-- ============================================================================
-- Move the daily WhatsApp production report from 17:30 to 19:00 SAST.
--
-- WHY. Henry asked for the daily report at 7pm (26 Oct 2026). Later also means the end-of-shift
-- cracking sheets (captured roughly 16:30-17:05 SAST) are well inside the 18:05 refresh of
-- data_production_daily, so the 17:30 reason in 20261001170000_daily_wa_report_1730.sql still holds.
--
-- 17:00 UTC + 2h = 19:00 SAST, same calendar day (SAST has no daylight saving).
--
-- cron.schedule() upserts on jobname, so this rewrites the existing job rather than adding a
-- second one. The command is unchanged.
-- ============================================================================

SELECT cron.schedule(
    'send-daily-whatsapp-report',
    '0 17 * * *',
    $cron$SELECT public.cron_send_daily_report();$cron$
);

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
    FROM cron.job
    WHERE jobname = 'send-daily-whatsapp-report'
      AND schedule = '0 17 * * *'
      AND active;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Migration incomplete - expected 1 active send-daily-whatsapp-report job at 0 17 * * *, found %', v_count;
    END IF;
    RAISE NOTICE 'Verified: send-daily-whatsapp-report now runs at 17:00 UTC (19:00 SAST).';
END;
$$;
