-- =============================================================================
-- Weekly report v2 (Mike, 12 Nov 2026): the two-page weekly report.
--
-- Depends on 20261107090000_reports_v2_snapshot.sql (get_report_comparison, report_build_snapshot)
-- and 20261106180200_reports_all_figures.sql (_oil_raw_stock_as_of, _oil_raw_flows), and on
-- get_oil_supplier_recon (20261029120000).
--
-- 1. _report_target_exact(metric_key, period_type, period_start): the target stored for exactly that
--    period. Two metrics have their targets stored under other keys (verified on the dev DB, 12 Nov):
--      oil_food_grade_produced_kg  -> also oil_ev_produced_kg ("EV Oil Produced", the food grade target)
--      oil_sales_excl_vat_zar      -> else the SUM of oil_sales_crude_cosmetic_zar, _extra_virgin_zar,
--                                     _protein_zar and _cake_zar (oil sales targets are kept per product)
-- 2. report_period_target(metric_key, period_type, period_start): a weekly report uses the week's own
--    target if one is stored, otherwise the monthly target / 4 (Mike's rule, 12 Nov 2026; his workbook's
--    weekly kernel sales target R483,394.67 is exactly the July monthly target / 4). The month is the one
--    holding the week's Thursday, i.e. the month most of the week falls in. NULL when nothing is set.
-- 3. get_report_comparison: the single-period target now comes from report_period_target (so the
--    headline tiles get the fallback and the aliases). Year-to-date target sums are unchanged.
-- 4. get_report_weekly_detail(from, to): the line-by-line figures the weekly report shows -
--    NIS deliveries, NIS stock + weeks on hand, cracked / packed vs target, kernel sales lines,
--    oil raws received by type, raw stock by type + weeks on hand, oil / cake / protein produced vs
--    target, and oil sales lines with US dollar export sales shown in dollars and rand.
--    Weeks on hand = stock / average weekly use over the last 4 weeks (Mike, 12 Nov 2026):
--      NIS: NIS cracked; oil raws: kg released to oil production. Days before the oil raw stock count
--      have no known usage, so the oil average only spans the days after the count.
--    Lists are capped at 200 rows (the report shows at most 8 lines per list and groups the rest).
-- 5. report_build_snapshot: weekly snapshots now carry 'weekly' (the block above). Reports published
--    before this migration have no 'weekly' key and keep their old layout.
--
-- Read-only RPCs, SECURITY DEFINER like the other report reads.
-- Down: DROP FUNCTION get_report_weekly_detail(date, date), report_period_target(text, text, date),
--       _report_target_exact(text, text, date); re-run get_report_comparison and report_build_snapshot
--       from 20261107090000_reports_v2_snapshot.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. _report_target_exact
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._report_target_exact(p_metric_key text, p_period_type text, p_period_start date)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_keys text[];
    v_key  text;
    v_val  numeric;
BEGIN
    IF p_metric_key IS NULL OR p_period_type IS NULL OR p_period_start IS NULL THEN
        RETURN NULL;
    END IF;

    v_keys := CASE p_metric_key
                  WHEN 'oil_food_grade_produced_kg' THEN ARRAY['oil_food_grade_produced_kg', 'oil_ev_produced_kg']
                  ELSE ARRAY[p_metric_key] END;

    FOREACH v_key IN ARRAY v_keys LOOP
        SELECT t.target_value INTO v_val
          FROM public.report_period_targets t
         WHERE t.metric_key = v_key AND t.period_type = p_period_type
           AND t.period_start = p_period_start AND t.target_value > 0
         LIMIT 1;
        IF v_val IS NOT NULL THEN
            RETURN v_val;
        END IF;
    END LOOP;

    IF p_metric_key = 'oil_sales_excl_vat_zar' THEN
        SELECT sum(t.target_value) INTO v_val
          FROM public.report_period_targets t
         WHERE t.metric_key IN ('oil_sales_crude_cosmetic_zar', 'oil_sales_extra_virgin_zar',
                                'oil_sales_protein_zar', 'oil_sales_cake_zar')
           AND t.period_type = p_period_type
           AND t.period_start = p_period_start AND t.target_value > 0;
        RETURN v_val;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._report_target_exact(text, text, date) IS
    'Target stored for exactly one period. Food grade oil also reads oil_ev_produced_kg; oil sales falls back to the sum of the four per-product oil sales targets. NULL when none.';

-- ---------------------------------------------------------------------------
-- 2. report_period_target
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_period_target(p_metric_key text, p_period_type text, p_period_start date)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_val numeric;
BEGIN
    v_val := public._report_target_exact(p_metric_key, p_period_type, p_period_start);
    IF v_val IS NOT NULL OR p_period_type <> 'weekly' OR p_period_start IS NULL THEN
        RETURN v_val;
    END IF;
    -- No weekly target: the monthly target / 4, from the month holding the week's Thursday.
    v_val := public._report_target_exact(p_metric_key, 'monthly',
                                         date_trunc('month', p_period_start + 3)::date);
    RETURN CASE WHEN v_val IS NULL THEN NULL ELSE round(v_val / 4, 2) END;
END;
$$;

COMMENT ON FUNCTION public.report_period_target(text, text, date) IS
    'Target for a report period. Weekly: the stored weekly target, else the monthly target / 4 (month of the week''s Thursday). NULL (never 0) when no target is set.';

-- ---------------------------------------------------------------------------
-- 3. get_report_comparison - as 20261107090000, except the single-period target now comes from
--    report_period_target (weekly fallback + aliases). Year-to-date target sums are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_comparison(p_period_type text, p_period_start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from      date;
    v_to        date;
    v_pfrom     date;
    v_pto       date;
    v_fy_start  date;
    v_ytd_from  date;
    v_ytd_to    date;
    v_fig_cur   jsonb;
    v_fig_prev  jsonb;
    v_fig_ytd   jsonb;
    v_h_cur     jsonb;
    v_h_prev    jsonb;
    v_h_ytd     jsonb;
    v_metrics   jsonb := '{}'::jsonb;
    v_months    jsonb := '[]'::jsonb;
    r           record;
    v_mk        text;
    v_target    numeric;
    v_ytd_t     numeric;
    v_ytd_tn    integer;
    v_ytd_n     integer;
    v_ytd_on numeric;
    v_ytd_val   numeric;
    v_m         date;
    v_m_end     date;
    v_t1        numeric;
    v_t2        numeric;
    v_t3        numeric;
BEGIN
    IF p_period_type IS NULL OR p_period_type NOT IN ('weekly', 'monthly') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Period type must be weekly or monthly.');
    END IF;
    IF p_period_start IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'A period start date is required.');
    END IF;

    IF p_period_type = 'weekly' THEN
        v_from  := date_trunc('week', p_period_start)::date;
        v_to    := v_from + 6;
        v_pfrom := v_from - 7;
        v_pto   := v_from - 1;
    ELSE
        v_from  := date_trunc('month', p_period_start)::date;
        v_to    := (v_from + interval '1 month' - interval '1 day')::date;
        v_pfrom := (v_from - interval '1 month')::date;
        v_pto   := v_from - 1;
    END IF;

    -- Financial year runs 1 April to 31 March; year to date is FY start through the period end.
    v_fy_start := make_date(EXTRACT(YEAR FROM v_to)::integer - CASE WHEN EXTRACT(MONTH FROM v_to) < 4 THEN 1 ELSE 0 END, 4, 1);
    v_ytd_from := v_fy_start;
    v_ytd_to   := v_to;

    v_fig_cur := public.get_reports_all_figures(v_from, v_to);
    IF COALESCE(v_fig_cur->>'success', 'false') <> 'true' THEN
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_fig_cur->>'error', 'Figures could not be read.'));
    END IF;
    v_fig_prev := public.get_reports_all_figures(v_pfrom, v_pto);
    v_fig_ytd  := public.get_reports_all_figures(v_ytd_from, v_ytd_to);
    v_h_cur  := public._report_headlines(v_fig_cur);
    v_h_prev := public._report_headlines(v_fig_prev);
    v_h_ytd  := public._report_headlines(v_fig_ytd);

    -- Number of periods of this type in the year to date (weekly: Mondays from FY start; monthly: months).
    IF p_period_type = 'weekly' THEN
        SELECT count(*)::integer INTO v_ytd_n
          FROM generate_series(v_ytd_from::timestamp, v_from::timestamp, interval '1 day') g
         WHERE EXTRACT(ISODOW FROM g) = 1;
    ELSE
        v_ytd_n := (EXTRACT(YEAR FROM v_from)::integer - EXTRACT(YEAR FROM v_fy_start)::integer) * 12
                   + EXTRACT(MONTH FROM v_from)::integer - EXTRACT(MONTH FROM v_fy_start)::integer + 1;
    END IF;

    FOR r IN
        SELECT * FROM (VALUES
            ('nis_received_kg',  'NIS received',          'kg',         'kernel', 'flow',  'nis_procured_kg',            p_period_type = 'monthly'),
            ('cracked_kg',       'NIS cracked',           'kg',         'kernel', 'flow',  'kernel_nis_cracking_kg',     true),
            ('sk_packed_kg',     'Sound kernel packed',   'kg',         'kernel', 'flow',  'kernel_sk_packing_kg',       true),
            ('recovery_pct',     'Kernel recovery',       'pct',        'kernel', 'ratio', NULL,                         false),
            ('kernel_stock_kg',  'Kernel stock on hand',  'kg',         'kernel', 'stock', NULL,                         false),
            ('kernel_sales_zar', 'Kernel sales',          'zar',        'kernel', 'flow',  'kernel_sales_excl_vat_zar',  true),
            ('kernel_sales_kg',  'Kernel sold',           'kg',         'kernel', 'flow',  NULL,                         false),
            ('kernel_avg_price', 'Average kernel price',  'zar_per_kg', 'kernel', 'ratio', NULL,                         false),
            ('raws_received_kg', 'Oil raws received',     'kg',         'oil',    'flow',  NULL,                         false),
            ('food_grade_kg',    'Food grade oil',        'kg',         'oil',    'flow',  'oil_food_grade_produced_kg', true),
            ('crude_kg',         'Crude oil',             'kg',         'oil',    'flow',  'oil_cosmetic_produced_kg',   true),
            ('protein_kg',       'Protein powder',        'kg',         'oil',    'flow',  'oil_protein_produced_kg',    true),
            ('oil_sales_zar',    'Oil & protein sales',   'zar',        'oil',    'flow',  'oil_sales_excl_vat_zar',     true),
            ('raw_stock_kg',     'Oil raw stock on hand', 'kg',         'oil',    'stock', NULL,                         false)
        ) AS t(k, label, unit, stream, kind, metric_key, targeted)
    LOOP
        v_mk := r.metric_key;
        v_target := NULL; v_ytd_t := NULL; v_ytd_tn := NULL; v_ytd_on := NULL; v_ytd_val := NULL;

        IF r.kind <> 'stock' THEN
            v_ytd_val := NULLIF(v_h_ytd->>r.k, '')::numeric;
        END IF;

        IF r.kind = 'flow' AND r.targeted AND v_mk IS NOT NULL THEN
            -- Weekly falls back to monthly / 4; food grade and oil sales read their stored aliases.
            v_target := public.report_period_target(v_mk, p_period_type, v_from);
            SELECT sum(t.target_value), count(*)::integer INTO v_ytd_t, v_ytd_tn
              FROM public.report_period_targets t
             WHERE t.metric_key = v_mk AND t.period_type = p_period_type
               AND t.period_start BETWEEN v_ytd_from AND v_from AND t.target_value > 0;
            IF COALESCE(v_ytd_tn, 0) = 0 THEN
                v_ytd_t := NULL; v_ytd_tn := 0;
            ELSE
                -- Actual over ONLY the periods that carry a target, so a partial-year target is
                -- compared like for like (2 targeted months vs 2 months of actuals, not 7).
                SELECT sum(public.resolve_report_metric_value(t.metric_key, t.period_start,
                           CASE WHEN p_period_type = 'weekly' THEN t.period_start + 6
                                ELSE (t.period_start + interval '1 month' - interval '1 day')::date END))
                  INTO v_ytd_on
                  FROM public.report_period_targets t
                 WHERE t.metric_key = v_mk AND t.period_type = p_period_type
                   AND t.period_start BETWEEN v_ytd_from AND v_from AND t.target_value > 0;
            END IF;
        END IF;

        v_metrics := v_metrics || jsonb_build_object(r.k, jsonb_build_object(
            'label', r.label, 'unit', r.unit, 'stream', r.stream, 'kind', r.kind, 'metric_key', v_mk,
            'value', NULLIF(v_h_cur->>r.k, '')::numeric,
            'target', v_target,
            'previous', NULLIF(v_h_prev->>r.k, '')::numeric,
            'ytd', v_ytd_val,
            'ytd_target', v_ytd_t,
            'ytd_target_periods', CASE WHEN r.kind = 'flow' AND r.targeted THEN COALESCE(v_ytd_tn, 0) END,
            'ytd_periods', CASE WHEN r.kind = 'stock' THEN NULL ELSE v_ytd_n END,
            'ytd_actual_on_target', v_ytd_on));
    END LOOP;

    -- Financial-year month by month (monthly reports only): actuals via the fast resolver.
    IF p_period_type = 'monthly' THEN
        v_m := v_fy_start;
        WHILE v_m <= v_from LOOP
            v_m_end := (v_m + interval '1 month' - interval '1 day')::date;
            SELECT max(t.target_value) FILTER (WHERE t.metric_key = 'kernel_nis_cracking_kg' AND t.target_value > 0),
                   max(t.target_value) FILTER (WHERE t.metric_key = 'kernel_sales_excl_vat_zar' AND t.target_value > 0),
                   max(t.target_value) FILTER (WHERE t.metric_key = 'oil_sales_excl_vat_zar' AND t.target_value > 0)
              INTO v_t1, v_t2, v_t3
              FROM public.report_period_targets t
             WHERE t.period_type = 'monthly' AND t.period_start = v_m
               AND t.metric_key IN ('kernel_nis_cracking_kg', 'kernel_sales_excl_vat_zar', 'oil_sales_excl_vat_zar');
            v_months := v_months || jsonb_build_array(jsonb_build_object(
                'month', v_m,
                'cracked_kg',          public.resolve_report_metric_value('kernel_nis_cracking_kg', v_m, v_m_end),
                'cracked_target',      v_t1,
                'kernel_sales_zar',    public.resolve_report_metric_value('kernel_sales_excl_vat_zar', v_m, v_m_end),
                'kernel_sales_target', v_t2,
                'oil_sales_zar',       public.resolve_report_metric_value('oil_sales_excl_vat_zar', v_m, v_m_end),
                'oil_sales_target',    v_t3));
            v_m := (v_m + interval '1 month')::date;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'period_type', p_period_type,
        'from', v_from, 'to', v_to,
        'period_complete', v_to < public.report_sast_today(),
        'prev', jsonb_build_object('from', v_pfrom, 'to', v_pto),
        'ytd',  jsonb_build_object('from', v_ytd_from, 'to', v_ytd_to),
        'fy', public.report_fy_of_date(v_to),
        'metrics', v_metrics,
        'fy_months', v_months);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_report_weekly_detail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_weekly_detail(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    c_max_lines constant integer := 200;
    v_live_nis  date := COALESCE((SELECT (value->>'nis_intake')::date FROM public.kernel_pipeline_settings
                                   WHERE key = 'reports_live_from'), DATE '2026-10-16');
    v_avg_from  date;

    v_deliv     jsonb;
    v_deliv_n   integer;
    v_deliv_kg  numeric;
    v_first     date;
    v_nis_end   numeric;
    v_cr4       numeric;
    v_nis_stock jsonb;
    v_cracked   numeric;
    v_packed    numeric;
    v_k_lines   jsonb;
    v_k_n       integer;
    v_k_kg      numeric;
    v_k_zar     numeric;

    v_recon     jsonb;
    v_loads     jsonb;
    v_loads_n   integer;
    v_close     jsonb;
    v_count     date;
    v_avg_days  integer;
    v_oil_k     jsonb;
    v_kd        jsonb;
    v_cd        jsonb;
    v_fl_k      jsonb;
    v_fl_kd     jsonb;
    v_fl_cd     jsonb;
    v_raw       jsonb := '[]'::jsonb;
    v_raw_ok    boolean;
    v_fg_on     numeric;
    v_fg_used   numeric;
    v_food      numeric;
    v_crude     numeric;
    v_protein   numeric;
    v_cake      numeric;
    v_o_lines   jsonb;
    v_o_n       integer;
    v_o_kg      numeric;
    v_o_zar     numeric;
    v_o_usd     numeric;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 31 THEN
        RETURN jsonb_build_object('success', false, 'error', 'A week (at most 31 days) is required.');
    END IF;
    v_avg_from := p_to - 27;

    -- =====================================================================
    -- KERNEL 1: NIS deliveries (same sources as get_reports_all_figures)
    -- =====================================================================
    WITH intake AS (
        SELECT n.received_date AS d, COALESCE(n.nis_kg, 0) AS kg,
               COALESCE(NULLIF(btrim(n.supplier_name), ''), 'Unknown grower') AS supplier
          FROM public.data_nis_intake n
         WHERE n.received_date BETWEEN p_from AND LEAST(p_to, v_live_nis - 1)
        UNION ALL
        SELECT k.received_date, COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg, 0),
               COALESCE(NULLIF(btrim(k.grower_name), ''), 'Unknown grower')
          FROM public.kernel k
         WHERE k.is_active
           AND k.received_date BETWEEN GREATEST(p_from, v_live_nis) AND p_to
    ),
    pos AS (SELECT * FROM intake WHERE kg > 0)
    SELECT (SELECT count(*)::integer FROM pos),
           (SELECT sum(kg) FROM pos),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('d', x.d, 'supplier', x.supplier, 'kg', x.kg)
                                      ORDER BY x.d, x.supplier)
                       FROM (SELECT d, supplier, kg FROM pos ORDER BY d, supplier LIMIT c_max_lines) x), '[]'::jsonb)
      INTO v_deliv_n, v_deliv_kg, v_deliv;

    -- =====================================================================
    -- KERNEL 2: NIS stock at the end of the week + weeks on hand
    -- =====================================================================
    SELECT min((m.moved_at AT TIME ZONE 'Africa/Johannesburg')::date) INTO v_first FROM public.nis_storage_movements m;
    v_cr4 := public.resolve_report_metric_value('kernel_nis_cracking_kg', v_avg_from, p_to);

    IF v_first IS NULL OR p_to < v_first THEN
        v_nis_stock := jsonb_build_object('available', false, 'available_from', v_first, 'end_kg', NULL,
                                          'avg_week_kg', CASE WHEN v_cr4 IS NOT NULL THEN round(v_cr4 / 4, 2) END,
                                          'weeks_on_hand', NULL);
    ELSE
        SELECT COALESCE(sum(m.kg) FILTER (WHERE m.to_area IS NOT NULL), 0)
             - COALESCE(sum(m.kg) FILTER (WHERE m.from_area IS NOT NULL), 0)
          INTO v_nis_end
          FROM public.nis_storage_movements m
         WHERE (m.moved_at AT TIME ZONE 'Africa/Johannesburg')::date <= p_to;
        v_nis_stock := jsonb_build_object(
            'available', true, 'available_from', v_first,
            'end_kg', v_nis_end,
            'avg_week_kg', CASE WHEN v_cr4 IS NOT NULL THEN round(v_cr4 / 4, 2) END,
            'weeks_on_hand', CASE WHEN COALESCE(v_cr4, 0) > 0 THEN round(v_nis_end / (v_cr4 / 4), 1) END);
    END IF;

    -- =====================================================================
    -- KERNEL 3: cracked and packed vs target
    -- =====================================================================
    v_cracked := public.resolve_report_metric_value('kernel_nis_cracking_kg', p_from, p_to);
    v_packed  := public.resolve_report_metric_value('kernel_sk_packing_kg', p_from, p_to);

    -- =====================================================================
    -- KERNEL 4: sales, one line per invoice line
    -- =====================================================================
    WITH s AS (
        SELECT l.sale_date AS d,
               COALESCE(NULLIF(btrim(l.customer_name), ''), 'Unknown customer') AS customer,
               COALESCE(NULLIF(btrim(l.style_code), ''), 'Unstyled') AS style,
               COALESCE(l.quantity_kg, 0) AS kg,
               COALESCE(l.price_per_kg, CASE WHEN COALESCE(l.quantity_kg, 0) > 0
                                             THEN round(l.vat_excl_zar / l.quantity_kg, 2) END) AS price,
               COALESCE(l.vat_excl_zar, 0) AS zar
          FROM public.data_kernel_sales_lines l
         WHERE l.sale_date BETWEEN p_from AND p_to
    )
    SELECT (SELECT count(*)::integer FROM s),
           (SELECT sum(kg) FROM s),
           (SELECT sum(zar) FROM s),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('d', x.d, 'customer', x.customer, 'style', x.style,
                                                         'kg', x.kg, 'price_per_kg', x.price, 'value_zar', x.zar)
                                      ORDER BY x.d, x.customer, x.style)
                       FROM (SELECT * FROM s ORDER BY d, customer, style LIMIT c_max_lines) x), '[]'::jsonb)
      INTO v_k_n, v_k_kg, v_k_zar, v_k_lines;

    -- =====================================================================
    -- OIL 1: raw materials received, one line per load per material
    -- =====================================================================
    v_recon := public.get_oil_supplier_recon(p_from, p_to);
    v_loads := CASE WHEN COALESCE((v_recon->>'success')::boolean, false)
                    THEN COALESCE(v_recon->'loads', '[]'::jsonb) ELSE '[]'::jsonb END;

    WITH l AS (
        SELECT (e->>'received_date')::date AS d,
               COALESCE(NULLIF(btrim(e->>'supplier'), ''), 'No supplier') AS supplier,
               COALESCE((e->>'food_grade_kg')::numeric, 0)   AS fg,
               COALESCE((e->>'crude_kg')::numeric, 0)        AS cr,
               COALESCE((e->>'kernel_dust_kg')::numeric, 0)  AS kd,
               COALESCE((e->>'cracker_dust_kg')::numeric, 0) AS cd
          FROM jsonb_array_elements(v_loads) e
    ),
    x AS (
        SELECT 1 AS ord, 'food_grade_kernel'::text AS material, d, supplier, fg AS kg FROM l WHERE fg > 0
        UNION ALL SELECT 2, 'crude_kernel', d, supplier, cr FROM l WHERE cr > 0
        UNION ALL SELECT 3, 'kernel_dust',  d, supplier, kd FROM l WHERE kd > 0
        UNION ALL SELECT 4, 'cracker_dust', d, supplier, cd FROM l WHERE cd > 0
    )
    SELECT (SELECT count(*)::integer FROM l WHERE fg + cr + kd + cd > 0),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('material', y.material, 'd', y.d, 'supplier', y.supplier, 'kg', y.kg)
                                      ORDER BY y.ord, y.d, y.supplier)
                       FROM (SELECT * FROM x ORDER BY ord, d, supplier LIMIT c_max_lines) y), '[]'::jsonb)
      INTO v_loads_n, v_loads;

    -- =====================================================================
    -- OIL 2: raw stock at the end of the week + weeks on hand
    -- =====================================================================
    v_close  := public._oil_raw_stock_as_of(p_to);
    v_raw_ok := COALESCE((v_close->>'available')::boolean, false);
    v_count  := NULLIF(v_close->>'count_date', '')::date;
    v_avg_days := CASE WHEN v_count IS NULL THEN 28 ELSE p_to - GREATEST(v_avg_from, v_count + 1) + 1 END;

    SELECT m INTO v_oil_k FROM jsonb_array_elements(COALESCE(v_close->'materials', '[]'::jsonb)) m WHERE m->>'material' = 'oil_kernel';
    SELECT m INTO v_kd    FROM jsonb_array_elements(COALESCE(v_close->'materials', '[]'::jsonb)) m WHERE m->>'material' = 'kernel_dust';
    SELECT m INTO v_cd    FROM jsonb_array_elements(COALESCE(v_close->'materials', '[]'::jsonb)) m WHERE m->>'material' = 'cracker_dust';

    IF v_avg_days > 0 THEN
        v_fl_k  := public._oil_raw_flows(GREATEST(v_avg_from, COALESCE(v_count + 1, v_avg_from)), p_to, 'oil_kernel');
        v_fl_kd := public._oil_raw_flows(GREATEST(v_avg_from, COALESCE(v_count + 1, v_avg_from)), p_to, 'kernel_dust');
        v_fl_cd := public._oil_raw_flows(GREATEST(v_avg_from, COALESCE(v_count + 1, v_avg_from)), p_to, 'cracker_dust');
    END IF;

    v_fg_on   := NULLIF(v_oil_k->>'food_grade_kg', '')::numeric;
    v_fg_used := NULLIF(v_fl_k->>'fg_used_kg', '')::numeric;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'material', r.material, 'on_hand_kg', r.on_hand,
               'avg_week_kg', CASE WHEN r.used IS NOT NULL AND v_avg_days > 0 THEN round(r.used * 7 / v_avg_days, 2) END,
               'weeks_on_hand', CASE WHEN r.on_hand IS NOT NULL AND COALESCE(r.used, 0) > 0 AND v_avg_days > 0
                                     THEN round(r.on_hand / (r.used * 7 / v_avg_days), 1) END)
               ORDER BY r.ord), '[]'::jsonb)
      INTO v_raw
      FROM (VALUES
          (1, 'food_grade_kernel', CASE WHEN v_raw_ok THEN v_fg_on END, v_fg_used),
          (2, 'crude_kernel',      CASE WHEN v_raw_ok AND v_fg_on IS NOT NULL
                                        THEN NULLIF(v_oil_k->>'on_hand_kg', '')::numeric - v_fg_on END,
                                   CASE WHEN v_fg_used IS NOT NULL
                                        THEN NULLIF(v_fl_k->>'used_kg', '')::numeric - v_fg_used END),
          (3, 'kernel_dust',       CASE WHEN v_raw_ok THEN NULLIF(v_kd->>'on_hand_kg', '')::numeric END,
                                   NULLIF(v_fl_kd->>'used_kg', '')::numeric),
          (4, 'cracker_dust',      CASE WHEN v_raw_ok THEN NULLIF(v_cd->>'on_hand_kg', '')::numeric END,
                                   NULLIF(v_fl_cd->>'used_kg', '')::numeric)
      ) AS r(ord, material, on_hand, used);

    -- =====================================================================
    -- OIL 3: produced vs target
    -- =====================================================================
    v_food    := public.resolve_report_metric_value('oil_food_grade_produced_kg', p_from, p_to);
    v_crude   := public.resolve_report_metric_value('oil_cosmetic_produced_kg', p_from, p_to);
    v_protein := public.resolve_report_metric_value('oil_protein_produced_kg', p_from, p_to);
    SELECT sum(c.kg) INTO v_cake
      FROM public.oil_cake_movements c
     WHERE c.voided_at IS NULL AND c.kind = 'produced' AND c.movement_date BETWEEN p_from AND p_to;

    -- =====================================================================
    -- OIL 4: sales lines. Local invoice lines + the export register (US dollars), de-duplicated as in
    -- get_reports_all_figures: a local line carrying export_register_id is the register row's sale.
    -- =====================================================================
    WITH al AS (
        SELECT s.sale_date AS d,
               COALESCE(NULLIF(btrim(s.customer_name), ''), 'Unknown customer') AS customer,
               CASE s.product_line WHEN 'extra_virgin' THEN 'food_grade' WHEN 'crude_cosmetic' THEN 'crude'
                                   WHEN 'protein' THEN 'protein' WHEN 'cake' THEN 'cake' ELSE 'other' END AS product,
               COALESCE(s.quantity_kg, 0) AS kg,
               'ZAR'::text AS currency,
               COALESCE(s.price_per_kg, CASE WHEN COALESCE(s.quantity_kg, 0) > 0
                                             THEN round(s.vat_excl_zar / s.quantity_kg, 2) END) AS price,
               NULL::numeric AS rate,
               NULL::numeric AS usd,
               COALESCE(s.vat_excl_zar, 0) AS zar
          FROM public.data_oil_sales_lines s
         WHERE s.sale_date BETWEEN p_from AND p_to
           AND s.export_register_id IS NULL
        UNION ALL
        SELECT e.export_date,
               COALESCE(NULLIF(btrim(e.customer_name), ''), 'Unknown customer'),
               CASE e.product_class WHEN 'evmo' THEN 'food_grade' WHEN 'crude' THEN 'crude'
                                    WHEN 'protein' THEN 'protein' ELSE 'other' END,
               COALESCE(e.weight_kg, 0),
               'USD',
               e.price_per_kg_usd,
               e.usd_zar_rate,
               e.usd_debit,
               COALESCE(e.rand_value, 0)
          FROM public.data_oil_export_register e
         WHERE e.export_date BETWEEN p_from AND p_to
    )
    SELECT (SELECT count(*)::integer FROM al),
           (SELECT sum(kg) FROM al),
           (SELECT sum(zar) FROM al),
           (SELECT sum(usd) FROM al WHERE currency = 'USD'),
           COALESCE((SELECT jsonb_agg(jsonb_build_object('d', x.d, 'customer', x.customer, 'product', x.product,
                                                         'kg', x.kg, 'currency', x.currency, 'price_per_kg', x.price,
                                                         'usd_zar_rate', x.rate, 'value_usd', x.usd, 'value_zar', x.zar)
                                      ORDER BY x.d, x.customer, x.product)
                       FROM (SELECT * FROM al ORDER BY d, customer, product LIMIT c_max_lines) x), '[]'::jsonb)
      INTO v_o_n, v_o_kg, v_o_zar, v_o_usd, v_o_lines;

    RETURN jsonb_build_object(
        'success', true,
        'from', p_from, 'to', p_to,
        'target_rule', 'Weekly target = the week''s own target, else the monthly target / 4.',
        'kernel', jsonb_build_object(
            'deliveries', jsonb_build_object('count', COALESCE(v_deliv_n, 0), 'kg', v_deliv_kg, 'lines', v_deliv),
            'nis_stock', v_nis_stock,
            'production', jsonb_build_array(
                jsonb_build_object('key', 'cracked', 'label', 'Nut in shell cracked', 'kg', v_cracked,
                                   'target', public.report_period_target('kernel_nis_cracking_kg', 'weekly', p_from)),
                jsonb_build_object('key', 'packed', 'label', 'Sound kernel packed', 'kg', v_packed,
                                   'target', public.report_period_target('kernel_sk_packing_kg', 'weekly', p_from))),
            'sales', jsonb_build_object('count', COALESCE(v_k_n, 0), 'kg', v_k_kg, 'value_zar', v_k_zar,
                                        'target', public.report_period_target('kernel_sales_excl_vat_zar', 'weekly', p_from),
                                        'lines', v_k_lines)),
        'oil', jsonb_build_object(
            'loads', jsonb_build_object('count', COALESCE(v_loads_n, 0),
                                        'error', CASE WHEN NOT COALESCE((v_recon->>'success')::boolean, false)
                                                      THEN COALESCE(v_recon->>'error', 'Oil deliveries could not be read.') END,
                                        'lines', v_loads),
            'raw_stock', jsonb_build_object('available', v_raw_ok, 'count_date', v_count, 'avg_days', v_avg_days,
                                            'materials', v_raw),
            'production', jsonb_build_array(
                jsonb_build_object('key', 'crude', 'label', 'Crude (cosmetic) oil', 'kg', v_crude,
                                   'target', public.report_period_target('oil_cosmetic_produced_kg', 'weekly', p_from)),
                jsonb_build_object('key', 'food_grade', 'label', 'Food grade (EVMO) oil', 'kg', v_food,
                                   'target', public.report_period_target('oil_food_grade_produced_kg', 'weekly', p_from)),
                jsonb_build_object('key', 'cake', 'label', 'Oil cake', 'kg', v_cake,
                                   'target', public.report_period_target('oil_cake_produced_kg', 'weekly', p_from)),
                jsonb_build_object('key', 'protein', 'label', 'Protein powder', 'kg', v_protein,
                                   'target', public.report_period_target('oil_protein_produced_kg', 'weekly', p_from))),
            'sales', jsonb_build_object('count', COALESCE(v_o_n, 0), 'kg', v_o_kg, 'value_zar', v_o_zar, 'value_usd', v_o_usd,
                                        'target', public.report_period_target('oil_sales_excl_vat_zar', 'weekly', p_from),
                                        'lines', v_o_lines)));
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

COMMENT ON FUNCTION public.get_report_weekly_detail(date, date) IS
    'Line-by-line figures for the two-page weekly report: NIS deliveries, NIS stock and weeks on hand, cracked/packed vs target, kernel sales lines, oil raws by type, raw stock and weeks on hand, oil/cake/protein vs target, oil sales lines (USD export sales in dollars and rand). Lists capped at 200 rows.';

-- ---------------------------------------------------------------------------
-- 5. report_build_snapshot - weekly snapshots carry the weekly block
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
    END IF;
    RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.report_build_snapshot(text, date) IS
    'Builds the full Reports v2 payload for a period from live data (weekly adds the two-page weekly block). publish_report_instance stores it; drafts get it live through get_report_view.';

-- ---------------------------------------------------------------------------
-- 6. Grants and bookkeeping
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public._report_target_exact(text, text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_period_target(text, text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_comparison(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_weekly_detail(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_build_snapshot(text, date) TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key = 'sales-forecasting-grid'
CROSS JOIN unnest(ARRAY['_report_target_exact', 'report_period_target', 'get_report_weekly_detail']) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
