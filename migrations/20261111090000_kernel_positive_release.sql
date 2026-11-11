-- Kernel positive release (Mike + Pete, 11 Nov 2026; mockup https://claude.ai/artifact/QtLtqzDdrSg1RfG8FRk6oN).
--
-- Packed kernel goes to the lab (End sample) before it may be released to stock. This migration:
--   1. Setting lab_expected_days {"days":10,"count":"working"|"calendar"} on Kernel Pipeline Settings,
--      validated by set_kernel_pipeline_setting (rebuilt from the live dev definition + one branch).
--   2. kernel.lab_history jsonb: one entry per finished lab test (retest / reprocess), so a
--      reprocessed batch keeps its batch number and its earlier results.
--   3. Lab state is DERIVED from kernel.qa_data (no new kernel status, the status CHECK is untouched):
--        qa_data.internal_micro_status / external_lab_status  'waiting' | 'passed' | 'failed'
--        qa_data.lab_sent_on   'YYYY-MM-DD'   qa_data.lab_attempt  1 | 2 (2 = retest)
--        qa_data.lab_decision  'rejected' (+ lab_rejected_reason/_at/_by)
--      kernel_lab_state(): none | passed | at_lab | failed (1st fail, retest offered) |
--      needs_decision (failed the retest) | rejected. A test only counts when its *_required tick
--      is on. Old End samples have no *_status keys, so they read as 'passed' (unchanged behaviour).
--   4. complete_kernel_batch refuses a release unless the lab state is passed/none. It is the only
--      function that sets kernel.status = 'complete' (checked on dev 11 Nov 2026).
--   5. upsert_kernel_qa keeps lab_attempt / lab_decision keys the End sample form does not send.
--   6. get_kernel_positive_release(): batches past the End sample and not yet released, with lab
--      state, days at the lab, due date, late flag and cartons per style (job card if approved,
--      else the packing sheet). Feeds Production, Stock on Hand and Send to Dispatch.
--   7. record_kernel_lab_decision(): retest (after a 1st fail), reprocess (after a 2nd fail: back
--      into production, same batch number, new End sample) or reject (after a 2nd fail, reason).
--
-- Days are counted in Africa/Johannesburg dates. Working days = Monday to Friday; public holidays
-- are deliberately not taken out (Mike: they move around). Idempotent; safe to re-run.

-- 1. SETTING ----------------------------------------------------------------------------

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('lab_expected_days', '{"days":10,"count":"working"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_kernel_pipeline_setting(p_key text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    WHEN 'bag_weighing' THEN
        IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
           OR COALESCE(p_value->>'where', '') NOT IN ('intake', 'silo')
           OR COALESCE(p_value->>'silo_unweighed', '') NOT IN ('allow', 'block') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Choose where bags are weighed, and what happens to an unweighed bag at the silo.');
        END IF;
        p_value := jsonb_build_object('where', p_value->>'where', 'silo_unweighed', p_value->>'silo_unweighed');

    WHEN 'lab_expected_days' THEN
        IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
           OR jsonb_typeof(p_value->'days') IS DISTINCT FROM 'number'
           OR COALESCE(p_value->>'count', '') NOT IN ('working', 'calendar') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Enter the expected days at the lab (a whole number from 1 to 60) and choose working or calendar days.');
        END IF;
        v_n := (p_value->>'days')::numeric;
        IF v_n <> trunc(v_n) OR v_n < 1 OR v_n > 60 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Expected days at the lab must be a whole number from 1 to 60.');
        END IF;
        p_value := jsonb_build_object('days', v_n::int, 'count', p_value->>'count');

    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Unknown setting: ' || COALESCE(p_key, 'null'));
    END CASE;

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at)
    VALUES (p_key, p_value, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 2. HISTORY COLUMN ---------------------------------------------------------------------

ALTER TABLE public.kernel ADD COLUMN IF NOT EXISTS lab_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. DERIVED LAB STATE ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.kernel_lab_state(p_qa jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
    WITH q AS (
        SELECT CASE WHEN jsonb_typeof(p_qa) = 'object' THEN p_qa ELSE '{}'::jsonb END AS qa
    ), t AS (
        SELECT qa,
               CASE WHEN (qa->>'internal_micro_required')::text = 'true' THEN lower(COALESCE(qa->>'internal_micro_status', '')) END AS im,
               CASE WHEN (qa->>'external_lab_required')::text = 'true' THEN lower(COALESCE(qa->>'external_lab_status', '')) END AS ex,
               CASE WHEN COALESCE(qa->>'lab_attempt', '') ~ '^[0-9]+$' THEN (qa->>'lab_attempt')::int ELSE 1 END AS attempt
        FROM q
    )
    SELECT CASE
        WHEN qa = '{}'::jsonb THEN 'none'
        WHEN qa->>'lab_decision' = 'rejected' THEN 'rejected'
        WHEN im = 'failed' OR ex = 'failed' THEN CASE WHEN attempt >= 2 THEN 'needs_decision' ELSE 'failed' END
        WHEN im = 'waiting' OR ex = 'waiting' THEN 'at_lab'
        ELSE 'passed'
    END
    FROM t;
$function$;

-- Days since p_from (exclusive) up to today in SAST. Working = Monday to Friday.
CREATE OR REPLACE FUNCTION public.kernel_lab_days_elapsed(p_from date, p_count text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE
        WHEN p_from IS NULL THEN NULL
        WHEN p_count = 'calendar' THEN GREATEST(0, ((now() AT TIME ZONE 'Africa/Johannesburg')::date - p_from))
        ELSE (SELECT count(*)::int FROM generate_series(p_from + 1, (now() AT TIME ZONE 'Africa/Johannesburg')::date, interval '1 day') d
              WHERE extract(isodow FROM d) < 6)
    END;
$function$;

-- The date p_days (working or calendar) days after p_from.
CREATE OR REPLACE FUNCTION public.kernel_lab_due_on(p_from date, p_days integer, p_count text)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE
        WHEN p_from IS NULL OR p_days IS NULL OR p_days < 1 THEN NULL
        WHEN p_count = 'calendar' THEN p_from + p_days
        ELSE (SELECT d::date FROM generate_series(p_from + 1, p_from + p_days * 2 + 7, interval '1 day') d
              WHERE extract(isodow FROM d) < 6 ORDER BY d OFFSET p_days - 1 LIMIT 1)
    END;
$function$;

-- 4. RELEASE LOCK -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_kernel_batch(p_kernel_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_status varchar;
    v_jc jsonb;
    v_approved boolean;
    v_lab text;
BEGIN
    SELECT status, job_card_data, COALESCE(jobcard_approved, false), public.kernel_lab_state(qa_data)
    INTO v_status, v_jc, v_approved, v_lab
    FROM public.kernel
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    IF v_status = 'complete' THEN
        RETURN jsonb_build_object('success', true, 'already_complete', true);
    END IF;

    IF v_status NOT IN ('qa') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Batch must be in QA status before releasing to stock (current status: ' || v_status || ')'
        );
    END IF;

    IF v_lab = 'at_lab' THEN
        RETURN jsonb_build_object('success', false, 'error',
            'This batch is still at the lab. Enter the lab results as Passed on the End sample before releasing it to stock.');
    ELSIF v_lab IN ('failed', 'needs_decision') THEN
        RETURN jsonb_build_object('success', false, 'error',
            'This batch failed a lab test. Send it for a retest or reprocess it before releasing it to stock.');
    ELSIF v_lab = 'rejected' THEN
        RETURN jsonb_build_object('success', false, 'error',
            'This batch was rejected after its lab tests and cannot be released to stock.');
    END IF;

    IF NOT v_approved THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Job card must be approved before releasing to stock. Open the job card and press Jobcard approved.'
        );
    END IF;

    IF NOT public.kernel_job_card_has_stock_quantities(v_jc) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Job card must include style quantities (cartons or kg) before releasing to stock.'
        );
    END IF;

    UPDATE public.kernel
    SET status = 'complete',
        packing_data = public.sync_kernel_job_card_to_packing_data(v_jc),
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 5. END SAMPLE SAVE KEEPS SERVER-OWNED LAB KEYS ----------------------------------------

CREATE OR REPLACE FUNCTION public.upsert_kernel_qa(p_kernel_id uuid, p_qa_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_old  jsonb;
    v_keep jsonb;
BEGIN
    SELECT COALESCE(qa_data, '{}'::jsonb) INTO v_old
    FROM public.kernel WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    -- lab_attempt / lab_decision are written by record_kernel_lab_decision only.
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_keep
    FROM jsonb_each(CASE WHEN jsonb_typeof(v_old) = 'object' THEN v_old ELSE '{}'::jsonb END)
    WHERE key IN ('lab_attempt', 'lab_decision', 'lab_rejected_reason', 'lab_rejected_at', 'lab_rejected_by');

    UPDATE public.kernel
    SET qa_data    = CASE WHEN jsonb_typeof(p_qa_data) = 'object'
                          THEN (p_qa_data - 'lab_attempt' - 'lab_decision' - 'lab_rejected_reason' - 'lab_rejected_at' - 'lab_rejected_by') || v_keep
                          ELSE p_qa_data END,
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- 6. READ: BATCHES IN POSITIVE RELEASE --------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_kernel_positive_release()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cfg   jsonb;
    v_days  int;
    v_count text;
    v_rows  jsonb;
BEGIN
    SELECT value INTO v_cfg FROM public.kernel_pipeline_settings WHERE key = 'lab_expected_days';
    v_days  := CASE WHEN COALESCE(v_cfg->>'days', '') ~ '^[0-9]+$' THEN (v_cfg->>'days')::int ELSE 10 END;
    v_count := CASE WHEN v_cfg->>'count' = 'calendar' THEN 'calendar' ELSE 'working' END;

    WITH base AS (
        SELECT k.id, b.batch_id AS batch_number, k.grower_name, k.status, k.qa_data, k.job_card_data,
               COALESCE(k.jobcard_approved, false) AS approved, k.packing_data, k.lab_history,
               public.kernel_lab_state(k.qa_data) AS state,
               CASE WHEN COALESCE(k.qa_data->>'lab_sent_on', '') ~ '^\d{4}-\d{2}-\d{2}$'
                    THEN (k.qa_data->>'lab_sent_on')::date END AS sent_on
        FROM public.kernel k
        LEFT JOIN public.batches b ON b.id = k.batch_id
        WHERE k.is_active = true
          AND k.status IN ('production', 'qa')
          AND ((k.qa_data IS NOT NULL AND k.qa_data <> '{}'::jsonb AND k.qa_data <> 'null'::jsonb)
               OR jsonb_array_length(COALESCE(k.lab_history, '[]'::jsonb)) > 0)
        ORDER BY k.updated_at DESC
        LIMIT 500
    ), styled AS (
        SELECT base.*,
               (SELECT jsonb_object_agg(t.style, CASE WHEN t.cartons > 0 THEN t.cartons ELSE round(t.qty_kg / 11.34, 2) END)
                FROM public.kernel_style_totals(
                    CASE WHEN base.approved AND public.kernel_job_card_has_stock_quantities(base.job_card_data)
                         THEN public.sync_kernel_job_card_to_packing_data(base.job_card_data)
                         ELSE base.packing_data END) t
                WHERE t.cartons > 0 OR t.qty_kg > 0) AS cartons_by_style
        FROM base
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'kernel_id', s.id,
            'batch_number', s.batch_number,
            'grower_name', s.grower_name,
            'status', s.status,
            -- 'reprocessing': sent back into production after failing its retest, End sample not redone yet.
            'state', CASE WHEN s.state = 'none' THEN 'reprocessing' ELSE s.state END,
            'test_number', jsonb_array_length(COALESCE(s.lab_history, '[]'::jsonb)) + 1,
            'lab_attempt', CASE WHEN COALESCE(s.qa_data->>'lab_attempt', '') ~ '^[0-9]+$' THEN (s.qa_data->>'lab_attempt')::int ELSE 1 END,
            'internal_micro_required', COALESCE((s.qa_data->>'internal_micro_required')::text = 'true', false),
            'internal_micro_status', s.qa_data->>'internal_micro_status',
            'external_lab_required', COALESCE((s.qa_data->>'external_lab_required')::text = 'true', false),
            'external_lab_status', s.qa_data->>'external_lab_status',
            'sent_on', s.sent_on,
            'days_at_lab', public.kernel_lab_days_elapsed(s.sent_on, v_count),
            'due_on', public.kernel_lab_due_on(s.sent_on, v_days, v_count),
            'is_late', (s.state = 'at_lab' AND s.sent_on IS NOT NULL AND public.kernel_lab_days_elapsed(s.sent_on, v_count) > v_days),
            'rejected_reason', s.qa_data->>'lab_rejected_reason',
            'last_failed', (SELECT h->'qa' FROM jsonb_array_elements(COALESCE(s.lab_history, '[]'::jsonb)) h ORDER BY (h->>'test_number')::int DESC NULLS LAST LIMIT 1),
            'cartons_by_style', COALESCE(s.cartons_by_style, '{}'::jsonb)
        ) ORDER BY s.batch_number), '[]'::jsonb)
    INTO v_rows
    FROM styled s;

    RETURN jsonb_build_object('success', true, 'expected_days', v_days, 'count', v_count,
                              'today', (now() AT TIME ZONE 'Africa/Johannesburg')::date, 'batches', v_rows);
END;
$function$;

-- 7. WRITE: RETEST / REPROCESS / REJECT -------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_kernel_lab_decision(p_kernel_id uuid, p_decision text, p_reason text DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_qa      jsonb;
    v_hist    jsonb;
    v_state   text;
    v_today   date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    v_entry   jsonb;
    v_test_no int;
BEGIN
    SELECT COALESCE(qa_data, '{}'::jsonb), COALESCE(lab_history, '[]'::jsonb), public.kernel_lab_state(qa_data)
    INTO v_qa, v_hist, v_state
    FROM public.kernel WHERE id = p_kernel_id AND is_active = true AND status IN ('production', 'qa')
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch not found, or it is no longer in Production.');
    END IF;

    v_test_no := jsonb_array_length(v_hist) + 1;
    v_entry := jsonb_build_object('test_number', v_test_no, 'outcome', 'failed', 'decision', p_decision,
                                  'decided_at', now(), 'decided_by', p_actor_user_id, 'qa', v_qa);

    IF p_decision = 'retest' THEN
        IF v_state <> 'failed' THEN
            RETURN jsonb_build_object('success', false, 'error', 'A retest can only be sent after a first failed lab test.');
        END IF;
        UPDATE public.kernel
        SET lab_history = v_hist || jsonb_build_array(v_entry),
            qa_data = v_qa || jsonb_build_object(
                'lab_attempt', 2,
                'lab_sent_on', to_char(v_today, 'YYYY-MM-DD'),
                'internal_micro_status', CASE WHEN v_qa->>'internal_micro_status' = 'failed' THEN 'waiting' ELSE v_qa->'internal_micro_status' #>> '{}' END,
                'external_lab_status',   CASE WHEN v_qa->>'external_lab_status'   = 'failed' THEN 'waiting' ELSE v_qa->'external_lab_status' #>> '{}' END),
            updated_by = COALESCE(p_actor_user_id, updated_by),
            updated_at = now()
        WHERE id = p_kernel_id;

    ELSIF p_decision = 'reprocess' THEN
        IF v_state <> 'needs_decision' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Reprocess is only offered after the retest has failed too.');
        END IF;
        -- Back into production with the same batch number; a new End sample starts the next test.
        UPDATE public.kernel
        SET lab_history = v_hist || jsonb_build_array(v_entry),
            qa_data = '{}'::jsonb,
            production_finished_at = NULL,
            status = 'production',
            updated_by = COALESCE(p_actor_user_id, updated_by),
            updated_at = now()
        WHERE id = p_kernel_id;

    ELSIF p_decision = 'reject' THEN
        IF v_state <> 'needs_decision' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Reject is only offered after the retest has failed too.');
        END IF;
        IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Give a reason for rejecting the batch.');
        END IF;
        UPDATE public.kernel
        SET qa_data = v_qa || jsonb_build_object('lab_decision', 'rejected', 'lab_rejected_reason', trim(p_reason),
                                                 'lab_rejected_at', now(), 'lab_rejected_by', p_actor_user_id),
            updated_by = COALESCE(p_actor_user_id, updated_by),
            updated_at = now()
        WHERE id = p_kernel_id;

    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Unknown decision: ' || COALESCE(p_decision, 'null'));
    END IF;

    RETURN jsonb_build_object('success', true, 'decision', p_decision);
END;
$function$;

-- GRANTS + bookkeeping ------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.kernel_lab_state(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kernel_lab_state(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kernel_lab_days_elapsed(date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kernel_lab_due_on(date, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_positive_release() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_kernel_lab_decision(uuid, text, text, uuid) TO anon, authenticated, service_role;

-- Function permissions (bookkeeping; RPCs are SECURITY DEFINER + anon). NOT EXISTS: no unique key.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY['get_kernel_positive_release', 'record_kernel_lab_decision']) AS fn
WHERE NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
