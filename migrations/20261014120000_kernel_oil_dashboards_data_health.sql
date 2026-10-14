-- Kernel dashboard, Oil dashboard and the Data health tab (Sales & Production Data).
--
-- Five read-only aggregate functions, plus the menu features for the two new Home screens.
-- All aggregation is server-side: PostgREST caps a response at 1000 rows, and every function
-- below returns a single jsonb object.
--
-- Financial year: April to March, the same convention as report_fy_of_date
-- (20260817090000_report_builder_foundations.sql). The functions themselves take a plain
-- p_from/p_to range; the screens work out the FY and quarter boundaries.
--
-- "last_date" on each section is the latest date with data in the WHOLE table, capped at today
-- (Africa/Johannesburg), so a future-dated typo cannot claim the data is current.
--
-- Accepted exposure: like the existing data-page getters, these are SECURITY DEFINER and granted
-- to anon, because every portal RPC runs with the anon key (WebPortal/js/data-functions.js,
-- useAnonAuth). They return aggregates only - supplier/customer names with kg and rand totals,
-- never row ids. role_permissions rows below are bookkeeping, not an enforced gate.

-- ============================================================================
-- 1. KERNEL - procurement (nut in shell received, data_nis_intake)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kernel_dashboard_procurement(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
    rows_in AS (
        SELECT received_date, nis_kg,
               coalesce(nullif(trim(supplier_name), ''), '(no supplier)') AS supplier
        FROM public.data_nis_intake
        WHERE received_date >= p_from AND received_date <= p_to
    )
    SELECT jsonb_build_object(
        'by_supplier', coalesce((
            SELECT jsonb_agg(jsonb_build_object('supplier_name', supplier, 'nis_kg', kg) ORDER BY kg DESC)
            FROM (SELECT supplier, sum(coalesce(nis_kg, 0)) AS kg FROM rows_in GROUP BY supplier) s
        ), '[]'::jsonb),
        'by_month', coalesce((
            SELECT jsonb_agg(jsonb_build_object('month', m, 'nis_kg', kg) ORDER BY m)
            FROM (SELECT to_char(received_date, 'YYYY-MM') AS m, sum(coalesce(nis_kg, 0)) AS kg
                  FROM rows_in GROUP BY 1) s
        ), '[]'::jsonb),
        'total_kg', coalesce((SELECT sum(coalesce(nis_kg, 0)) FROM rows_in), 0),
        'last_date', (SELECT max(received_date) FROM public.data_nis_intake, today WHERE received_date <= today.d)
    );
$$;

-- ============================================================================
-- 2. KERNEL - production (cracked kg, data_production_daily)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kernel_dashboard_production(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
    rows_in AS (
        SELECT production_date, cracked_kg
        FROM public.data_production_daily
        WHERE production_date >= p_from AND production_date <= p_to
    )
    SELECT jsonb_build_object(
        'by_month', coalesce((
            SELECT jsonb_agg(jsonb_build_object('month', m, 'cracked_kg', kg) ORDER BY m)
            FROM (SELECT to_char(production_date, 'YYYY-MM') AS m, sum(coalesce(cracked_kg, 0)) AS kg
                  FROM rows_in GROUP BY 1) s
        ), '[]'::jsonb),
        'total_kg', coalesce((SELECT sum(coalesce(cracked_kg, 0)) FROM rows_in), 0),
        'last_date', (SELECT max(production_date) FROM public.data_production_daily, today
                      WHERE production_date <= today.d AND coalesce(cracked_kg, 0) > 0)
    );
$$;

-- ============================================================================
-- 3. KERNEL - sales (data_kernel_sales_lines), in kg and rand excl. VAT, by style
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kernel_dashboard_sales(p_from date, p_to date, p_style text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
    all_in AS (
        SELECT sale_date, quantity_kg, vat_excl_zar,
               coalesce(nullif(trim(style_code), ''), '(no style)') AS style,
               coalesce(nullif(trim(customer_name), ''), '(no customer)') AS customer
        FROM public.data_kernel_sales_lines
        WHERE sale_date >= p_from AND sale_date <= p_to
    ),
    -- by_style ignores p_style so the style list stays complete; everything else is filtered.
    rows_in AS (
        SELECT * FROM all_in WHERE p_style IS NULL OR style = p_style
    )
    SELECT jsonb_build_object(
        'by_month', coalesce((
            SELECT jsonb_agg(jsonb_build_object('month', m, 'quantity_kg', kg, 'value_zar', zar) ORDER BY m)
            FROM (SELECT to_char(sale_date, 'YYYY-MM') AS m, sum(coalesce(quantity_kg, 0)) AS kg,
                         sum(coalesce(vat_excl_zar, 0)) AS zar
                  FROM rows_in GROUP BY 1) s
        ), '[]'::jsonb),
        'by_style', coalesce((
            SELECT jsonb_agg(jsonb_build_object('style_code', style, 'quantity_kg', kg, 'value_zar', zar) ORDER BY kg DESC)
            FROM (SELECT style, sum(coalesce(quantity_kg, 0)) AS kg, sum(coalesce(vat_excl_zar, 0)) AS zar
                  FROM all_in GROUP BY style) s
        ), '[]'::jsonb),
        'by_customer', coalesce((
            SELECT jsonb_agg(jsonb_build_object('customer_name', customer, 'quantity_kg', kg, 'value_zar', zar) ORDER BY kg DESC)
            FROM (SELECT customer, sum(coalesce(quantity_kg, 0)) AS kg, sum(coalesce(vat_excl_zar, 0)) AS zar
                  FROM rows_in GROUP BY customer) s
        ), '[]'::jsonb),
        'total_kg', coalesce((SELECT sum(coalesce(quantity_kg, 0)) FROM rows_in), 0),
        'total_zar', coalesce((SELECT sum(coalesce(vat_excl_zar, 0)) FROM rows_in), 0),
        'last_date', (SELECT max(sale_date) FROM public.data_kernel_sales_lines, today WHERE sale_date <= today.d)
    );
$$;

-- ============================================================================
-- 4. OIL - raw materials in, oil out, local sales and exports
-- ============================================================================
-- Raw materials: supplier_intake_batches (kg by product_type) - the Oil "Step 1 Supplier Intake".
-- Oil out: public.oil.total_oil_litre by production_date (as get_oil_production_trends_daily).
-- Protein out: protein_bin_batch.batch_weight_kg by start_date (same source as that function).
-- Sales: data_oil_sales_lines (local, by product_line) and data_oil_export_register (exports).

CREATE OR REPLACE FUNCTION public.get_oil_dashboard(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
    intake AS (
        SELECT date_received AS d, coalesce(quantity_kg, 0) AS kg,
               coalesce(nullif(trim(product_type), ''), '(no type)') AS material
        FROM public.supplier_intake_batches
        WHERE date_received >= p_from AND date_received <= p_to
    ),
    oil_out AS (
        SELECT coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) AS d,
               coalesce(o.total_oil_litre, 0) AS litres
        FROM public.oil o
        WHERE o.is_active = true
    ),
    protein_out AS (
        SELECT coalesce(p.start_date, (p.created_at AT TIME ZONE 'Africa/Johannesburg')::date) AS d,
               coalesce(p.batch_weight_kg, 0) AS kg
        FROM public.protein_bin_batch p
    ),
    local_sales AS (
        SELECT sale_date AS d, coalesce(quantity_kg, 0) AS kg, coalesce(vat_excl_zar, 0) AS zar,
               coalesce(nullif(trim(product_line), ''), '(no product line)') AS line
        FROM public.data_oil_sales_lines
        WHERE sale_date >= p_from AND sale_date <= p_to
    ),
    exports AS (
        SELECT export_date AS d, coalesce(weight_kg, 0) AS kg, coalesce(rand_value, 0) AS zar
        FROM public.data_oil_export_register
        WHERE export_date >= p_from AND export_date <= p_to
    )
    SELECT jsonb_build_object(
        'intake_by_month', coalesce((
            SELECT jsonb_agg(jsonb_build_object('month', m, 'kg', kg) ORDER BY m)
            FROM (SELECT to_char(d, 'YYYY-MM') AS m, sum(kg) AS kg FROM intake GROUP BY 1) s), '[]'::jsonb),
        'intake_by_material', coalesce((
            SELECT jsonb_agg(jsonb_build_object('material', material, 'kg', kg) ORDER BY kg DESC)
            FROM (SELECT material, sum(kg) AS kg FROM intake GROUP BY material) s), '[]'::jsonb),
        'intake_total_kg', coalesce((SELECT sum(kg) FROM intake), 0),
        'intake_last_date', (SELECT max(date_received) FROM public.supplier_intake_batches, today WHERE date_received <= today.d),
        'production_by_month', coalesce((
            SELECT jsonb_agg(jsonb_build_object('month', m, 'oil_litres', l, 'protein_kg', k) ORDER BY m)
            FROM (
                SELECT m, sum(l) AS l, sum(k) AS k FROM (
                    SELECT to_char(d, 'YYYY-MM') AS m, litres AS l, 0::numeric AS k FROM oil_out WHERE d >= p_from AND d <= p_to
                    UNION ALL
                    SELECT to_char(d, 'YYYY-MM'), 0, kg FROM protein_out WHERE d >= p_from AND d <= p_to
                ) u GROUP BY m
            ) s), '[]'::jsonb),
        'oil_total_litres', coalesce((SELECT sum(litres) FROM oil_out WHERE d >= p_from AND d <= p_to), 0),
        'protein_total_kg', coalesce((SELECT sum(kg) FROM protein_out WHERE d >= p_from AND d <= p_to), 0),
        'production_last_date', (SELECT max(oil_out.d) FROM oil_out, today WHERE oil_out.d <= today.d AND oil_out.litres > 0),
        'sales_by_month', coalesce((
            SELECT jsonb_agg(jsonb_build_object('month', m, 'local_kg', lk, 'local_zar', lz, 'export_kg', ek, 'export_zar', ez) ORDER BY m)
            FROM (
                SELECT m, sum(lk) AS lk, sum(lz) AS lz, sum(ek) AS ek, sum(ez) AS ez FROM (
                    SELECT to_char(d, 'YYYY-MM') AS m, kg AS lk, zar AS lz, 0::numeric AS ek, 0::numeric AS ez FROM local_sales
                    UNION ALL
                    SELECT to_char(d, 'YYYY-MM'), 0, 0, kg, zar FROM exports
                ) u GROUP BY m
            ) s), '[]'::jsonb),
        'sales_by_line', coalesce((
            SELECT jsonb_agg(jsonb_build_object('product_line', line, 'kg', kg, 'value_zar', zar) ORDER BY kg DESC)
            FROM (SELECT line, sum(kg) AS kg, sum(zar) AS zar FROM local_sales GROUP BY line) s), '[]'::jsonb),
        'local_total_kg', coalesce((SELECT sum(kg) FROM local_sales), 0),
        'local_total_zar', coalesce((SELECT sum(zar) FROM local_sales), 0),
        'export_total_kg', coalesce((SELECT sum(kg) FROM exports), 0),
        'export_total_zar', coalesce((SELECT sum(zar) FROM exports), 0),
        'sales_last_date', (SELECT max(x) FROM (
            SELECT max(sale_date) AS x FROM public.data_oil_sales_lines, today WHERE sale_date <= today.d
            UNION ALL
            SELECT max(export_date) FROM public.data_oil_export_register, today WHERE export_date <= today.d) u)
    );
$$;

-- ============================================================================
-- 5. DATA HEALTH - one row per day: what each data page holds vs what the factory captured
-- ============================================================================
-- The screen turns these into captured / missing / differs per week. Only rows with a factory
-- side can be "missing": a day with no delivery or no sale is normal, so the data page is only
-- flagged when the factory recorded activity and the page has nothing.

CREATE OR REPLACE FUNCTION public.get_data_health(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH bounds AS (
        SELECT p_from AS f,
               least(p_to, (now() AT TIME ZONE 'Africa/Johannesburg')::date) AS t,
               (now() AT TIME ZONE 'Africa/Johannesburg')::date AS today
    ),
    days AS (
        SELECT gs::date AS d FROM bounds, generate_series(bounds.f, bounds.t, interval '1 day') gs
    ),
    prod AS (
        SELECT production_date AS d, sum(coalesce(cracked_kg, 0)) AS typed, sum(cracked_kg_system) AS sys
        FROM public.data_production_daily, bounds
        WHERE production_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    nis AS (
        SELECT received_date AS d, count(*) AS n FROM public.data_nis_intake, bounds
        WHERE received_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    deliv AS (
        SELECT k.received_date AS d, count(*) AS n FROM public.kernel k, bounds
        WHERE k.is_active AND k.received_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    ksales AS (
        SELECT sale_date AS d, count(*) AS n FROM public.data_kernel_sales_lines, bounds
        WHERE sale_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    disp AS (
        SELECT coalesce((o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date, o.delivery_date) AS d, count(*) AS n
        FROM public.kernel_dispatch_orders o, bounds
        WHERE coalesce(lower(o.status), '') NOT IN ('cancelled', 'canceled', 'draft')
          AND coalesce((o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date, o.delivery_date) BETWEEN bounds.f AND bounds.t
        GROUP BY 1
    ),
    osales AS (
        SELECT sale_date AS d, count(*) AS n FROM public.data_oil_sales_lines, bounds
        WHERE sale_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    oexp AS (
        SELECT export_date AS d, count(*) AS n FROM public.data_oil_export_register, bounds
        WHERE export_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    )
    SELECT jsonb_build_object(
        'from', (SELECT f FROM bounds),
        'to', (SELECT t FROM bounds),
        'today', (SELECT today FROM bounds),
        -- Compact rows: [date, typed cracked kg, factory cracked kg (null = not tracked),
        --                nis rows, deliveries booked in, kernel sales lines, dispatch orders,
        --                oil sales lines, oil export rows]
        'days', coalesce((
            SELECT jsonb_agg(jsonb_build_array(
                days.d, coalesce(prod.typed, 0), prod.sys, coalesce(nis.n, 0), coalesce(deliv.n, 0),
                coalesce(ksales.n, 0), coalesce(disp.n, 0), coalesce(osales.n, 0), coalesce(oexp.n, 0)
            ) ORDER BY days.d)
            FROM days
            LEFT JOIN prod ON prod.d = days.d
            LEFT JOIN nis ON nis.d = days.d
            LEFT JOIN deliv ON deliv.d = days.d
            LEFT JOIN ksales ON ksales.d = days.d
            LEFT JOIN disp ON disp.d = days.d
            LEFT JOIN osales ON osales.d = days.d
            LEFT JOIN oexp ON oexp.d = days.d
        ), '[]'::jsonb)
    );
$$;

-- ============================================================================
-- 6. GRANTS
-- ============================================================================

REVOKE ALL ON FUNCTION public.get_kernel_dashboard_procurement(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kernel_dashboard_production(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_kernel_dashboard_sales(date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_oil_dashboard(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_data_health(date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_kernel_dashboard_procurement(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dashboard_production(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dashboard_sales(date, date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_dashboard(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_health(date, date) TO anon, authenticated, service_role;

-- ============================================================================
-- 7. FEATURES - kernel-dashboard and oil-dashboard (Home menu)
-- ============================================================================
-- Audience agreed for these screens: management and reporting roles.

INSERT INTO public.features (key, name, description)
VALUES
    ('kernel-dashboard', 'Kernel Dashboard', 'Kernel procurement, production, stock and sales by financial year'),
    ('oil-dashboard', 'Oil Dashboard', 'Oil raw materials, production, stock and sales by financial year')
ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key IN ('kernel-dashboard', 'oil-dashboard')) f
WHERE r.role_name IN ('super_user', 'admin', 'Palladium Manager', 'Production Manager', 'Sales Exec')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- ============================================================================
-- 8. FUNCTION PERMISSIONS (bookkeeping) - NOT EXISTS, role_permissions has no unique key
-- ============================================================================

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key IN ('kernel-dashboard', 'oil-dashboard')
CROSS JOIN unnest(ARRAY['get_kernel_dashboard_procurement', 'get_kernel_dashboard_production',
                        'get_kernel_dashboard_sales', 'get_oil_dashboard']) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', 'get_data_health', 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key = 'sales-data-grid'
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = 'get_data_health' AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
