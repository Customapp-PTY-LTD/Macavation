-- Fix get_kernel_runway_summary to use kernel_production_forecast columns (status, due_date).

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
         FROM jsonb_each_text(coalesce(k.remaining_by_style, '{}'::jsonb)))
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

NOTIFY pgrst, 'reload schema';
