-- ============================================================================
-- Customers > performance and map (Mike's MacView, round 3, 27 Nov 2026).
--
-- WHY. CRM keeps the customer contacts (Kernel Customers, Oil & Protein Customers) and the Data
-- page keeps every sales line, but nothing rolls the lines up by customer: who buys most, when
-- they last bought, this year so far, local or export, which products. MacView has this.
-- Sales are NOT re-entered: everything is read from the existing sales ledgers.
--
-- Sales lines (verified on the dev DB 27 Nov 2026):
--   data_kernel_sales_lines   kernel invoices (vat_excl_zar), incl. dispatch-approved lines and
--                             negative return lines, so plain sums are already net of returns.
--   data_oil_sales_lines      Pete's local oil / protein / cake invoice book (vat_excl_zar).
--                             A line with export_register_id is the SAME sale as an export
--                             register row (20260821100000) and is skipped, exactly as Pete's
--                             reports do, so nothing is counted twice.
--   data_oil_export_register  bulk export invoices; rand_value is the rand amount; country kept.
--   (Shell sales join this read in 20261128150000.)
--
-- Customer matching: customer_id when set, else the name with (Pty) Ltd / CC / punctuation
-- ignored, against customer contacts. A name that matches nothing is returned as it is, and the
-- screen shows it with "not on the customer list".
-- Local or export: export when the customer has a line on the export register, or its contact
-- country is not South Africa.
--
-- Prices and rand values are role-gated (Henry, 27 Nov 2026: Sales Exec, Palladium Manager,
-- Shareholder and Procurement Lead see them, plus super_user and admin):
--   feature 'see-costs-prices'   a Role Features switch, not a screen
--   portal_actor_sees_prices()   true for super_user / admin / a role with the switch, and for a
--                                server-side call with no person behind it (service role, cron).
--                                The caller is the X-User-Id the portal sends (audit.current_actor);
--                                that is as strong as the portal's identity is today.
--   get_customer_performance returns value = NULL on every line when the caller may not see prices.
--
-- What this adds:
--   portal_actor_sees_prices()
--   _customer_sales_lines(from, to)        one row per sales line, all three ledgers, matched
--   get_customer_performance(from, to)     the Customers screen (period lines + directory with
--                                          last invoice and this financial year so far)
--   screen  feature 'customers' for super_user, admin and every role that has the Sales screen
--   switch  feature 'see-costs-prices'
--
-- Idempotent. Needs 20260819100000, 20260821100000 (sales ledgers), 20261128090000 (_sup_norm,
-- contacts latitude/longitude).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Who may see prices and rand values.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active)
VALUES ('see-costs-prices', 'See costs and prices',
        'Switch, not a screen: this role sees rand values, prices, sales values, stock value and transport costs. Roles without it see kg only.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE f.key = 'see-costs-prices'
  AND r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager', 'Shareholder', 'Procurement Lead')
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

CREATE OR REPLACE FUNCTION public.portal_actor_sees_prices()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_actor uuid;
    v_claims jsonb;
BEGIN
    SELECT a.actor INTO v_actor FROM audit.current_actor() a;
    IF v_actor IS NULL THEN
        -- No person behind the call. The service role (edge functions, WhatsApp reports, cron)
        -- and a direct SQL session may see values; an anonymous browser call may not.
        BEGIN
            v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
        EXCEPTION WHEN OTHERS THEN
            v_claims := NULL;
        END;
        RETURN v_claims IS NULL OR COALESCE(v_claims ->> 'role', '') = 'service_role';
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.roles r ON r.id = u.role_id
        WHERE u.id = v_actor AND COALESCE(u.is_active, true)
          AND (r.role_name IN ('super_user', 'admin')
               OR EXISTS (SELECT 1 FROM public.role_features rf JOIN public.features f ON f.id = rf.feature_id
                          WHERE rf.role_id = r.id AND f.key = 'see-costs-prices' AND f.is_active AND rf.value = 'true')));
END;
$$;

-- ----------------------------------------------------------------------------
-- Every sales line in a range, from all three ledgers, matched to a customer contact.
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
    )
    SELECT r.src, r.kind, r.d, r.invoice, r.product, r.kg, r.value,
           COALESCE(r.customer_id, (SELECT c.id FROM cust c WHERE public._sup_norm(r.name) IN (c.n1, c.n2) LIMIT 1)),
           NULLIF(btrim(r.name), ''), r.country, r.export
    FROM raw r;
$$;

-- ----------------------------------------------------------------------------
-- The Customers screen. Called for the period and the period before (trend arrows).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_performance(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_prices boolean := public.portal_actor_sees_prices();
    v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    v_fy date;
    v_lines jsonb;
    v_dir jsonb;
    v_unlisted jsonb;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 4000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a period of up to 10 years.');
    END IF;
    v_fy := make_date(extract(year FROM v_today)::int - CASE WHEN extract(month FROM v_today) < 4 THEN 1 ELSE 0 END, 4, 1);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'src', l.src, 'kind', l.kind, 'date', l.d, 'invoice', l.invoice, 'product', l.product, 'kg', l.kg,
               'value', CASE WHEN v_prices THEN l.value END,
               'customer_id', l.customer_id, 'name', l.name, 'country', l.country, 'export', l.export)
             ORDER BY l.d DESC), '[]'::jsonb)
    INTO v_lines
    FROM public._customer_sales_lines(p_from, p_to) l;

    -- All-time facts per customer: last invoice, this financial year so far, kinds, export.
    WITH allx AS (
        SELECT * FROM public._customer_sales_lines(DATE '2015-01-01', v_today)
    ), agg AS (
        SELECT COALESCE(a.customer_id::text, 'name:' || public._sup_norm(a.name)) AS k,
               max(a.customer_id::text) AS cid, max(a.name) AS name,
               max(a.d) AS last_invoice, min(a.d) AS first_invoice,
               sum(a.kg) FILTER (WHERE a.d >= v_fy) AS fy_kg,
               sum(a.value) FILTER (WHERE a.d >= v_fy) AS fy_value,
               array_agg(DISTINCT a.kind) AS kinds, bool_or(a.export) AS has_export,
               max(a.country) AS export_country
        FROM allx a
        GROUP BY 1
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', c.id, 'type', c.contact_type, 'name', coalesce(nullif(c.trading_name, ''), c.company_name),
               'company_name', c.company_name, 'status', c.status, 'contact', c.primary_contact_name,
               'phone', coalesce(nullif(c.primary_contact_mobile, ''), c.primary_contact_phone), 'email', c.primary_contact_email,
               'area', c.physical_area, 'city', c.physical_city, 'province', c.physical_province, 'country', c.physical_country,
               'lat', c.latitude, 'lng', c.longitude, 'notes', c.notes,
               'last_invoice', g.last_invoice, 'first_invoice', g.first_invoice, 'fy_kg', g.fy_kg,
               'fy_value', CASE WHEN v_prices THEN g.fy_value END,
               'kinds', to_jsonb(COALESCE(g.kinds, ARRAY[]::text[])),
               'export', COALESCE(g.has_export, false)
                         OR (nullif(btrim(c.physical_country), '') IS NOT NULL AND lower(btrim(c.physical_country)) NOT IN ('south africa', 'sa', 'rsa', 'za')),
               'export_country', g.export_country)
             ORDER BY c.company_name), '[]'::jsonb)
    INTO v_dir
    FROM public.contacts c
    LEFT JOIN agg g ON g.cid = c.id::text
    WHERE c.deleted_at IS NULL AND c.contact_type IN ('kernel_customer', 'customer', 'both', 'oil_protein_customer');

    WITH allx AS (
        SELECT * FROM public._customer_sales_lines(DATE '2015-01-01', v_today) WHERE customer_id IS NULL
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'key', 'name:' || k, 'name', name, 'last_invoice', last_invoice, 'fy_kg', fy_kg,
               'fy_value', CASE WHEN v_prices THEN fy_value END, 'kinds', to_jsonb(kinds), 'export', has_export,
               'export_country', export_country) ORDER BY name), '[]'::jsonb)
    INTO v_unlisted
    FROM (
        SELECT public._sup_norm(a.name) AS k, max(a.name) AS name, max(a.d) AS last_invoice,
               sum(a.kg) FILTER (WHERE a.d >= v_fy) AS fy_kg, sum(a.value) FILTER (WHERE a.d >= v_fy) AS fy_value,
               array_agg(DISTINCT a.kind) AS kinds, bool_or(a.export) AS has_export, max(a.country) AS export_country
        FROM allx a
        WHERE public._sup_norm(a.name) IS NOT NULL
        GROUP BY 1
    ) u;

    RETURN jsonb_build_object('success', true, 'from', p_from, 'to', p_to, 'fy_from', v_fy, 'sees_prices', v_prices,
                              'lines', v_lines, 'customers', v_dir, 'unlisted', v_unlisted);
END;
$$;

-- ----------------------------------------------------------------------------
-- Screen and grants.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active)
VALUES ('customers', 'Customers',
        'Customer performance: sales by customer (kg and, for roles that see prices, rand), last invoice, this financial year, local or export, products bought, and a world / South Africa map.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT DISTINCT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE f.key = 'customers'
  AND (r.role_name IN ('super_user', 'admin', 'Shareholder')
       OR r.id IN (SELECT rf.role_id FROM public.role_features rf JOIN public.features f2 ON f2.id = rf.feature_id
                   WHERE f2.key = 'sales-hub' AND rf.value = 'true'))
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

REVOKE ALL ON FUNCTION public._customer_sales_lines(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_actor_sees_prices() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_performance(date, date) TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', 'get_customer_performance', 'EXECUTE', true
FROM public.role_features rf JOIN public.features f ON f.id = rf.feature_id
WHERE f.key = 'customers' AND rf.value = 'true'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = rf.role_id AND x.object_type = 'function' AND x.object_name = 'get_customer_performance' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
