-- Undo a finished silo run from the Cracking log (Production team, 6 Nov 2026).
--
-- _close_silo_run cracks bags first-in-first-out and records exactly what it took from each bag in
-- silo_run_bags (run_id, allocation_id, kg). Undoing gives each bag back that kg, puts it back
-- 'in_silo', deletes the run (silo_run_bags cascades) and re-syncs the batch cracking sheets for the
-- day the run closed - the silo_run_sync_cracking_sheets trigger only fires on UPDATE, so a delete
-- would otherwise leave the run's kg on the sheet.
--
-- Only the LATEST closed run of a silo, and only while that silo is not open: a later run cracked
-- bags from what this run left behind, so undoing an earlier one would break the bag balances.
-- data_production_daily (digest / dashboard) catches up on its hourly re-seed.

CREATE OR REPLACE FUNCTION public.undo_silo_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run   public.silo_runs%ROWTYPE;
    v_day   date;
    v_kids  uuid[];
    v_kid   uuid;
    b       record;
BEGIN
    SELECT * INTO v_run FROM public.silo_runs WHERE id = p_run_id;
    IF v_run.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This run no longer exists.');
    END IF;

    PERFORM 1 FROM public.silos WHERE silo_number = v_run.silo_number FOR UPDATE;
    SELECT * INTO v_run FROM public.silo_runs WHERE id = p_run_id FOR UPDATE;

    IF v_run.closed_at IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'This silo is still open. Use "Opened by mistake" on the silo card instead.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.silo_runs WHERE silo_number = v_run.silo_number AND closed_at IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Silo %s is open right now. Stop it or cancel the opening first.', v_run.silo_number));
    END IF;
    IF EXISTS (SELECT 1 FROM public.silo_runs
               WHERE silo_number = v_run.silo_number AND closed_at IS NOT NULL AND id <> v_run.id
                 AND (closed_at, id) > (v_run.closed_at, v_run.id)) THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Only the latest run on silo %s can be undone. Undo the later runs first.', v_run.silo_number));
    END IF;

    v_day := (v_run.closed_at AT TIME ZONE 'Africa/Johannesburg')::date;
    SELECT array_agg(DISTINCT a.kernel_id) INTO v_kids
    FROM public.silo_run_bags rb
    JOIN public.silo_allocations a ON a.id = rb.allocation_id
    WHERE rb.run_id = v_run.id AND a.kernel_id IS NOT NULL;

    -- Give every bag back what this run took from it.
    FOR b IN
        SELECT rb.allocation_id, sum(rb.kg) AS kg
        FROM public.silo_run_bags rb WHERE rb.run_id = v_run.id
        GROUP BY rb.allocation_id
    LOOP
        UPDATE public.silo_allocations
        SET remaining_kg = remaining_kg + b.kg, status = 'in_silo', updated_at = now()
        WHERE id = b.allocation_id;
    END LOOP;
    -- "Silo is empty" also swept zero-kg leftovers to 'cracked' with no silo_run_bags row.
    UPDATE public.silo_allocations SET status = 'in_silo', updated_at = now()
    WHERE run_id = v_run.id AND status = 'cracked';
    -- run_id = the last run that took kg from the bag, now that this one is gone.
    UPDATE public.silo_allocations a
    SET run_id = (SELECT rb.run_id FROM public.silo_run_bags rb JOIN public.silo_runs r ON r.id = rb.run_id
                  WHERE rb.allocation_id = a.id AND rb.run_id <> v_run.id
                  ORDER BY r.closed_at DESC LIMIT 1)
    WHERE a.run_id = v_run.id;

    DELETE FROM public.silo_runs WHERE id = v_run.id;

    FOREACH v_kid IN ARRAY COALESCE(v_kids, ARRAY[]::uuid[]) LOOP
        BEGIN
            PERFORM public.sync_batch_cracking_from_runs(v_kid, v_day);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'sync_batch_cracking_from_runs(%, %) failed: %', v_kid, v_day, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'silo_number', v_run.silo_number,
                              'volume_kg', v_run.volume_kg, 'batch_numbers', v_run.batch_numbers);
END;
$$;

-- Same people who can edit a run's times can undo it.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id, 'function', 'undo_silo_run', 'EXECUTE', true
FROM (SELECT DISTINCT role_id FROM public.role_permissions WHERE object_name = 'update_silo_run_times' AND allowed) rp
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = rp.role_id AND x.object_name = 'undo_silo_run' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
