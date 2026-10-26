-- close_silo: lock the silo row first (review fix, 6 Oct 2026).
--
-- allocate_bags_to_silo locks public.silos FOR UPDATE, but close_silo summed the silo's contents and
-- marked them cracked in two separate statements without that lock. A bag allocated in between was
-- marked cracked but left out of the run's volume_kg. Taking the same row lock serialises the two.

CREATE OR REPLACE FUNCTION public.close_silo(p_silo_number integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run     public.silo_runs%ROWTYPE;
    v_kg      numeric;
    v_batches text;
BEGIN
    PERFORM 1 FROM public.silos WHERE silo_number = p_silo_number FOR UPDATE;

    SELECT * INTO v_run FROM public.silo_runs WHERE silo_number = p_silo_number AND closed_at IS NULL FOR UPDATE;
    IF v_run.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is not open.');
    END IF;

    SELECT COALESCE(sum(a.weight_kg), 0), string_agg(DISTINCT b.batch_id, ', ')
    INTO v_kg, v_batches
    FROM public.silo_allocations a
    JOIN public.kernel k ON k.id = a.kernel_id
    JOIN public.batches b ON b.id = k.batch_id
    WHERE a.silo_number = p_silo_number AND a.status = 'in_silo';

    UPDATE public.silo_allocations SET status = 'cracked', run_id = v_run.id, updated_at = now()
    WHERE silo_number = p_silo_number AND status = 'in_silo';

    UPDATE public.silo_runs SET closed_at = now(), volume_kg = v_kg, batch_numbers = v_batches
    WHERE id = v_run.id;

    RETURN jsonb_build_object('success', true, 'run_id', v_run.id, 'volume_kg', v_kg,
        'minutes', round(extract(epoch FROM (now() - v_run.opened_at)) / 60.0, 1),
        'kg_per_hour', CASE WHEN now() > v_run.opened_at
                            THEN round(v_kg / (extract(epoch FROM (now() - v_run.opened_at)) / 3600.0), 2) END);
END;
$$;

NOTIFY pgrst, 'reload schema';
