-- Transport: two cost centres + "they pay" tickbox (Henry, 18 Nov 2026).
--
-- Receiving transport is a PROCUREMENT cost, dispatch transport is a SALES cost: two different costs,
-- reported separately (report_view.js), never added together. Wherever a transport cost is entered there
-- is now a tickbox for "the other side pays", and then no cost is needed:
--   Kernel receiving (My Day rate task)  intake_data.delivery.transport.paid_by = 'supplier' (else 'macavation')
--   Oil receiving (New delivery)         oil_delivery_transport.transport_payer = 'supplier' | 'macavation'
--   Kernel / oil dispatch                transport_payer = 'customer' (columns already exist)
-- The report counts "they paid" trips separately: they are neither our cost nor a missing cost.
--
-- Also: an R0 kernel rate typed into the task (rate_entered_at set) is a real "free" entry, not missing;
-- only the R0 that the 27 Oct backfill left behind (no rate_entered_at) still counts as missing.
--
-- Builds on 20261118090000. Oil receiving now saves through save_oil_delivery_transport (adds
-- p_supplier_pays); set_oil_delivery_transport from 090000 is left in place but no longer called.

-- ---------------------------------------------------------------------------
-- 1. Kernel receiving: rate task tickbox
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_transport_rate(p_kernel_id uuid, p_rate_zar numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_rate_zar IS NULL OR p_rate_zar < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the rate for the whole trip (0 or more).');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kernel
                   WHERE id = p_kernel_id AND is_active AND (intake_data #> '{delivery,transport}') IS NOT NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery not found.');
    END IF;

    UPDATE public.kernel
    SET intake_data = jsonb_set(jsonb_set(
            jsonb_set(intake_data, '{delivery,transport,rate_zar}', to_jsonb(round(p_rate_zar, 2)), true),
            '{delivery,transport,rate_entered_at}', to_jsonb(now()), true),
            '{delivery,transport,paid_by}', '"macavation"'::jsonb, true),
        updated_at = now()
    WHERE id = p_kernel_id;

    PERFORM public._complete_transport_rate_task(p_kernel_id);
    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'rate_zar', round(p_rate_zar, 2));
END;
$$;

-- The tickbox: the grower / supplier paid for this delivery's transport. No rate, task closed.
CREATE OR REPLACE FUNCTION public.set_transport_paid_by_supplier(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.kernel
                   WHERE id = p_kernel_id AND is_active AND (intake_data #> '{delivery,transport}') IS NOT NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery not found.');
    END IF;

    UPDATE public.kernel
    SET intake_data = jsonb_set(jsonb_set(
            jsonb_set(intake_data, '{delivery,transport,rate_zar}', '0'::jsonb, true),
            '{delivery,transport,rate_entered_at}', to_jsonb(now()), true),
            '{delivery,transport,paid_by}', '"supplier"'::jsonb, true),
        updated_at = now()
    WHERE id = p_kernel_id;

    PERFORM public._complete_transport_rate_task(p_kernel_id);
    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'paid_by', 'supplier');
END;
$$;

-- A delivery already marked "supplier pays" never needs a rate task.
CREATE OR REPLACE FUNCTION public._kernel_transport_rate_task()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.is_active AND (NEW.intake_data #> '{delivery,transport}') IS NOT NULL THEN
        IF (NEW.intake_data #>> '{delivery,transport,rate_zar}') IS NULL
           AND COALESCE(NEW.intake_data #>> '{delivery,transport,paid_by}', '') <> 'supplier' THEN
            PERFORM public._ensure_transport_rate_task(NEW.id);
        ELSE
            PERFORM public._complete_transport_rate_task(NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Oil receiving: payer column + tickbox argument
-- ---------------------------------------------------------------------------
ALTER TABLE public.oil_delivery_transport
    ADD COLUMN IF NOT EXISTS transport_payer text NOT NULL DEFAULT 'macavation'
        CHECK (transport_payer IN ('macavation', 'supplier'));

CREATE OR REPLACE FUNCTION public.save_oil_delivery_transport(
    p_delivery_group_id uuid,
    p_transporter_id    uuid DEFAULT NULL,
    p_transporter_name  text DEFAULT NULL,
    p_cost_zar          numeric DEFAULT NULL,
    p_supplier_pays     boolean DEFAULT false,
    p_actor_user_id     uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_name  text := NULLIF(btrim(COALESCE(p_transporter_name, '')), '');
    v_payer text := CASE WHEN COALESCE(p_supplier_pays, false) THEN 'supplier' ELSE 'macavation' END;
BEGIN
    IF p_delivery_group_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This delivery has no delivery id, so transport cannot be saved on it.');
    END IF;
    IF p_cost_zar IS NOT NULL AND p_cost_zar < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transport cost cannot be negative.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.oil o WHERE o.intake_data->>'delivery_group_id' = p_delivery_group_id::text LIMIT 1) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery not found.');
    END IF;
    IF p_transporter_id IS NOT NULL THEN
        SELECT COALESCE(v_name, t.name) INTO v_name FROM public.transporters t WHERE t.id = p_transporter_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Transporter not found.');
        END IF;
    END IF;

    INSERT INTO public.oil_delivery_transport AS t
        (delivery_group_id, transporter_id, transporter_name, cost_zar, transport_payer, updated_at, updated_by)
    VALUES (p_delivery_group_id, p_transporter_id, v_name,
            CASE WHEN v_payer = 'supplier' THEN NULL ELSE round(p_cost_zar, 2) END,   -- their transport is not our cost
            v_payer, now(), p_actor_user_id)
    ON CONFLICT (delivery_group_id) DO UPDATE
       SET transporter_id = EXCLUDED.transporter_id,
           transporter_name = EXCLUDED.transporter_name,
           cost_zar = EXCLUDED.cost_zar,
           transport_payer = EXCLUDED.transport_payer,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_oil_delivery_transport(p_delivery_group_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'transport',
        (SELECT jsonb_build_object('transporter_id', t.transporter_id, 'transporter_name', t.transporter_name,
                                   'cost_zar', t.cost_zar, 'transport_payer', t.transport_payer, 'updated_at', t.updated_at)
           FROM public.oil_delivery_transport t
          WHERE t.delivery_group_id = p_delivery_group_id
          LIMIT 1));
$$;

-- ---------------------------------------------------------------------------
-- 3. Report: payer on receiving trips, "they paid" counts per cost centre
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._report_transport_trips(p_from date, p_to date)
RETURNS TABLE (direction text, stream text, transporter text, trip_date date, kg numeric, pallets integer,
               payer text, cost_zar numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    -- Kernel in: grower deliveries that went through the transport step.
    SELECT 'in', 'kernel',
           COALESCE(NULLIF(btrim(k.intake_data #>> '{delivery,transport,transporter_name}'), ''), 'Transporter not recorded'),
           k.received_date,
           COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg),
           CASE WHEN jsonb_typeof(k.intake_data #> '{delivery,bags}') = 'array'
                THEN jsonb_array_length(k.intake_data #> '{delivery,bags}') END,
           CASE WHEN k.intake_data #>> '{delivery,transport,paid_by}' = 'supplier' THEN 'supplier' ELSE 'macavation' END,
           CASE WHEN k.intake_data #>> '{delivery,transport,paid_by}' = 'supplier' THEN NULL
                WHEN (k.intake_data #>> '{delivery,transport,rate_zar}') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN NULL
                -- typed into the task (even R0) is a real entry; an R0 with no entry time is the old backfill
                WHEN (k.intake_data #>> '{delivery,transport,rate_entered_at}') IS NOT NULL
                     THEN (k.intake_data #>> '{delivery,transport,rate_zar}')::numeric
                ELSE NULLIF((k.intake_data #>> '{delivery,transport,rate_zar}')::numeric, 0) END
      FROM public.kernel k
     WHERE k.is_active
       AND (k.intake_data #> '{delivery,transport}') IS NOT NULL
       AND k.received_date BETWEEN p_from AND p_to

    UNION ALL
    -- Kernel out: dispatches priced at step 3 (only those carry a payer).
    SELECT 'out', 'kernel',
           COALESCE(NULLIF(btrim(COALESCE(o.transport_company, o.record->>'transport_company', '')), ''), 'Transporter not recorded'),
           x.d,
           (SELECT sum(CASE WHEN (l->>'quantity_kg') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN (l->>'quantity_kg')::numeric END)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) l),
           o.pallets,
           o.transport_payer,
           o.transport_cost_zar
      FROM public.kernel_dispatch_orders o
      CROSS JOIN LATERAL (
          SELECT COALESCE((SELECT min(s.sale_date) FROM public.data_kernel_sales_lines s WHERE s.dispatch_order_id = o.id),
                          (o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date,
                          (o.approved_at AT TIME ZONE 'Africa/Johannesburg')::date) AS d) x
     WHERE o.status IS DISTINCT FROM 'cancelled'
       AND o.transport_payer IS NOT NULL
       AND x.d BETWEEN p_from AND p_to

    UNION ALL
    -- Oil in: one trip per supplier delivery (bags grouped by delivery_group_id).
    SELECT 'in', 'oil',
           COALESCE(NULLIF(btrim(t.transporter_name), ''), 'Transporter not recorded'),
           g.d, g.kg, NULL::integer, COALESCE(t.transport_payer, 'macavation'), t.cost_zar
      FROM (
          SELECT o.intake_data->>'delivery_group_id' AS gid,
                 min((o.intake_data->>'date_received')::date) AS d,
                 sum(CASE WHEN (o.intake_data->>'quantity_kg') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                          THEN (o.intake_data->>'quantity_kg')::numeric END) AS kg
            FROM public.oil o
           WHERE COALESCE(o.is_active, true)
             AND (o.intake_data->>'delivery_group_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             AND (o.intake_data->>'date_received') ~ '^\d{4}-\d{2}-\d{2}'
             AND COALESCE((o.intake_data->>'from_adjust_stock')::boolean, false) = false
           GROUP BY 1) g
      LEFT JOIN public.oil_delivery_transport t ON t.delivery_group_id = g.gid::uuid
     WHERE g.d BETWEEN p_from AND p_to

    UNION ALL
    -- Oil out: dispatched orders.
    SELECT 'out', 'oil',
           COALESCE(NULLIF(btrim(COALESCE(o.record->>'transport_company', '')), ''), 'Transporter not recorded'),
           x.d,
           (SELECT sum(CASE WHEN (l->>'quantity_kg') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN (l->>'quantity_kg')::numeric END)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) l),
           NULL::integer,
           o.transport_payer,
           o.transport_cost_zar
      FROM public.oil_dispatch_orders o
      CROSS JOIN LATERAL (
          SELECT COALESCE(CASE WHEN (o.record->>'date_dispatched') ~ '^\d{4}-\d{2}-\d{2}' THEN (o.record->>'date_dispatched')::date END,
                          (o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date) AS d) x
     WHERE o.status = 'dispatched'
       AND x.d BETWEEN p_from AND p_to;
$$;

-- Same shape as 20261118090000, plus other_paid_trips {in, out}. "Ours" = payer is not supplier/customer.
CREATE OR REPLACE FUNCTION public.get_report_transport(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_prev_from date;
    v_prev_to   date;
    v_out       jsonb;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A from and to date are required.');
    END IF;
    IF p_from = date_trunc('month', p_from)::date AND p_to = (date_trunc('month', p_from) + interval '1 month' - interval '1 day')::date THEN
        v_prev_from := (p_from - interval '1 month')::date;
    ELSE
        v_prev_from := p_from - (p_to - p_from + 1);
    END IF;
    v_prev_to := p_from - 1;

    WITH t AS (
        SELECT * FROM public._report_transport_trips(p_from, p_to)
    ),
    paid AS (
        SELECT * FROM t WHERE COALESCE(payer, '') NOT IN ('customer', 'supplier')
    ),
    by_tr AS (
        SELECT direction, stream, transporter,
               count(*) AS trips,
               count(cost_zar) AS priced_trips,
               sum(kg) AS kg,
               sum(kg) FILTER (WHERE cost_zar IS NOT NULL) AS priced_kg,
               sum(pallets) FILTER (WHERE cost_zar IS NOT NULL) AS priced_pallets,
               sum(cost_zar) AS cost_zar
          FROM paid
         GROUP BY 1, 2, 3
    ),
    tot AS (
        SELECT COALESCE(direction, 'all') AS k,
               count(*) AS trips, count(cost_zar) AS priced_trips, count(*) - count(cost_zar) AS unpriced_trips,
               sum(kg) AS kg, sum(kg) FILTER (WHERE cost_zar IS NOT NULL) AS priced_kg, sum(cost_zar) AS cost_zar
          FROM paid
         GROUP BY ROLLUP (direction)
    ),
    prev AS (
        SELECT sum(cost_zar) AS cost_zar,
               sum(cost_zar) FILTER (WHERE direction = 'in') AS in_cost_zar,
               sum(cost_zar) FILTER (WHERE direction = 'out') AS out_cost_zar,
               count(cost_zar) AS priced_trips
          FROM public._report_transport_trips(v_prev_from, v_prev_to)
         WHERE COALESCE(payer, '') NOT IN ('customer', 'supplier')
    )
    SELECT jsonb_build_object(
        'success', true,
        'from', p_from,
        'to', p_to,
        'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'direction', b.direction, 'stream', b.stream, 'transporter', b.transporter,
                    'trips', b.trips, 'priced_trips', b.priced_trips, 'kg', b.kg, 'priced_kg', b.priced_kg,
                    'priced_pallets', b.priced_pallets, 'cost_zar', b.cost_zar)
                    ORDER BY b.direction, b.stream, COALESCE(b.cost_zar, 0) DESC, b.transporter)
                  FROM by_tr b), '[]'::jsonb),
        'totals', COALESCE((SELECT jsonb_object_agg(x.k, jsonb_build_object(
                    'trips', x.trips, 'priced_trips', x.priced_trips, 'unpriced_trips', x.unpriced_trips,
                    'kg', x.kg, 'priced_kg', x.priced_kg, 'cost_zar', x.cost_zar)) FROM tot x), '{}'::jsonb),
        'missing', COALESCE((SELECT jsonb_agg(jsonb_build_object('direction', m.direction, 'stream', m.stream, 'trips', m.n)
                    ORDER BY m.direction, m.stream)
                  FROM (SELECT direction, stream, count(*) AS n FROM paid WHERE cost_zar IS NULL GROUP BY 1, 2) m), '[]'::jsonb),
        'customer_paid_trips', (SELECT count(*) FROM t WHERE payer = 'customer'),
        'other_paid_trips', jsonb_build_object(
            'in',  (SELECT count(*) FROM t WHERE direction = 'in'  AND payer IN ('customer', 'supplier')),
            'out', (SELECT count(*) FROM t WHERE direction = 'out' AND payer IN ('customer', 'supplier'))),
        'previous', (SELECT jsonb_build_object('from', v_prev_from, 'to', v_prev_to, 'cost_zar', p.cost_zar,
                        'in_cost_zar', p.in_cost_zar, 'out_cost_zar', p.out_cost_zar, 'priced_trips', p.priced_trips)
                       FROM prev p))
      INTO v_out;
    RETURN v_out;
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or amount could not be read.');
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants and RBAC
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._report_transport_trips(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._report_transport_trips(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_oil_delivery_transport(uuid, uuid, text, numeric, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_transport_paid_by_supplier(uuid) TO anon, authenticated, service_role;

-- "Supplier pays" on the rate task: same roles that can enter a rate.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', 'set_transport_paid_by_supplier', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'set_transport_rate' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function'
                     AND x.object_name = 'set_transport_paid_by_supplier' AND x.operation = 'EXECUTE');

-- Oil New delivery: same roles as the function it replaces.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', 'save_oil_delivery_transport', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'set_oil_delivery_transport' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function'
                     AND x.object_name = 'save_oil_delivery_transport' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
