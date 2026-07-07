-- get_kernel_runway_summary / get_phase2_extended_kpis referenced kernel.remaining_by_style,
-- which is not a column: remaining stock is derived per batch as packing_data yield minus
-- dispatched kg (kernel_dispatch_orders.lines). Compute it the same way get_kernel_batches
-- does, via get_batch_remaining_by_style. packing_data only syncs on job card approval
-- (20260519120000), so this SOH already respects the approval gate.

CREATE OR REPLACE FUNCTION public.kernel_packing_yield_by_style(p_packing_data jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'SP',  COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty', '')::numeric), 0),
    '0',   COALESCE(SUM(NULLIF(e ->> 'sk_0_qty', '')::numeric), 0),
    '1',   COALESCE(SUM(NULLIF(e ->> 'sk_1_qty', '')::numeric), 0),
    '1S',  COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty', '')::numeric), 0),
    '4L',  COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty', '')::numeric), 0),
    '5',   COALESCE(SUM(NULLIF(e ->> 'sk_5_qty', '')::numeric), 0),
    '6',   COALESCE(SUM(NULLIF(e ->> 'sk_6_qty', '')::numeric), 0),
    '7/8', COALESCE(SUM(NULLIF(e ->> 'bt_78_qty', '')::numeric), 0),
    'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_qty', '')::numeric), 0),
    'Butter Low Oil',  COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0))
  FROM jsonb_array_elements(COALESCE(NULLIF(p_packing_data, 'null'::jsonb), '[]'::jsonb)) e;
$$;

COMMENT ON FUNCTION public.kernel_packing_yield_by_style(jsonb) IS
  'Style -> packed kg from kernel.packing_data. Same mapping as get_kernel_batches yield_by_style.';

CREATE OR REPLACE FUNCTION public.get_kernel_runway_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_soh_kg numeric := 0;
    v_weekly_demand_kg numeric := 0;
    v_weeks_cover numeric;
BEGIN
    SELECT coalesce(SUM(
        (SELECT coalesce(SUM((value)::numeric), 0)
         FROM jsonb_each_text(public.get_batch_remaining_by_style(
             k.id, public.kernel_packing_yield_by_style(k.packing_data))))
    ), 0) INTO v_soh_kg
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status IN ('complete', 'in_finished_stock');

    SELECT coalesce(SUM(coalesce(f.quantity_cartons, 0) * 11.34), 0) / 4.0 INTO v_weekly_demand_kg
    FROM public.kernel_production_forecast f
    WHERE f.status IN ('open', 'in_progress')
      AND coalesce(f.due_date, current_date)
            BETWEEN date_trunc('week', current_date)::date
                AND (date_trunc('week', current_date) + interval '4 weeks')::date;

    IF coalesce(v_weekly_demand_kg, 0) > 0 THEN
        v_weeks_cover := round(v_soh_kg / v_weekly_demand_kg, 1);
    ELSE
        v_weeks_cover := NULL;
    END IF;

    RETURN jsonb_build_object(
        'soh_kg', coalesce(v_soh_kg, 0),
        'weekly_demand_kg', coalesce(v_weekly_demand_kg, 0),
        'weeks_cover', v_weeks_cover,
        'months_cover', CASE WHEN v_weeks_cover IS NOT NULL THEN round(v_weeks_cover / 4.33, 1) ELSE NULL END
    );
END;
$$;

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
BEGIN
    SELECT coalesce(SUM(coalesce(k.wet_nis_received_kg, 0)), 0) INTO v_nis_in
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.received_date >= v_last_month_start
      AND k.received_date < v_month_start + interval '1 month';

    SELECT coalesce(SUM(
        coalesce(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric, 0)
    ), 0) INTO v_sound_out
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true AND elem ? 'date';

    IF v_nis_in > 0 THEN v_recovery_pct := round((v_sound_out / v_nis_in) * 100, 2); END IF;

    SELECT coalesce(SUM(coalesce(o.total_oil_litre, 0)), 0) INTO v_oil_litres
    FROM public.oil o
    WHERE o.is_active = true
      AND coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) >= v_last_month_start;

    SELECT coalesce(SUM(coalesce(l.kilograms, 0)), 0) INTO v_rm_kg
    FROM public.oil_stock_lots l
    WHERE lower(coalesce(l.stock_category, '')) = 'raw_material';

    IF v_rm_kg > 0 THEN v_oil_yield_pct := round((v_oil_litres / v_rm_kg) * 100, 2); END IF;

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
            THEN round(((v_prod_this_month - v_prod_last_month) / v_prod_last_month) * 100, 1) ELSE NULL END
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
