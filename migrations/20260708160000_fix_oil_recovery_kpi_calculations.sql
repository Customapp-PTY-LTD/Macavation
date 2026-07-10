-- Align Phase 2 KPI calculations with business definitions:
--   Sound kernel recovery = sound packed kg / wet NIS kg in (same rolling period)
--   Oil yield = total oil litres / raw RM kg consumed (from production sheets, same period)

CREATE OR REPLACE FUNCTION public.get_phase2_extended_kpis()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_nis_in numeric := 0;
    v_sound_out numeric := 0;
    v_recovery_pct numeric := 0;
    v_oil_litres numeric := 0;
    v_rm_kg numeric := 0;
    v_oil_yield_pct numeric := 0;
    v_kernel_soh numeric := 0;
    v_oil_soh numeric := 0;
    v_rm_soh numeric := 0;
    v_prod_this_month numeric := 0;
    v_prod_last_month numeric := 0;
    v_month_start date := date_trunc('month', current_date)::date;
    v_last_month_start date := (date_trunc('month', current_date) - interval '1 month')::date;
    v_period_end date := (date_trunc('month', current_date) + interval '1 month')::date;
BEGIN
    -- Wet NIS received in rolling window (previous calendar month through current month)
    SELECT coalesce(SUM(coalesce(k.wet_nis_received_kg, 0)), 0) INTO v_nis_in
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.received_date >= v_last_month_start
      AND k.received_date < v_period_end;

    -- Sound kernel packed (sk_total_qty only) for batches received in the same window,
    -- counting packing entries dated within that window.
    SELECT coalesce(SUM(
        coalesce(NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric, 0)
    ), 0) INTO v_sound_out
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND k.received_date >= v_last_month_start
      AND k.received_date < v_period_end
      AND (elem->>'date')::date >= v_last_month_start
      AND (elem->>'date')::date < v_period_end;

    IF v_nis_in > 0 THEN
        v_recovery_pct := round((v_sound_out / v_nis_in) * 100, 2);
    END IF;

    -- Oil litres produced in the same rolling window
    SELECT coalesce(SUM(coalesce(o.total_oil_litre, 0)), 0) INTO v_oil_litres
    FROM public.oil o
    WHERE o.is_active = true
      AND coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) >= v_last_month_start
      AND coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) < v_period_end;

    -- Raw RM kg consumed from oil production sheets (not stock on hand)
    SELECT coalesce(SUM(
        coalesce(
            NULLIF(TRIM(rm->>'weight_raw_in'), '')::numeric,
            NULLIF(TRIM(rm->>'raw_material_in_kg'), '')::numeric,
            0
        )
    ), 0) INTO v_rm_kg
    FROM public.oil o,
         jsonb_array_elements(COALESCE(o.production_data->'raw_materials', '[]'::jsonb)) AS rm
    WHERE o.is_active = true
      AND coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) >= v_last_month_start
      AND coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) < v_period_end;

    IF v_rm_kg > 0 THEN
        v_oil_yield_pct := round((v_oil_litres / v_rm_kg) * 100, 2);
    END IF;

    SELECT coalesce(SUM(
        (SELECT coalesce(SUM((value)::numeric), 0)
         FROM jsonb_each_text(public.get_batch_remaining_by_style(
             k.id, public.kernel_packing_yield_by_style(k.packing_data))))
    ), 0) INTO v_kernel_soh
    FROM public.kernel k WHERE k.is_active = true AND k.status IN ('complete', 'in_finished_stock');

    SELECT coalesce(SUM(coalesce(l.kilograms, 0)), 0) INTO v_oil_soh
    FROM public.oil_stock_lots l
    WHERE lower(coalesce(l.stock_category, '')) = 'finished_good'
      AND lower(coalesce(l.status, '')) IN ('on_hand', 'hold', 'in_stock');

    SELECT coalesce(SUM(coalesce(l.kilograms, 0)), 0) INTO v_rm_soh
    FROM public.oil_stock_lots l
    WHERE lower(coalesce(l.stock_category, '')) = 'raw_material';

    SELECT coalesce(SUM(
        coalesce(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric, 0)
    ), 0) INTO v_prod_this_month
    FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true AND (elem->>'date')::date >= v_month_start;

    SELECT coalesce(SUM(
        coalesce(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric, 0)
    ), 0) INTO v_prod_last_month
    FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND (elem->>'date')::date >= v_last_month_start
      AND (elem->>'date')::date < v_month_start;

    RETURN jsonb_build_object(
        'sound_kernel_recovery_pct', v_recovery_pct,
        'oil_yield_pct', v_oil_yield_pct,
        'kernel_soh_kg', v_kernel_soh,
        'oil_finished_soh_kg', v_oil_soh,
        'oil_rm_soh_kg', v_rm_soh,
        'production_kg_this_month', v_prod_this_month,
        'production_kg_last_month', v_prod_last_month,
        'production_delta_pct', CASE WHEN v_prod_last_month > 0
            THEN round(((v_prod_this_month - v_prod_last_month) / v_prod_last_month) * 100, 1) ELSE NULL END,
        'period_start', v_last_month_start,
        'period_end', v_period_end,
        'nis_in_kg', v_nis_in,
        'sound_packed_kg', v_sound_out,
        'oil_litres', v_oil_litres,
        'oil_rm_consumed_kg', v_rm_kg
    );
END;
$$;

COMMENT ON FUNCTION public.get_phase2_extended_kpis() IS
  'Phase 2 executive KPIs: sound kernel recovery (sk kg / wet NIS, rolling 2-month window), oil yield (litres / RM consumed from production_data), SOH, production deltas.';

NOTIFY pgrst, 'reload schema';
