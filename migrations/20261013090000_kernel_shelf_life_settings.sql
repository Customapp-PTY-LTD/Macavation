-- Kernel shelf-life settings (Mike's list, 12 Oct 2026, items 1b/1c + Henry's decisions 13 Oct).
--
--   1. Two new kernel_pipeline_settings keys, both editable on Kernel Pipeline Settings:
--        kernel_best_before_months  integer 1-60, default 24 (was hard-coded in JS and SQL)
--        best_before_bands          {"green":12,"yellow":6} - Kernel Stock "Time Left" colours:
--                                   green above `green` months, yellow down to `yellow`, red below.
--      The bands are ONE key so a change like 12/6 -> 5/3 saves atomically.
--   2. set_kernel_pipeline_setting validates per key instead of rejecting everything except
--      bag_numbering.
--   3. get_kernel_batches' best-before fallback reads kernel_best_before_months instead of a
--      hard-coded 24 months. Same in-place rewrite as 20260822100000 so the ~22k character
--      body is not hand-copied.
--   4. Roles that use Kernel Stock / Kernel Dispatch / Oil Dispatch may read the pipeline config
--      (FFA limits, best-before months, bands, transporters), add a transport company from the
--      dispatch form, and read a customer's contact details for the "Attention" prefill.
--
-- Changing kernel_best_before_months is forward-only: stored best-before dates are kept (the job
-- card only recomputes when the packing start date changes - see modal_kernel_job_card.js).
-- Idempotent; safe to re-run.

-- 1. SETTINGS -------------------------------------------------------------------

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('kernel_best_before_months', '24'::jsonb),
       ('best_before_bands', '{"green":12,"yellow":6}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. SETTER -----------------------------------------------------------------------

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

-- 3. get_kernel_batches FALLBACK READS THE SETTING ---------------------------------

DO $mig$
DECLARE
    v_def  text;
    v_old  text := '((NULLIF(k.job_card_data->>''packing_start_date'', ''''))::date + interval ''24 months'')::date';
    v_new  text := '((NULLIF(k.job_card_data->>''packing_start_date'', ''''))::date + make_interval(months => COALESCE((SELECT (s.value #>> ''{}'')::int FROM public.kernel_pipeline_settings s WHERE s.key = ''kernel_best_before_months''), 24)))::date';
    v_hits int;
BEGIN
    SELECT pg_get_functiondef(p.oid)
      INTO v_def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_kernel_batches'
       AND pg_get_function_identity_arguments(p.oid)
           = 'p_status character varying, p_search character varying, p_limit integer, p_offset integer';

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'get_kernel_batches(varchar,varchar,int,int) not found - refusing to guess';
    END IF;

    IF position('kernel_best_before_months' in v_def) > 0 THEN
        RAISE NOTICE 'get_kernel_batches already reads kernel_best_before_months - nothing to do';
        RETURN;
    END IF;

    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 occurrence of the 24 month fallback in get_kernel_batches, found % (is 20260822100000 applied?)', v_hits;
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
    RAISE NOTICE 'get_kernel_batches fallback now reads kernel_best_before_months';
END
$mig$;

-- 4. FUNCTION PERMISSIONS ------------------------------------------------------------
-- role_permissions has no unique key, so NOT EXISTS rather than ON CONFLICT (as 20261006090300).

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id
     AND f.key IN ('stock-management-kernel', 'kernel-dispatch-grid', 'oil-dispatch-grid')
CROSS JOIN unnest(ARRAY['get_kernel_pipeline_config', 'upsert_transporter', 'get_contact_by_id']) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
