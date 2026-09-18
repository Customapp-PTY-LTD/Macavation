-- Add raw NIS (nut-in-shell) runway to get_daily_digest(), alongside the existing finished-kernel
-- runway (public.get_kernel_runway_summary(), 'runway' key). These are two different stocks and
-- must not be confused: 'runway' is finished/packed kernel vs production-forecast demand;
-- 'nis_runway' is raw uncracked nut-in-shell vs the plant's crack rate, projected day-by-day
-- including scheduled deliveries -- the exact same source the executive dashboard's "Raw material
-- runway forecast (NIS)" chart uses (public.get_nis_runway_forecast(),
-- migrations/20260813120000_nis_runway_forecast_full_depletion.sql).
--
-- Called with no p_kg_per_day / p_rate_basis_month override, exactly like the dashboard's default
-- (unset) rate preview (WebPortal/modules/dashboard/js/executive_dashboard.js:1628-1633) -- so this
-- resolves the crack rate the same way the chart does: dashboard_targets override, else basis
-- month, else none. That keeps the WhatsApp figure identical to whatever the chart currently shows,
-- with no separate rate to keep in sync.
--
-- final_depletion_date (not run_out_date) is surfaced: it is the date the LAST scheduled delivery
-- is itself consumed, i.e. the date the chart's line actually reaches and stays at zero -- see that
-- migration's header for why run_out_date alone would understate cover whenever a delivery is
-- already booked.
--
-- Only ONE column is read out of get_nis_runway_forecast()'s payload; nothing else about that
-- function's shape (points, other meta fields) is touched or relied on here.

CREATE OR REPLACE FUNCTION public.get_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_kernel jsonb;
    v_alerts jsonb;
    v_procurement jsonb;
    v_oil jsonb;
    v_runway jsonb;
    v_nis_runway jsonb;
    v_extended jsonb;
    v_target jsonb;
    v_actual numeric;
    v_target_val numeric;
BEGIN
    SELECT to_jsonb(s) INTO v_kernel FROM public.get_dashboard_kernel_stats() s;
    SELECT public.get_kernel_runway_summary() INTO v_runway;
    SELECT public.get_phase2_extended_kpis() INTO v_extended;

    SELECT jsonb_build_object(
        'final_depletion_date', (public.get_nis_runway_forecast())->'meta'->>'final_depletion_date'
    ) INTO v_nis_runway;

    SELECT jsonb_agg(x) INTO v_alerts FROM (
        SELECT jsonb_build_object(
            'id', a.id, 'title', a.alert_title, 'severity', a.severity,
            'type', a.alert_type, 'created_at', a.created_at
        ) AS x
        FROM public.dashboard_alerts a
        WHERE a.status = 'active'
        ORDER BY a.created_at DESC
        LIMIT 25
    ) sub;

    SELECT jsonb_build_object(
        'deliveries_today', count(*),
        'predicted_kg_today', COALESCE(SUM(predicted_weight_kg), 0)
    ) INTO v_procurement
    FROM public.kernel_intake_procurement
    WHERE status = 'scheduled' AND scheduled_date = current_date;

    SELECT jsonb_build_object(
        'litres_today', coalesce(SUM(total_oil_litre) FILTER (
            WHERE coalesce(production_date, (created_at AT TIME ZONE 'Africa/Johannesburg')::date) = current_date
        ), 0),
        'litres_week', coalesce(SUM(total_oil_litre) FILTER (
            WHERE coalesce(production_date, (created_at AT TIME ZONE 'Africa/Johannesburg')::date)
                >= date_trunc('week', current_date)::date
        ), 0)
    ) INTO v_oil
    FROM public.oil WHERE is_active = true;

    -- Effective-dated lookup (dashboard_targets has no is_active column — it is a plain
    -- effective-dated table; see get_dashboard_targets(), migrations/20260602110000_...sql:47-52).
    SELECT target_value INTO v_target_val FROM public.dashboard_targets
    WHERE metric_key = 'total_production_kg'
      AND effective_from <= current_date
    ORDER BY effective_from DESC, updated_at DESC
    LIMIT 1;

    v_actual := coalesce((v_extended->>'production_kg_this_month')::numeric, 0);

    RETURN jsonb_build_object(
        'generated_at', now(),
        'date', current_date,
        'kernel_stats', COALESCE(v_kernel, '{}'::jsonb),
        'oil_stats', COALESCE(v_oil, '{}'::jsonb),
        'open_alerts', COALESCE(v_alerts, '[]'::jsonb),
        'procurement_today', COALESCE(v_procurement, '{}'::jsonb),
        'runway', COALESCE(v_runway, '{}'::jsonb),
        'nis_runway', COALESCE(v_nis_runway, '{}'::jsonb),
        'extended_kpis', COALESCE(v_extended, '{}'::jsonb),
        'produced_vs_target', jsonb_build_object(
            'actual_kg', v_actual,
            'target_kg', v_target_val,
            'variance_kg', CASE WHEN v_target_val IS NOT NULL THEN v_actual - v_target_val ELSE NULL END
        )
    );
END;
$$;

COMMENT ON FUNCTION public.get_daily_digest() IS
  'Daily digest payload for the scheduled report edge function. Adds nis_runway.final_depletion_date '
  '(2026-09-18): the raw nut-in-shell run-out date from public.get_nis_runway_forecast(), called with '
  'no rate override so it resolves the crack rate exactly as the executive dashboard chart does '
  '(dashboard_targets override, else basis month, else none -- null final_depletion_date when no rate '
  'is configured or history exists). Distinct from the existing runway key, which is finished/packed '
  'kernel stock vs production-forecast demand (public.get_kernel_runway_summary()). Previously fixed '
  '2026-08-13: dashboard_targets.is_active does not exist on that table (it is effective-dated), which '
  'had made every call error and every scheduled digest (email + WhatsApp) fail silently. '
  'produced_vs_target.target_kg / variance_kg remain null when no target row is effective yet.';

DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_daily_digest', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_digest() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
