-- Auto-seed the Production data page from the factory, on a schedule - and fix the reseed bug
-- that made doing so impossible.
--
-- Context. The Production tab of Sales & Production Data reads ONLY from
-- public.data_production_daily (see get_data_production_daily in
-- 20260819090000_data_page_production_daily.sql:287). That table is a MIRROR of the factory's
-- batch capture, not a live view of it, and the only thing that ever fills it is
-- reseed_data_production_daily(). As at 2026-09-01 nothing called that on a schedule:
--
--   * The "Refresh from factory" button on the page calls it for the SELECTED PERIOD only
--     (WebPortal/modules/sales-data/js/sales_data_grid.js:795) - a human has to press it.
--   * supabase/functions/send-daily-production-report/index.ts:199 calls it for ONE day, and its
--     own header comment (line 6) says "Intended schedule (set up outside this repo)". That
--     schedule was never set up. Same for evaluate-stock-alerts-cron, whose header claims a cron
--     that does not exist either.
--   * 20260819090000's own comment at line 499 states the assumption this migration overturns:
--     "this project has no pg_cron".
--
-- The observable result: every row in data_production_daily was data_source='backfill', the last
-- one was 2026-08-06, seeded_at was NULL on all 583 of them, and the page - which opens on the
-- current week - rendered "No production rows for this period" while the factory had captured
-- cracking on 20 separate days in August, up to and including 2026-08-31.
--
-- Fix: enable pg_cron (verified present in shared_preload_libraries with cron.database_name =
-- 'postgres' on both dev nmdmddugxclpqrwylyfa and prod sofanhfpxifgdtooefzq before writing this)
-- and schedule reseed_data_production_daily() over a rolling window. No edge function, no HTTP,
-- no service-role key, no pg_net: the function being called is plain SQL in this same database,
-- so pg_cron can invoke it directly and there is no secret to leak or rotate.
--
-- WHY A ROLLING WINDOW AND NOT JUST YESTERDAY. Batch capture is edited after the fact -
-- KG_CRACKED_UNDERCOUNT_INVESTIGATION.md documents corrections landing days later - so a
-- seed-yesterday-only job would permanently miss them. Two jobs:
--     hourly  - 7 days back, so a figure captured this morning is on the page within the hour.
--     nightly - 14 days back, to sweep up later corrections.
-- Both are cheap: the window is days, not months, and each day is two aggregate helper calls.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. reseed_data_production_daily writes the *_system mirror
-- columns and, for a day that has no row yet, seeds the effective figure from them. On a row that
-- ALREADY exists it never touches the effective figure (20260819090000:265-272). That is what
-- makes a correction Pete typed durable, and it is why running this on a schedule cannot overwrite
-- anyone's work. The 14-day window is chosen partly for this reason: a wider window would reach
-- back into the 2025 backfilled rows and stamp a _system mirror of 0 on days the factory has no
-- capture for, lighting up the drift panel with noise rather than signal.
--
-- KNOWN LIMIT, RECORDED RATHER THAN HIDDEN. The two live helpers do not have equal coverage,
-- measured directly against prod on 2026-09-01:
--     cracking capture (kernel.cracking_data) - earliest day-element 2026-02-13, current to today.
--     packing  capture (kernel.packing_data)  - earliest day-element 2026-06-07, current to today,
--                                               but only 23 of the 87 days since then have a
--                                               non-zero total.
-- So Cracked auto-populates faithfully; SK Packed will auto-populate as 0 on most days because
-- that is genuinely what the factory has recorded. Those are honest reflections of the capture,
-- not a defect in this job, and they are exactly the cases the page's editable effective column
-- and its drift panel exist to handle. Nothing here should be read as a claim that the packing
-- figures are complete. There is NO system source at all before 2026-02-13, so pre-2026 figures
-- are hand-entered permanently and this job must never reach them.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260901120000_auto_seed_production_daily_cron.sql
-- against dev (nmdmddugxclpqrwylyfa) and, after sign-off, npm run db:apply-prod for the same file
-- against prod (sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. pg_cron.
--
-- Supabase ships pg_cron in shared_preload_libraries; this only creates the extension objects,
-- which land in the `cron` schema (the extension itself registers against pg_catalog).
-- Idempotent, so re-running the migration is safe.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- 2. Fix reseed_data_production_daily - it THROWS on negative factory figures.
--
-- Found while first applying this migration to dev: the catch-up reseed aborted with
--
--   23514: new row for relation "data_production_daily" violates check constraint
--          "data_production_daily_packed_check"
--   DETAIL: Failing row contains (..., 2026-08-12, 0.00, 0.00, -79.38, -79.38, ...)
--
-- The cause: the table constrains the EFFECTIVE columns to >= 0
-- (20260819090000:122-123 - cracked_kg >= 0, sk_packed_kg >= 0) while the *_system mirror columns
-- carry no constraint at all. The original reseed inserted the live figure into BOTH, so any day
-- whose packing total is negative violated the effective-column CHECK and raised - it did not
-- return success=0, it aborted the whole statement.
--
-- Negative day-totals are real, not corrupt: kernel_packing_yield_by_style returns per-style
-- kilograms straight from batch capture, and a reversal/adjustment entry is recorded as a negative
-- (prod 2026-08-04 = -351.54 on style 4L; dev 2026-08-12 = -79.38). So this is not a rare edge -
-- one such day anywhere in the range breaks the whole reseed. Which means "Refresh from factory"
-- on the Production tab has been broken for any range containing such a day, for as long as the
-- data has contained one. Fixing it is a prerequisite for scheduling it, not a separate nicety.
--
-- The fix keeps the mirror honest and the report-facing figure legal:
--   * *_system  gets the RAW live figure, negative included - that is the mirror's whole job, and
--     it is what get_data_production_daily_drift compares against.
--   * the effective figure on a NEW row is clamped with GREATEST(x, 0), so a negative capture
--     never becomes a negative report figure.
--   * where a clamp happened, the day is tagged in data_quality_flags, whose documented purpose
--     (20260819090000:141-143) is exactly this: "so a questionable row is visible for review
--     rather than silently dropped or silently corrected". The UI already renders these as a
--     "Check" pill with the flags as its tooltip (sales-data-row-grid.js:314-320), so the clamp
--     is visible to the Sales Exec rather than buried.
--   * flag strings follow the existing snake_case convention in this table
--     (month_not_reconciled_to_report, duplicate_row_in_source).
--
-- Unchanged, and load-bearing: the effective columns are still absent from the ON CONFLICT SET
-- list, so an existing row keeps whatever figure the user put there. The flag merge below
-- deliberately preserves any flag the row already carries and only takes ownership of the two
-- negative_system_* keys, so it cannot erase a backfill flag (139 rows in dev carry them).
--
-- The live helpers are also now called once per day instead of twice, via a derived table.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reseed_data_production_daily(
    p_date_from     date,
    p_date_to       date,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, rows_reseeded integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL THEN
        RETURN QUERY SELECT 0, 'A date range is required.', 0;
        RETURN;
    END IF;
    IF p_date_to < p_date_from THEN
        RETURN QUERY SELECT 0, 'The end date is before the start date.', 0;
        RETURN;
    END IF;
    IF (p_date_to - p_date_from) > 400 THEN
        RETURN QUERY SELECT 0, 'Re-seed a range of 400 days or fewer at a time.', 0;
        RETURN;
    END IF;

    INSERT INTO public.data_production_daily AS t
        (production_date, cracked_kg_system, cracked_kg,
         sk_packed_kg_system, sk_packed_kg, data_source, seeded_at, edited_by,
         data_quality_flags)
    SELECT s.d,
           s.cracked_live,
           GREATEST(COALESCE(s.cracked_live, 0), 0),
           s.packed_live,
           GREATEST(COALESCE(s.packed_live, 0), 0),
           'system_seeded',
           now(),
           p_actor_user_id,
           CASE WHEN COALESCE(s.cracked_live, 0) < 0
                 AND COALESCE(s.packed_live, 0) < 0
                    THEN ARRAY['negative_system_cracked', 'negative_system_packed']
                WHEN COALESCE(s.cracked_live, 0) < 0 THEN ARRAY['negative_system_cracked']
                WHEN COALESCE(s.packed_live, 0)  < 0 THEN ARRAY['negative_system_packed']
                ELSE ARRAY[]::text[]
           END
    FROM (
        SELECT g::date AS d,
               public.production_day_cracked_kg_live(g::date)   AS cracked_live,
               public.production_day_sk_packed_kg_live(g::date) AS packed_live
        FROM generate_series(p_date_from, p_date_to, interval '1 day') g
    ) s
    ON CONFLICT (production_date) DO UPDATE
        -- The effective columns are deliberately absent from this SET list. An existing row keeps
        -- whatever figure the user put there; only the factory-side mirror is refreshed.
        SET cracked_kg_system   = EXCLUDED.cracked_kg_system,
            sk_packed_kg_system = EXCLUDED.sk_packed_kg_system,
            seeded_at           = now(),
            -- Keep every flag this job does not own; re-derive only the negative_system_* pair, so
            -- a day that stops being negative loses the flag and a backfill flag is never lost.
            data_quality_flags  = (
                SELECT COALESCE(array_agg(f ORDER BY f), ARRAY[]::text[])
                FROM (
                    SELECT f FROM unnest(t.data_quality_flags) AS f
                     WHERE f NOT IN ('negative_system_cracked', 'negative_system_packed')
                    UNION
                    SELECT f FROM unnest(EXCLUDED.data_quality_flags) AS f
                ) u(f)
            );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count;
END;
$$;

COMMENT ON FUNCTION public.reseed_data_production_daily(date, date, uuid) IS
    'Refreshes the factory-side mirror for a date range, creating missing days. Never overwrites an '
    'effective figure - that is what makes a correction durable against later batch edits. The '
    '*_system mirror takes the raw factory figure including a negative adjustment; the effective '
    'figure on a new row is clamped at 0 and the day tagged negative_system_* so the clamp is '
    'visible for review rather than silent.';

-- ============================================================================
-- 3. The job body.
--
-- A named wrapper rather than inlining SQL into cron.schedule, for three reasons: the cron command
-- string is then short enough to read in cron.job, the date arithmetic lives in version-controlled
-- SQL instead of a table row, and a failed reseed can RAISE so cron.job_run_details records it as
-- failed instead of silently succeeding.
--
-- Today is resolved with public.report_sast_today(), NEVER current_date. The database TimeZone is
-- UTC on both projects (verified) and the factory works South African hours, so current_date is
-- the wrong day for two hours out of every 24 - the same trap send-daily-production-report avoids
-- at index.ts:190.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cron_reseed_production_daily(p_days_back integer DEFAULT 7)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today date;
    v_from  date;
    v_row   record;
BEGIN
    IF p_days_back IS NULL OR p_days_back < 0 THEN
        RAISE EXCEPTION 'cron_reseed_production_daily: p_days_back must be >= 0, got %', p_days_back;
    END IF;
    -- 400 is reseed_data_production_daily's own cap. Fail here with a clear message rather than
    -- letting the inner function return success=0 for a range we chose ourselves.
    IF p_days_back > 400 THEN
        RAISE EXCEPTION 'cron_reseed_production_daily: p_days_back must be <= 400, got %', p_days_back;
    END IF;

    v_today := public.report_sast_today();
    v_from  := v_today - p_days_back;

    SELECT * INTO v_row
    FROM public.reseed_data_production_daily(v_from, v_today, NULL);

    IF v_row.success IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'reseed_data_production_daily(%, %) failed: %',
            v_from, v_today, COALESCE(v_row.error, 'no error text returned');
    END IF;

    RAISE NOTICE 'cron_reseed_production_daily: % .. % refreshed % row(s)',
        v_from, v_today, v_row.rows_reseeded;
END;
$$;

COMMENT ON FUNCTION public.cron_reseed_production_daily(integer) IS
    'Scheduled body for the Production data page auto-seed. Refreshes the factory mirror for the '
    'last p_days_back days up to report_sast_today(), and raises on failure so cron.job_run_details '
    'shows it. Never overwrites an effective figure - reseed_data_production_daily guarantees that.';

REVOKE ALL ON FUNCTION public.cron_reseed_production_daily(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_reseed_production_daily(integer) TO service_role;

-- ============================================================================
-- 4. The schedule.
--
-- cron.schedule() upserts on jobname in pg_cron >= 1.4 (1.6.4 here), so re-running this migration
-- rewrites the two jobs rather than stacking duplicates. Times are UTC; SAST is UTC+2.
--
--   hourly  - :05 past every hour. 7-day window. Keeps the current week honest during the day.
--   nightly - 23:20 UTC = 01:20 SAST. 14-day window. Sweeps up corrections made after the fact.
--
-- Jobs run as the role that scheduled them (postgres here); reseed_data_production_daily is
-- SECURITY DEFINER regardless, so this does not widen anyone's access.
-- ============================================================================

SELECT cron.schedule(
    'reseed-production-daily-hourly',
    '5 * * * *',
    $cron$SELECT public.cron_reseed_production_daily(7);$cron$
);

SELECT cron.schedule(
    'reseed-production-daily-nightly',
    '20 23 * * *',
    $cron$SELECT public.cron_reseed_production_daily(14);$cron$
);

-- ============================================================================
-- 5. Health check.
--
-- "It must always auto-populate" needs a way to see that it still is. Without this, the failure
-- mode just fixed - a job nobody scheduled - is replaced by an equally silent one: a job that was
-- scheduled and has been failing since. Reads pg_cron's own run log; stores nothing.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_production_reseed_health()
RETURNS TABLE (
    jobname          text,
    schedule         text,
    active           boolean,
    last_run_started timestamptz,
    last_run_status  text,
    last_run_message text,
    data_last_seeded timestamptz,
    data_last_day    date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT j.jobname::text,
           j.schedule::text,
           j.active,
           r.start_time,
           r.status::text,
           r.return_message::text,
           (SELECT max(d.seeded_at) FROM public.data_production_daily d),
           (SELECT max(d.production_date) FROM public.data_production_daily d)
    FROM cron.job j
    LEFT JOIN LATERAL (
        SELECT d.start_time, d.status, d.return_message
        FROM cron.job_run_details d
        WHERE d.jobid = j.jobid
        ORDER BY d.start_time DESC
        LIMIT 1
    ) r ON true
    WHERE j.jobname LIKE 'reseed-production-daily-%'
    ORDER BY j.jobname;
$$;

COMMENT ON FUNCTION public.get_production_reseed_health() IS
    'Is the Production data page auto-seed still running? One row per scheduled job with its last '
    'run outcome from cron.job_run_details, plus how current the mirror actually is. Read-only.';

REVOKE ALL ON FUNCTION public.get_production_reseed_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_production_reseed_health() TO authenticated, service_role;

-- ============================================================================
-- 6. One-off catch-up for the gap this migration was written to close.
--
-- Scoped to 2026-08-07 .. today: the day after the last backfilled row, through now. Deliberately
-- NOT wider - see "WHAT THIS DELIBERATELY DOES NOT DO" in the header. Guarded by a date test so
-- re-running the migration much later does not silently reseed an ever-growing historical range;
-- by then the scheduled jobs own this.
-- ============================================================================

DO $$
DECLARE
    v_today date := public.report_sast_today();
    v_from  date := DATE '2026-08-07';
    v_row   record;
BEGIN
    IF v_today < v_from THEN
        RAISE NOTICE 'Catch-up skipped: today (%) is before the gap start (%).', v_today, v_from;
        RETURN;
    END IF;
    IF (v_today - v_from) > 400 THEN
        RAISE NOTICE 'Catch-up skipped: the gap (% .. %) now exceeds the 400-day reseed cap; the '
                     'scheduled jobs cover current data.', v_from, v_today;
        RETURN;
    END IF;

    SELECT * INTO v_row
    FROM public.reseed_data_production_daily(v_from, v_today, NULL);

    IF v_row.success IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'Catch-up reseed(%, %) failed: %', v_from, v_today, v_row.error;
    END IF;
    RAISE NOTICE 'Catch-up reseed % .. % wrote % row(s).', v_from, v_today, v_row.rows_reseeded;
END;
$$;

-- ============================================================================
-- 7. RBAC for the new read function, following this repo's role_permissions pattern.
--
-- Read-only health, so every role gets it - matching how 20260819090000:555-566 grants the get_/
-- live_ readers to all roles and reserves the writers for the four editing roles. Nothing here
-- grants a new write.
-- ============================================================================

DO $$
DECLARE
    v_role record;
BEGIN
    FOR v_role IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role.id, 'function', 'get_production_reseed_health', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

-- ============================================================================
-- 8. Verification - fail the migration rather than report a false success.
-- ============================================================================

DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
    v_jobs    integer;
    v_rows    integer;
BEGIN
    IF to_regprocedure('public.cron_reseed_production_daily(integer)') IS NULL THEN
        v_missing := v_missing || 'cron_reseed_production_daily(integer)';
    END IF;
    IF to_regprocedure('public.get_production_reseed_health()') IS NULL THEN
        v_missing := v_missing || 'get_production_reseed_health()';
    END IF;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Migration incomplete - missing function(s): %', array_to_string(v_missing, ', ');
    END IF;

    SELECT count(*) INTO v_jobs
    FROM cron.job
    WHERE jobname IN ('reseed-production-daily-hourly', 'reseed-production-daily-nightly')
      AND active;
    IF v_jobs <> 2 THEN
        RAISE EXCEPTION 'Migration incomplete - expected 2 active reseed cron jobs, found %', v_jobs;
    END IF;

    -- The gap this migration exists to close must actually be closed: the current week has to have
    -- rows now. Asserted rather than assumed, because the catch-up above is the only thing that
    -- fills it before the first scheduled run.
    SELECT count(*) INTO v_rows
    FROM public.data_production_daily
    WHERE production_date > DATE '2026-08-06'
      AND production_date <= public.report_sast_today();
    IF v_rows = 0 THEN
        RAISE EXCEPTION 'Migration incomplete - no production rows after 2026-08-06; the catch-up '
                        'reseed wrote nothing.';
    END IF;

    RAISE NOTICE 'Verified: 2 active cron jobs, both functions present, % row(s) past the gap.', v_rows;
END;
$$;

NOTIFY pgrst, 'reload schema';
