-- ============================================================================
-- Role controls: rand values hidden from roles without "See costs and prices" (MacView round 3).
--
-- WHY. Mike's MacView hides costs, prices and sales values from the production roles. The portal's
-- screens hid some prices (action kernel_prices.view), but every function that returns them answered
-- any role, so a hidden column was only hidden in the browser. Henry (27 Nov 2026): Sales Exec,
-- Palladium Manager, Shareholder and Procurement Lead see costs and prices (plus super_user and
-- admin); Production Manager, Factory Manager and Quality Assurance do not. The switch and the
-- check, portal_actor_sees_prices(), came in 20261128110000.
--
-- WHAT. The read-only functions below are renamed to <name>__all and a function with the SAME name,
-- arguments and defaults takes their place. It returns the original answer for a role that may see
-- prices, and the same answer with every money field set to null for one that may not (keys are
-- kept, so screens don't break; they show a dash).
--   jsonb:  get_kernel_style_prices, get_kernel_dashboard_sales, get_kernel_dashboard_dispatch_sales,
--           get_transport_performance, get_report_transport, get_kernel_dispatch_returns
--   tables: get_data_kernel_sales_lines, get_data_oil_sales_lines, get_data_oil_export_register
-- The __all functions can no longer be called from the browser (EXECUTE revoked from anon and
-- authenticated); only these gates and server-side code call them.
--
-- NOT GATED, on purpose: functions that capture forms load AND save back (get_transport_sheet for
-- the delivery route / rate, get_oil_delivery_transport, get_oil_dispatch_transport, dispatch
-- orders). Nulling them would wipe a price when a role without prices re-saves the form. They stay
-- as they are; see the round 3 report.
--
-- ANYONE CHANGING ONE OF THESE FUNCTIONS LATER: change <name>__all, not <name>. Replacing <name>
-- with a full body silently removes the gate. scripts/verify-price-gate.mjs (in test:fleet) fails
-- a migration that redefines a gated name without portal_actor_sees_prices in it.
--
-- Idempotent (a second run skips the renames). Needs 20261128110000.
-- ============================================================================

-- Money fields, set to null anywhere in a jsonb answer.
CREATE OR REPLACE FUNCTION public._strip_money(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    k text;
    v jsonb;
    o jsonb;
    a jsonb;
    money text[] := ARRAY['customer_price', 'list_price', 'price_per_kg', 'prices', 'price', 'avg_price', 'value', 'value_zar',
                          'total_zar', 'zar', 'dispatch_sales_zar', 'transport_paid_zar', 'cost', 'cheapest', 'cost_zar',
                          'in_cost_zar', 'out_cost_zar', 'rate_zar', 'spend', 'vat_excl_zar', 'vat_zar', 'vat_incl_zar',
                          'rand_value', 'usd_debit', 'price_per_kg_usd'];
BEGIN
    IF p IS NULL THEN RETURN NULL; END IF;
    IF jsonb_typeof(p) = 'object' THEN
        o := '{}'::jsonb;
        FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
            o := o || jsonb_build_object(k, CASE WHEN k = ANY (money) THEN 'null'::jsonb ELSE public._strip_money(v) END);
        END LOOP;
        RETURN o;
    ELSIF jsonb_typeof(p) = 'array' THEN
        SELECT COALESCE(jsonb_agg(public._strip_money(e) ORDER BY i), '[]'::jsonb) INTO a
        FROM jsonb_array_elements(p) WITH ORDINALITY AS t(e, i);
        RETURN a;
    END IF;
    RETURN p;
END;
$$;

-- Rename once; a re-run finds the __all function already there and leaves it.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('get_kernel_style_prices', 'uuid, date'),
        ('get_kernel_dashboard_sales', 'date, date, text'),
        ('get_kernel_dashboard_dispatch_sales', 'date, date'),
        ('get_transport_performance', 'date, date'),
        ('get_report_transport', 'date, date'),
        ('get_kernel_dispatch_returns', 'uuid, integer'),
        ('get_data_kernel_sales_lines', 'date, date, integer, integer'),
        ('get_data_oil_sales_lines', 'date, date, integer, integer'),
        ('get_data_oil_export_register', 'date, date, integer, integer')) AS t(fn, args)
    LOOP
        IF to_regprocedure(format('public.%s__all(%s)', r.fn, r.args)) IS NULL THEN
            EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', r.fn, r.args, r.fn || '__all');
        END IF;
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.fn || '__all', r.args);
    END LOOP;
END $$;

-- ---------------------------------------------------------------- jsonb answers
CREATE OR REPLACE FUNCTION public.get_kernel_style_prices(p_customer_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN public.portal_actor_sees_prices() THEN x ELSE public._strip_money(x) || '{"prices_hidden": true}'::jsonb END
    FROM (SELECT public.get_kernel_style_prices__all(p_customer_id, p_as_of) AS x) q;
$$;

CREATE OR REPLACE FUNCTION public.get_kernel_dashboard_sales(p_from date, p_to date, p_style text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN public.portal_actor_sees_prices() THEN x ELSE public._strip_money(x) || '{"prices_hidden": true}'::jsonb END
    FROM (SELECT public.get_kernel_dashboard_sales__all(p_from, p_to, p_style) AS x) q;
$$;

CREATE OR REPLACE FUNCTION public.get_kernel_dashboard_dispatch_sales(p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN public.portal_actor_sees_prices() THEN x ELSE public._strip_money(x) || '{"prices_hidden": true}'::jsonb END
    FROM (SELECT public.get_kernel_dashboard_dispatch_sales__all(p_from, p_to) AS x) q;
$$;

CREATE OR REPLACE FUNCTION public.get_transport_performance(p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN public.portal_actor_sees_prices() THEN x ELSE public._strip_money(x) || '{"prices_hidden": true}'::jsonb END
    FROM (SELECT public.get_transport_performance__all(p_from, p_to) AS x) q;
$$;

CREATE OR REPLACE FUNCTION public.get_report_transport(p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN public.portal_actor_sees_prices() THEN x ELSE public._strip_money(x) || '{"prices_hidden": true}'::jsonb END
    FROM (SELECT public.get_report_transport__all(p_from, p_to) AS x) q;
$$;

CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_returns(p_order_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT CASE WHEN public.portal_actor_sees_prices() THEN x ELSE public._strip_money(x) || '{"prices_hidden": true}'::jsonb END
    FROM (SELECT public.get_kernel_dispatch_returns__all(p_order_id, p_limit) AS x) q;
$$;

-- ---------------------------------------------------------------- table answers
CREATE OR REPLACE FUNCTION public.get_data_kernel_sales_lines(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date,
                                                              p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, sale_date date, customer_id uuid, customer_name text, invoice_number text, item_code text, style_code text,
              description text, cartons numeric, quantity_kg numeric, price_per_kg numeric, vat_excl_zar numeric, vat_zar numeric,
              vat_incl_zar numeric, data_source text, edited_by_name text, edited_at timestamp with time zone,
              data_quality_flags text[], notes text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.id, a.sale_date, a.customer_id, a.customer_name, a.invoice_number, a.item_code, a.style_code, a.description, a.cartons,
           a.quantity_kg,
           CASE WHEN s.ok THEN a.price_per_kg END, CASE WHEN s.ok THEN a.vat_excl_zar END,
           CASE WHEN s.ok THEN a.vat_zar END, CASE WHEN s.ok THEN a.vat_incl_zar END,
           a.data_source, a.edited_by_name, a.edited_at, a.data_quality_flags, a.notes, a.total_count
    FROM (SELECT public.portal_actor_sees_prices() AS ok) s
    CROSS JOIN LATERAL public.get_data_kernel_sales_lines__all(p_date_from, p_date_to, p_limit, p_offset) a;
$$;

CREATE OR REPLACE FUNCTION public.get_data_oil_sales_lines(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date,
                                                           p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, sale_date date, customer_id uuid, customer_name text, invoice_number text, item_code text, product_line text,
              description text, cartons numeric, quantity_kg numeric, price_per_kg numeric, vat_excl_zar numeric, vat_zar numeric,
              vat_incl_zar numeric, data_source text, edited_by_name text, edited_at timestamp with time zone,
              data_quality_flags text[], notes text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.id, a.sale_date, a.customer_id, a.customer_name, a.invoice_number, a.item_code, a.product_line, a.description, a.cartons,
           a.quantity_kg,
           CASE WHEN s.ok THEN a.price_per_kg END, CASE WHEN s.ok THEN a.vat_excl_zar END,
           CASE WHEN s.ok THEN a.vat_zar END, CASE WHEN s.ok THEN a.vat_incl_zar END,
           a.data_source, a.edited_by_name, a.edited_at, a.data_quality_flags, a.notes, a.total_count
    FROM (SELECT public.portal_actor_sees_prices() AS ok) s
    CROSS JOIN LATERAL public.get_data_oil_sales_lines__all(p_date_from, p_date_to, p_limit, p_offset) a;
$$;

CREATE OR REPLACE FUNCTION public.get_data_oil_export_register(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date,
                                                               p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, export_date date, customer_id uuid, customer_name text, location_country text, document_number text,
              reference text, product_class text, price_per_kg_usd numeric, incoterm text, weight_kg numeric, usd_debit numeric,
              load_count numeric, usd_zar_rate numeric, rand_value numeric, data_source text, edited_by_name text,
              edited_at timestamp with time zone, data_quality_flags text[], notes text, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT a.id, a.export_date, a.customer_id, a.customer_name, a.location_country, a.document_number, a.reference, a.product_class,
           CASE WHEN s.ok THEN a.price_per_kg_usd END, a.incoterm, a.weight_kg, CASE WHEN s.ok THEN a.usd_debit END,
           a.load_count, CASE WHEN s.ok THEN a.usd_zar_rate END, CASE WHEN s.ok THEN a.rand_value END,
           a.data_source, a.edited_by_name, a.edited_at, a.data_quality_flags, a.notes, a.total_count
    FROM (SELECT public.portal_actor_sees_prices() AS ok) s
    CROSS JOIN LATERAL public.get_data_oil_export_register__all(p_date_from, p_date_to, p_limit, p_offset) a;
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_style_prices(uuid, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dashboard_sales(date, date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dashboard_dispatch_sales(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_transport_performance(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_transport(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_returns(uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_kernel_sales_lines(date, date, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_oil_sales_lines(date, date, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_oil_export_register(date, date, integer, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
