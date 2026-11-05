-- ============================================================================
-- Grower Intake: a delivery whose checks are all fine goes straight to Ready to crack.
--
-- WHY. Henry (3 Nov 2026): "when a batch has finished the samples in grower intake, then it
-- should go straight to ready to crack". Until now someone had to press Release after both
-- samples were saved, and a forgotten press left the truck's bags off the Silos screen
-- (get_silo_allocation_batches only lists status 'production').
--
-- Only a delivery with nothing wrong goes through on its own, the same rule as the oil FFA
-- hold (20261102090000): no limit set = no hold.
--   held when   a ziplock result (moisture, PV, FFA) is above its green limit on Kernel Pipeline
--               Settings (sample_spec_thresholds, direction min turns it round), or the receiving
--               checklist says the vehicle was not clean or pests were found (the same two
--               answers raise_intake_problem_alert raises a dashboard alert for).
--   released    status 'production', intake_data.auto_released_at = now(); exactly what
--               release_kernel_to_production does, without a pre-sizer figure (the pre-sizer is
--               recorded when bags go into a silo).
--   held        status stays 'intake'; intake_data.release_hold = {reasons[], at}. The batch
--               waits in Grower Intake's "Needs a decision" column and is released by hand with the
--               existing Release button.
-- It runs when the checklist or either sample is saved, so correcting a mistyped result
-- re-checks the batch. Batches already released are never touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._kernel_release_hold_reasons(p_intake jsonb)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_z       jsonb := COALESCE(p_intake -> 'ziplock_sample', '{}'::jsonb);
    v_chk     jsonb := p_intake -> 'receiving_checklist';
    v_reasons text[] := ARRAY[]::text[];
    r         record;
    v_val     numeric;
BEGIN
    FOR r IN
        SELECT t.test_key, t.label, COALESCE(t.direction, 'max') AS direction, t.green_limit,
               CASE t.test_key WHEN 'moisture' THEN 'moisture_result'
                               WHEN 'pv'       THEN 'peroxide_result'
                               ELSE 'ffa_result' END AS result_key
        FROM public.sample_spec_thresholds t
        WHERE t.green_limit IS NOT NULL
    LOOP
        v_val := CASE WHEN jsonb_typeof(v_z -> r.result_key) = 'number'
                      THEN (v_z ->> r.result_key)::numeric END;
        IF v_val IS NULL THEN CONTINUE; END IF;
        IF (r.direction = 'max' AND v_val > r.green_limit) OR (r.direction = 'min' AND v_val < r.green_limit) THEN
            v_reasons := v_reasons || (COALESCE(NULLIF(r.label, ''), r.test_key) || ' ' || v_val::text
                         || CASE r.direction WHEN 'max' THEN ' is above ' ELSE ' is below ' END
                         || 'the limit of ' || r.green_limit::text);
        END IF;
    END LOOP;

    IF COALESCE(v_chk ->> 'vehicle_clean', '') ILIKE 'no' THEN
        v_reasons := v_reasons || 'Checklist: vehicle not clean'::text;
    END IF;
    IF COALESCE(v_chk ->> 'pest_infestations', '') ILIKE 'yes' THEN
        v_reasons := v_reasons || 'Checklist: pests found'::text;
    END IF;

    RETURN v_reasons;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_kernel_auto_release()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_chk     jsonb := NEW.intake_data -> 'receiving_checklist';
    v_reasons text[];
BEGIN
    IF NOT COALESCE(NEW.is_active, false) THEN RETURN NEW; END IF;
    IF v_chk IS NULL OR v_chk IN ('{}'::jsonb, 'null'::jsonb) THEN RETURN NEW; END IF;
    IF (NEW.intake_data #>> '{ziplock_sample,completed_at}') IS NULL
       OR (NEW.intake_data #>> '{five_kg_sample,completed_at}') IS NULL THEN
        RETURN NEW;
    END IF;

    v_reasons := public._kernel_release_hold_reasons(NEW.intake_data);

    IF array_length(v_reasons, 1) IS NULL THEN
        NEW.status      := 'production';
        NEW.intake_data := (NEW.intake_data - 'release_hold')
                           || jsonb_build_object('auto_released_at', now());
    ELSE
        NEW.intake_data := NEW.intake_data
                           || jsonb_build_object('release_hold', jsonb_build_object('reasons', to_jsonb(v_reasons), 'at', now()));
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never block a sample or checklist save: the batch simply waits for a manual Release.
    RAISE WARNING 'kernel auto-release failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_auto_release
    BEFORE UPDATE OF intake_data ON public.kernel
    FOR EACH ROW
    WHEN (NEW.status IN ('intake', 'receiving')
          AND ((NEW.intake_data -> 'ziplock_sample')      IS DISTINCT FROM (OLD.intake_data -> 'ziplock_sample')
            OR (NEW.intake_data -> 'five_kg_sample')      IS DISTINCT FROM (OLD.intake_data -> 'five_kg_sample')
            OR (NEW.intake_data -> 'receiving_checklist') IS DISTINCT FROM (OLD.intake_data -> 'receiving_checklist')))
    EXECUTE FUNCTION public.trg_kernel_auto_release();

REVOKE ALL ON FUNCTION public._kernel_release_hold_reasons(jsonb) FROM PUBLIC, anon, authenticated;

-- Self-check: an in-spec delivery passes, a high FFA and a pest finding are held.
DO $$
DECLARE
    v_ffa numeric := (SELECT green_limit FROM public.sample_spec_thresholds WHERE test_key = 'ffa');
BEGIN
    IF array_length(public._kernel_release_hold_reasons(
           '{"ziplock_sample":{"ffa_result":0},"receiving_checklist":{"vehicle_clean":"Yes","pest_infestations":"No"}}'::jsonb), 1) IS NOT NULL THEN
        RAISE EXCEPTION 'self-check: a clean delivery was held';
    END IF;
    IF array_length(public._kernel_release_hold_reasons(
           '{"receiving_checklist":{"pest_infestations":"Yes"}}'::jsonb), 1) IS NULL THEN
        RAISE EXCEPTION 'self-check: pests did not hold the delivery';
    END IF;
    IF v_ffa IS NOT NULL AND array_length(public._kernel_release_hold_reasons(
           jsonb_build_object('ziplock_sample', jsonb_build_object('ffa_result', v_ffa + 1))), 1) IS NULL THEN
        RAISE EXCEPTION 'self-check: FFA above the limit did not hold the delivery';
    END IF;
END $$;
