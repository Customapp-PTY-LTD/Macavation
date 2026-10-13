-- Daily kernel cracking target (Henry, 13 Oct 2026).
--
-- WHY. The 17:30 WhatsApp production report is being reworked as a tap-through Flow that shows
-- "kernel cracked today" against a target. No daily target existed anywhere: report_period_targets
-- holds weekly (loaded only up to 2026-07-27) and monthly cracking targets, and the
-- produced_vs_target block in get_daily_digest() reads a monthly total_production_kg row from
-- dashboard_targets that has never been loaded. Macavation sets this one number themselves on
-- Kernel Pipeline Settings instead of us deriving it from the monthly target.
--
--   1. New kernel_pipeline_settings key daily_cracking_target_kg: whole kg of NIS cracked per
--      working day, 1-100 000, or JSON null for "no target". NOT seeded - an absent key means no
--      target, and nothing may render a target that nobody entered.
--   2. set_kernel_pipeline_setting accepts the new key. The body is
--      migrations/20261013090000_kernel_shelf_life_settings.sql's, unchanged except for the new
--      WHEN branch, so bag_numbering / kernel_best_before_months / best_before_bands keep working.
--
-- get_kernel_pipeline_config() already returns every kernel_pipeline_settings row under
-- 'settings', so no read-side change is needed.
-- Idempotent; safe to re-run.

CREATE OR REPLACE FUNCTION public.set_kernel_pipeline_setting(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_n      numeric;
    v_green  numeric;
    v_yellow numeric;
BEGIN
    CASE p_key
    WHEN 'bag_numbering' THEN
        IF p_value IS NULL OR p_value NOT IN ('"stable"'::jsonb, '"renumber"'::jsonb) THEN
            RETURN jsonb_build_object('success', false, 'error', 'bag_numbering must be "stable" or "renumber"');
        END IF;

    WHEN 'kernel_best_before_months' THEN
        IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Best before months must be a whole number between 1 and 60.');
        END IF;
        v_n := (p_value #>> '{}')::numeric;
        IF v_n <> trunc(v_n) OR v_n < 1 OR v_n > 60 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Best before months must be a whole number between 1 and 60.');
        END IF;

    WHEN 'best_before_bands' THEN
        IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
           OR jsonb_typeof(p_value->'green') IS DISTINCT FROM 'number'
           OR jsonb_typeof(p_value->'yellow') IS DISTINCT FROM 'number' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Enter whole numbers of months for green and yellow.');
        END IF;
        v_green  := (p_value->>'green')::numeric;
        v_yellow := (p_value->>'yellow')::numeric;
        IF v_green <> trunc(v_green) OR v_yellow <> trunc(v_yellow)
           OR v_yellow < 1 OR v_green <= v_yellow OR v_green > 120 THEN
            RETURN jsonb_build_object('success', false, 'error',
                'Green must be more months than yellow, and yellow at least 1 (whole months, up to 120).');
        END IF;
        p_value := jsonb_build_object('green', v_green::int, 'yellow', v_yellow::int);

    WHEN 'daily_cracking_target_kg' THEN
        -- SQL NULL or JSON null clears the target (stored as JSON null; the column is NOT NULL).
        IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
            p_value := 'null'::jsonb;
        ELSE
            IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
                RETURN jsonb_build_object('success', false, 'error', 'Daily cracking target must be a whole number of kg from 1 to 100 000, or blank for no target.');
            END IF;
            v_n := (p_value #>> '{}')::numeric;
            IF v_n <> trunc(v_n) OR v_n < 1 OR v_n > 100000 THEN
                RETURN jsonb_build_object('success', false, 'error', 'Daily cracking target must be a whole number of kg from 1 to 100 000, or blank for no target.');
            END IF;
            p_value := to_jsonb(v_n::int);
        END IF;

    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Unknown setting: ' || COALESCE(p_key, 'null'));
    END CASE;

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at)
    VALUES (p_key, p_value, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_kernel_pipeline_setting(text, jsonb) TO anon, authenticated, service_role;

-- Verify: the new key is accepted and the existing keys still are. Runs inside a sub-block whose
-- writes are rolled back, so no setting is changed by this migration.
DO $$
DECLARE
    v_res jsonb;
BEGIN
    BEGIN
        v_res := public.set_kernel_pipeline_setting('daily_cracking_target_kg', '5000'::jsonb);
        IF (v_res->>'success')::boolean IS NOT TRUE THEN
            RAISE EXCEPTION 'daily_cracking_target_kg rejected a valid value: %', v_res;
        END IF;
        v_res := public.set_kernel_pipeline_setting('daily_cracking_target_kg', '12.5'::jsonb);
        IF (v_res->>'success')::boolean IS NOT FALSE THEN
            RAISE EXCEPTION 'daily_cracking_target_kg accepted a fractional value: %', v_res;
        END IF;
        v_res := public.set_kernel_pipeline_setting('kernel_best_before_months', '24'::jsonb);
        IF (v_res->>'success')::boolean IS NOT TRUE THEN
            RAISE EXCEPTION 'kernel_best_before_months no longer accepted: %', v_res;
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'verify-rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'verify-rollback' THEN RAISE; END IF;
    END;
    RAISE NOTICE 'Verified: daily_cracking_target_kg accepted, existing keys unchanged.';
END;
$$;
