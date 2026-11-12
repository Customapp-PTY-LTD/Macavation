-- =============================================================================
-- Report targets August 2026 - March 2027 (Mike's "Macavation Monthly Targets", 12 Nov 2026)
--
-- Mike sent one set of MONTHLY targets with no months on it. They fill the gap from August 2026 (the
-- last stored kernel sales and oil targets are for July 2026) to the end of the financial year, March
-- 2027. Weekly reports use them as monthly / 4 (report_period_target, 20261112110000).
--
--   Nut in Shell Cracked     100,000 kg      kernel_nis_cracking_kg
--   Sound Kernel Packed       17,500 kg      kernel_sk_packing_kg
--   Kernel Sales Revenue  R 2,221,984        kernel_sales_excl_vat_zar
--   Oil Produced              80,000 kg      oil_produced_kg (NEW: crude + food grade together)
--   Cake Produced             48,000 kg      oil_cake_produced_kg
--   Crude Oil Sales       R 3,268,237.50     oil_sales_crude_cosmetic_zar
--   Food Oil Sales          R 412,500        oil_sales_extra_virgin_zar
--   Protein Sales           R 100,000        oil_sales_protein_zar
--   Cake Sales               R 20,000        oil_sales_cake_zar
--   (oil sales total = sum of the four = R 3,800,737.50, via _report_target_exact's fallback)
--
-- 1. report_metrics 'oil_produced_kg': a target-only metric (source_kind 'manual', is_active = false,
--    like oil_cake_produced_kg) so it does not add an empty line to the older report editor. The
--    weekly report computes its actual as crude + food grade itself.
-- 2. report_period_targets: the nine targets for each month Aug 2026 - Mar 2027 (upsert: an existing
--    row for the same metric and month is replaced with Mike's figure).
-- 3. get_report_weekly_detail: as 20261112110000 plus an "Oil produced (crude + food grade)" line
--    first in Oil Production.
--
-- Down: DELETE FROM report_period_targets WHERE notes = 'Mike monthly targets 12 Nov 2026';
--       DELETE FROM report_metrics WHERE metric_key = 'oil_produced_kg';
--       re-run get_report_weekly_detail from 20261112110000_weekly_report_v2.sql.
-- =============================================================================

INSERT INTO public.report_metrics (metric_key, label, section_key, division, unit, aggregation, source_kind,
                                   source_args, period_types, has_target, display_order, is_active, admin_label)
VALUES ('oil_produced_kg', 'Oil Produced', 'oil_production', 'oil', 'kg', 'sum_over_period', 'manual',
        '{}'::jsonb, ARRAY['weekly', 'monthly'], true, 3, false, 'Oil produced (crude + food grade)')
ON CONFLICT (metric_key) DO NOTHING;

INSERT INTO public.report_period_targets (metric_key, period_type, period_start, target_value, notes)
SELECT t.k, 'monthly', m::date, t.v, 'Mike monthly targets 12 Nov 2026'
  FROM (VALUES
        ('kernel_nis_cracking_kg',        100000::numeric),
        ('kernel_sk_packing_kg',           17500),
        ('kernel_sales_excl_vat_zar',    2221984),
        ('oil_produced_kg',                80000),
        ('oil_cake_produced_kg',           48000),
        ('oil_sales_crude_cosmetic_zar', 3268237.5),
        ('oil_sales_extra_virgin_zar',    412500),
        ('oil_sales_protein_zar',         100000),
        ('oil_sales_cake_zar',             20000)
       ) AS t(k, v)
 CROSS JOIN generate_series(DATE '2026-08-01', DATE '2027-03-01', interval '1 month') AS m
ON CONFLICT (metric_key, period_type, period_start)
DO UPDATE SET target_value = EXCLUDED.target_value, notes = EXCLUDED.notes, updated_at = now();

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
                jsonb_build_object('key', 'oil', 'label', 'Oil produced (crude + food grade)',
                                   'kg', CASE WHEN v_crude IS NULL AND v_food IS NULL THEN NULL
                                              ELSE COALESCE(v_crude, 0) + COALESCE(v_food, 0) END,
                                   'target', public.report_period_target('oil_produced_kg', 'weekly', p_from)),
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

GRANT EXECUTE ON FUNCTION public.get_report_weekly_detail(date, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
