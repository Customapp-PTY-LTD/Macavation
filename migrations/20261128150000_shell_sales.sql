-- ============================================================================
-- Shell page and shell sales (Mike's MacView, round 3, 27 Nov 2026).
--
-- WHY. Shell is weighed bag by bag on the cracking sheet (kernel.cracking_data, one row per day
-- with shell_bagN = bag number, shell_qtyN = kg), but the only place shell shows is the small
-- "Shell waste" menu on Stock on Hand: one lot per batch (shell_stock_lot, kg only) that can be
-- "dispatched" whole with a free-text customer reference. There is no shell sale with a customer,
-- invoice or price (checked 27 Nov 2026). MacView sells shell per bag, oldest bags first.
--
-- What this adds:
--   shell_sales                      one row per shell invoice: date, customer, invoice number,
--                                    bags, price per bag (excl. VAT), kg (worked out at save time
--                                    from the oldest bags), voided_at instead of deleting
--   _shell_bags()                    every bag weighed on a cracking sheet, oldest first, with
--                                    whether it is still on hand. A batch whose shell lot was
--                                    dispatched or written off in the old Shell waste menu counts
--                                    as gone (its bags are not on hand and are not sold again).
--   get_shell_overview()             the Shell screen: bags by batch and weigh day, every sale.
--                                    Prices / values are left out for roles without
--                                    "See costs and prices".
--   save_shell_sale(...)             add or change a sale; refuses more bags than are on hand
--   void_shell_sale(id, reason)      take a sale back off (its bags come back into stock)
--   portal_actor_has_action(key)     the API side of role_actions (super_user / admin always)
--   _customer_sales_lines            now also returns shell sales (kind 'shell'), so the
--                                    Customers screen shows shell buyers
--   screen  feature 'shell' for every role (bags and kg); action shell.sales.edit for
--           super_user, admin and the roles that see prices (they set the price per bag)
--
-- The Shell waste lots are NOT changed by a shell sale; see the follow-up in the round 3 report.
-- Idempotent. Needs 20260602140000 (shell_stock_lot), 20261128110000 (_customer_sales_lines,
-- portal_actor_sees_prices).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.shell_sales (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_date       date NOT NULL,
    customer_id     uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
    customer_name   text NOT NULL CHECK (length(btrim(customer_name)) > 0),
    invoice_number  text,
    bags            integer NOT NULL CHECK (bags > 0),
    price_per_bag   numeric(12,2) NOT NULL CHECK (price_per_bag >= 0),
    kg              numeric(12,2),
    notes           text,
    voided_at       timestamptz,
    void_reason     text,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shell_sales_date ON public.shell_sales (sale_date) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shell_sales_customer_id ON public.shell_sales (customer_id);

ALTER TABLE public.shell_sales ENABLE ROW LEVEL SECURITY;   -- read and written only through the functions below
REVOKE ALL ON public.shell_sales FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- API side of role_actions.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_actor_has_action(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.roles r ON r.id = u.role_id
        WHERE u.id = (SELECT a.actor FROM audit.current_actor() a LIMIT 1)
          AND COALESCE(u.is_active, true)
          AND (r.role_name IN ('super_user', 'admin')
               OR EXISTS (SELECT 1 FROM public.role_actions ra JOIN public.actions ac ON ac.id = ra.action_id
                          WHERE ra.role_id = r.id AND ac.key = p_key AND ra.value::text IN ('true', '"true"'))));
$$;

-- ----------------------------------------------------------------------------
-- Every shell bag weighed on a cracking sheet, oldest first; sold oldest first.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._shell_bags()
RETURNS TABLE (rn bigint, kernel_id uuid, batch text, day date, bag_no text, kg numeric, gone boolean, sold boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH rows_ AS (
        SELECT k.id AS kernel_id, b.batch_id AS batch, d.e AS e, d.o AS o
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(k.cracking_data) = 'array' THEN k.cracking_data ELSE '[]'::jsonb END) WITH ORDINALITY AS d(e, o)
        WHERE COALESCE(k.is_active, true)
    ), bags AS (
        SELECT r.kernel_id, r.batch,
               CASE WHEN (r.e ->> 'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (r.e ->> 'date')::date END AS day,
               r.o, n.n,
               NULLIF(btrim(r.e ->> ('shell_bag' || n.n)), '') AS bag_no,
               (r.e ->> ('shell_qty' || n.n))::numeric AS kg
        FROM rows_ r
        CROSS JOIN LATERAL (
            SELECT substring(key FROM '^shell_qty(\d+)$')::int AS n
            FROM jsonb_object_keys(r.e) AS key
            WHERE key ~ '^shell_qty\d+$'
        ) n
        WHERE (r.e ->> ('shell_qty' || n.n)) ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
          AND (r.e ->> ('shell_qty' || n.n))::numeric > 0
    ), marked AS (
        SELECT g.*,
               EXISTS (SELECT 1 FROM public.shell_stock_lot l
                       WHERE public._batch_norm(l.lot_number) = public._batch_norm('SHELL-' || g.batch)
                         AND l.status IN ('dispatched', 'written_off')) AS gone
        FROM bags g
    ), numbered AS (
        SELECT m.*, CASE WHEN m.gone THEN NULL
                         ELSE row_number() OVER (PARTITION BY m.gone ORDER BY m.day NULLS LAST, m.batch, m.o, m.n) END AS rn
        FROM marked m
    )
    SELECT x.rn, x.kernel_id, x.batch, x.day, x.bag_no, x.kg, x.gone,
           (NOT x.gone AND x.rn <= (SELECT COALESCE(sum(s.bags), 0) FROM public.shell_sales s WHERE s.voided_at IS NULL)) AS sold
    FROM numbered x
    ORDER BY x.gone, x.rn NULLS LAST, x.day;
$$;

-- ----------------------------------------------------------------------------
-- The Shell screen.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_shell_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_prices boolean := public.portal_actor_sees_prices();
    v_batches jsonb;
    v_sales jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'kernel_id', g.kernel_id, 'batch', g.batch, 'day', g.day, 'gone', g.gone,
               'bags', g.bags, 'kg', g.kg, 'left', g.left_bags, 'left_kg', g.left_kg)
             ORDER BY g.day DESC NULLS LAST, g.batch), '[]'::jsonb)
    INTO v_batches
    FROM (
        SELECT b.kernel_id, b.batch, b.day, b.gone, count(*) AS bags, sum(b.kg) AS kg,
               count(*) FILTER (WHERE NOT b.gone AND NOT b.sold) AS left_bags,
               COALESCE(sum(b.kg) FILTER (WHERE NOT b.gone AND NOT b.sold), 0) AS left_kg
        FROM public._shell_bags() b
        GROUP BY b.kernel_id, b.batch, b.day, b.gone
    ) g;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', s.id, 'date', s.sale_date, 'customer_id', s.customer_id, 'customer', s.customer_name,
               'invoice', s.invoice_number, 'bags', s.bags, 'kg', s.kg, 'notes', s.notes,
               'price', CASE WHEN v_prices THEN s.price_per_bag END,
               'value', CASE WHEN v_prices THEN s.bags * s.price_per_bag END)
             ORDER BY s.sale_date DESC, s.created_at DESC), '[]'::jsonb)
    INTO v_sales
    FROM public.shell_sales s
    WHERE s.voided_at IS NULL;

    RETURN jsonb_build_object('success', true, 'sees_prices', v_prices,
                              'can_sell', public.portal_actor_has_action('shell.sales.edit') AND v_prices,
                              'batches', v_batches, 'sales', v_sales);
END;
$$;

-- ----------------------------------------------------------------------------
-- Add or change a sale. kg = the weight of the bags it takes, oldest first.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_shell_sale(
    p_id uuid, p_sale_date date, p_customer_id uuid, p_customer_name text, p_invoice_number text,
    p_bags integer, p_price_per_bag numeric, p_notes text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_actor uuid := (SELECT a.actor FROM audit.current_actor() a LIMIT 1);
    v_old integer := 0;
    v_sold_before bigint;
    v_on_hand bigint;
    v_kg numeric;
    v_name text := NULLIF(btrim(p_customer_name), '');
    v_id uuid;
BEGIN
    IF NOT (public.portal_actor_has_action('shell.sales.edit') AND public.portal_actor_sees_prices()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to record shell sales.');
    END IF;
    IF p_sale_date IS NULL OR p_bags IS NULL OR p_bags < 1 OR p_price_per_bag IS NULL OR p_price_per_bag < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Fill in the date, bags and price per bag.');
    END IF;
    IF p_customer_id IS NOT NULL THEN
        SELECT coalesce(nullif(c.trading_name, ''), c.company_name) INTO v_name
        FROM public.contacts c WHERE c.id = p_customer_id AND c.deleted_at IS NULL;
        IF v_name IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'That customer is not on the list.');
        END IF;
    END IF;
    IF v_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose or type the customer.');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('shell_sales'));
    IF p_id IS NOT NULL THEN
        SELECT bags INTO v_old FROM public.shell_sales WHERE id = p_id AND voided_at IS NULL FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'That sale no longer exists.');
        END IF;
    END IF;

    SELECT COALESCE(sum(bags), 0) INTO v_sold_before FROM public.shell_sales WHERE voided_at IS NULL AND id IS DISTINCT FROM p_id;
    SELECT count(*) INTO v_on_hand FROM public._shell_bags() b WHERE NOT b.gone;
    IF v_sold_before + p_bags > v_on_hand THEN
        RETURN jsonb_build_object('success', false,
            'error', format('Only %s bag%s of shell %s in stock.', v_on_hand - v_sold_before,
                            CASE WHEN v_on_hand - v_sold_before = 1 THEN '' ELSE 's' END,
                            CASE WHEN v_on_hand - v_sold_before = 1 THEN 'is' ELSE 'are' END));
    END IF;
    SELECT COALESCE(sum(b.kg), 0) INTO v_kg FROM public._shell_bags() b
    WHERE NOT b.gone AND b.rn > v_sold_before AND b.rn <= v_sold_before + p_bags;

    IF p_id IS NULL THEN
        INSERT INTO public.shell_sales (sale_date, customer_id, customer_name, invoice_number, bags, price_per_bag, kg, notes, created_by, updated_by)
        VALUES (p_sale_date, p_customer_id, v_name, NULLIF(btrim(p_invoice_number), ''), p_bags, round(p_price_per_bag, 2), round(v_kg, 2),
                NULLIF(btrim(p_notes), ''), v_actor, v_actor)
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.shell_sales
        SET sale_date = p_sale_date, customer_id = p_customer_id, customer_name = v_name,
            invoice_number = NULLIF(btrim(p_invoice_number), ''), bags = p_bags, price_per_bag = round(p_price_per_bag, 2),
            kg = round(v_kg, 2), notes = NULLIF(btrim(p_notes), ''), updated_by = v_actor, updated_at = now()
        WHERE id = p_id
        RETURNING id INTO v_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'kg', round(v_kg, 2));
END;
$$;

CREATE OR REPLACE FUNCTION public.void_shell_sale(p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_actor uuid := (SELECT a.actor FROM audit.current_actor() a LIMIT 1);
BEGIN
    IF NOT public.portal_actor_has_action('shell.sales.edit') THEN
        RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to change shell sales.');
    END IF;
    UPDATE public.shell_sales
    SET voided_at = now(), void_reason = NULLIF(btrim(p_reason), ''), updated_by = v_actor, updated_at = now()
    WHERE id = p_id AND voided_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That sale no longer exists.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- Customers screen: shell sales are sales lines too.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._customer_sales_lines(p_from date, p_to date)
RETURNS TABLE (src text, kind text, d date, invoice text, product text, kg numeric, value numeric,
               customer_id uuid, name text, country text, export boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH cust AS (
        SELECT c.id, public._sup_norm(coalesce(nullif(c.trading_name, ''), c.company_name)) AS n1, public._sup_norm(c.company_name) AS n2
        FROM public.contacts c
        WHERE c.deleted_at IS NULL AND c.contact_type IN ('kernel_customer', 'customer', 'both', 'oil_protein_customer')
    ), raw AS (
        SELECT 'kernel'::text AS src, 'kernel'::text AS kind, k.sale_date AS d, k.invoice_number AS invoice,
               coalesce(nullif(k.description, ''), k.style_code, k.item_code) AS product,
               k.quantity_kg AS kg, k.vat_excl_zar AS value, k.customer_id, k.customer_name AS name, NULL::text AS country, false AS export
        FROM public.data_kernel_sales_lines k
        WHERE k.sale_date BETWEEN p_from AND p_to
        UNION ALL
        SELECT 'oil', CASE o.product_line WHEN 'protein' THEN 'protein' WHEN 'cake' THEN 'cake' ELSE 'oil' END,
               o.sale_date, o.invoice_number, coalesce(nullif(o.description, ''), o.product_line), o.quantity_kg, o.vat_excl_zar,
               o.customer_id, o.customer_name, NULL, false
        FROM public.data_oil_sales_lines o
        WHERE o.sale_date BETWEEN p_from AND p_to AND o.export_register_id IS NULL
        UNION ALL
        SELECT 'export', CASE x.product_class WHEN 'protein' THEN 'protein' ELSE 'oil' END,
               x.export_date, coalesce(nullif(x.document_number, ''), x.reference),
               x.product_class, x.weight_kg, x.rand_value, x.customer_id, x.customer_name, nullif(btrim(x.location_country), ''), true
        FROM public.data_oil_export_register x
        WHERE x.export_date BETWEEN p_from AND p_to
        UNION ALL
        SELECT 'shell', 'shell', s.sale_date, s.invoice_number, 'Shell, ' || s.bags || ' bag' || CASE WHEN s.bags = 1 THEN '' ELSE 's' END,
               s.kg, s.bags * s.price_per_bag, s.customer_id, s.customer_name, NULL, false
        FROM public.shell_sales s
        WHERE s.voided_at IS NULL AND s.sale_date BETWEEN p_from AND p_to
    )
    SELECT r.src, r.kind, r.d, r.invoice, r.product, r.kg, r.value,
           COALESCE(r.customer_id, (SELECT c.id FROM cust c WHERE public._sup_norm(r.name) IN (c.n1, c.n2) LIMIT 1)),
           NULLIF(btrim(r.name), ''), r.country, r.export
    FROM raw r;
$$;

-- ----------------------------------------------------------------------------
-- Screen, action, grants.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active)
VALUES ('shell', 'Shell', 'Shell bags on hand by batch (weighed on the cracking sheet) and shell sales per bag.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE f.key = 'shell'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

INSERT INTO public.actions (key, module, label, description) VALUES
    ('shell.sales.edit', 'Shell', 'Record shell sales', 'Add, change and take back shell sales (customer, invoice, bags and price per bag)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT DISTINCT r.id, a.id, 'true'
FROM public.actions a CROSS JOIN public.roles r
WHERE a.key = 'shell.sales.edit'
  AND (r.role_name IN ('super_user', 'admin')
       OR r.id IN (SELECT rf.role_id FROM public.role_features rf JOIN public.features f ON f.id = rf.feature_id
                   WHERE f.key = 'see-costs-prices' AND rf.value = 'true'))
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

REVOKE ALL ON FUNCTION public._shell_bags() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._customer_sales_lines(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_actor_has_action(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shell_overview() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_shell_sale(uuid, date, uuid, text, text, integer, numeric, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_shell_sale(uuid, text) TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', 'get_shell_overview', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = r.id AND x.object_type = 'function' AND x.object_name = 'get_shell_overview' AND x.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT ra.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_actions ra JOIN public.actions a ON a.id = ra.action_id
CROSS JOIN unnest(ARRAY['save_shell_sale', 'void_shell_sale']) AS fn
WHERE a.key = 'shell.sales.edit' AND ra.value::text IN ('true', '"true"')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = ra.role_id AND x.object_type = 'function' AND x.object_name = fn AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
