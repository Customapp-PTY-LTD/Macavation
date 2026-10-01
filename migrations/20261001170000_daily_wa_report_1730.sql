-- ============================================================================
-- Move the daily WhatsApp production report from 17:00 to 17:30 SAST.
--
-- WHY. The report reads data_production_daily, which the reseed-production-daily-hourly job
-- (5 * * * *, migrations/20260901120000_auto_seed_production_daily_cron.sql) refreshes at five
-- past each hour. The factory captures the day's cracking sheets at the end of the shift, roughly
-- 16:30-17:05 SAST (on prod, 1 Oct 2026's sheets landed 16:29-16:37 and 30 Sep's last at 17:01).
-- At 17:00 the newest refresh was 16:05, so "kg cracked today" was reported as 0 every day, and
-- the day only showed up in the next day's "this week" total. At 17:30 the 17:05 refresh has run.
--
-- 15:30 UTC + 2h = 17:30 SAST, same calendar day (SAST has no daylight saving).
--
-- cron.schedule() upserts on jobname, so this rewrites the existing job from
-- migrations/20260909090000_whatsapp_report_schedule.sql rather than adding a second one.
-- The command is unchanged.
-- ============================================================================

SELECT cron.schedule(
    'send-daily-whatsapp-report',
    '30 15 * * *',
    $cron$SELECT public.cron_send_daily_report();$cron$
);

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
    FROM cron.job
    WHERE jobname = 'send-daily-whatsapp-report'
      AND schedule = '30 15 * * *'
      AND active;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Migration incomplete - expected 1 active send-daily-whatsapp-report job at 30 15 * * *, found %', v_count;
    END IF;
    RAISE NOTICE 'Verified: send-daily-whatsapp-report now runs at 15:30 UTC (17:30 SAST).';
END;
$$;
