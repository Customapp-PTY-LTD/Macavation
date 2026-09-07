-- ============================================================================
-- Put the daily, weekly and monthly WhatsApp report senders on a schedule.
--
-- WHAT IS MISSING TODAY, stated only as this checkout can prove it:
-- migrations/20260901120000_auto_seed_production_daily_cron.sql is the ONLY file in this repo
-- that calls cron.schedule, and it schedules exactly two jobs — reseed-production-daily-hourly
-- (5 * * * *) and reseed-production-daily-nightly (20 23 * * *) — neither of which sends a
-- WhatsApp report. net.http_post appears nowhere in migrations/; the only occurrence anywhere in
-- this repo is an illustrative example in BluePrint/supabase-database-rules.md:448. Both
-- supabase/functions/send-daily-production-report/index.ts and
-- supabase/functions/send-period-report/index.ts already exist and can be called by hand, but
-- nothing in this repo calls either automatically. This migration is what makes that true.
--
-- WHAT THIS ADDS — three named SQL wrapper functions, each scheduled by pg_cron, each posting to
-- one of the two existing edge functions over HTTP via pg_net:
--
--   Job                            | Schedule (UTC) | SAST            | Calls                     | Body
--   -------------------------------|-----------------|-----------------|----------------------------|--------------------------
--   send-daily-whatsapp-report     | 0 15 * * *      | 17:00 daily     | send-daily-production-report | {}
--   send-weekly-whatsapp-report    | 0 4 * * 1       | 06:00 Monday    | send-period-report            | {"p_kind":"weekly"}
--   send-monthly-whatsapp-report   | 0 4 1 * *       | 06:00 on the 1st| send-period-report            | {"p_kind":"monthly"}
--
-- UTC/SAST ARITHMETIC. SAST (Africa/Johannesburg) is UTC+2 year-round, no daylight saving
-- (report_sast_today(), migrations/20260825090000_report_subscriptions_and_staff.sql:49, computes
-- exactly this). Adding 2 hours to any of the UTC times above does not cross midnight, so the SAST
-- calendar day (and day-of-week, and day-of-month) is identical to the UTC one:
--   15:00 UTC + 2h = 17:00 SAST, same day.
--   04:00 UTC + 2h = 06:00 SAST, same day; "* * 1" is Monday in both, "1 * *" is the 1st in both.
--
-- WHY THE DAILY IS 17:00 SAST AND NOT 06:00. With an empty body, send-daily-production-report
-- resolves the date from report_sast_today() (index.ts:183-194) — i.e. TODAY in SAST — and then
-- reseeds and reports on that same date (index.ts:196-213). It refuses to send unless that date
-- already has cracking or packing captured: has_production is (cracked > 0 OR packed > 0) for that
-- date (20260825091000_daily_production_report.sql:330) and the sender returns
-- {skipped:'no_production'} otherwise (index.ts:224-226). At 06:00 SAST the current SAST day has
-- had no factory capture yet, so a 0 4 * * * job would skip almost every morning, silently. 17:00
-- SAST is also the schedule the function's own header already documents (index.ts:2,6), so the
-- code and the schedule now agree instead of contradicting each other. The weekly/monthly sender
-- has no such same-day dependency — it resolves the latest PUBLISHED report_instances row
-- (index.ts:172-186) and skips with {skipped:'no_published_instance'} when there is none — so it
-- keeps the 06:00 SAST slot.
--
-- HUMAN PRE-STEPS, per environment (this same file is applied to both dev and, separately after
-- sign-off, prod, via npm run db:apply / npm run db:apply-prod): seed two Vault secrets, by exact
-- name, before these jobs can send anything:
--   wa_cron_service_role_key     — this database's service-role key.
--   wa_cron_functions_base_url   — this database's edge-function base URL, e.g.
--                                  https://<project-ref>.supabase.co/functions/v1 (no trailing
--                                  slash). Nothing in SQL can read the SUPABASE_URL the edge
--                                  functions themselves see at runtime
--                                  (send-daily-production-report/index.ts:68,
--                                  send-period-report/index.ts:73), and there is no SQL-visible
--                                  per-environment config table in this repo — Vault is the only
--                                  per-database place to keep this out of a committed file, and
--                                  keeps prod's cron from ever posting to dev's project or vice
--                                  versa. This migration creates neither secret; it only guards, at
--                                  call time, for either one being missing (see the wrappers below).
-- This migration does NOT enable pg_net or pg_cron by hand and does NOT seed either secret — see
-- "OUT OF SCOPE" below.
--
-- net.http_post IS ASYNC. It returns a request id, not a response. None of these wrappers reads
-- net._http_response or attempts to branch on the send's outcome — that data is not available
-- synchronously. Visibility into whether the actual HTTP POST and the edge function's own send
-- succeeded lives in pg_net's own net._http_response table and in the edge function's own logs, NOT
-- in cron.job_run_details. cron.job_run_details only ever shows whether this wrapper ITSELF ran
-- without raising, which is why each wrapper still RAISE NOTICEs the returned request id — that is
-- the only receipt this migration can leave behind.
--
-- NO RETRY. If net.http_post's dispatch fails, or the edge function itself errors, that period's
-- send simply did not happen. The daily's own daily_report_already_sent(p_date) keys on
-- report_kind='daily', report_date, status='sent'
-- (migrations/20260825091000_daily_production_report.sql:279-287), and the period sender's
-- period_report_already_sent keys on the report_instance_id and message_kind — so a failed run
-- cannot cause a DUPLICATE send, but the next scheduled run is a full day/week/month later and is
-- NOT a retry of the missed one. A daily that skips because the factory captured nothing that day,
-- and a weekly/monthly that skips because nothing is published yet, are both silent, by-design
-- no-ops — not failures. This migration does not add retry logic; none was asked for.
--
-- OUT OF SCOPE: applying this migration (a human runs it, on dev first, then prod after sign-off);
-- seeding or rotating either Vault secret; enabling pg_net or pg_cron by hand outside this file;
-- retry logic for a failed send; touching either sender edge function; touching
-- reseed-production-daily-hourly, reseed-production-daily-nightly, or
-- migrations/20260901120000_auto_seed_production_daily_cron.sql. No project-ref-shaped literal and
-- no literal Supabase URL appear anywhere in this file, including this header — where the shape
-- needs to be shown, the placeholder https://<project-ref>.supabase.co/functions/v1 is used
-- instead.
--
-- Idempotent to re-run: every function is CREATE OR REPLACE, cron.schedule() upserts on jobname
-- (pg_cron >= 1.4 — see 20260901120000:258), and there is no destructive DDL anywhere in this file.
-- ============================================================================

-- ============================================================================
-- 1. pg_net.
--
-- Idempotent, same mechanism 20260901120000:71 uses for pg_cron. pg_cron itself is already created
-- by that migration and is deliberately not re-created here (see "OUT OF SCOPE" above).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- 2. public.cron_send_daily_report()
--
-- Posts an empty body to send-daily-production-report. The function itself resolves "today" via
-- report_sast_today() when the body is empty (index.ts:183-194) and refuses to send unless that
-- date already has production captured (index.ts:224-226) — see the file header for why this is
-- scheduled at 17:00 SAST rather than 06:00.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_send_daily_report()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_key        text;
    v_base       text;
    v_request_id bigint;
BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'wa_cron_service_role_key';
    SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'wa_cron_functions_base_url';

    IF v_key IS NULL OR v_key = '' THEN
        RAISE EXCEPTION 'cron_send_daily_report: Vault secret "wa_cron_service_role_key" is not '
            'seeded in this database. A human must seed it before this job can send anything.';
    END IF;
    IF v_base IS NULL OR v_base = '' THEN
        RAISE EXCEPTION 'cron_send_daily_report: Vault secret "wa_cron_functions_base_url" is not '
            'seeded in this database. A human must seed it before this job can send anything.';
    END IF;
    IF v_base NOT LIKE 'https://%' THEN
        RAISE EXCEPTION 'cron_send_daily_report: "wa_cron_functions_base_url" must start with '
            'https://, got: %', v_base;
    END IF;

    -- net.http_post is ASYNC — it returns a request id, not a response. This wrapper does not and
    -- must not inspect the async HTTP response table or branch on the send's outcome; see the
    -- file header for where that visibility actually lives.
    SELECT net.http_post(
        url     := rtrim(v_base, '/') || '/send-daily-production-report',
        headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || v_key),
        body    := '{}'::jsonb
    ) INTO v_request_id;

    RAISE NOTICE 'cron_send_daily_report: dispatched net.http_post request id %', v_request_id;
END;
$fn$;

COMMENT ON FUNCTION public.cron_send_daily_report() IS
    'Scheduled body for the 17:00 SAST daily WhatsApp production report. Posts an empty body to '
    'send-daily-production-report, which itself resolves the SAST date and skips silently when '
    'that date has no production captured. Dispatch is fire-and-forget via pg_net; see the '
    'migration header for why the send outcome is never inspected here.';

REVOKE ALL ON FUNCTION public.cron_send_daily_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_send_daily_report() TO service_role;

-- ============================================================================
-- 3. public.cron_send_weekly_report()
--
-- Posts {"p_kind":"weekly"} to send-period-report, which resolves the latest PUBLISHED
-- report_instances row itself (index.ts:172-186) and skips silently when there is none — no
-- same-day dependency, so this stays on the 06:00 SAST slot.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_send_weekly_report()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_key        text;
    v_base       text;
    v_request_id bigint;
BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'wa_cron_service_role_key';
    SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'wa_cron_functions_base_url';

    IF v_key IS NULL OR v_key = '' THEN
        RAISE EXCEPTION 'cron_send_weekly_report: Vault secret "wa_cron_service_role_key" is not '
            'seeded in this database. A human must seed it before this job can send anything.';
    END IF;
    IF v_base IS NULL OR v_base = '' THEN
        RAISE EXCEPTION 'cron_send_weekly_report: Vault secret "wa_cron_functions_base_url" is not '
            'seeded in this database. A human must seed it before this job can send anything.';
    END IF;
    IF v_base NOT LIKE 'https://%' THEN
        RAISE EXCEPTION 'cron_send_weekly_report: "wa_cron_functions_base_url" must start with '
            'https://, got: %', v_base;
    END IF;

    -- net.http_post is ASYNC — it returns a request id, not a response. This wrapper does not and
    -- must not inspect the async HTTP response table or branch on the send's outcome; see the
    -- file header for where that visibility actually lives.
    SELECT net.http_post(
        url     := rtrim(v_base, '/') || '/send-period-report',
        headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || v_key),
        body    := '{"p_kind":"weekly"}'::jsonb
    ) INTO v_request_id;

    RAISE NOTICE 'cron_send_weekly_report: dispatched net.http_post request id %', v_request_id;
END;
$fn$;

COMMENT ON FUNCTION public.cron_send_weekly_report() IS
    'Scheduled body for the 06:00 SAST Monday WhatsApp weekly report. Posts {"p_kind":"weekly"} to '
    'send-period-report, which resolves the latest published report_instances row itself and skips '
    'silently when none exists. Dispatch is fire-and-forget via pg_net; see the migration header '
    'for why the send outcome is never inspected here.';

REVOKE ALL ON FUNCTION public.cron_send_weekly_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_send_weekly_report() TO service_role;

-- ============================================================================
-- 4. public.cron_send_monthly_report()
--
-- Posts {"p_kind":"monthly"} to send-period-report. Same reasoning as the weekly wrapper above,
-- for the monthly period type.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_send_monthly_report()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_key        text;
    v_base       text;
    v_request_id bigint;
BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'wa_cron_service_role_key';
    SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets WHERE name = 'wa_cron_functions_base_url';

    IF v_key IS NULL OR v_key = '' THEN
        RAISE EXCEPTION 'cron_send_monthly_report: Vault secret "wa_cron_service_role_key" is not '
            'seeded in this database. A human must seed it before this job can send anything.';
    END IF;
    IF v_base IS NULL OR v_base = '' THEN
        RAISE EXCEPTION 'cron_send_monthly_report: Vault secret "wa_cron_functions_base_url" is not '
            'seeded in this database. A human must seed it before this job can send anything.';
    END IF;
    IF v_base NOT LIKE 'https://%' THEN
        RAISE EXCEPTION 'cron_send_monthly_report: "wa_cron_functions_base_url" must start with '
            'https://, got: %', v_base;
    END IF;

    -- net.http_post is ASYNC — it returns a request id, not a response. This wrapper does not and
    -- must not inspect the async HTTP response table or branch on the send's outcome; see the
    -- file header for where that visibility actually lives.
    SELECT net.http_post(
        url     := rtrim(v_base, '/') || '/send-period-report',
        headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || v_key),
        body    := '{"p_kind":"monthly"}'::jsonb
    ) INTO v_request_id;

    RAISE NOTICE 'cron_send_monthly_report: dispatched net.http_post request id %', v_request_id;
END;
$fn$;

COMMENT ON FUNCTION public.cron_send_monthly_report() IS
    'Scheduled body for the 06:00 SAST WhatsApp monthly report, sent on the 1st of the month. Posts '
    '{"p_kind":"monthly"} to send-period-report, which resolves the latest published '
    'report_instances row itself and skips silently when none exists. Dispatch is fire-and-forget '
    'via pg_net; see the migration header for why the send outcome is never inspected here.';

REVOKE ALL ON FUNCTION public.cron_send_monthly_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_send_monthly_report() TO service_role;

-- ============================================================================
-- 5. The schedule.
--
-- cron.schedule() upserts on jobname, so re-running this migration rewrites these three jobs
-- rather than stacking duplicates (same behaviour 20260901120000:258 documents for its own two
-- jobs). This migration does not touch reseed-production-daily-hourly or
-- reseed-production-daily-nightly, and does not re-run 20260901120000.
-- ============================================================================

SELECT cron.schedule(
    'send-daily-whatsapp-report',
    '0 15 * * *',
    $cron$SELECT public.cron_send_daily_report();$cron$
);

SELECT cron.schedule(
    'send-weekly-whatsapp-report',
    '0 4 * * 1',
    $cron$SELECT public.cron_send_weekly_report();$cron$
);

SELECT cron.schedule(
    'send-monthly-whatsapp-report',
    '0 4 1 * *',
    $cron$SELECT public.cron_send_monthly_report();$cron$
);

-- ============================================================================
-- 6. Verification — fail the migration rather than report a false success.
--
-- Cannot check the two Vault secrets here without failing the whole apply on a database where a
-- human has not yet seeded them — that per-run guard already lives inside each wrapper (section
-- 2-4 above). What this DOES assert: the three wrapper functions exist, the three new jobnames are
-- present and active, the two pre-existing reseed jobnames are STILL present and active (this
-- migration must not disturb them), and that net.http_post and vault.decrypted_secrets actually
-- resolve in this database.
-- ============================================================================

DO $$
DECLARE
    v_missing     text[] := ARRAY[]::text[];
    v_new_jobs    integer;
    v_reseed_jobs integer;
    v_has_net_http_post boolean;
BEGIN
    IF to_regprocedure('public.cron_send_daily_report()') IS NULL THEN
        v_missing := v_missing || 'cron_send_daily_report()';
    END IF;
    IF to_regprocedure('public.cron_send_weekly_report()') IS NULL THEN
        v_missing := v_missing || 'cron_send_weekly_report()';
    END IF;
    IF to_regprocedure('public.cron_send_monthly_report()') IS NULL THEN
        v_missing := v_missing || 'cron_send_monthly_report()';
    END IF;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Migration incomplete - missing function(s): %', array_to_string(v_missing, ', ');
    END IF;

    SELECT count(*) INTO v_new_jobs
    FROM cron.job
    WHERE jobname IN (
        'send-daily-whatsapp-report',
        'send-weekly-whatsapp-report',
        'send-monthly-whatsapp-report'
    )
    AND active;
    IF v_new_jobs <> 3 THEN
        RAISE EXCEPTION 'Migration incomplete - expected 3 active WhatsApp report-send cron jobs, found %', v_new_jobs;
    END IF;

    SELECT count(*) INTO v_reseed_jobs
    FROM cron.job
    WHERE jobname IN ('reseed-production-daily-hourly', 'reseed-production-daily-nightly')
      AND active;
    IF v_reseed_jobs <> 2 THEN
        RAISE EXCEPTION 'Migration incomplete - the 2 pre-existing reseed cron jobs from '
            '20260901120000 must still be present and active; found %', v_reseed_jobs;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'http_post' AND n.nspname = 'net'
    ) INTO v_has_net_http_post;
    IF NOT v_has_net_http_post THEN
        RAISE EXCEPTION 'Migration incomplete - net.http_post was not found; pg_net did not install '
            'correctly.';
    END IF;

    IF to_regclass('vault.decrypted_secrets') IS NULL THEN
        RAISE EXCEPTION 'Migration incomplete - vault.decrypted_secrets does not resolve; '
            'supabase_vault is not available in this database.';
    END IF;

    RAISE NOTICE 'Verified: 3 active WhatsApp report-send cron jobs, 3 wrapper functions present, '
        '2 pre-existing reseed jobs undisturbed, net.http_post and vault.decrypted_secrets resolve.';
END;
$$;

NOTIFY pgrst, 'reload schema';
