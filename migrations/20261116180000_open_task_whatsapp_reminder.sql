-- ============================================================================
-- Daily 13:00 WhatsApp reminder about open My Day tasks.
--
-- WHY. Henry, 16 Nov 2026: anyone who still has open tasks gets a WhatsApp warning every day at
-- 13:00 SAST. Tasks belong to a ROLE, so the message goes to every active person in that role.
--
-- WHO GETS ONE. An active user with a CONFIRMED WhatsApp number (users.whatsapp_phone with
-- whatsapp_phone_verified_at set), whose role has at least one open task. "Open" means exactly
-- what My Day shows that role (get_role_tasks, 20261105090000): not completed or dismissed, not
-- snoozed, not scheduled for a later day, and not on a deleted kernel delivery. A task with a kind
-- belongs to every role whose task-<kind> switch is on (_task_kind_roles); one without a kind
-- belongs to its own role. users.sees_all_tasks (Mike) does NOT widen this: he is warned about
-- his own role's tasks only, otherwise he would be warned about everyone's.
--
-- HOW. pg_cron at 11:00 UTC (13:00 SAST) calls cron_send_open_task_reminders(), which posts once
-- to the send-task-reminder-whatsapp edge function using the two Vault secrets every other
-- WhatsApp job already uses. The function sends the approved template macavation_open_tasks:
--   "Hi {{1}}, you still have {{2}} open tasks in Macavation, the oldest from {{3}}.
--    Please open My Day to finish them."
-- One message per person per SAST day: task_reminder_wa_sends keeps a 'sent' row per
-- (user, day) and the recipient list skips anyone who already has one, so a re-run never
-- double-sends.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE throughout, cron.schedule upserts on jobname.
-- ============================================================================

-- 1. Send log --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_reminder_wa_sends (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    sent_on             date NOT NULL,
    phone               text,
    task_count          integer NOT NULL,
    status              text NOT NULL CHECK (status IN ('sent', 'failed')),
    external_message_id text,
    error               text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS task_reminder_wa_sends_one_per_day
    ON public.task_reminder_wa_sends (user_id, sent_on) WHERE status = 'sent';

ALTER TABLE public.task_reminder_wa_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_reminder_wa_sends FROM anon, authenticated;
GRANT ALL ON public.task_reminder_wa_sends TO service_role;

COMMENT ON TABLE public.task_reminder_wa_sends IS
    'One row per daily open-task WhatsApp reminder attempt. At most one ''sent'' row per user per SAST day.';

-- 2. Who should be reminded right now ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_task_reminder_recipients(p_user_id uuid DEFAULT NULL)
RETURNS TABLE (user_id uuid, first_name text, phone text, role_name text,
               task_count integer, oldest_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH open_tasks AS (
        SELECT t.id, t.created_at,
               CASE WHEN t.kind IS NULL THEN ARRAY[t.role]
                    ELSE public._task_kind_roles(t.kind) END AS roles
        FROM public.workflow_tasks t
        LEFT JOIN public.kernel k ON k.id = t.kernel_id
        WHERE t.status NOT IN ('completed', 'dismissed')
          AND (t.kernel_id IS NULL OR k.is_active)
          AND (t.scheduled_date IS NULL OR t.scheduled_date <= public._sast_today())
          AND (t.snoozed_until IS NULL OR t.snoozed_until <= now())
    ), people AS (
        SELECT u.id, NULLIF(trim(u.first_name), '') AS first_name, u.whatsapp_phone,
               COALESCE(r.role_name, u.role) AS role_name
        FROM public.users u
        LEFT JOIN public.roles r ON r.id = u.role_id
        WHERE u.is_active
          AND NULLIF(trim(u.whatsapp_phone), '') IS NOT NULL
          AND u.whatsapp_phone_verified_at IS NOT NULL
          AND (p_user_id IS NULL OR u.id = p_user_id)
    )
    SELECT p.id, COALESCE(p.first_name, 'there'), p.whatsapp_phone, p.role_name,
           count(o.id)::integer,
           to_char(min(o.created_at) AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon YYYY')
    FROM people p
    JOIN open_tasks o ON p.role_name = ANY (o.roles)
    WHERE NOT EXISTS (SELECT 1 FROM public.task_reminder_wa_sends s
                      WHERE s.user_id = p.id AND s.sent_on = public._sast_today()
                        AND s.status = 'sent')
    GROUP BY p.id, p.first_name, p.whatsapp_phone, p.role_name
    ORDER BY p.role_name, p.first_name;
$$;

REVOKE ALL ON FUNCTION public.open_task_reminder_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_task_reminder_recipients(uuid) TO service_role;

-- 3. The cron body ---------------------------------------------------------------------------------
-- Same shape as cron_push_dashboard_alerts (20260910100000): a missing secret is a NOTICE and a
-- quiet skip, and the async pg_net result is never inspected.
CREATE OR REPLACE FUNCTION public.cron_send_open_task_reminders()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
    v_key        text;
    v_base       text;
    v_request_id bigint;
BEGIN
    SELECT decrypted_secret INTO v_key  FROM vault.decrypted_secrets WHERE name = 'wa_cron_service_role_key';
    SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'wa_cron_functions_base_url';

    IF COALESCE(v_key, '') = '' OR COALESCE(v_base, '') NOT LIKE 'https://%' THEN
        RAISE NOTICE 'cron_send_open_task_reminders: Vault secrets not seeded; skipping.';
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.open_task_reminder_recipients()) THEN
        RAISE NOTICE 'cron_send_open_task_reminders: nobody to remind today.';
        RETURN;
    END IF;

    SELECT net.http_post(
        url     := rtrim(v_base, '/') || '/send-task-reminder-whatsapp',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'Authorization', 'Bearer ' || v_key),
        body    := '{}'::jsonb
    ) INTO v_request_id;

    RAISE NOTICE 'cron_send_open_task_reminders: dispatched request %', v_request_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cron_send_open_task_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_send_open_task_reminders() TO service_role;

-- 4. Schedule: 13:00 SAST = 11:00 UTC, every day ---------------------------------------------------
SELECT cron.schedule(
    'open-task-whatsapp-reminder',
    '0 11 * * *',
    $cron$SELECT public.cron_send_open_task_reminders();$cron$
);

-- 5. Verify ----------------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regprocedure('public.open_task_reminder_recipients(uuid)') IS NULL
       OR to_regprocedure('public.cron_send_open_task_reminders()') IS NULL
       OR to_regclass('public.task_reminder_wa_sends') IS NULL THEN
        RAISE EXCEPTION 'open-task reminder migration incomplete';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'open-task-whatsapp-reminder'
                   AND schedule = '0 11 * * *' AND active) THEN
        RAISE EXCEPTION 'open-task-whatsapp-reminder cron job missing';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
