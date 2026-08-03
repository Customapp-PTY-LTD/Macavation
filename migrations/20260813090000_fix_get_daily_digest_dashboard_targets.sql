-- Fix get_daily_digest(): it errors on every call with
-- "column \"is_active\" does not exist" because public.dashboard_targets has no such column
-- (see migrations/20260602110000_dashboard_targets.sql:6-18 — it is effective-dated, not a
-- boolean flag). Every scheduled report (email + WhatsApp) has therefore been failing silently:
-- supabase/functions/send-daily-digest/index.ts and send-daily-digest-whatsapp/index.ts both call
-- this RPC, as does WebPortal/js/data-functions.js. The only change from the live definition at
-- migrations/20260706100000_phase2_implementation_complete.sql:233-303 is the target lookup,
-- switched to the same effective-dated pattern get_dashboard_targets() already uses
-- (migrations/20260602110000_dashboard_targets.sql:47-52). Everything else is copied verbatim.
--
-- This migration is standalone: it does not depend on the cracking-kg helper migrations that
-- follow it. PL/pgSQL resolves public.get_dashboard_kernel_stats() by name at call time, so
-- re-creating get_daily_digest() here does not bind it to any particular version of that
-- function.

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
    v_extended jsonb;
    v_target jsonb;
    v_actual numeric;
    v_target_val numeric;
BEGIN
    SELECT to_jsonb(s) INTO v_kernel FROM public.get_dashboard_kernel_stats() s;
    SELECT public.get_kernel_runway_summary() INTO v_runway;
    SELECT public.get_phase2_extended_kpis() INTO v_extended;

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
  'Daily digest payload for the scheduled report edge function. Fixed 2026-08-13: previously '
  'queried dashboard_targets.is_active, a column that has never existed on that table, which '
  'made every call error and every scheduled digest (email + WhatsApp) fail silently. '
  'dashboard_targets is effective-dated, so the target lookup now uses '
  'effective_from <= current_date ORDER BY effective_from DESC, updated_at DESC LIMIT 1, the '
  'same predicate get_dashboard_targets() uses. produced_vs_target.target_kg / variance_kg '
  'remain null when no target row is effective yet.';

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
