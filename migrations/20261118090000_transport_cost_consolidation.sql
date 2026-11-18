-- Monthly report: transport cost consolidation (Henry, 18 Nov 2026).
--
-- WHAT. One place that adds up every transport cost Macavation pays in a month, by transporter:
--   Kernel in   grower deliveries   kernel.intake_data.delivery.transport.rate_zar (My Day task, PR #133)
--   Kernel out  dispatch and sales  kernel_dispatch_orders.transport_cost_zar where transport_payer = 'macavation'
--   Oil in      supplier deliveries NEW public.oil_delivery_transport, one row per delivery_group_id
--   Oil out     oil dispatch        NEW oil_dispatch_orders.transport_payer / transport_cost_zar
--
-- WHY a table for oil in. An oil delivery is saved as one oil row PER BAG (all sharing
-- intake_data.delivery_group_id). A cost on every bag would be counted once per bag, and editing one
-- bag would leave the others stale. So the cost lives once per delivery, keyed by the group id.
--
-- RULES the report follows.
--   * Costs are Rand EXCLUDING VAT (same as the dispatch pricing step).
--   * A kernel delivery saved with R0 counts as "no cost entered" (the rate task treats R0 the same).
--   * Transport the CUSTOMER pays is not Macavation's cost: only counted, never added.
--   * Months follow the same dates as the rest of the report: kernel in = kernel.received_date,
--     kernel out = the sale date written to data_kernel_sales_lines (else dispatched/approved date),
--     oil in = intake_data.date_received, oil out = record.date_dispatched (else dispatched_at).
--
-- Undo (manual): remove the six functions and the oil_delivery_transport table added here, remove the two
-- new oil_dispatch_orders columns, and restore report_build_snapshot from 20261112110000_weekly_report_v2.sql.

-- ---------------------------------------------------------------------------
-- 1. Oil in: one transport row per delivery
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oil_delivery_transport (
    delivery_group_id uuid PRIMARY KEY,
    transporter_id    uuid REFERENCES public.transporters(id) ON DELETE SET NULL,
    transporter_name  text,
    cost_zar          numeric(14,2) CHECK (cost_zar IS NULL OR cost_zar >= 0),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        uuid
);
CREATE INDEX IF NOT EXISTS idx_oil_delivery_transport_transporter_id ON public.oil_delivery_transport(transporter_id);
ALTER TABLE public.oil_delivery_transport ENABLE ROW LEVEL SECURITY;
-- No policies: read and written only through the SECURITY DEFINER functions below.

COMMENT ON TABLE public.oil_delivery_transport IS
    'Transport cost (R excl. VAT) and transporter for one oil supplier delivery (all bags sharing oil.intake_data.delivery_group_id). Read by get_report_transport.';

CREATE OR REPLACE FUNCTION public.get_oil_delivery_transport(p_delivery_group_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'transport',
        (SELECT jsonb_build_object('transporter_id', t.transporter_id, 'transporter_name', t.transporter_name,
                                   'cost_zar', t.cost_zar, 'updated_at', t.updated_at)
           FROM public.oil_delivery_transport t
          WHERE t.delivery_group_id = p_delivery_group_id
          LIMIT 1));
$$;

-- Saves (or clears, when all three are empty) the transport for a delivery.
CREATE OR REPLACE FUNCTION public.set_oil_delivery_transport(
    p_delivery_group_id uuid,
    p_transporter_id    uuid DEFAULT NULL,
    p_transporter_name  text DEFAULT NULL,
    p_cost_zar          numeric DEFAULT NULL,
    p_actor_user_id     uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_name text := NULLIF(btrim(COALESCE(p_transporter_name, '')), '');
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

    INSERT INTO public.oil_delivery_transport AS t (delivery_group_id, transporter_id, transporter_name, cost_zar, updated_at, updated_by)
    VALUES (p_delivery_group_id, p_transporter_id, v_name, round(p_cost_zar, 2), now(), p_actor_user_id)
    ON CONFLICT (delivery_group_id) DO UPDATE
       SET transporter_id = EXCLUDED.transporter_id,
           transporter_name = EXCLUDED.transporter_name,
           cost_zar = EXCLUDED.cost_zar,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Oil out: who pays and what it cost, like kernel_dispatch_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.oil_dispatch_orders
    ADD COLUMN IF NOT EXISTS transport_payer    text CHECK (transport_payer IN ('macavation', 'customer')),
    ADD COLUMN IF NOT EXISTS transport_cost_zar numeric(14,2) CHECK (transport_cost_zar IS NULL OR transport_cost_zar >= 0);

CREATE OR REPLACE FUNCTION public.get_oil_dispatch_transport(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'transport',
        (SELECT jsonb_build_object('transport_payer', o.transport_payer, 'transport_cost_zar', o.transport_cost_zar)
           FROM public.oil_dispatch_orders o WHERE o.id = p_order_id LIMIT 1));
$$;

CREATE OR REPLACE FUNCTION public.set_oil_dispatch_transport(
    p_order_id           uuid,
    p_transport_payer    text DEFAULT NULL,
    p_transport_cost_zar numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_transport_payer IS NOT NULL AND p_transport_payer NOT IN ('macavation', 'customer') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose who pays for transport.');
    END IF;
    IF p_transport_cost_zar IS NOT NULL AND p_transport_cost_zar < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transport cost cannot be negative.');
    END IF;
    UPDATE public.oil_dispatch_orders
       SET transport_payer = p_transport_payer,
           -- the customer's own transport is not a Macavation cost, so no cost is kept for it
           transport_cost_zar = CASE WHEN p_transport_payer = 'customer' THEN NULL ELSE round(p_transport_cost_zar, 2) END,
           updated_at = now()
     WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Every trip in a date range, one row each, from the four sources
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
           'macavation',
           NULLIF(CASE WHEN (k.intake_data #>> '{delivery,transport,rate_zar}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                       THEN (k.intake_data #>> '{delivery,transport,rate_zar}')::numeric END, 0)
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
           g.d, g.kg, NULL::integer, 'macavation', t.cost_zar
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

-- ---------------------------------------------------------------------------
-- 4. The report block: by transporter, in vs out, with last month's total
-- ---------------------------------------------------------------------------
-- Shape:
--   { success, from, to,
--     rows: [{direction 'in'|'out', stream 'kernel'|'oil', transporter, trips, priced_trips, kg, priced_kg,
--             priced_pallets, cost_zar}]                         -- Macavation-paid trips only
--     totals: {in|out|all: {trips, priced_trips, unpriced_trips, kg, priced_kg, cost_zar}},
--     missing: [{direction, stream, trips}]                       -- trips with no cost entered yet
--     customer_paid_trips,                                        -- out trips the customer paid for
--     previous: {from, to, cost_zar, in_cost_zar, out_cost_zar, priced_trips} }
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
    -- Same-length period straight before (for a month: the previous calendar month).
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
        SELECT * FROM t WHERE payer IS DISTINCT FROM 'customer'
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
         WHERE payer IS DISTINCT FROM 'customer'
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
        'previous', (SELECT jsonb_build_object('from', v_prev_from, 'to', v_prev_to, 'cost_zar', p.cost_zar,
                        'in_cost_zar', p.in_cost_zar, 'out_cost_zar', p.out_cost_zar, 'priced_trips', p.priced_trips)
                       FROM prev p))
      INTO v_out;
    RETURN v_out;
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or amount could not be read.');
END;
$$;

COMMENT ON FUNCTION public.get_report_transport(date, date) IS
    'Monthly report transport consolidation: Macavation-paid transport (R excl. VAT) by direction, stream and transporter, trips with no cost yet, and the previous period total.';

-- ---------------------------------------------------------------------------
-- 5. Monthly snapshot carries the block (weekly unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_build_snapshot(p_period_type text, p_period_start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from date;
    v_to   date;
    v_out  jsonb;
BEGIN
    IF p_period_type IS NULL OR p_period_type NOT IN ('weekly', 'monthly') OR p_period_start IS NULL THEN
        RETURN jsonb_build_object('version', 1, 'figures',
            jsonb_build_object('success', false, 'error', 'A weekly or monthly period start is required.'));
    END IF;
    IF p_period_type = 'weekly' THEN
        v_from := date_trunc('week', p_period_start)::date;
        v_to   := v_from + 6;
    ELSE
        v_from := date_trunc('month', p_period_start)::date;
        v_to   := (v_from + interval '1 month' - interval '1 day')::date;
    END IF;

    v_out := jsonb_build_object(
        'version', 1,
        'built_at', now(),
        'figures', public.get_reports_all_figures(v_from, v_to),
        'comparison', public.get_report_comparison(p_period_type, v_from),
        'coming_up', public.get_report_coming_up(p_period_type, v_from));
    IF p_period_type = 'weekly' THEN
        v_out := v_out || jsonb_build_object('weekly', public.get_report_weekly_detail(v_from, v_to));
    ELSE
        v_out := v_out || jsonb_build_object('transport', public.get_report_transport(v_from, v_to));
    END IF;
    RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants and RBAC (same roles as the screens that call them)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._report_transport_trips(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._report_transport_trips(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_report_transport(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_delivery_transport(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_oil_delivery_transport(uuid, uuid, text, numeric, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_dispatch_transport(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_oil_dispatch_transport(uuid, text, numeric) TO anon, authenticated, service_role;

-- Oil New delivery: every role that can save an oil intake bag.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_permissions rp
CROSS JOIN unnest(ARRAY['get_oil_delivery_transport', 'set_oil_delivery_transport']) AS fn
WHERE rp.object_type = 'function' AND rp.object_name = 'upsert_oil_batch' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = fn AND x.operation = 'EXECUTE');

-- Oil dispatch: every role that can save an oil dispatch record.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_permissions rp
CROSS JOIN unnest(ARRAY['get_oil_dispatch_transport', 'set_oil_dispatch_transport']) AS fn
WHERE rp.object_type = 'function' AND rp.object_name = 'save_oil_dispatch_record' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = fn AND x.operation = 'EXECUTE');

-- Reports: every role that can build a report snapshot.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', 'get_report_transport', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'report_build_snapshot' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = 'get_report_transport' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
