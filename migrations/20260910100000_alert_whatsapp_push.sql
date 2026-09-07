-- Push a dashboard alert to the people who asked for it, over WhatsApp.
--
-- WHAT IS MISSING TODAY, stated only as this checkout can prove it: public.dashboard_alert_wa_pushes
-- does not exist yet, so it holds zero rows — nothing has ever recorded a WhatsApp alert send. The
-- only fan-out an alert has today is trg_dashboard_alert_to_notification
-- (migrations/20260602150000_notifications.sql:206-211), which writes an in-app notification row.
-- Nothing in this repo posts an alert to WhatsApp. This migration adds that third branch, alongside
-- the existing trigger — it does not touch or replace it.
--
-- ARCHITECTURAL DECISION, restated (see the plan this migration was built from for the full
-- reasoning): the WhatsApp push is NOT wired to an AFTER INSERT trigger on dashboard_alerts. A
-- trigger runs inside the SAME transaction as the alert-raising INSERT (commonly from
-- evaluate_stock_alerts, itself called client-side from the Stock Management grid — see
-- supabase/functions/evaluate-stock-alerts-cron/index.ts's own header, unchanged by this plan). An
-- HTTP send inside that trigger would mean a slow or failing WhatsApp send blocks the alert insert
-- itself, and an unhandled trigger exception would ROLL BACK the very alert row the send was meant
-- to report. So instead: a small polling cron job, following wa-flow-05's established pattern
-- (migrations/20260909090000_whatsapp_report_schedule.sql) of a named SQL wrapper function calling
-- net.http_post to reach an edge function, scheduled via pg_cron every 5 minutes. This decouples the
-- alert INSERT entirely from any network I/O.
--
-- pg_net / pg_cron / supabase_vault are already enabled on dev (confirmed live, not derivable from
-- this checkout), and the two Vault secrets wa-flow-05 already seeded — wa_cron_service_role_key,
-- wa_cron_functions_base_url — are reused verbatim below. This migration creates neither extension
-- (both already exist per 20260901120000 and 20260909090000) and seeds neither secret.
--
-- WHAT THIS ADDS:
--   1. report_recipients.alert_severity_floor — per-recipient floor ('none' | 'critical' |
--      'critical_and_warning'), default 'critical'. A 'none' floor, or an 'info'-severity alert at
--      ANY floor, is never pushed — 'info' never appears in the eligibility comparison below, only
--      'critical'/'warning' do, so there is nothing to explicitly exclude.
--   2. dashboard_alert_wa_pushes — one row per (alert, recipient) actually sent, the dedupe record
--      and the daily-cap ledger. NOT an extension of report_deliveries: that table's own
--      report_kind CHECK (migrations/20260825091000_daily_production_report.sql:73) allows only
--      'daily'/'weekly'/'monthly', and a dashboard_alerts row is not a report_instances row —
--      widening that constraint for a case it was never designed to hold would be the wrong fix.
--   3. alert_push_recipients(p_alert_id) — who should be pushed for one alert right now: severity
--      floor, opt-out gate (same rr.opted_out_at IS NULL every report selector already obeys — see
--      migrations/20260907130000_report_opt_out.sql:226-243 — this path is not a second, ungated
--      send), rr.is_active (same as every sibling recipient selector), the per-recipient daily cap
--      (5 sends / rolling 24h, contract 5 — a recipient at the cap is skipped and picked up by a
--      LATER poll only if the alert is still open and they are still under the cap by then; this is
--      deliberate, not an oversight, because an hours-old alert may no longer be the most urgent
--      thing to surface once the window rolls over), and the per-(alert,recipient) dedupe (never
--      pushed twice for the same still-open alert).
--   4. get_dashboard_alert_for_push(p_alert_id) — the one-alert lookup send-alert-whatsapp uses to
--      build the template body. Bare jsonb, no envelope, matching get_daily_production_report's own
--      convention (send-daily-production-report/index.ts:27-28) for a single-object read.
--   5. resolve_dashboard_alert_by_ref(p_ref) — see "WHY A REPLY-ID CANNOT CARRY THE RAW ALERT ID"
--      below. Used only by whatsapp-inbound's "Mark resolved" button-tap dispatch.
--   6. cron_push_dashboard_alerts() + cron.schedule('push-dashboard-alerts-to-whatsapp', '*/5 * * * *',
--      ...) — the wrapper and its schedule. Confirmed against the five existing cron.job rows
--      (reseed-production-daily-hourly, reseed-production-daily-nightly, send-daily-whatsapp-report,
--      send-weekly-whatsapp-report, send-monthly-whatsapp-report) that this jobname collides with
--      none of them.
--
-- REQUEST SHAPE, stated once so send-alert-whatsapp/index.ts and this migration agree: ONE
-- net.http_post per eligible alert, body {"alert_id": "<uuid>"}. Not a batched, all-alerts-at-once
-- payload — the edge function resolves its OWN recipient list per alert (deliverable 2), which
-- mirrors send-daily-production-report/send-period-report's own "one kind, resolve recipients
-- inside the function" shape rather than the cron layer pre-computing a large fan-out payload.
--
-- WHY A REPLY-ID CANNOT CARRY THE RAW ALERT ID. buildReplyId/parseReplyId
-- (supabase/functions/_shared/wa-send.ts:205-232) cap every segment at 24 characters
-- (REPLY_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/) — a real, load-bearing constraint discovered
-- while building this migration, not stated in the plan it was built from. dashboard_alerts.id is a
-- uuid: 36 characters with dashes, 32 without — both exceed the 24-character cap, so it cannot be
-- embedded as a buildReplyId arg segment verbatim. Rather than add a whole new short-code table
-- (report_link_codes' own pattern, migrations/20260825092000_report_link_codes.sql, mints one row
-- PER LINK — wrong shape here: the button payload must exist BEFORE the send succeeds, but contract
-- 4/8 only ever write dashboard_alert_wa_pushes AFTER a successful send), the button's reply-id arg
-- carries the first 24 lowercase-hex characters of the alert id with its dashes stripped (96 bits of
-- the id's 128 bits of entropy — a same-prefix collision across two real alerts is not a realistic
-- event at this application's scale) and resolve_dashboard_alert_by_ref resolves that prefix back to
-- exactly one ACTIVE alert. If the prefix matches zero or more than one active alert (the latter
-- vanishingly unlikely), the tap is treated as stale/ambiguous — the same "confirmation names the
-- alert, so a stale list is caught by a NO reply" safety net commandAck's own header already
-- documents (whatsapp-inbound/index.ts, ACK <n>), not a new failure mode.
--
-- DEVIATION FROM wa-flow-05's PER-GUARD RAISE EXCEPTION SHAPE, deliberate. wa-flow-05's own three
-- wrappers RAISE EXCEPTION when a Vault secret is missing (migrations/20260909090000:126-137 etc.),
-- because each runs once a day/week/month — a hard failure a human notices quickly. This wrapper
-- runs every 5 minutes (contract 2): RAISE EXCEPTION on every tick for however many minutes/hours
-- pass before a human seeds either secret would spam cron.job_run_details with "failed" runs for a
-- condition that is not transient-network-failure-shaped, it is "not configured yet". This wrapper
-- therefore RAISE NOTICEs (never RAISE EXCEPTION) and RETURNs early on a missing/malformed secret,
-- exactly as it does when there is simply nothing eligible to push this tick — both are ordinary,
-- silent no-ops for a job that ticks constantly. net.http_post's own async result is, as in every
-- wrapper in this repo, never inspected or branched on either way.
--
-- OUT OF SCOPE (do not do these here): applying this migration (a human runs it, dev first, then
-- prod after sign-off) and deploying send-alert-whatsapp; seeding or rotating either Vault secret;
-- a snooze feature (no snoozed_until column, no snooze RPC exists for dashboard_alerts — a separate
-- plan if wanted); changing evaluate_stock_alerts or its own (alert-raising) dedupe; scheduling
-- evaluate-stock-alerts-cron itself (still client-side from the Stock Management grid, unchanged).
--
-- Idempotent to re-run: every function is CREATE OR REPLACE, the table/column adds are IF NOT
-- EXISTS, cron.schedule() upserts on jobname, and there is no destructive DDL anywhere in this file.

-- ============================================================================
-- 1. report_recipients.alert_severity_floor
-- ============================================================================

ALTER TABLE public.report_recipients
    ADD COLUMN IF NOT EXISTS alert_severity_floor text DEFAULT 'critical'
        CHECK (alert_severity_floor IN ('none', 'critical', 'critical_and_warning'));

COMMENT ON COLUMN public.report_recipients.alert_severity_floor IS
    'Per-recipient WhatsApp alert-push floor. ''none'' = never pushed a dashboard alert. ''critical'' '
    '(default) = only severity=critical. ''critical_and_warning'' = critical or warning. An '
    'info-severity alert is never pushed at any floor — see alert_push_recipients.';

-- ============================================================================
-- 2. public.dashboard_alert_wa_pushes — the dedupe / daily-cap ledger
--
-- id is a convenience PK beyond contract 4's literal column list (alert_id, recipient_id, sent_at,
-- external_message_id) — every other table in this repo's WhatsApp migrations uses a uuid PK, and
-- one is useful for a future audit join. The UNIQUE constraint is the dedupe contract: the same
-- still-open alert can never be pushed twice to the same recipient.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dashboard_alert_wa_pushes (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id             uuid NOT NULL REFERENCES public.dashboard_alerts (id) ON DELETE CASCADE,
    recipient_id         uuid NOT NULL REFERENCES public.report_recipients (id) ON DELETE CASCADE,
    sent_at              timestamptz NOT NULL DEFAULT now(),
    external_message_id  text NULL,
    CONSTRAINT dashboard_alert_wa_pushes_alert_recipient_uniq UNIQUE (alert_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_alert_wa_pushes_recipient_sent_at
    ON public.dashboard_alert_wa_pushes (recipient_id, sent_at);

REVOKE ALL ON public.dashboard_alert_wa_pushes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.dashboard_alert_wa_pushes TO service_role;

COMMENT ON TABLE public.dashboard_alert_wa_pushes IS
    'One row per (alert, recipient) actually sent over WhatsApp. Dedupe (contract 4) and the '
    '5-per-24h daily cap (contract 5) both key off this table. service_role only — never read or '
    'written by the browser.';

-- ============================================================================
-- 3. public.alert_push_recipients(p_alert_id) — who gets pushed for THIS alert, right now
--
-- 'info' never appears in the severity comparison below — it is excluded by construction (only
-- 'critical' and 'critical_and_warning' floors match anything, and neither ever matches an 'info'
-- alert), not by a redundant explicit exclusion.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.alert_push_recipients(p_alert_id uuid)
RETURNS TABLE (
    recipient_id uuid,
    phone        text,
    display_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT rr.id, public.report_normalize_wa_phone(rr.phone), rr.display_name
    FROM public.dashboard_alerts da
    CROSS JOIN public.report_recipients rr
    WHERE da.id = p_alert_id
      AND da.status = 'active'
      AND rr.is_active
      AND rr.opted_out_at IS NULL
      AND (
           (rr.alert_severity_floor = 'critical' AND da.severity = 'critical')
        OR (rr.alert_severity_floor = 'critical_and_warning' AND da.severity IN ('critical', 'warning'))
      )
      -- Dedupe (contract 4): never pushed for THIS alert before.
      AND NOT EXISTS (
          SELECT 1 FROM public.dashboard_alert_wa_pushes p
          WHERE p.alert_id = da.id AND p.recipient_id = rr.id
      )
      -- Daily cap (contract 5): at most 5 pushes to this recipient in the last rolling 24h. A
      -- recipient over the cap is skipped here and picked up by a LATER poll only if the alert is
      -- still open and they are back under the cap by then — deliberate, not queued for forced
      -- delivery once the window rolls over (see the header for why).
      AND (
          SELECT count(*) FROM public.dashboard_alert_wa_pushes p2
          WHERE p2.recipient_id = rr.id AND p2.sent_at > now() - interval '24 hours'
      ) < 5
    ORDER BY rr.display_name;
$fn$;

REVOKE ALL ON FUNCTION public.alert_push_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_push_recipients(uuid) TO service_role;

-- ============================================================================
-- 4. public.get_dashboard_alert_for_push(p_alert_id) — bare jsonb, read directly (no envelope),
--    same convention as get_daily_production_report (send-daily-production-report/index.ts:27-28).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_alert_for_push(p_alert_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT jsonb_build_object(
        'id',            da.id,
        'alert_title',   da.alert_title,
        'alert_message', da.alert_message,
        'severity',      da.severity,
        'status',        da.status
    )
    FROM public.dashboard_alerts da
    WHERE da.id = p_alert_id;
$fn$;

REVOKE ALL ON FUNCTION public.get_dashboard_alert_for_push(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_alert_for_push(uuid) TO service_role;

-- ============================================================================
-- 5. public.resolve_dashboard_alert_by_ref(p_ref) — bridges the truncated reply-id arg back to a
--    real alert. See the header's "WHY A REPLY-ID CANNOT CARRY THE RAW ALERT ID" for why this
--    exists at all. Returns zero, one, or (vanishingly rarely) more rows; the caller
--    (whatsapp-inbound) treats anything other than exactly one row as stale/not found.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_dashboard_alert_by_ref(p_ref text)
RETURNS TABLE (id uuid, alert_title text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT da.id, da.alert_title
    FROM public.dashboard_alerts da
    WHERE da.status = 'active'
      AND p_ref ~ '^[0-9a-f]{8,32}$'
      AND replace(da.id::text, '-', '') LIKE (p_ref || '%')
    LIMIT 2;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_dashboard_alert_by_ref(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_dashboard_alert_by_ref(text) TO service_role;

-- ============================================================================
-- 6. public.cron_push_dashboard_alerts() — the polling wrapper (contract 1)
--
-- RAISE NOTICE only, never RAISE EXCEPTION — see the header's "DEVIATION FROM wa-flow-05's
-- PER-GUARD RAISE EXCEPTION SHAPE" for why a 5-minute-cadence job treats a missing secret the same
-- as "nothing eligible this tick": both are silent, ordinary no-ops. Exactly one net.http_post per
-- eligible alert (the header's "REQUEST SHAPE" section); its async result is never inspected here,
-- same limitation as every wrapper in migrations/20260909090000_whatsapp_report_schedule.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_push_dashboard_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_key        text;
    v_base       text;
    v_request_id bigint;
    v_alert      record;
    v_count      integer := 0;
BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'wa_cron_service_role_key';
    SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'wa_cron_functions_base_url';

    IF v_key IS NULL OR v_key = '' THEN
        RAISE NOTICE 'cron_push_dashboard_alerts: Vault secret "wa_cron_service_role_key" is not '
            'seeded in this database yet. A human must seed it before this job can send anything. '
            'Skipping this tick.';
        RETURN;
    END IF;
    IF v_base IS NULL OR v_base = '' THEN
        RAISE NOTICE 'cron_push_dashboard_alerts: Vault secret "wa_cron_functions_base_url" is not '
            'seeded in this database yet. A human must seed it before this job can send anything. '
            'Skipping this tick.';
        RETURN;
    END IF;
    IF v_base NOT LIKE 'https://%' THEN
        RAISE NOTICE 'cron_push_dashboard_alerts: "wa_cron_functions_base_url" must start with '
            'https://, got: %. Skipping this tick.', v_base;
        RETURN;
    END IF;

    FOR v_alert IN
        SELECT da.id
        FROM public.dashboard_alerts da
        WHERE da.status = 'active'
          AND EXISTS (SELECT 1 FROM public.alert_push_recipients(da.id))
    LOOP
        -- net.http_post is ASYNC — it returns a request id, not a response. This wrapper does not
        -- and must not inspect the async HTTP response table or branch on the send's outcome.
        SELECT net.http_post(
            url     := rtrim(v_base, '/') || '/send-alert-whatsapp',
            headers := jsonb_build_object(
                           'Content-Type', 'application/json',
                           'Authorization', 'Bearer ' || v_key),
            body    := jsonb_build_object('alert_id', v_alert.id)
        ) INTO v_request_id;

        v_count := v_count + 1;
        RAISE NOTICE 'cron_push_dashboard_alerts: dispatched net.http_post request id % for alert %',
            v_request_id, v_alert.id;
    END LOOP;

    RAISE NOTICE 'cron_push_dashboard_alerts: dispatched % alert push request(s) this tick.', v_count;
END;
$fn$;

COMMENT ON FUNCTION public.cron_push_dashboard_alerts() IS
    'Scheduled body for the every-5-minutes WhatsApp alert push. Finds active dashboard_alerts with '
    'at least one cap-eligible, not-yet-pushed recipient and posts {"alert_id"} to '
    'send-alert-whatsapp once per alert. Dispatch is fire-and-forget via pg_net; see the migration '
    'header for why neither a missing secret nor the send outcome ever raises here.';

REVOKE ALL ON FUNCTION public.cron_push_dashboard_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_push_dashboard_alerts() TO service_role;

-- ============================================================================
-- 7. The schedule (contract 2). cron.schedule() upserts on jobname, so re-running this migration
--    rewrites this one job rather than stacking duplicates. Confirmed not to collide with any of
--    the five jobnames already in cron.job (see header).
-- ============================================================================

SELECT cron.schedule(
    'push-dashboard-alerts-to-whatsapp',
    '*/5 * * * *',
    $cron$SELECT public.cron_push_dashboard_alerts();$cron$
);

-- ============================================================================
-- 8. Verification — fail the migration rather than report a false success. Cannot check the two
--    Vault secrets without failing the whole apply on a database where a human has not yet seeded
--    them (per-run guard already lives inside cron_push_dashboard_alerts, section 6 above).
-- ============================================================================

DO $$
DECLARE
    v_missing      text[] := ARRAY[]::text[];
    v_new_job      integer;
    v_existing_jobs integer;
    v_has_unique   boolean;
BEGIN
    IF to_regprocedure('public.alert_push_recipients(uuid)') IS NULL THEN
        v_missing := v_missing || 'alert_push_recipients(uuid)';
    END IF;
    IF to_regprocedure('public.get_dashboard_alert_for_push(uuid)') IS NULL THEN
        v_missing := v_missing || 'get_dashboard_alert_for_push(uuid)';
    END IF;
    IF to_regprocedure('public.resolve_dashboard_alert_by_ref(text)') IS NULL THEN
        v_missing := v_missing || 'resolve_dashboard_alert_by_ref(text)';
    END IF;
    IF to_regprocedure('public.cron_push_dashboard_alerts()') IS NULL THEN
        v_missing := v_missing || 'cron_push_dashboard_alerts()';
    END IF;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Migration incomplete - missing function(s): %', array_to_string(v_missing, ', ');
    END IF;

    IF to_regclass('public.dashboard_alert_wa_pushes') IS NULL THEN
        RAISE EXCEPTION 'Migration incomplete - public.dashboard_alert_wa_pushes was not created.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dashboard_alert_wa_pushes_alert_recipient_uniq'
          AND conrelid = 'public.dashboard_alert_wa_pushes'::regclass
    ) INTO v_has_unique;
    IF NOT v_has_unique THEN
        RAISE EXCEPTION 'Migration incomplete - dashboard_alert_wa_pushes is missing its (alert_id, '
            'recipient_id) unique constraint.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'report_recipients'
          AND column_name = 'alert_severity_floor'
    ) THEN
        RAISE EXCEPTION 'Migration incomplete - report_recipients.alert_severity_floor was not added.';
    END IF;

    SELECT count(*) INTO v_new_job
    FROM cron.job
    WHERE jobname = 'push-dashboard-alerts-to-whatsapp' AND active;
    IF v_new_job <> 1 THEN
        RAISE EXCEPTION 'Migration incomplete - expected 1 active push-dashboard-alerts-to-whatsapp '
            'cron job, found %', v_new_job;
    END IF;

    SELECT count(*) INTO v_existing_jobs
    FROM cron.job
    WHERE jobname IN (
        'reseed-production-daily-hourly', 'reseed-production-daily-nightly',
        'send-daily-whatsapp-report', 'send-weekly-whatsapp-report', 'send-monthly-whatsapp-report'
    ) AND active;
    IF v_existing_jobs <> 5 THEN
        RAISE EXCEPTION 'Migration incomplete - the 5 pre-existing cron jobs must still be present '
            'and active; found %', v_existing_jobs;
    END IF;

    RAISE NOTICE 'Verified: push-dashboard-alerts-to-whatsapp cron job active, 4 new functions '
        'present, dashboard_alert_wa_pushes + its unique constraint present, '
        'report_recipients.alert_severity_floor present, 5 pre-existing cron jobs undisturbed.';
END;
$$;

NOTIFY pgrst, 'reload schema';
