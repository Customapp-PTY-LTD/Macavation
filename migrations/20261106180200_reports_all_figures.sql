-- ============================================================================
-- Reports: "All figures" tab (Henry, 6 Nov 2026)
-- ============================================================================
-- One read for every kernel and oil figure over any date range (max 400 days), so the Reports page
-- can show a week, a month or a custom range without opening a report.
--
-- 1. Settings, key 'reports_live_from' in kernel_pipeline_settings:
--      nis_intake  first day NIS intake is read from the live kernel table. Before it, the figures
--                  come from data_nis_intake (the data page, which the monthly report reads).
-- 2. _oil_raw_flows(from, to, material) and _oil_raw_stock_as_of(date): get_oil_raw_stock()'s
--    arithmetic (20261029120000) split out so the stock position can be read at the end of any
--    day. get_oil_raw_stock() now returns _oil_raw_stock_as_of(today) with exactly the same keys.
--    A date before the stock count date has no known position: positions come back null and
--    available = false (movements are still summed).
-- 3. get_reports_all_figures(from, to). Headline totals that are report metrics go through
--    resolve_report_metric_value, so a calendar month here equals the monthly report. NULL means
--    "no figure", never a faked 0. by_day arrays only hold days that have data, all inside the range.
--
-- Read-only RPCs, SECURITY DEFINER like the other report / dashboard reads.
-- Down: DROP FUNCTION get_reports_all_figures(date, date), _oil_raw_stock_as_of(date),
--       _oil_raw_flows(date, date, text); re-run get_oil_raw_stock from 20261029120000;
--       DELETE FROM kernel_pipeline_settings WHERE key = 'reports_live_from';
-- ============================================================================

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('reports_live_from', jsonb_build_object('nis_intake', '2026-10-16'))
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Oil raw material movements between two days (inclusive), one material.
-- Same sources and cut-offs as get_oil_raw_stock: portal bags count after both the stock count and
-- the recon sheet's last day, sheet loads after the count up to the sheet's last day, releases to
-- Oil Production after the count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._oil_raw_flows(p_from date, p_to date, p_material text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_set     jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_count   date  := COALESCE((v_set->>'count_date')::date, DATE '2026-10-26');
    v_hist    date  := COALESCE((SELECT (value->>'history_through')::date FROM public.kernel_pipeline_settings
                                  WHERE key = 'oil_supplier_recon'), DATE '2026-10-29');
    v_p_from  date;
    v_s_from  date;
    v_s_to    date;
    v_in      numeric;
    v_used    numeric;
    v_fg_in   numeric;
    v_fg_used numeric;
    v_sh_in   numeric;
    v_sh_fg   numeric;
BEGIN
    v_p_from := GREATEST(p_from, GREATEST(v_count, v_hist) + 1);
    v_s_from := GREATEST(p_from, v_count + 1);
    v_s_to   := LEAST(p_to, v_hist);

    SELECT COALESCE(sum(COALESCE((o.intake_data->>'quantity_kg')::numeric, 0))
                    FILTER (WHERE (o.intake_data->>'date_received')::date BETWEEN v_p_from AND p_to), 0),
           COALESCE(sum(COALESCE((o.intake_data->>'weight_before_production_kg')::numeric,
                                 (o.intake_data->>'quantity_kg')::numeric, 0))
                    FILTER (WHERE (((o.intake_data->>'weight_before_production_recorded_at')::timestamptz)
                                   AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_s_from AND p_to), 0),
           COALESCE(sum(COALESCE((o.intake_data->>'quantity_kg')::numeric, 0))
                    FILTER (WHERE (o.intake_data->>'date_received')::date BETWEEN v_p_from AND p_to
                              AND o.intake_data->>'grade' = 'food_grade'), 0),
           COALESCE(sum(COALESCE((o.intake_data->>'weight_before_production_kg')::numeric,
                                 (o.intake_data->>'quantity_kg')::numeric, 0))
                    FILTER (WHERE (((o.intake_data->>'weight_before_production_recorded_at')::timestamptz)
                                   AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_s_from AND p_to
                              AND o.intake_data->>'grade' = 'food_grade'), 0)
      INTO v_in, v_used, v_fg_in, v_fg_used
      FROM public.oil o
     WHERE COALESCE(o.is_active, true)
       AND o.intake_data->>'product_type' = p_material
       AND (o.intake_data->>'date_received') ~ '^\d{4}-\d{2}-\d{2}'
       AND (o.intake_data->>'weight_before_production_recorded_at' IS NULL
            OR (o.intake_data->>'weight_before_production_recorded_at') ~ '^\d{4}-\d{2}-\d{2}');

    SELECT COALESCE(sum(CASE p_material WHEN 'oil_kernel'   THEN r.food_grade_kernel_kg + r.crude_kernel_kg
                                        WHEN 'kernel_dust'  THEN r.kernel_dust_kg
                                        WHEN 'cracker_dust' THEN r.cracker_dust_kg END), 0),
           COALESCE(sum(r.food_grade_kernel_kg) FILTER (WHERE p_material = 'oil_kernel'), 0)
      INTO v_sh_in, v_sh_fg
      FROM public.oil_raw_receipts r
     WHERE r.voided_at IS NULL
       AND r.received_date BETWEEN v_s_from AND v_s_to;

    RETURN jsonb_build_object(
        'received_kg',       v_in + v_sh_in,
        'received_sheet_kg', v_sh_in,
        'used_kg',           v_used,
        'fg_in_kg',          v_fg_in + v_sh_fg,
        'fg_used_kg',        v_fg_used);
END;
$$;

-- ---------------------------------------------------------------------------
-- Raw material stock at the end of one day. Same output as get_oil_raw_stock plus 'available'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._oil_raw_stock_as_of(p_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_set   jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_count date  := COALESCE((v_set->>'count_date')::date, DATE '2026-10-26');
    v_hist  date  := COALESCE((SELECT (value->>'history_through')::date FROM public.kernel_pipeline_settings
                                WHERE key = 'oil_supplier_recon'), DATE '2026-10-29');
    v_avail boolean := (p_date IS NOT NULL AND p_date >= v_count);
    v_out   jsonb := '[]'::jsonb;
    v_key   text;
    v_m     jsonb;
    v_daily numeric;
    v_cnt   numeric;
    v_fl    jsonb;
    v_in    numeric;
    v_used  numeric;
    v_on    numeric;
    v_fg    numeric;
BEGIN
    FOREACH v_key IN ARRAY ARRAY['oil_kernel', 'kernel_dust', 'cracker_dust'] LOOP
        v_m     := COALESCE(v_set->'materials'->v_key, '{}'::jsonb);
        v_daily := COALESCE((v_m->>'daily_kg')::numeric, 0);
        v_cnt   := COALESCE((v_m->>'count_kg')::numeric, 0);

        IF v_avail THEN
            v_fl   := public._oil_raw_flows(v_count + 1, p_date, v_key);
            v_in   := (v_fl->>'received_kg')::numeric;
            v_used := (v_fl->>'used_kg')::numeric;
            v_on   := v_cnt + v_in - v_used;
            v_fg   := CASE WHEN v_key = 'oil_kernel'
                           THEN COALESCE((v_m->>'count_food_grade_kg')::numeric, 0)
                                + (v_fl->>'fg_in_kg')::numeric - (v_fl->>'fg_used_kg')::numeric END;
            v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                'material',    v_key,
                'count_kg',    v_cnt,
                'received_kg', v_in,
                'received_sheet_kg', (v_fl->>'received_sheet_kg')::numeric,
                'used_kg',     v_used,
                'on_hand_kg',  v_on,
                'daily_kg',    v_daily,
                'minimum_kg',  v_daily * 16,
                'days_cover',  CASE WHEN v_daily > 0 THEN round(v_on / v_daily, 1) END,
                'food_grade_kg', v_fg
            )));
        ELSE
            v_out := v_out || jsonb_build_array(jsonb_build_object(
                'material',    v_key,
                'count_kg',    v_cnt,
                'received_kg', NULL,
                'used_kg',     NULL,
                'on_hand_kg',  NULL,
                'daily_kg',    v_daily,
                'minimum_kg',  v_daily * 16,
                'days_cover',  NULL,
                'food_grade_kg', NULL
            ));
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'available', v_avail, 'count_date', v_count,
                              'history_through', v_hist, 'settings', v_set, 'materials', v_out);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

-- Today's stock: unchanged output, now one code path with the "as of" reader.
CREATE OR REPLACE FUNCTION public.get_oil_raw_stock()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN public._oil_raw_stock_as_of(public.report_sast_today()) - 'available';
END;
$$;

-- ---------------------------------------------------------------------------
-- Every kernel and oil figure for a date range
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reports_all_figures(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today     date := public.report_sast_today();
    v_live_nis  date := COALESCE((SELECT (value->>'nis_intake')::date FROM public.kernel_pipeline_settings
                                   WHERE key = 'reports_live_from'), DATE '2026-10-16');
    c_kg_per_carton constant numeric := 11.34;
    v_styles    text[] := ARRAY['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];

    v_k_proc    jsonb;
    v_k_stor    jsonb;
    v_k_prod    jsonb;
    v_k_stock   jsonb;
    v_k_sales   jsonb;
    v_o_proc    jsonb;
    v_o_raw     jsonb;
    v_o_prod    jsonb;
    v_o_stock   jsonb;
    v_o_sales   jsonb;

    v_first     date;
    v_cracked   numeric;
    v_packed    numeric;
    v_butter    numeric;
    v_packlog   jsonb;
    v_pk_rows   jsonb;
    v_pk_map    jsonb;
    v_n         integer;
    v_to_eff    date;

    v_recon     jsonb;
    v_loads     jsonb;
    v_open      jsonb;
    v_close     jsonb;
    v_mat       text;
    v_fl        jsonb;
    v_mats      jsonb := '[]'::jsonb;
    v_note      text;
    v_val       numeric;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF p_to - p_from > 400 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 400 days.');
    END IF;

    -- ===================================================================================
    -- KERNEL: procurement
    -- ===================================================================================
    WITH intake AS (
        SELECT n.received_date AS d, COALESCE(n.nis_kg, 0) AS kg,
               COALESCE(NULLIF(btrim(n.supplier_name), ''), 'Unknown grower') AS grower
          FROM public.data_nis_intake n
         WHERE n.received_date BETWEEN p_from AND LEAST(p_to, v_live_nis - 1)
        UNION ALL
        SELECT k.received_date, COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg, 0),
               COALESCE(NULLIF(btrim(k.grower_name), ''), 'Unknown grower')
          FROM public.kernel k
         WHERE k.is_active
           AND k.received_date BETWEEN GREATEST(p_from, v_live_nis) AND p_to
    ),
    plan AS (
        SELECT p.scheduled_date AS d, p.predicted_weight_kg AS kg
          FROM public.kernel_intake_procurement p
         WHERE p.status <> 'cancelled'
           AND p.scheduled_date BETWEEN p_from AND p_to
    ),
    tot AS (
        SELECT sum(kg) AS nis_kg,
               count(*) FILTER (WHERE kg > 0)::integer AS deliveries,
               count(DISTINCT lower(grower)) FILTER (WHERE kg > 0)::integer AS growers
          FROM intake
    ),
    ptot AS (
        SELECT sum(kg) AS planned_kg, count(*)::integer AS trucks FROM plan
    ),
    days AS (
        SELECT COALESCE(i.d, p.d) AS d, i.kg AS received_kg, p.kg AS planned_kg
          FROM (SELECT d, sum(kg) AS kg FROM intake WHERE d IS NOT NULL GROUP BY d) i
          FULL JOIN (SELECT d, sum(kg) AS kg FROM plan GROUP BY d) p ON p.d = i.d
    ),
    gr AS (
        SELECT grower, count(*)::integer AS deliveries, sum(kg) AS nis_kg,
               row_number() OVER (ORDER BY sum(kg) DESC, grower) AS rn
          FROM intake GROUP BY grower
    )
    SELECT jsonb_build_object(
               'nis_kg',         tot.nis_kg,
               'deliveries',     tot.deliveries,
               'growers',        tot.growers,
               'planned_kg',     ptot.planned_kg,
               'planned_trucks', ptot.trucks,
               'received_vs_plan_pct', CASE WHEN COALESCE(ptot.planned_kg, 0) > 0 AND tot.nis_kg IS NOT NULL
                                            THEN round(tot.nis_kg / ptot.planned_kg * 100, 1) END,
               'cost_captured',  false,
               'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                       'd', days.d, 'received_kg', days.received_kg, 'planned_kg', days.planned_kg)
                                       ORDER BY days.d) FROM days), '[]'::jsonb),
               'by_grower', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                          'grower', x.grower, 'deliveries', x.deliveries, 'nis_kg', x.nis_kg)
                                          ORDER BY x.ord, x.nis_kg DESC)
                                        FROM (SELECT 1 AS ord, g.grower, g.deliveries, g.nis_kg FROM gr g WHERE g.rn <= 25
                                              UNION ALL
                                              SELECT 2, 'Other growers', sum(g.deliveries)::integer, sum(g.nis_kg)
                                                FROM gr g WHERE g.rn > 25 HAVING count(*) > 0) x), '[]'::jsonb))
      INTO v_k_proc
      FROM tot, ptot;

    -- ===================================================================================
    -- KERNEL: NIS storage (balances only exist from the first recorded movement)
    -- ===================================================================================
    SELECT min((m.moved_at AT TIME ZONE 'Africa/Johannesburg')::date) INTO v_first FROM public.nis_storage_movements m;

    IF v_first IS NULL OR p_to < v_first THEN
        v_k_stor := jsonb_build_object('available', false, 'available_from', v_first,
                                       'end_kg', NULL, 'in_kg', NULL, 'out_kg', NULL, 'by_area', '[]'::jsonb);
    ELSE
        WITH ev AS (
            SELECT (m.moved_at AT TIME ZONE 'Africa/Johannesburg')::date AS d, m.to_area AS area,
                   m.kg AS delta, m.movement_type AS mt
              FROM public.nis_storage_movements m WHERE m.to_area IS NOT NULL
            UNION ALL
            SELECT (m.moved_at AT TIME ZONE 'Africa/Johannesburg')::date, m.from_area, -m.kg, m.movement_type
              FROM public.nis_storage_movements m WHERE m.from_area IS NOT NULL
        ),
        per AS (
            SELECT e.area,
                   sum(e.delta) FILTER (WHERE e.d <= p_to) AS end_kg,
                   sum(e.delta) FILTER (WHERE e.d BETWEEN p_from AND p_to AND e.delta > 0) AS in_kg,
                   -sum(e.delta) FILTER (WHERE e.d BETWEEN p_from AND p_to AND e.delta < 0) AS out_kg
              FROM ev e GROUP BY e.area
        )
        SELECT jsonb_build_object(
                   'available', true,
                   'available_from', v_first,
                   'end_kg', COALESCE((SELECT sum(per.end_kg) FROM per), 0),
                   'in_kg',  COALESCE((SELECT sum(e.delta) FROM ev e WHERE e.mt = 'in'
                                        AND e.d BETWEEN p_from AND p_to), 0),
                   'out_kg', COALESCE((SELECT -sum(e.delta) FROM ev e WHERE e.mt = 'out'
                                        AND e.d BETWEEN p_from AND p_to), 0),
                   'by_area', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                  'code', a.code, 'label', a.label,
                                  'in_kg', COALESCE(per.in_kg, 0), 'out_kg', COALESCE(per.out_kg, 0),
                                  'end_kg', COALESCE(per.end_kg, 0), 'capacity_kg', a.capacity_kg)
                                  ORDER BY a.display_order)
                                  FROM public.nis_storage_areas a
                                  LEFT JOIN per ON per.area = a.code
                                 WHERE a.is_active OR per.area IS NOT NULL), '[]'::jsonb))
          INTO v_k_stor;
    END IF;

    -- ===================================================================================
    -- KERNEL: production (headlines via the report resolver; styles from the packing log)
    -- ===================================================================================
    v_cracked := public.resolve_report_metric_value('kernel_nis_cracking_kg', p_from, p_to);
    v_packed  := public.resolve_report_metric_value('kernel_sk_packing_kg', p_from, p_to);

    v_packlog := public.get_packing_log(p_from, p_to);
    v_pk_rows := CASE WHEN COALESCE((v_packlog->>'success')::boolean, false)
                      THEN COALESCE(v_packlog->'rows', '[]'::jsonb) ELSE '[]'::jsonb END;

    SELECT CASE WHEN jsonb_array_length(v_pk_rows) > 0
                THEN (SELECT sum((r->>'bt_kg')::numeric) FROM jsonb_array_elements(v_pk_rows) r) END
      INTO v_butter;

    SELECT COALESCE(jsonb_object_agg(s.style, s.kg), '{}'::jsonb)
      INTO v_pk_map
      FROM (SELECT kv.key AS style, sum(kv.value::numeric) AS kg
              FROM jsonb_array_elements(v_pk_rows) r
              CROSS JOIN LATERAL jsonb_each_text(
                  CASE WHEN jsonb_typeof(r->'by_style') = 'object' THEN r->'by_style' ELSE '{}'::jsonb END) kv
             WHERE kv.key = ANY (v_styles)
               AND kv.value ~ '^-?\d+(\.\d+)?$'
             GROUP BY kv.key
            HAVING sum(kv.value::numeric) <> 0) s;

    SELECT jsonb_build_object(
               'cracked_kg',   v_cracked,
               'sk_packed_kg', v_packed,
               'butter_kg',    v_butter,
               'cartons',      CASE WHEN v_packed IS NOT NULL THEN round(v_packed / c_kg_per_carton, 1) END,
               'recovery_pct', CASE WHEN COALESCE(v_cracked, 0) > 0 AND v_packed IS NOT NULL
                                    THEN round(v_packed / v_cracked * 100, 2) END,
               'byproducts', jsonb_build_object(
                   'oil_kernel_kg',   public.resolve_report_metric_value('byproduct_oil_kernel_kg', p_from, p_to),
                   'cracker_dust_kg', public.resolve_report_metric_value('byproduct_cracker_dust_kg', p_from, p_to),
                   'shell_fines_kg',  public.resolve_report_metric_value('byproduct_shell_fines_kg', p_from, p_to),
                   'compost_kg',      public.resolve_report_metric_value('byproduct_compost_kg', p_from, p_to),
                   'shell_kg',        public.resolve_report_metric_value('byproduct_shell_kg', p_from, p_to)),
               'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                       'd', d.production_date, 'cracked_kg', d.cracked_kg, 'sk_packed_kg', d.sk_packed_kg)
                                       ORDER BY d.production_date)
                                     FROM public.data_production_daily d
                                    WHERE d.production_date BETWEEN p_from AND p_to), '[]'::jsonb),
               'packed_by_style', COALESCE((SELECT jsonb_agg(jsonb_build_object('style', e.key, 'kg', e.value::numeric)
                                                              ORDER BY e.value::numeric DESC)
                                              FROM jsonb_each_text(v_pk_map) e), '[]'::jsonb))
      INTO v_k_prod;

    -- ===================================================================================
    -- KERNEL: finished stock by style (position at the end of the day before p_from and of p_to)
    -- ===================================================================================
    v_n      := (v_today - (p_from - 1)) + 1;
    v_to_eff := LEAST(p_to, v_today);
    v_k_stock := jsonb_build_object('available', false, 'opening_kg', NULL, 'packed_kg', NULL, 'out_kg', NULL,
                                    'closing_kg', NULL, 'closing_cartons', NULL, 'by_style', '[]'::jsonb);

    IF v_n BETWEEN 1 AND 1826 AND p_from - 1 <= v_to_eff THEN
        WITH h AS (
            SELECT s.d, s.series, s.qty_kg
              FROM public.get_stock_soh_history('kernel', v_n) s
             WHERE s.d IN (p_from - 1, v_to_eff)
        ),
        st AS (
            SELECT h.series AS style,
                   max(h.qty_kg) FILTER (WHERE h.d = p_from - 1) AS opening,
                   max(h.qty_kg) FILTER (WHERE h.d = v_to_eff)   AS closing
              FROM h GROUP BY h.series
        ),
        sr AS (
            SELECT st.style, st.opening AS opening_kg,
                   COALESCE((v_pk_map->>st.style)::numeric, 0) AS packed_kg,
                   st.closing AS closing_kg
              FROM st
             WHERE st.opening IS NOT NULL AND st.closing IS NOT NULL
        )
        SELECT CASE WHEN count(*) = 0 THEN v_k_stock ELSE jsonb_build_object(
                   'available', true,
                   'opening_kg', sum(r.opening_kg),
                   'packed_kg',  sum(r.packed_kg),
                   'out_kg',     sum(r.opening_kg + r.packed_kg - r.closing_kg),
                   'closing_kg', sum(r.closing_kg),
                   'closing_cartons', round(sum(r.closing_kg) / c_kg_per_carton, 1),
                   'by_style', jsonb_agg(jsonb_build_object(
                       'style', r.style, 'opening_kg', r.opening_kg, 'packed_kg', r.packed_kg,
                       'out_kg', r.opening_kg + r.packed_kg - r.closing_kg,
                       'closing_kg', r.closing_kg,
                       'closing_cartons', round(r.closing_kg / c_kg_per_carton, 1))
                       ORDER BY array_position(v_styles, r.style))) END
          INTO v_k_stock
          FROM sr r;
    END IF;

    -- ===================================================================================
    -- KERNEL: sales
    -- ===================================================================================
    v_val := public.resolve_report_metric_value('kernel_sales_excl_vat_zar', p_from, p_to);

    WITH s AS (
        SELECT l.sale_date AS d,
               COALESCE(NULLIF(btrim(l.customer_name), ''), 'Unknown customer') AS customer,
               COALESCE(NULLIF(btrim(l.style_code), ''), 'Unstyled') AS style,
               l.quantity_kg AS kg, l.cartons, l.vat_excl_zar AS zar
          FROM public.data_kernel_sales_lines l
         WHERE l.sale_date BETWEEN p_from AND p_to
    )
    SELECT jsonb_build_object(
               'kg',        (SELECT sum(kg) FROM s),
               'cartons',   (SELECT sum(cartons) FROM s),
               'value_zar', v_val,
               'avg_price_per_kg', CASE WHEN COALESCE((SELECT sum(kg) FROM s), 0) > 0 AND v_val IS NOT NULL
                                        THEN round(v_val / (SELECT sum(kg) FROM s), 2) END,
               'customers', (SELECT count(DISTINCT customer)::integer FROM s),
               'by_customer', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                   'customer', x.customer, 'kg', x.kg, 'value_zar', x.zar) ORDER BY x.zar DESC, x.customer)
                                 FROM (SELECT customer, sum(kg) AS kg, sum(zar) AS zar FROM s GROUP BY customer) x),
                                '[]'::jsonb),
               'by_style', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                   'style', x.style, 'kg', x.kg, 'value_zar', x.zar) ORDER BY x.zar DESC, x.style)
                                 FROM (SELECT style, sum(kg) AS kg, sum(zar) AS zar FROM s GROUP BY style) x),
                                '[]'::jsonb),
               'by_customer_style', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                   'customer', x.customer, 'style', x.style, 'kg', x.kg, 'cartons', x.cartons,
                                   'price_per_kg', CASE WHEN x.kg > 0 THEN round(x.zar / x.kg, 2) END,
                                   'value_zar', x.zar) ORDER BY x.zar DESC, x.customer, x.style)
                                 FROM (SELECT customer, style, sum(kg) AS kg, sum(cartons) AS cartons, sum(zar) AS zar
                                         FROM s GROUP BY customer, style
                                        ORDER BY sum(zar) DESC, customer, style LIMIT 50) x), '[]'::jsonb),
               'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('d', x.d, 'kg', x.kg, 'value_zar', x.zar) ORDER BY x.d)
                                 FROM (SELECT d, sum(kg) AS kg, sum(zar) AS zar FROM s GROUP BY d) x), '[]'::jsonb))
      INTO v_k_sales;

    -- ===================================================================================
    -- OIL: procurement (supplier recon logic: sheet history + portal deliveries)
    -- ===================================================================================
    v_recon := public.get_oil_supplier_recon(p_from, p_to);
    IF NOT COALESCE((v_recon->>'success')::boolean, false) THEN
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_recon->>'error', 'Oil deliveries could not be read.'));
    END IF;
    v_loads := COALESCE(v_recon->'loads', '[]'::jsonb);

    WITH l AS (
        SELECT (e->>'received_date')::date AS d,
               COALESCE(NULLIF(btrim(e->>'supplier'), ''), 'No supplier') AS supplier,
               COALESCE((e->>'food_grade_kg')::numeric, 0) + COALESCE((e->>'crude_kg')::numeric, 0) AS oil_kernel_kg,
               COALESCE((e->>'food_grade_kg')::numeric, 0) AS food_grade_kg,
               COALESCE((e->>'kernel_dust_kg')::numeric, 0) AS kernel_dust_kg,
               COALESCE((e->>'cracker_dust_kg')::numeric, 0) AS cracker_dust_kg
          FROM jsonb_array_elements(v_loads) e
    )
    SELECT jsonb_build_object(
               'total_kg',        COALESCE((SELECT sum(oil_kernel_kg + kernel_dust_kg + cracker_dust_kg) FROM l), 0),
               'oil_kernel_kg',   COALESCE((SELECT sum(oil_kernel_kg) FROM l), 0),
               'food_grade_kg',   COALESCE((SELECT sum(food_grade_kg) FROM l), 0),
               'kernel_dust_kg',  COALESCE((SELECT sum(kernel_dust_kg) FROM l), 0),
               'cracker_dust_kg', COALESCE((SELECT sum(cracker_dust_kg) FROM l), 0),
               'loads',           (SELECT count(*)::integer FROM l),
               'cost_captured',   false,
               'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                       'd', x.d, 'oil_kernel_kg', x.ok, 'kernel_dust_kg', x.kd, 'cracker_dust_kg', x.cd)
                                       ORDER BY x.d)
                                     FROM (SELECT d, sum(oil_kernel_kg) AS ok, sum(kernel_dust_kg) AS kd, sum(cracker_dust_kg) AS cd
                                             FROM l GROUP BY d) x), '[]'::jsonb),
               'by_supplier', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                       'supplier', x.supplier, 'oil_kernel_kg', x.ok, 'kernel_dust_kg', x.kd,
                                       'cracker_dust_kg', x.cd, 'total_kg', x.ok + x.kd + x.cd)
                                       ORDER BY x.ok + x.kd + x.cd DESC, x.supplier)
                                     FROM (SELECT supplier, sum(oil_kernel_kg) AS ok, sum(kernel_dust_kg) AS kd, sum(cracker_dust_kg) AS cd
                                             FROM l GROUP BY supplier) x), '[]'::jsonb))
      INTO v_o_proc;

    -- ===================================================================================
    -- OIL: raw material stock. Positions at both ends; movements always summed.
    -- ===================================================================================
    v_open  := public._oil_raw_stock_as_of(p_from - 1);
    v_close := public._oil_raw_stock_as_of(p_to);

    FOREACH v_mat IN ARRAY ARRAY['oil_kernel', 'kernel_dust', 'cracker_dust'] LOOP
        v_fl := public._oil_raw_flows(p_from, p_to, v_mat);
        v_mats := v_mats || jsonb_build_array(jsonb_build_object(
            'material',   v_mat,
            'label',      CASE v_mat WHEN 'oil_kernel' THEN 'Oil kernel' WHEN 'kernel_dust' THEN 'Kernel dust' ELSE 'Cracker dust' END,
            'opening_kg', (SELECT (m->>'on_hand_kg')::numeric FROM jsonb_array_elements(v_open->'materials') m WHERE m->>'material' = v_mat),
            'received_kg', (v_fl->>'received_kg')::numeric,
            'used_kg',    (v_fl->>'used_kg')::numeric,
            'closing_kg', (SELECT (m->>'on_hand_kg')::numeric FROM jsonb_array_elements(v_close->'materials') m WHERE m->>'material' = v_mat)));
    END LOOP;

    v_note := CASE
                WHEN NOT COALESCE((v_close->>'available')::boolean, false)
                    THEN 'Stock on hand is only known from the stock count on ' || (v_close->>'count_date')
                         || '. Movements for the period are shown.'
                WHEN NOT COALESCE((v_open->>'available')::boolean, false)
                    THEN 'Opening stock is before the stock count on ' || (v_close->>'count_date')
                         || ', so only closing stock and movements are shown.'
                ELSE NULL END;

    v_o_raw := jsonb_build_object(
        'available',  COALESCE((v_open->>'available')::boolean, false) AND COALESCE((v_close->>'available')::boolean, false),
        'count_date', v_close->>'count_date',
        'note',       v_note,
        'materials',  v_mats);

    -- ===================================================================================
    -- OIL: production (grade totals via the report resolver, same sources as the metrics)
    -- ===================================================================================
    WITH lots AS (
        SELECT l.manufacture_date AS d, l.grade, l.kilograms AS kg
          FROM public.oil_stock_lots l
         WHERE l.counterparty_type IS NULL
           AND l.grade IN ('Food grade', 'Cosmetic', 'Protein powder')
           AND l.manufacture_date BETWEEN p_from AND p_to
    ),
    cake AS (
        SELECT c.movement_date AS d, c.kg
          FROM public.oil_cake_movements c
         WHERE c.voided_at IS NULL AND c.kind = 'produced'
           AND c.movement_date BETWEEN p_from AND p_to
    ),
    days AS (
        SELECT d FROM lots UNION SELECT d FROM cake
    )
    SELECT jsonb_build_object(
               'food_grade_kg', public.resolve_report_metric_value('oil_food_grade_produced_kg', p_from, p_to),
               'crude_kg',      public.resolve_report_metric_value('oil_cosmetic_produced_kg', p_from, p_to),
               'protein_kg',    public.resolve_report_metric_value('oil_protein_produced_kg', p_from, p_to),
               'cake_kg',       (SELECT sum(kg) FROM cake),
               'oil_litres',    (SELECT sum(o.total_oil_litre) FROM public.oil o
                                  WHERE COALESCE(o.is_active, true) AND o.production_date BETWEEN p_from AND p_to),
               'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                       'd', days.d,
                                       'food_grade_kg', COALESCE((SELECT sum(kg) FROM lots WHERE lots.d = days.d AND lots.grade = 'Food grade'), 0),
                                       'crude_kg',      COALESCE((SELECT sum(kg) FROM lots WHERE lots.d = days.d AND lots.grade = 'Cosmetic'), 0),
                                       'protein_kg',    COALESCE((SELECT sum(kg) FROM lots WHERE lots.d = days.d AND lots.grade = 'Protein powder'), 0),
                                       'cake_kg',       COALESCE((SELECT sum(kg) FROM cake WHERE cake.d = days.d), 0))
                                       ORDER BY days.d)
                                     FROM days WHERE days.d IS NOT NULL), '[]'::jsonb))
      INTO v_o_prod;

    -- ===================================================================================
    -- OIL: finished stock (food grade / cosmetic / protein from the stock history; cake untracked)
    -- ===================================================================================
    WITH h AS (
        SELECT s.d, s.series, s.qty_kg
          FROM public.get_stock_soh_history('oil', GREATEST(v_n, 1)) s
         WHERE v_n BETWEEN 1 AND 1826 AND p_from - 1 <= v_to_eff
           AND s.d IN (p_from - 1, v_to_eff)
    ),
    st AS (
        SELECT h.series AS product,
               max(h.qty_kg) FILTER (WHERE h.d = p_from - 1) AS opening,
               max(h.qty_kg) FILTER (WHERE h.d = v_to_eff)   AS closing
          FROM h GROUP BY h.series
    ),
    prod AS (
        SELECT CASE WHEN position('protein' in lower(COALESCE(l.product_description, ''))) > 0
                      OR position('protein' in lower(COALESCE(l.grade, ''))) > 0 THEN 'protein'
                    WHEN position('cosmetic' in lower(COALESCE(l.grade, ''))) > 0 THEN 'cosmetic'
                    ELSE 'food_grade' END AS product,
               sum(l.kilograms) AS kg
          FROM public.oil_stock_lots l
         WHERE l.counterparty_type IS NULL
           AND l.manufacture_date BETWEEN p_from AND p_to
         GROUP BY 1
    ),
    prods(product, label, ord) AS (
        VALUES ('food_grade', 'Food grade oil', 1), ('cosmetic', 'Cosmetic (crude) oil', 2), ('protein', 'Protein powder', 3)
    )
    SELECT jsonb_build_object('products',
               (SELECT jsonb_agg(jsonb_build_object(
                            'product', p.product, 'label', p.label, 'tracked', true,
                            'opening_kg', st.opening,
                            'produced_kg', COALESCE(prod.kg, 0),
                            'sold_kg', CASE WHEN st.opening IS NOT NULL AND st.closing IS NOT NULL
                                            THEN st.opening + COALESCE(prod.kg, 0) - st.closing END,
                            'closing_kg', st.closing) ORDER BY p.ord)
                  FROM prods p
                  LEFT JOIN st   ON st.product = p.product AND st.opening IS NOT NULL AND st.closing IS NOT NULL
                  LEFT JOIN prod ON prod.product = p.product)
               || jsonb_build_array(jsonb_build_object(
                            'product', 'cake', 'label', 'Oil cake', 'tracked', false,
                            'opening_kg', NULL,
                            'produced_kg', (SELECT sum(c.kg) FROM public.oil_cake_movements c
                                             WHERE c.voided_at IS NULL AND c.kind = 'produced'
                                               AND c.movement_date BETWEEN p_from AND p_to),
                            'sold_kg',     (SELECT sum(c.kg) FROM public.oil_cake_movements c
                                             WHERE c.voided_at IS NULL AND c.kind = 'sold'
                                               AND c.movement_date BETWEEN p_from AND p_to),
                            'closing_kg', NULL)))
      INTO v_o_stock;

    -- ===================================================================================
    -- OIL: sales. Local invoice lines + export register, de-duplicated like the report resolver:
    -- a local line that carries export_register_id is the same sale as its register row, so skipped.
    -- ===================================================================================
    v_val := public.resolve_report_metric_value('oil_sales_excl_vat_zar', p_from, p_to);

    WITH al AS (
        SELECT s.sale_date AS d,
               COALESCE(NULLIF(btrim(s.customer_name), ''), 'Unknown customer') AS customer,
               CASE s.product_line WHEN 'extra_virgin' THEN 'food_grade' WHEN 'crude_cosmetic' THEN 'crude'
                                   WHEN 'protein' THEN 'protein' WHEN 'cake' THEN 'cake' ELSE 'other' END AS product,
               s.quantity_kg AS kg, s.vat_excl_zar AS zar, 'local'::text AS ch
          FROM public.data_oil_sales_lines s
         WHERE s.sale_date BETWEEN p_from AND p_to
           AND s.export_register_id IS NULL
        UNION ALL
        SELECT e.export_date,
               COALESCE(NULLIF(btrim(e.customer_name), ''), 'Unknown customer'),
               CASE e.product_class WHEN 'evmo' THEN 'food_grade' WHEN 'crude' THEN 'crude'
                                    WHEN 'protein' THEN 'protein' ELSE 'other' END,
               COALESCE(e.weight_kg, 0), COALESCE(e.rand_value, 0), 'export'::text
          FROM public.data_oil_export_register e
         WHERE e.export_date BETWEEN p_from AND p_to
    )
    SELECT jsonb_build_object(
               'value_zar', v_val,
               'kg',        (SELECT sum(kg) FROM al),
               'local_zar', (SELECT sum(zar) FROM al WHERE ch = 'local'),
               'export_zar', (SELECT sum(zar) FROM al WHERE ch = 'export'),
               'pricing_note', 'Oil Dispatch records kg only; oil sales come from the Sales & Production Data page.',
               'lines', jsonb_build_object(
                   'food_grade', jsonb_build_object('kg', COALESCE((SELECT sum(kg) FROM al WHERE product = 'food_grade'), 0),
                                                    'value_zar', COALESCE((SELECT sum(zar) FROM al WHERE product = 'food_grade'), 0)),
                   'crude',      jsonb_build_object('kg', COALESCE((SELECT sum(kg) FROM al WHERE product = 'crude'), 0),
                                                    'value_zar', COALESCE((SELECT sum(zar) FROM al WHERE product = 'crude'), 0)),
                   'protein',    jsonb_build_object('kg', COALESCE((SELECT sum(kg) FROM al WHERE product = 'protein'), 0),
                                                    'value_zar', COALESCE((SELECT sum(zar) FROM al WHERE product = 'protein'), 0)),
                   'cake',       jsonb_build_object('kg', COALESCE((SELECT sum(kg) FROM al WHERE product = 'cake'), 0),
                                                    'value_zar', COALESCE((SELECT sum(zar) FROM al WHERE product = 'cake'), 0)),
                   'other',      jsonb_build_object('kg', COALESCE((SELECT sum(kg) FROM al WHERE product = 'other'), 0),
                                                    'value_zar', COALESCE((SELECT sum(zar) FROM al WHERE product = 'other'), 0))),
               'by_customer', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                   'customer', x.customer, 'product', x.product, 'kg', x.kg, 'value_zar', x.zar)
                                   ORDER BY x.zar DESC, x.customer, x.product)
                                 FROM (SELECT customer, product, sum(kg) AS kg, sum(zar) AS zar FROM al
                                        GROUP BY customer, product ORDER BY sum(zar) DESC, customer, product LIMIT 100) x),
                                '[]'::jsonb),
               'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('d', x.d, 'product', x.product, 'value_zar', x.zar)
                                   ORDER BY x.d, x.product)
                                 FROM (SELECT d, product, sum(zar) AS zar FROM al GROUP BY d, product) x), '[]'::jsonb))
      INTO v_o_sales;

    RETURN jsonb_build_object(
        'success', true,
        'from', p_from,
        'to', p_to,
        'today', v_today,
        'kernel', jsonb_build_object(
            'procurement',    v_k_proc,
            'storage',        v_k_stor,
            'production',     v_k_prod,
            'finished_stock', v_k_stock,
            'sales',          v_k_sales),
        'oil', jsonb_build_object(
            'procurement',    v_o_proc,
            'raw_stock',      v_o_raw,
            'production',     v_o_prod,
            'finished_stock', v_o_stock,
            'sales',          v_o_sales));
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

COMMENT ON FUNCTION public.get_reports_all_figures(date, date) IS
    'Every kernel and oil figure for a date range (max 400 days) for the Reports "All figures" tab. Headlines go through resolve_report_metric_value so a month equals the monthly report; NULL = no figure, never 0.';

GRANT EXECUTE ON FUNCTION public._oil_raw_flows(date, date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._oil_raw_stock_as_of(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_raw_stock() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_reports_all_figures(date, date) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- FUNCTION PERMISSIONS (bookkeeping) - NOT EXISTS, role_permissions has no unique key
-- ---------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key = 'sales-forecasting-grid'
CROSS JOIN unnest(ARRAY['get_reports_all_figures', '_oil_raw_stock_as_of', '_oil_raw_flows']) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
