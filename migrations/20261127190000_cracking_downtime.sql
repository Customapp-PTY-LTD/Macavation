-- ============================================================================
-- Cracking downtime (Mike's MacView, 27 Nov 2026: production "Downtime (min)", home KPI
-- "NIS cracked ... · N min downtime").
--
-- WHY. Our cracking runs are silo runs (silo_runs, 20261006090200): start, stop, kg cracked. There
-- was nothing anywhere for time the cracker stood while a run was open. This adds downtime minutes
-- plus an optional reason to each run, captured on "Stop cracking" or later from the Cracking log.
-- Run time and kg/hour stay as they are (start to stop); downtime is shown next to them.
--
--   silo_runs.downtime_minutes / downtime_reason / downtime_by / downtime_at
--   set_silo_run_downtime(p_run_id, p_minutes, p_reason, p_user_id)   0 or blank clears it
--   get_silo_runs / get_silo_runs_between / get_cracking_log_daily     now also return downtime
--   get_cracking_downtime_summary()   today + this week (Monday start, as get_dashboard_kernel_stats)
--
-- Idempotent. Grants copy close_silo's roles (whoever can stop a run can record its downtime).
-- ============================================================================

ALTER TABLE public.silo_runs ADD COLUMN IF NOT EXISTS downtime_minutes integer;
ALTER TABLE public.silo_runs ADD COLUMN IF NOT EXISTS downtime_reason text;
ALTER TABLE public.silo_runs ADD COLUMN IF NOT EXISTS downtime_by uuid;
ALTER TABLE public.silo_runs ADD COLUMN IF NOT EXISTS downtime_at timestamptz;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'silo_runs_downtime_minutes_check') THEN
        ALTER TABLE public.silo_runs ADD CONSTRAINT silo_runs_downtime_minutes_check
            CHECK (downtime_minutes IS NULL OR downtime_minutes BETWEEN 0 AND 1440);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_silo_run_downtime(
    p_run_id uuid, p_minutes integer, p_reason text, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run public.silo_runs%ROWTYPE;
    v_min integer := NULLIF(p_minutes, 0);
BEGIN
    SELECT * INTO v_run FROM public.silo_runs WHERE id = p_run_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That cracking run was not found.');
    END IF;
    IF v_min IS NOT NULL AND (v_min < 0 OR v_min > 1440) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Downtime must be between 0 and 1440 minutes.');
    END IF;
    IF v_min IS NOT NULL AND v_run.closed_at IS NOT NULL
       AND v_min > ceil(extract(epoch FROM (v_run.closed_at - v_run.opened_at)) / 60.0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Downtime can''t be longer than the run itself.');
    END IF;

    UPDATE public.silo_runs
    SET downtime_minutes = v_min,
        downtime_reason  = CASE WHEN v_min IS NULL THEN NULL ELSE NULLIF(btrim(COALESCE(p_reason, '')), '') END,
        downtime_by      = CASE WHEN v_min IS NULL THEN NULL ELSE p_user_id END,
        downtime_at      = CASE WHEN v_min IS NULL THEN NULL ELSE now() END
    WHERE id = p_run_id;

    RETURN jsonb_build_object('success', true, 'run_id', p_run_id, 'downtime_minutes', v_min);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_silo_runs_between(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF p_date_to - p_date_from > 62 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 62 days.');
    END IF;

    RETURN (
        SELECT jsonb_build_object('success', true, 'runs', COALESCE(jsonb_agg(jsonb_build_object(
            'id', r.id, 'silo_number', r.silo_number, 'opened_at', r.opened_at, 'closed_at', r.closed_at,
            'volume_kg', r.volume_kg, 'left_kg', r.left_kg, 'batch_numbers', r.batch_numbers,
            'grower_names', (SELECT string_agg(DISTINCT k.grower_name, ', ')
                             FROM public.silo_run_bags rb
                             JOIN public.silo_allocations a ON a.id = rb.allocation_id
                             JOIN public.kernel k ON k.id = a.kernel_id
                             WHERE rb.run_id = r.id AND k.grower_name IS NOT NULL AND k.grower_name <> ''),
            'times_edited', r.times_edited,
            'minutes', round(extract(epoch FROM (r.closed_at - r.opened_at)) / 60.0, 1),
            'kg_per_hour', CASE WHEN r.closed_at > r.opened_at
                                THEN round(r.volume_kg / (extract(epoch FROM (r.closed_at - r.opened_at)) / 3600.0), 2) END,
            'downtime_minutes', r.downtime_minutes, 'downtime_reason', r.downtime_reason
        ) ORDER BY r.closed_at DESC), '[]'::jsonb))
        FROM (SELECT * FROM public.silo_runs
              WHERE closed_at IS NOT NULL
                AND (closed_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN p_date_from AND p_date_to
              ORDER BY closed_at DESC
              LIMIT 1000) r
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_silo_runs(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object('success', true, 'runs', COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id, 'silo_number', r.silo_number, 'opened_at', r.opened_at, 'closed_at', r.closed_at,
        'volume_kg', r.volume_kg, 'left_kg', r.left_kg, 'batch_numbers', r.batch_numbers,
        'grower_names', (SELECT string_agg(DISTINCT k.grower_name, ', ')
                         FROM public.silo_run_bags rb
                         JOIN public.silo_allocations a ON a.id = rb.allocation_id
                         JOIN public.kernel k ON k.id = a.kernel_id
                         WHERE rb.run_id = r.id AND k.grower_name IS NOT NULL AND k.grower_name <> ''),
        'times_edited', r.times_edited,
        'minutes', round(extract(epoch FROM (r.closed_at - r.opened_at)) / 60.0, 1),
        'kg_per_hour', CASE WHEN r.closed_at > r.opened_at
                            THEN round(r.volume_kg / (extract(epoch FROM (r.closed_at - r.opened_at)) / 3600.0), 2) END,
        'downtime_minutes', r.downtime_minutes, 'downtime_reason', r.downtime_reason
    ) ORDER BY r.closed_at DESC), '[]'::jsonb))
    FROM (SELECT * FROM public.silo_runs WHERE closed_at IS NOT NULL
          ORDER BY closed_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))) r;
$function$;

CREATE OR REPLACE FUNCTION public.get_cracking_log_daily(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF p_date_to - p_date_from > 400 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 400 days.');
    END IF;

    RETURN (
        SELECT jsonb_build_object('success', true, 'days', COALESCE(jsonb_agg(jsonb_build_object(
            'day', d.day, 'kg', d.kg, 'minutes', d.minutes, 'runs', d.runs, 'emptied', d.emptied,
            'downtime_minutes', d.downtime_minutes
        ) ORDER BY d.day), '[]'::jsonb))
        FROM (
            SELECT (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date AS day,
                   COALESCE(SUM(r.volume_kg), 0) AS kg,
                   COALESCE(SUM(round(extract(epoch FROM (r.closed_at - r.opened_at)) / 60.0, 1)), 0) AS minutes,
                   COUNT(*) AS runs,
                   COUNT(*) FILTER (WHERE COALESCE(r.left_kg, 0) = 0) AS emptied,
                   COALESCE(SUM(r.downtime_minutes), 0) AS downtime_minutes
            FROM public.silo_runs r
            WHERE r.closed_at IS NOT NULL
              AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN p_date_from AND p_date_to
            GROUP BY 1
        ) d
    );
END;
$function$;

-- Home dashboard: downtime next to kg cracked today / this week (same day and week as
-- get_dashboard_kernel_stats; a run counts on the SAST day it stopped, like kg cracked).
CREATE OR REPLACE FUNCTION public.get_cracking_downtime_summary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH d AS (
        SELECT (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date AS today,
               date_trunc('week', (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date)::date AS week_start
    )
    SELECT jsonb_build_object('success', true,
        'today_minutes', COALESCE(SUM(r.downtime_minutes) FILTER (WHERE (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date = d.today), 0),
        'week_minutes',  COALESCE(SUM(r.downtime_minutes), 0),
        'today_runs', COUNT(*) FILTER (WHERE (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date = d.today),
        'week_runs', COUNT(r.id))
    FROM d
    LEFT JOIN public.silo_runs r
      ON r.closed_at IS NOT NULL
     AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN d.week_start AND d.today
    GROUP BY d.today, d.week_start;
$$;

GRANT EXECUTE ON FUNCTION public.set_silo_run_downtime(uuid, integer, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cracking_downtime_summary() TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', 'set_silo_run_downtime', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'close_silo' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = 'set_silo_run_downtime' AND x.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', 'get_cracking_downtime_summary', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'get_dashboard_kernel_stats' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = 'get_cracking_downtime_summary' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
