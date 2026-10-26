-- Fix the WhatsApp daily report's "this week" figures: they were a rolling 7-day trailing sum,
-- not a calendar week starting Monday, so on a Monday "this week" included six days of the
-- PREVIOUS week plus today instead of just week-to-date. The user-visible symptom: Monday's
-- weekly kernel-cracked/packed total looked nothing like Monday's own daily total.
--
-- get_dashboard_kernel_stats() (migrations/20260914090000_dashboard_reads_data_production_daily.sql:
-- 61-62, unchanged since) computed v_week_start := v_today - interval '7 days' -- a trailing
-- window with no Monday anchor at all. Fixed here to date_trunc('week', v_today), which in
-- Postgres's default (ISO, Monday-first) week numbering is always that week's Monday, using the
-- v_today that function already computes correctly in Africa/Johannesburg.
--
-- get_daily_digest() (migrations/20260918100000_daily_digest_nis_runway.sql:69-72, the current
-- live version) already used a calendar-week anchor for oil (date_trunc('week', current_date)),
-- but against bare current_date -- the SERVER's UTC date, not Africa/Johannesburg's. That is the
-- same UTC-vs-SAST gap flagged in migrations/20260825090000_report_subscriptions_and_staff.sql:
-- 44-46 for the report engine generally: for the first two hours of every SAST day (00:00-02:00
-- SAST = 22:00-00:00 UTC the previous day), UTC's current_date is still the previous calendar
-- day, which on a Monday means UTC hasn't rolled into the new week yet and date_trunc('week', ...)
-- anchors to the PRIOR Monday. The report sends at 17:00 SAST (15:00 UTC,
-- migrations/20260909090000_whatsapp_report_schedule.sql:19) so this exact gap does not bite at
-- send time today, but it is still wrong on principle and would bite the moment anything else
-- calls get_daily_digest() earlier in the day. Fixed here to anchor on the same
-- Africa/Johannesburg date get_dashboard_kernel_stats() already uses, so kernel and oil in the
-- same digest payload use one consistent, correct week definition instead of two different ones.
--
-- Only the week-start line changes in each function; both are otherwise copied verbatim from
-- their current live definitions (confirmed no later migration redefines either).
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260930090000_weekly_totals_monday_anchored.sql
-- against dev (nmdmddugxclpqrwylyfa) and, after sign-off, npm run db:apply-prod for the same file
-- against prod (sofanhfpxifgdtooefzq). Demo shares the dev database, so applying to dev covers it.

-- ============================================================================
-- 1. get_dashboard_kernel_stats() -- Monday-anchored week instead of trailing 7 days.
-- Source: migrations/20260914090000_dashboard_reads_data_production_daily.sql:43-89 (unchanged
-- since). Only v_week_start's definition changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_kernel_stats()
RETURNS TABLE (
    batches_in_production bigint,
    kg_cracked_today numeric,
    kg_cracked_week numeric,
    kg_packed_today numeric,
    kg_packed_week numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batches bigint;
    v_kg_today numeric;
    v_kg_week numeric;
    v_packed_today numeric;
    v_packed_week numeric;
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_week_start date := date_trunc('week', (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date)::date;
BEGIN
    SELECT count(*)::bigint INTO v_batches
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status = 'production';

    SELECT COALESCE(SUM(d.cracked_kg), 0) INTO v_kg_today
    FROM public.data_production_daily d
    WHERE d.production_date = v_today;

    SELECT COALESCE(SUM(d.cracked_kg), 0) INTO v_kg_week
    FROM public.data_production_daily d
    WHERE d.production_date >= v_week_start AND d.production_date <= v_today;

    SELECT COALESCE(SUM(d.sk_packed_kg), 0) INTO v_packed_today
    FROM public.data_production_daily d
    WHERE d.production_date = v_today;

    SELECT COALESCE(SUM(d.sk_packed_kg), 0) INTO v_packed_week
    FROM public.data_production_daily d
    WHERE d.production_date >= v_week_start AND d.production_date <= v_today;

    RETURN QUERY SELECT v_batches, v_kg_today, v_kg_week, v_packed_today, v_packed_week;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_kernel_stats() IS 'Dashboard kernel stats. batches_in_production = active kernels with status production only. Uses Africa/Johannesburg for today/week. kg_cracked_week/kg_packed_week are a calendar week starting Monday (date_trunc(''week'', today) in Africa/Johannesburg), not a rolling 7-day window -- fixed 2026-09-30, see migrations/20260930090000_weekly_totals_monday_anchored.sql. Cracked/packed kg read from data_production_daily (the same corrected source the reports use) instead of raw kernel.cracking_data/packing_data.';

-- ============================================================================
-- 2. get_daily_digest() -- oil's week anchor moved from bare (UTC) current_date to the same
-- Africa/Johannesburg calendar date get_dashboard_kernel_stats() uses, so kernel and oil agree
-- on what "this week" means. Source: migrations/20260918100000_daily_digest_nis_runway.sql
-- (the current live version) -- copied verbatim except for the v_oil block.
-- ============================================================================

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
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_week_start date := date_trunc('week', (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date)::date;
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
            WHERE coalesce(production_date, (created_at AT TIME ZONE 'Africa/Johannesburg')::date) = v_today
        ), 0),
        'litres_week', coalesce(SUM(total_oil_litre) FILTER (
            WHERE coalesce(production_date, (created_at AT TIME ZONE 'Africa/Johannesburg')::date)
                >= v_week_start
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
  'Daily digest payload for the scheduled report edge function. oil_stats.litres_week is now a '
  'calendar week starting Monday in Africa/Johannesburg (previously anchored on bare, UTC '
  'current_date, which could disagree with SAST for the first two hours of a new week) -- fixed '
  '2026-09-30 alongside kernel_stats.kg_cracked_week/kg_packed_week, which had the larger bug of '
  'being a rolling 7-day trailing sum with no Monday anchor at all; see '
  'migrations/20260930090000_weekly_totals_monday_anchored.sql. Adds nis_runway.final_depletion_date '
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

-- ============================================================================
-- 3. Verification — fail the migration rather than report a false success.
-- ============================================================================

DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
BEGIN
    IF to_regprocedure('public.get_dashboard_kernel_stats()') IS NULL THEN
        v_missing := v_missing || 'get_dashboard_kernel_stats()';
    END IF;
    IF to_regprocedure('public.get_daily_digest()') IS NULL THEN
        v_missing := v_missing || 'get_daily_digest()';
    END IF;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Migration incomplete - missing function(s): %', array_to_string(v_missing, ', ');
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
