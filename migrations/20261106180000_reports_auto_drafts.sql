-- ============================================================================
-- Reports: automatic drafts, due dates and send history (Henry, 6 Nov 2026)
-- ============================================================================
-- 1. report_due_date(period_type, period_start): when a report is due to go out.
--      weekly   the Monday after the Mon-Sun week (period_start + 7)
--      monthly  the 15th of the following month, moved forward to Monday if it is a Sat/Sun
-- 2. ensure_report_drafts(actor): makes sure the previous full week and the previous full month
--    each have a live report (a draft is created if none exists). Safe to call repeatedly and
--    from two places at once: an advisory lock serialises callers and a unique_violation from
--    uq_report_instances_live_period is caught and treated as "already there".
-- 3. list_report_history(period_type, limit): one row per LIVE (non-superseded) report, newest
--    period first, with send state aggregated across ALL versions of that template + period, so
--    a corrected re-issue does not make a report look unsent.
-- 4. pg_cron job 'ensure-report-drafts' at 04:00 UTC (06:00 SAST) every day. Skipped, not failed,
--    where pg_cron is not installed.
--
-- report_deliveries.status only holds pending | sent | failed (20260822090000); 'delivered' and
-- 'read' are accepted too in case receipts are ever folded into status (20260910090000 keeps
-- receipts in their own columns). The table has no status_updated_at, so the send time is
-- coalesce(completed_at, created_at).
--
-- Same model as the other report functions: SECURITY DEFINER RPCs, tables closed to anon.
-- Down: SELECT cron.unschedule('ensure-report-drafts');
--       DROP FUNCTION list_report_history(text, integer), ensure_report_drafts(uuid),
--                     report_due_date(text, date);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_due_date(p_period_type text, p_period_start date)
RETURNS date
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_first date;
    v_15th  date;
BEGIN
    IF p_period_start IS NULL THEN
        RETURN NULL;
    END IF;
    IF p_period_type = 'weekly' THEN
        RETURN p_period_start + 7;
    ELSIF p_period_type = 'monthly' THEN
        v_first := p_period_start - (EXTRACT(DAY FROM p_period_start)::integer - 1);
        v_15th  := (v_first + INTERVAL '1 month')::date + 14;
        IF EXTRACT(ISODOW FROM v_15th)::integer = 6 THEN
            RETURN v_15th + 2;
        ELSIF EXTRACT(ISODOW FROM v_15th)::integer = 7 THEN
            RETURN v_15th + 1;
        END IF;
        RETURN v_15th;
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.report_due_date(text, date) IS
    'Due date of a report: weekly = the Monday after the week; monthly = the 15th of the next month, moved forward to Monday if it falls on a weekend.';

CREATE OR REPLACE FUNCTION public.ensure_report_drafts(p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today   date;
    v_targets jsonb;
    v_t       jsonb;
    v_type    text;
    v_start   date;
    v_tpl     uuid;
    v_inst    uuid;
    v_created boolean;
    v_ok      integer;
    v_err     text;
    v_items   jsonb := '[]'::jsonb;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('ensure_report_drafts'));
    v_today := public.report_sast_today();

    v_targets := jsonb_build_array(
        jsonb_build_object('period_type', 'weekly',  'period_start', public.report_week_start(v_today) - 7),
        jsonb_build_object('period_type', 'monthly',
                           'period_start', ((v_today - (EXTRACT(DAY FROM v_today)::integer - 1)) - INTERVAL '1 month')::date)
    );

    FOR v_t IN SELECT * FROM jsonb_array_elements(v_targets) LOOP
        v_type    := v_t->>'period_type';
        v_start   := (v_t->>'period_start')::date;
        v_created := false;
        v_err     := NULL;
        v_inst    := NULL;
        v_tpl     := NULL;

        SELECT t.id INTO v_tpl
          FROM public.report_templates t
         WHERE t.is_active AND t.period_type = v_type
         ORDER BY t.code
         LIMIT 1;

        IF v_tpl IS NULL THEN
            v_items := v_items || jsonb_build_array(jsonb_build_object(
                'period_type', v_type, 'period_start', v_start,
                'report_instance_id', NULL, 'created', false, 'error', 'No active template.'));
            CONTINUE;
        END IF;

        SELECT ri.id INTO v_inst
          FROM public.report_instances ri
         WHERE ri.template_id = v_tpl AND ri.period_start = v_start AND ri.status <> 'superseded'
         ORDER BY ri.version DESC
         LIMIT 1;

        IF v_inst IS NULL THEN
            BEGIN
                SELECT c.success, c.error, c.report_instance_id
                  INTO v_ok, v_err, v_inst
                  FROM public.create_report_instance(v_tpl, v_start, p_actor_user_id) c;
                v_created := COALESCE(v_ok, 0) = 1;
            EXCEPTION WHEN unique_violation THEN
                v_created := false;
                v_err := NULL;
                SELECT ri.id INTO v_inst
                  FROM public.report_instances ri
                 WHERE ri.template_id = v_tpl AND ri.period_start = v_start AND ri.status <> 'superseded'
                 ORDER BY ri.version DESC
                 LIMIT 1;
            END;
        END IF;

        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'period_type', v_type, 'period_start', v_start,
            'report_instance_id', v_inst, 'created', v_created, 'error', v_err));
    END LOOP;

    RETURN jsonb_build_object('success', true, 'today', v_today, 'items', v_items);
END;
$$;

COMMENT ON FUNCTION public.ensure_report_drafts(uuid) IS
    'Creates the draft for the previous full week and previous full month if no live report exists. Idempotent; advisory-locked; a lost race on uq_report_instances_live_period is treated as already existing.';

CREATE OR REPLACE FUNCTION public.list_report_history(p_period_type text, p_limit integer DEFAULT 26)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 26), 60));
    v_today date    := public.report_sast_today();
    v_items jsonb;
BEGIN
    IF p_period_type IS NULL OR p_period_type NOT IN ('weekly', 'monthly') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Period type must be weekly or monthly.');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', x.id,
               'period_start', x.period_start,
               'period_end', x.period_end,
               'iso_week', x.iso_week,
               'label', x.label,
               'version', x.version,
               'status', x.status,
               'generated_at', x.generated_at,
               'published_at', x.published_at,
               'due_date', x.due_date,
               'first_sent_at', x.first_sent_at,
               'sent_count', x.sent_count,
               'failed_count', x.failed_count,
               'send_state', CASE
                   WHEN x.sent_count > 0 THEN
                       CASE WHEN (x.first_sent_at AT TIME ZONE 'Africa/Johannesburg')::date > x.due_date
                            THEN 'sent_late' ELSE 'sent' END
                   WHEN x.failed_count > 0 THEN 'failed_only'
                   ELSE 'not_sent' END,
               'overdue', (x.sent_count = 0 AND v_today > x.due_date)
           ) ORDER BY x.period_start DESC, x.version DESC), '[]'::jsonb)
      INTO v_items
      FROM (
          SELECT ri.id, ri.period_start, ri.period_end, ri.version, ri.status, ri.generated_at, ri.published_at,
                 CASE WHEN ri.period_type = 'weekly' THEN EXTRACT(WEEK FROM ri.period_start)::integer END AS iso_week,
                 CASE WHEN ri.period_type = 'weekly'
                      THEN 'Wk ' || TO_CHAR(ri.period_start, 'IW') || ' · '
                           || TO_CHAR(ri.period_start, 'FMDD Mon') || ' to ' || TO_CHAR(ri.period_end, 'FMDD Mon')
                      ELSE TO_CHAR(ri.period_start, 'FMMon YYYY') END AS label,
                 public.report_due_date(ri.period_type, ri.period_start) AS due_date,
                 d.first_sent_at, COALESCE(d.sent_count, 0) AS sent_count, COALESCE(d.failed_count, 0) AS failed_count
            FROM public.report_instances ri
            LEFT JOIN LATERAL (
                SELECT min(COALESCE(rd.completed_at, rd.created_at))
                           FILTER (WHERE rd.status IN ('sent', 'delivered', 'read')) AS first_sent_at,
                       count(*) FILTER (WHERE rd.status IN ('sent', 'delivered', 'read'))::integer AS sent_count,
                       count(*) FILTER (WHERE rd.status = 'failed')::integer AS failed_count
                  FROM public.report_instances sib
                  JOIN public.report_deliveries rd ON rd.report_instance_id = sib.id
                 WHERE sib.template_id = ri.template_id AND sib.period_start = ri.period_start
            ) d ON true
           WHERE ri.period_type = p_period_type
             AND ri.status <> 'superseded'
           ORDER BY ri.period_start DESC, ri.version DESC
           LIMIT v_limit
      ) x;

    RETURN jsonb_build_object('success', true, 'items', v_items);
END;
$$;

COMMENT ON FUNCTION public.list_report_history(text, integer) IS
    'Live reports of one period type, newest period first, with due date and send state aggregated across every version of the same template + period. Limit clamped 1..60.';

GRANT EXECUTE ON FUNCTION public.report_due_date(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_report_drafts(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_report_history(text, integer) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Daily job. 04:00 UTC = 06:00 SAST. Guarded: where pg_cron is missing this is a no-op.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron could not be enabled: %', SQLERRM;
    END;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'ensure-report-drafts';
        PERFORM cron.schedule('ensure-report-drafts', '0 4 * * *', 'select public.ensure_report_drafts();');
    ELSE
        RAISE NOTICE 'pg_cron not available - ensure-report-drafts not scheduled.';
    END IF;
END
$cron$;

-- ---------------------------------------------------------------------------
-- FUNCTION PERMISSIONS (bookkeeping) - NOT EXISTS, role_permissions has no unique key
-- ---------------------------------------------------------------------------
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key = 'sales-forecasting-grid'
CROSS JOIN unnest(ARRAY['report_due_date', 'ensure_report_drafts', 'list_report_history']) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
