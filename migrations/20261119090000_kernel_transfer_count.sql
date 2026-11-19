-- ============================================================================
-- Count the boxes before a finished batch goes into stock on hand.
--
-- WHY. Mike (19 Nov 2026, Thando's point): "Release to stock" put a batch into finished-goods stock
-- straight from the job card, with no check that the boxes are really there. A batch that has
-- passed the lab now waits in Ready for stock, Thando gets a My Day task, and the transfer is a
-- count sheet: what production packed per style, what was counted, and a note for any difference.
-- Henry: the COUNTED number goes into stock, and a difference is flagged.
--
-- How the counted number reaches stock: the batch is released from the job card exactly as before
-- (complete_kernel_batch), then each style that counted differently gets an ordinary Adjust Stock
-- row (adjust_kernel_stock_on_hand) for the difference. Those rows survive job-card re-saves
-- (kernel_packing_keep_adjustments, 20261117120000) and land in the stock history. The job card
-- stays as production's record.
--
--   kernel.transfer_check             who counted, when, per style: production vs counted + note
--   get_kernel_transfer_sheet(id)     the sheet: production's cartons/kg per style
--   transfer_kernel_batch_to_stock    save the count + release + adjust, all or nothing
--   get_kernel_transfer_differences() batches in stock whose count differed (Stock on Hand flag)
--   complete_kernel_batch(uuid)       refuses unless called through the transfer (no count, no stock)
--   task kernel_transfer_check        "Count a batch into stock" for Production Manager; opens when a
--                                     batch reaches Ready for stock, closes when it is in stock
--   role_actions                      Production Manager may release to stock (Thando does the count)
--
-- Down (by hand): restore complete_kernel_batch(uuid) from 20261111090000 + 20261117120000, remove the
-- three new functions, the trigger and _kernel_transfer_task, and kernel.transfer_check.
-- ============================================================================

ALTER TABLE public.kernel ADD COLUMN IF NOT EXISTS transfer_check jsonb;

COMMENT ON COLUMN public.kernel.transfer_check IS
    'Box count at transfer to stock: {checked_at, checked_by, note, has_difference, lines:[{style, expected_cartons, expected_kg, counted_cartons, difference, note}]}. Written by transfer_kernel_batch_to_stock.';

-- ----------------------------------------------------------------------------
-- Production's figures per style, from the job card (same source Release to stock always used).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._kernel_transfer_expected(p_job_card jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'style', t.style,
               'cartons', round(t.cartons, 2),
               'kg', round(t.qty_kg, 2)) ORDER BY o.ord), '[]'::jsonb)
    FROM public.kernel_style_totals(public.sync_kernel_job_card_to_packing_data(p_job_card)) t
    JOIN (VALUES ('SP', 1), ('0', 2), ('1', 3), ('1S', 4), ('4L', 5), ('5', 6), ('6', 7),
                 ('7/8', 8), ('Butter High Oil', 9), ('Butter Low Oil', 10)) AS o(style, ord)
      ON o.style = t.style
    WHERE t.cartons > 0 OR t.qty_kg > 0;
$function$;

REVOKE EXECUTE ON FUNCTION public._kernel_transfer_expected(jsonb) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- READ: the count sheet for one batch.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kernel_transfer_sheet(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_k record;
BEGIN
    SELECT k.id, k.status, k.grower_name, k.job_card_data, k.transfer_check,
           COALESCE(k.jobcard_approved, false) AS approved, b.batch_id AS batch_number
    INTO v_k
    FROM public.kernel k
    LEFT JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id AND k.is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'kernel_id', v_k.id,
        'batch_number', v_k.batch_number,
        'grower_name', v_k.grower_name,
        'status', v_k.status,
        'jobcard_approved', v_k.approved,
        'packing_completion_date', NULLIF(btrim(COALESCE(v_k.job_card_data ->> 'packing_completion_date', '')), ''),
        'lines', public._kernel_transfer_expected(v_k.job_card_data),
        'transfer_check', v_k.transfer_check);
END;
$function$;

-- ----------------------------------------------------------------------------
-- Release to stock now refuses unless it comes through the count.
-- Body = live dev definition 19 Nov 2026 (20261111090000 + 20261117120000) + the guard at the top.
-- ----------------------------------------------------------------------------
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

    -- Set (transaction-local) only by transfer_kernel_batch_to_stock.
    IF COALESCE(current_setting('macavation.kernel_transfer_count', true), '') <> 'on' THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Count the boxes first: refresh the page and press Transfer to stock on this batch.');
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
        packing_data = public.kernel_packing_keep_adjustments(public.sync_kernel_job_card_to_packing_data(v_jc), packing_data),
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- ----------------------------------------------------------------------------
-- WRITE: the count. p_counts = [{style, counted, note}], one per style on the sheet.
-- A style that counted differently needs a note. All or nothing: any failure after the release
-- raises, which rolls the release back too.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_kernel_batch_to_stock(
    p_kernel_id     uuid,
    p_counts        jsonb,
    p_note          text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_status    varchar;
    v_jc        jsonb;
    v_batch     text;
    v_expected  jsonb;
    v_line      jsonb;
    v_count     jsonb;
    v_style     text;
    v_exp_ctn   numeric;
    v_exp_kg    numeric;
    v_counted   numeric;
    v_diff      numeric;
    v_kg_diff   numeric;
    v_line_note text;
    v_lines     jsonb := '[]'::jsonb;
    v_any_diff  boolean := false;
    v_res       jsonb;
    v_extra     text;
BEGIN
    SELECT k.status, k.job_card_data, b.batch_id
    INTO v_status, v_jc, v_batch
    FROM public.kernel k
    LEFT JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id AND k.is_active = true
    FOR UPDATE OF k;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;
    IF v_status = 'complete' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This batch is already in stock.');
    END IF;
    IF jsonb_typeof(p_counts) IS DISTINCT FROM 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a count for every style.');
    END IF;

    v_expected := public._kernel_transfer_expected(v_jc);
    IF jsonb_array_length(v_expected) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'The job card has no style quantities. Open the job card, enter them and press Jobcard approved.');
    END IF;

    -- Only styles on the sheet may be counted.
    SELECT string_agg(DISTINCT c ->> 'style', ', ') INTO v_extra
    FROM jsonb_array_elements(p_counts) c
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_expected) e WHERE e ->> 'style' = c ->> 'style');
    IF v_extra IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Style ' || v_extra || ' is not on the job card. Fix the job card first, or write it in the note.');
    END IF;

    FOR v_line IN SELECT value FROM jsonb_array_elements(v_expected) LOOP
        v_style   := v_line ->> 'style';
        v_exp_ctn := (v_line ->> 'cartons')::numeric;
        v_exp_kg  := (v_line ->> 'kg')::numeric;

        SELECT c INTO v_count FROM jsonb_array_elements(p_counts) c WHERE c ->> 'style' = v_style LIMIT 1;
        IF v_count IS NULL OR COALESCE(btrim(v_count ->> 'counted'), '') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
            RETURN jsonb_build_object('success', false, 'error',
                'Enter the boxes counted for style ' || v_style || ' (0 if there are none).');
        END IF;

        v_counted   := (v_count ->> 'counted')::numeric;
        v_diff      := round(v_counted - v_exp_ctn, 2);
        v_line_note := NULLIF(btrim(COALESCE(v_count ->> 'note', '')), '');

        IF v_diff <> 0 AND v_line_note IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error',
                'Style ' || v_style || ' counted ' || trim_scale(v_counted) || ' but production packed ' || trim_scale(v_exp_ctn) ||
                '. Add a note to say why.');
        END IF;

        v_any_diff := v_any_diff OR v_diff <> 0;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
            'style', v_style, 'expected_cartons', v_exp_ctn, 'expected_kg', v_exp_kg,
            'counted_cartons', v_counted, 'difference', v_diff,
            'note', CASE WHEN v_diff <> 0 THEN v_line_note END));
        v_count := NULL;
    END LOOP;

    -- Release from the job card exactly as before (all the old checks apply).
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    PERFORM set_config('macavation.kernel_transfer_count', 'on', true);
    v_res := public.complete_kernel_batch(p_kernel_id);
    PERFORM set_config('macavation.kernel_transfer_count', 'off', true);
    IF COALESCE((v_res ->> 'success')::boolean, false) IS NOT TRUE OR (v_res ->> 'already_complete') = 'true' THEN
        RETURN COALESCE(v_res, jsonb_build_object('success', false, 'error', 'Could not release the batch.'));
    END IF;

    -- Then move each differing style to the counted number with an ordinary stock adjustment.
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) WHERE (value ->> 'difference')::numeric <> 0 LOOP
        v_diff    := (v_line ->> 'difference')::numeric;
        v_exp_ctn := (v_line ->> 'expected_cartons')::numeric;
        v_exp_kg  := (v_line ->> 'expected_kg')::numeric;
        -- kg follows the batch's own kg per box when the job card has both; else 11.34 kg a box.
        v_kg_diff := CASE
            WHEN (v_line ->> 'counted_cartons')::numeric = 0 THEN -v_exp_kg
            WHEN v_exp_ctn > 0 AND v_exp_kg > 0 THEN round(v_diff * v_exp_kg / v_exp_ctn, 2)
            ELSE round(v_diff * 11.34, 2) END;

        v_res := public.adjust_kernel_stock_on_hand(
            p_kernel_id, (v_line ->> 'style')::varchar, v_kg_diff, v_diff,
            'Transfer count: production packed ' || trim_scale(v_exp_ctn) || ', counted ' || trim_scale((v_line ->> 'counted_cartons')::numeric) ||
            '. ' || (v_line ->> 'note'));
        IF COALESCE((v_res ->> 'success')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'Could not set style % to the counted number: %', v_line ->> 'style', COALESCE(v_res ->> 'error', 'unknown error');
        END IF;
    END LOOP;

    UPDATE public.kernel
    SET transfer_check = jsonb_build_object(
            'checked_at', now(),
            'checked_by', p_actor_user_id,
            'note', NULLIF(btrim(COALESCE(p_note, '')), ''),
            'has_difference', v_any_diff,
            'lines', v_lines),
        updated_at = now()
    WHERE id = p_kernel_id;

    PERFORM public._close_tasks('kernel_transfer_check', 'kernel_transfer:' || p_kernel_id::text);

    RETURN jsonb_build_object('success', true, 'batch_number', v_batch, 'has_difference', v_any_diff, 'lines', v_lines);
END;
$function$;

-- ----------------------------------------------------------------------------
-- READ: batches in stock whose count differed from production (Stock on Hand flag).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kernel_transfer_differences()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object('success', true, 'batches', COALESCE(jsonb_agg(x), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
                   'kernel_id', k.id,
                   'checked_at', k.transfer_check -> 'checked_at',
                   'checked_by_name', NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                   'note', k.transfer_check -> 'note',
                   'lines', (SELECT COALESCE(jsonb_agg(l), '[]'::jsonb)
                             FROM jsonb_array_elements(k.transfer_check -> 'lines') l
                             WHERE (l ->> 'difference')::numeric <> 0)) AS x
        FROM public.kernel k
        LEFT JOIN public.users u ON u.id = CASE WHEN (k.transfer_check ->> 'checked_by') ~ '^[0-9a-f-]{36}$'
                                                THEN (k.transfer_check ->> 'checked_by')::uuid END
        WHERE k.is_active = true
          AND k.status = 'complete'
          AND (k.transfer_check ->> 'has_difference') = 'true'
        ORDER BY k.updated_at DESC
        LIMIT 500
    ) s;
$function$;

-- ----------------------------------------------------------------------------
-- My Day task: "Count a batch into stock" (Production Manager).
-- Ready for stock = in production/qa, production finished, End sample saved, lab passed
-- (same as the Production board, batch-status.js).
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active)
VALUES ('task-kernel-transfer-check', 'Tasks: count a batch into stock',
        'Gets a task when a batch has passed the lab and is ready for stock: count the boxes of each style and transfer it into stock on hand.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE r.role_name = 'Production Manager' AND f.key = 'task-kernel-transfer-check'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

CREATE OR REPLACE FUNCTION public._kernel_transfer_task(p_kernel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_k     record;
    v_ready boolean;
    v_key   text := 'kernel_transfer:' || p_kernel_id::text;
BEGIN
    SELECT k.status, k.is_active, k.production_finished_at, k.qa_data, k.grower_name,
           COALESCE(k.jobcard_approved, false) AS approved, b.batch_id AS batch_number
    INTO v_k
    FROM public.kernel k
    LEFT JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id;

    v_ready := FOUND AND v_k.is_active
        AND v_k.status IN ('production', 'qa')
        AND v_k.production_finished_at IS NOT NULL
        AND v_k.qa_data IS NOT NULL AND v_k.qa_data <> '{}'::jsonb AND v_k.qa_data <> 'null'::jsonb
        AND public.kernel_lab_state(v_k.qa_data) = 'passed';

    IF v_ready THEN
        PERFORM public._open_task('kernel_transfer_check', v_key,
            'Count into stock · ' || COALESCE(v_k.batch_number, 'batch'),
            CASE WHEN v_k.approved
                 THEN 'Passed the lab. Count the boxes of each style and transfer it into stock on hand.'
                 ELSE 'Passed the lab. Approve the job card, then count the boxes of each style and transfer it into stock.' END
                || COALESCE(' Supplier: ' || NULLIF(btrim(v_k.grower_name), '') || '.', ''),
            'kernel', p_kernel_id);
    ELSE
        PERFORM public._close_tasks('kernel_transfer_check', v_key);
    END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kernel_transfer_task(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._trg_kernel_transfer_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM public._kernel_transfer_task(NEW.id);
    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._trg_kernel_transfer_task() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER kernel_transfer_task
    AFTER INSERT OR UPDATE OF status, is_active, production_finished_at, qa_data, jobcard_approved ON public.kernel
    FOR EACH ROW EXECUTE FUNCTION public._trg_kernel_transfer_task();

-- Backfill: a task for every batch already waiting in Ready for stock.
DO $backfill$
DECLARE
    v_id uuid;
BEGIN
    FOR v_id IN
        SELECT id FROM public.kernel
        WHERE is_active AND status IN ('production', 'qa') AND production_finished_at IS NOT NULL
        LIMIT 500
    LOOP
        PERFORM public._kernel_transfer_task(v_id);
    END LOOP;
END
$backfill$;

-- ----------------------------------------------------------------------------
-- Thando (Production Manager) does the count, so her role may release to stock.
-- ----------------------------------------------------------------------------
INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.actions a
JOIN public.roles r ON r.role_name = 'Production Manager'
WHERE a.key = 'kernel.release_to_stock'
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

-- ----------------------------------------------------------------------------
-- Grants.
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_kernel_transfer_sheet(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_kernel_batch_to_stock(uuid, jsonb, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_transfer_differences() TO anon, authenticated, service_role;

-- Function permissions (bookkeeping; RPCs are SECURITY DEFINER + anon). NOT EXISTS: no unique key.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY['get_kernel_transfer_sheet', 'transfer_kernel_batch_to_stock', 'get_kernel_transfer_differences']) AS fn
WHERE NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
