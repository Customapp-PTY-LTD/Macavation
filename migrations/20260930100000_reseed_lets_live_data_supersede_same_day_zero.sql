-- Fix: a same-day auto-seeded row's effective figure never updates as the day's real production
-- comes in, so the WhatsApp/Flow report can show 0 kg cracked for a day that in fact had real
-- production.
--
-- reseed_data_production_daily() (migrations/20260901120000_auto_seed_production_daily_cron.sql:
-- 116-188) runs hourly (cron_reseed_production_daily(7), ":05 past every hour") over a 7-day
-- window that includes today. The FIRST run each day (00:05 SAST) correctly inserts a new row with
-- cracked_kg = 0, because at that instant nothing has been produced yet. Every subsequent run that
-- same day (01:05, 02:05, ... 23:05 SAST) hits ON CONFLICT DO UPDATE, which was written to update
-- ONLY the cracked_kg_system/sk_packed_kg_system mirror columns and never the effective cracked_kg/
-- sk_packed_kg -- so the real figures accumulating through the day land in the mirror but the
-- report-facing effective figure stays frozen at that first hour's 0, forever. Confirmed live on
-- prod 2026-09-30: 2026-09-28's cracked_kg_system = 4894.00 (real) vs cracked_kg = 0.00 (stuck);
-- 2026-09-29's cracked_kg_system = 5066.00 vs cracked_kg = 0.00.
--
-- That freeze-on-conflict behaviour is deliberate and correct for the case it was built for -- "a
-- correction Pete typed durable... cannot overwrite anyone's work" -- but it cannot tell "a human
-- genuinely reviewed this day and set an effective figure" apart from "the very first automated
-- run of the day happened to seed a placeholder 0 before production started." Both look identical
-- (an existing row) to a plain ON CONFLICT DO UPDATE.
--
-- The table already carries the distinguishing signal: data_source. The ONLY path that sets it to
-- 'manual' is upsert_data_production_daily_rows() (migrations/20260819090000_
-- data_page_production_daily.sql:356-416), the Sales Exec's save action -- its own comment there
-- says outright "a backfilled or seeded row that a human then edits becomes 'manual'". So a row
-- that is still 'system_seeded' has, by construction, never been touched by a human: the reseed is
-- free to keep following the live figure on it, exactly as it does for a brand-new row. A row that
-- is 'manual' (or the older 'backfill') keeps the existing freeze -- unchanged from today's
-- behaviour, and that is the case the original design was protecting.
--
-- Fix: the ON CONFLICT SET list now updates the effective cracked_kg/sk_packed_kg (clamped at 0,
-- same as a new row) WHEN the existing row's data_source is still 'system_seeded'; otherwise it
-- keeps today's already-correct freeze. Same for the negative_system_* quality-flag merge, which
-- only means anything on the not-yet-human-touched path -- a 'manual' row's flags are left alone
-- exactly as before.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260930100000_reseed_lets_live_data_supersede_same_day_zero.sql
-- against dev (nmdmddugxclpqrwylyfa) and, after sign-off, npm run db:apply-prod for the same file
-- against prod (sofanhfpxifgdtooefzq). Demo shares the dev database, so applying to dev covers it.
-- A one-off catch-up re-seed of the last 7 days is included below so already-stuck rows on prod
-- (2026-09-25 .. today, per the header above) are fixed the moment this lands, rather than only
-- healing for future days.

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
        SET cracked_kg_system   = EXCLUDED.cracked_kg_system,
            sk_packed_kg_system = EXCLUDED.sk_packed_kg_system,
            seeded_at           = now(),
            -- The effective figures follow the live mirror as long as the row is still
            -- 'system_seeded' -- i.e. no human has ever touched it via
            -- upsert_data_production_daily_rows(), which is the only path that sets 'manual'.
            -- Once a row is 'manual' (or the older 'backfill'), this is unchanged from before:
            -- the effective figure keeps whatever a human put there, forever.
            cracked_kg          = CASE WHEN t.data_source = 'system_seeded'
                                        THEN EXCLUDED.cracked_kg ELSE t.cracked_kg END,
            sk_packed_kg        = CASE WHEN t.data_source = 'system_seeded'
                                        THEN EXCLUDED.sk_packed_kg ELSE t.sk_packed_kg END,
            -- Keep every flag this job does not own; re-derive only the negative_system_* pair, so
            -- a day that stops being negative loses the flag and a backfill flag is never lost.
            -- Only meaningful on the still-'system_seeded' path above; a 'manual' row's flags are
            -- left exactly as a human last set them, same as today.
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
    'Refreshes the factory-side mirror for a date range, creating missing days. The effective figure '
    'follows the live mirror for as long as a row stays data_source=''system_seeded'' -- i.e. no human '
    'has ever saved a value on it via upsert_data_production_daily_rows() -- so a same-day placeholder '
    '0 seeded before production started is superseded as real figures come in through the day. Once a '
    'row becomes ''manual'' (or is ''backfill''), the effective figure is frozen exactly as before: '
    'never overwritten, which is what makes a correction durable against later batch edits. Fixed '
    '2026-09-30 -- previously the effective column was frozen from the row''s very first insert, so a '
    'same-day auto-seeded 0 could never update even though nothing about it was ever a human decision; '
    'see migrations/20260930100000_reseed_lets_live_data_supersede_same_day_zero.sql. The *_system '
    'mirror still takes the raw factory figure including a negative adjustment; the effective figure '
    'is clamped at 0 and the day tagged negative_system_* so the clamp is visible for review rather '
    'than silent.';

-- ============================================================================
-- One-off catch-up: re-run today's fixed logic over the last 7 days, so rows already stuck at a
-- stale same-day 0 (2026-09-25 through today, on both dev and prod) heal immediately rather than
-- only for days from here on. Same window the hourly cron already uses, so this changes nothing
-- outside what that job would have covered anyway.
-- ============================================================================

DO $$
DECLARE
    v_today date := public.report_sast_today();
    v_row   record;
BEGIN
    SELECT * INTO v_row
    FROM public.reseed_data_production_daily(v_today - 7, v_today, NULL);

    IF v_row.success IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'Catch-up reseed(%, %) failed: %', v_today - 7, v_today, v_row.error;
    END IF;
    RAISE NOTICE 'Catch-up reseed % .. % refreshed % row(s).', v_today - 7, v_today, v_row.rows_reseeded;
END;
$$;

-- ============================================================================
-- Verification — fail the migration rather than report a false success.
-- ============================================================================

DO $$
BEGIN
    IF to_regprocedure('public.reseed_data_production_daily(date, date, uuid)') IS NULL THEN
        RAISE EXCEPTION 'Migration incomplete - missing function reseed_data_production_daily(date, date, uuid)';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
