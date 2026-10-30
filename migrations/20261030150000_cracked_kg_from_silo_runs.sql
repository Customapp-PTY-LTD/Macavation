-- Kg cracked comes from the silo Cracking log, and every closed run fills its batch's cracking sheet.
--
-- Why: since 26 Oct 2026 operators log cracking ONLY as silo runs (Silos > Cracking log). The daily
-- figures (WhatsApp 19:00 report, dashboard, data pages) summed the batch cracking sheets
-- (kernel.cracking_data), which the Production screen only SAVES when someone edits a run there, so
-- whole runs went missing: 29 Oct reported 3,140.5 kg against 5,370.5 kg logged (silo 3's 2,230 kg run
-- on Bn 55 26 63 never reached the sheet); 26 Oct reported 0 against 6,255. No double entry: the
-- operators do not retype runs onto the sheet.
--
-- 1. production_day_cracked_kg_live(date) reads closed silo runs from 2026-10-26 (the first closed run
--    on prod), bucketed by the SAST day of closed_at exactly as get_silo_runs_between buckets them.
--    Earlier days keep reading the sheets (there are no runs before then). data_production_daily is
--    re-seeded from this function hourly (cron_reseed_production_daily), so every reader of it — the
--    digest, dashboard, data pages — follows.
-- 2. sync_batch_cracking_from_runs(kernel, date) writes the batch's runs for that day onto its cracking
--    sheet entry (the same fields the Production screen fills in runs mode: applyCrackingRunsToFields /
--    recalcCrackVolume in modal_production_stages.js), merged into whatever is already there so the
--    hand-typed minute tests and shell bags are kept. Entries are matched by date, the same as
--    upsert_kernel_production; the screen builds its day list by date (_rebuildDayListFromCache).
-- 3. A trigger on silo_runs runs that sync whenever a run closes or its times change (covers
--    _close_silo_run, record_silo_run and update_silo_run_times). It never raises: closing a silo must
--    not fail because a sheet could not be updated.
-- 4. Back-fills the sheets for every run closed since 2026-10-26, then re-seeds data_production_daily.

-- 1. Day total from the Cracking log ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.production_day_cracked_kg_live(p_date date)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    -- From 26 Oct 2026 the closed silo runs are the record (SAST day of closed_at, as the Cracking log).
    -- Before that the batch cracking sheet day entries, filtered on the entry's own date.
    SELECT CASE
        WHEN p_date >= DATE '2026-10-26' THEN (
            SELECT COALESCE(SUM(r.volume_kg), 0)
            FROM public.silo_runs r
            WHERE r.closed_at IS NOT NULL
              AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date = p_date)
        ELSE (
            SELECT COALESCE(SUM(public.kernel_day_kg(e)), 0)
            FROM public.kernel k
            CROSS JOIN LATERAL jsonb_array_elements(
                COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e
            WHERE k.is_active
              AND public.kernel_day_date(e) = p_date)
    END;
$$;

COMMENT ON FUNCTION public.production_day_cracked_kg_live(date) IS
    'Nut-in-shell cracked on one day. From 2026-10-26: closed silo runs (volume_kg, SAST day of closed_at), '
    'matching the Cracking log. Before: batch cracking sheet day entries via kernel_day_kg.';

-- 2. Copy one batch's runs for one day onto its cracking sheet -----------------------------------------
CREATE OR REPLACE FUNCTION public.sync_batch_cracking_from_runs(p_kernel_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_cracking  jsonb;
    v_idx       integer;
    v_entry     jsonb;
    v_i         integer;
    v_runs      integer;
    v_kg        numeric;
    v_start     numeric;
    v_left      numeric;
    v_minutes   numeric;
    v_first     timestamptz;
    v_last      timestamptz;
    v_silos     integer[];
    v_time      text;
    v_fields    jsonb;
BEGIN
    IF p_kernel_id IS NULL OR p_date IS NULL THEN RETURN; END IF;

    -- Same runs the sheet shows (get_batch_cracking_runs): closed that SAST day, with kg from this batch.
    SELECT count(*), COALESCE(sum(q.batch_kg), 0), COALESCE(sum(q.start_kg), 0), COALESCE(sum(q.left_kg), 0),
           COALESCE(sum(GREATEST(extract(epoch FROM (q.closed_at - q.opened_at)) / 60.0, 0)), 0),
           min(q.opened_at), max(q.closed_at), array_agg(DISTINCT q.silo_number)
    INTO v_runs, v_kg, v_start, v_left, v_minutes, v_first, v_last, v_silos
    FROM (
        SELECT r.id, r.silo_number, r.opened_at, r.closed_at,
               COALESCE(r.volume_kg, 0) + COALESCE(r.left_kg, 0) AS start_kg,
               COALESCE(r.left_kg, 0) AS left_kg,
               sum(rb.kg) AS batch_kg
        FROM public.silo_runs r
        JOIN public.silo_run_bags rb ON rb.run_id = r.id
        JOIN public.silo_allocations a ON a.id = rb.allocation_id AND a.kernel_id = p_kernel_id
        WHERE r.closed_at IS NOT NULL
          AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date = p_date
        GROUP BY r.id
    ) q;

    SELECT COALESCE(NULLIF(cracking_data, 'null'::jsonb), '[]'::jsonb)
    INTO v_cracking
    FROM public.kernel
    WHERE id = p_kernel_id AND is_active
    FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    FOR v_i IN 0 .. jsonb_array_length(v_cracking) - 1 LOOP
        IF public.kernel_day_date(v_cracking -> v_i) = p_date THEN v_idx := v_i; EXIT; END IF;
    END LOOP;
    v_entry := CASE WHEN v_idx IS NULL THEN NULL ELSE v_cracking -> v_idx END;

    IF v_runs = 0 THEN
        -- A run moved off this day (times edited): clear what an earlier sync wrote, keep the rest.
        IF v_entry IS NULL OR COALESCE(v_entry ->> 'from_silo_runs', '') <> 'true' THEN RETURN; END IF;
        v_entry := (v_entry - 'from_silo_runs' - 'total_output' - 'cracking_percentage') || jsonb_build_object(
            'silo_number', '', 'startqty1', '', 'endqty_left', '', 'endqty1', '', 'start1', '', 'end1', '',
            'timespent1', '', 'totaltime', '', 'volume_cracked', '', 'vol_cracked_per_hour', '',
            'vol_cracked_per_min', '');
        -- Nothing hand-typed left on that day (no minute tests, no shell bags): drop the empty day.
        IF NOT EXISTS (SELECT 1 FROM jsonb_each(v_entry) f
                       WHERE f.key <> 'date' AND f.value NOT IN ('""'::jsonb, 'null'::jsonb)) THEN
            v_cracking := v_cracking - v_idx;
        ELSE
            v_cracking := jsonb_set(v_cracking, ARRAY[v_idx::text], v_entry);
        END IF;
        UPDATE public.kernel
        SET cracking_data = v_cracking, updated_at = now()
        WHERE id = p_kernel_id;
        RETURN;
    END IF;

    v_minutes := round(v_minutes);
    v_time := CASE
        WHEN v_minutes <= 0 THEN ''
        WHEN v_minutes < 60 THEN (v_minutes::int % 60) || 'm'
        WHEN v_minutes::int % 60 = 0 THEN (v_minutes::int / 60) || 'h'
        ELSE (v_minutes::int / 60) || 'h ' || (v_minutes::int % 60) || 'm'
    END;

    -- Same fields and formats as the Production screen in runs mode (2 dp strings, HH:MM SAST).
    v_fields := jsonb_build_object(
        'date',                 COALESCE(v_entry ->> 'date', to_char(p_date, 'YYYY-MM-DD')),
        'silo_number',          CASE WHEN array_length(v_silos, 1) = 1 THEN v_silos[1]::text ELSE '' END,
        'startqty1',            round(v_start, 2)::text,
        'endqty_left',          round(v_left, 2)::text,
        'endqty1',              '',
        'start1',               to_char(v_first AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI'),
        'end1',                 to_char(v_last AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI'),
        'timespent1',           v_time,
        'totaltime',            v_time,
        'volume_cracked',       round(v_kg, 2)::text,
        'vol_cracked_per_hour', CASE WHEN v_minutes > 0 THEN round(v_kg / (v_minutes / 60.0), 2)::text ELSE '' END,
        'vol_cracked_per_min',  CASE WHEN v_minutes > 0 THEN round(v_kg / v_minutes, 2)::text ELSE '' END,
        'total_output',         round(v_kg, 2),
        'from_silo_runs',       true
    );

    IF v_idx IS NULL THEN
        v_cracking := v_cracking || jsonb_build_array(v_fields);
    ELSE
        -- cracking_percentage is derived from the kg by the screen on save; drop it when the kg changed.
        IF public.kernel_day_kg(v_entry) <> round(v_kg, 2) THEN
            v_entry := v_entry - 'cracking_percentage';
        END IF;
        v_cracking := jsonb_set(v_cracking, ARRAY[v_idx::text], v_entry || v_fields);
    END IF;

    -- Same status step as saving the sheet (upsert_kernel_production): cracking means it is in production.
    UPDATE public.kernel
    SET cracking_data = v_cracking,
        status = CASE WHEN status IN ('intake', 'receiving') THEN 'production'::varchar ELSE status END,
        updated_at = now()
    WHERE id = p_kernel_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_batch_cracking_from_runs(uuid, date) FROM PUBLIC, anon, authenticated;

-- 3. Run closed or re-timed -> sync every batch it cracked, on the new day (and the old day if it moved).
CREATE OR REPLACE FUNCTION public.trg_silo_run_sync_cracking_sheets()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_new  date := (NEW.closed_at AT TIME ZONE 'Africa/Johannesburg')::date;
    v_old  date := CASE WHEN OLD.closed_at IS NULL THEN NULL
                        ELSE (OLD.closed_at AT TIME ZONE 'Africa/Johannesburg')::date END;
    k      record;
BEGIN
    FOR k IN
        SELECT DISTINCT a.kernel_id
        FROM public.silo_run_bags rb
        JOIN public.silo_allocations a ON a.id = rb.allocation_id
        WHERE rb.run_id = NEW.id AND a.kernel_id IS NOT NULL
    LOOP
        BEGIN
            PERFORM public.sync_batch_cracking_from_runs(k.kernel_id, v_new);
            IF v_old IS NOT NULL AND v_old <> v_new THEN
                PERFORM public.sync_batch_cracking_from_runs(k.kernel_id, v_old);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'sync_batch_cracking_from_runs(%, %) failed: %', k.kernel_id, v_new, SQLERRM;
        END;
    END LOOP;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_silo_run_sync_cracking_sheets() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER silo_run_sync_cracking_sheets
    AFTER UPDATE OF closed_at, opened_at ON public.silo_runs
    FOR EACH ROW
    WHEN (NEW.closed_at IS NOT NULL
          AND (OLD.closed_at IS DISTINCT FROM NEW.closed_at OR OLD.opened_at IS DISTINCT FROM NEW.opened_at))
    EXECUTE FUNCTION public.trg_silo_run_sync_cracking_sheets();

-- 4. Back-fill every batch/day with a closed run since the cut-over, then refresh the data pages.
DO $$
DECLARE
    p record;
BEGIN
    FOR p IN
        SELECT DISTINCT a.kernel_id, (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date AS d
        FROM public.silo_runs r
        JOIN public.silo_run_bags rb ON rb.run_id = r.id
        JOIN public.silo_allocations a ON a.id = rb.allocation_id
        WHERE r.closed_at IS NOT NULL
          AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date >= DATE '2026-10-26'
    LOOP
        PERFORM public.sync_batch_cracking_from_runs(p.kernel_id, p.d);
    END LOOP;
END;
$$;

SELECT public.cron_reseed_production_daily(14);
