-- ============================================================================
-- Batch stages with rules (Mike's MacView STAGES / STAGE_RULES / viewBatches, 27 Nov 2026).
--
-- DECISION (Henry, 27 Nov): the stage stays AUTOMATIC, worked out from what has actually happened.
-- There is no manual "Move to next stage" for the production stages. What this adds:
--
--   MacView's 9 stages, mapped onto our data (_kernel_stage):
--     1 Storage               status intake/receiving, or released with no bags in a silo yet
--     2 Drying Silo           bags in a silo, nothing cracked, the silo not running
--     3 Cracking              a silo holding its bags is running, or some cracked and some still in a silo
--     4 Production            cracked (nothing left in a silo), production not finished
--     5 Awaiting Lab Results  production finished (status qa), lab not passed / nothing captured
--     6 Cleared for Transfer  status qa, lab passed (or no tests required): ready to count into stock
--     7 Request Invoice       transferred to stock (status complete), no invoice asked for yet
--     8 Invoice Requested     invoice asked for, not yet marked invoiced
--     9 Completed             marked invoiced
--   Each batch also gets its next step and, when it can't move on, the reason (MacView STAGE_RULES).
--
--   Rules that BLOCK a step (the ones that did not already exist):
--     - a batch on Hold / Reject after its intake lab results (round 1, kernel_intake_reviews) cannot
--       be released to production. Manual Release is refused with the reason; automatic release
--       keeps it at intake with the reason in release_hold (shows in Grower Intake > Needs a decision).
--     - Request invoice only from stage 7; Mark invoiced only from stage 8 (in the RPCs).
--   Rules that already existed and are only SHOWN here: samples before release
--   (release_kernel_to_production), production status before a silo (get_silo_allocation_batches),
--   lab passed + approved job card before transfer to stock (complete_kernel_batch).
--
--   kernel_stage_log          stage history, written whenever a batch's worked-out stage changes
--   kernel_invoice_requests   one row per batch: requested (who/when/note), invoiced (who/when/ref),
--                             cancelled_at (moved back). Batches already complete when this runs are
--                             marked invoiced as "before invoice stages" so they land in Completed.
--   get_batch_stages(p_include_completed)   kg + count per stage and the batch list for the tab
--   get_kernel_stage_history(p_kernel_id)
--   request_kernel_invoice / mark_kernel_invoiced / move_kernel_stage_back
--   My Day task 'invoice_request' (switch task-invoice-request: Palladium Manager, Procurement Lead,
--   admin). On request, the people with that switch get the existing approved WhatsApp
--   'macavation_open_tasks' straight away via send-task-reminder-whatsapp (same sender as the 13:00
--   reminder; once a day per person). No new sender, no new template.
--   Moving back: only the two invoice stages (cancel the request / undo invoiced), action
--   batch_stages.move_back (super_user, admin). Earlier stages are undone with their own tools
--   (silo undo, return from stock), because the stage follows the real data.
--
-- Idempotent. Needs 20261111090000 (kernel_lab_state), 20261127110000 (_kernel_intake_lab),
-- 20261116180000 (open-task WhatsApp), the task plumbing (20261027130000 / 140000).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kernel_stage_log (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kernel_id uuid NOT NULL REFERENCES public.kernel(id),
    stage_no  smallint NOT NULL CHECK (stage_no BETWEEN 1 AND 9),
    stage     text NOT NULL,
    at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    by_user   uuid,
    note      text
);
CREATE INDEX IF NOT EXISTS idx_kernel_stage_log_kernel_at ON public.kernel_stage_log (kernel_id, at DESC);
ALTER TABLE public.kernel_stage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kernel_stage_log ALTER COLUMN at SET DEFAULT clock_timestamp();

CREATE TABLE IF NOT EXISTS public.kernel_invoice_requests (
    kernel_id     uuid PRIMARY KEY REFERENCES public.kernel(id),
    requested_at  timestamptz NOT NULL DEFAULT now(),
    requested_by  uuid,
    note          text,
    invoiced_at   timestamptz,
    invoiced_by   uuid,
    invoice_ref   text,
    cancelled_at  timestamptz,
    cancelled_by  uuid,
    legacy        boolean NOT NULL DEFAULT false
);
ALTER TABLE public.kernel_invoice_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._batch_stage_names()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['Storage', 'Drying Silo', 'Cracking', 'Production', 'Awaiting Lab Results',
                   'Cleared for Transfer', 'Request Invoice', 'Invoice Requested', 'Completed']; $$;

-- One batch: its stage, the next step and why it is blocked (blank = it can move on).
CREATE OR REPLACE FUNCTION public._kernel_stage(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    k         public.kernel%ROWTYPE;
    inv       public.kernel_invoice_requests%ROWTYPE;
    v_in_silo int;
    v_cracked int;
    v_running boolean;
    v_lab     text;
    v_ilab    jsonb;
    v_no      int;
    v_next    text;
    v_why     text := '';
    v_where   text;
    v_miss    text[] := '{}';
BEGIN
    SELECT * INTO k FROM public.kernel WHERE id = p_kernel_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT count(*) FILTER (WHERE a.status = 'in_silo'), count(*) FILTER (WHERE a.status = 'cracked'),
           COALESCE(bool_or(a.status = 'in_silo' AND EXISTS (
               SELECT 1 FROM public.silo_runs r WHERE r.silo_number = a.silo_number AND r.closed_at IS NULL)), false)
      INTO v_in_silo, v_cracked, v_running
    FROM public.silo_allocations a WHERE a.kernel_id = k.id;

    IF k.status IN ('complete', 'dispatch') THEN
        SELECT * INTO inv FROM public.kernel_invoice_requests WHERE kernel_id = k.id AND cancelled_at IS NULL;
        IF NOT FOUND THEN
            v_no := 7; v_next := 'Request invoice'; v_where := 'stages';
        ELSIF inv.invoiced_at IS NULL THEN
            v_no := 8; v_next := 'Mark invoiced'; v_where := 'stages';
        ELSE
            v_no := 9;
        END IF;
    ELSIF k.status = 'qa' THEN
        v_lab := public.kernel_lab_state(k.qa_data);
        IF k.qa_data IS NULL OR k.qa_data IN ('{}'::jsonb, 'null'::jsonb) OR v_lab IN ('at_lab', 'failed', 'needs_decision', 'rejected') THEN
            v_no := 5; v_next := 'Transfer to stock'; v_where := 'kernel-production';
            v_why := CASE v_lab
                WHEN 'at_lab' THEN 'Waiting for the lab results'
                WHEN 'failed' THEN 'Failed its lab test: retest or decide'
                WHEN 'needs_decision' THEN 'Failed its retest: needs a decision'
                WHEN 'rejected' THEN 'Rejected by the lab'
                ELSE 'Capture the End sample and lab tests first' END;
        ELSE
            v_no := 6; v_next := 'Transfer to stock'; v_where := 'kernel-production';
            IF NOT COALESCE(k.jobcard_approved, false) THEN v_why := 'Approve the job card first'; END IF;
        END IF;
    ELSIF k.status = 'production' THEN
        IF v_running OR (v_cracked > 0 AND v_in_silo > 0) THEN
            v_no := 3; v_next := 'Finish cracking'; v_where := 'silo-allocation';
        ELSIF v_in_silo > 0 THEN
            v_no := 2; v_next := 'Start cracking'; v_where := 'silo-allocation';
        ELSIF v_cracked > 0
              OR jsonb_array_length(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) > 0
              OR jsonb_array_length(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) > 0 THEN
            v_no := 4; v_next := 'Finish production'; v_where := 'kernel-production';
        ELSE
            v_no := 1; v_next := 'Place in a drying silo'; v_where := 'silo-allocation';
        END IF;
    ELSE
        -- Still at intake: the release rules (samples, then the lab decision).
        v_no := 1; v_next := 'Release to production'; v_where := 'grower-intake-grid';
        IF (k.intake_data #>> '{ziplock_sample,completed_at}') IS NULL THEN v_miss := v_miss || 'the moisture, PV and FFA sample'::text; END IF;
        IF (k.intake_data #>> '{five_kg_sample,completed_at}') IS NULL THEN v_miss := v_miss || 'the 5 kg sample analysis'::text; END IF;
        IF cardinality(v_miss) > 0 THEN
            v_why := 'Capture ' || array_to_string(v_miss, ' and ') || ' first';
        ELSE
            v_ilab := public._kernel_intake_lab(k.id);
            IF v_ilab ->> 'outcome' IN ('hold', 'reject') THEN
                v_why := CASE WHEN v_ilab ->> 'outcome' = 'hold' THEN 'On hold after its intake lab results: record Pass first'
                              ELSE 'Rejected after its intake lab results' END;
            ELSIF jsonb_typeof(k.intake_data -> 'release_hold') = 'object' THEN
                v_why := 'Needs a decision on Grower Intake: '
                    || COALESCE(array_to_string(ARRAY(SELECT jsonb_array_elements_text(k.intake_data #> '{release_hold,reasons}')), '; '), 'held');
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object('stage_no', v_no, 'stage', (public._batch_stage_names())[v_no],
        'next', v_next, 'blocked', NULLIF(v_why, ''), 'where', v_where);
END;
$$;

-- Write a history row when the worked-out stage differs from the last one recorded.
CREATE OR REPLACE FUNCTION public._kernel_stage_sync(p_kernel_id uuid, p_by uuid DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_st   jsonb;
    v_last smallint;
BEGIN
    IF p_kernel_id IS NULL THEN RETURN; END IF;
    v_st := public._kernel_stage(p_kernel_id);
    IF v_st IS NULL THEN RETURN; END IF;
    SELECT l.stage_no INTO v_last FROM public.kernel_stage_log l WHERE l.kernel_id = p_kernel_id ORDER BY l.at DESC, l.id DESC LIMIT 1;
    IF v_last IS DISTINCT FROM (v_st ->> 'stage_no')::smallint THEN
        INSERT INTO public.kernel_stage_log (kernel_id, stage_no, stage, by_user, note)
        VALUES (p_kernel_id, (v_st ->> 'stage_no')::smallint, v_st ->> 'stage', p_by, p_note);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- History must never block the real work.
    RAISE WARNING '_kernel_stage_sync failed for %: %', p_kernel_id, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_kernel_stage_kernel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public._kernel_stage_sync(NEW.id, NEW.updated_by); RETURN NULL; END; $$;

CREATE OR REPLACE FUNCTION public._trg_kernel_stage_alloc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    -- Allocations are never removed as rows (unallocating changes the status), so no row-removal case.
    IF TG_OP = 'UPDATE' THEN PERFORM public._kernel_stage_sync(OLD.kernel_id); END IF;
    IF TG_OP = 'INSERT' OR NEW.kernel_id IS DISTINCT FROM OLD.kernel_id THEN
        PERFORM public._kernel_stage_sync(NEW.kernel_id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_kernel_stage_run()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_k uuid;
BEGIN
    FOR v_k IN SELECT DISTINCT a.kernel_id FROM public.silo_allocations a
               WHERE a.silo_number = NEW.silo_number AND a.status IN ('in_silo', 'cracked') AND a.kernel_id IS NOT NULL
                 AND (a.status = 'in_silo' OR a.run_id = NEW.id)
    LOOP
        PERFORM public._kernel_stage_sync(v_k);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_stage_log_kernel
    AFTER INSERT OR UPDATE OF status, is_active, production_finished_at, qa_data, cracking_data, packing_data, jobcard_approved
    ON public.kernel FOR EACH ROW EXECUTE FUNCTION public._trg_kernel_stage_kernel();

CREATE OR REPLACE TRIGGER kernel_stage_log_alloc
    AFTER INSERT OR UPDATE OF status, kernel_id, silo_number
    ON public.silo_allocations FOR EACH ROW EXECUTE FUNCTION public._trg_kernel_stage_alloc();

CREATE OR REPLACE TRIGGER kernel_stage_log_run
    AFTER INSERT OR UPDATE OF closed_at
    ON public.silo_runs FOR EACH ROW EXECUTE FUNCTION public._trg_kernel_stage_run();

-- ----------------------------------------------------------------------------
-- Rule: no release to production while QA holds or rejected the intake results.
-- Named zz_ so it runs after kernel_auto_release (BEFORE triggers fire in name order).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_kernel_release_lab_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_out   text;
    v_batch text;
    v_why   text;
BEGIN
    v_out := public._kernel_intake_lab(NEW.id) ->> 'outcome';
    IF v_out NOT IN ('hold', 'reject') THEN RETURN NEW; END IF;
    v_why := CASE WHEN v_out = 'hold' THEN 'QA put it on hold after its intake lab results'
                  ELSE 'QA rejected it after its intake lab results' END;

    -- Automatic release (kernel_auto_release just set auto_released_at): keep it at intake, say why.
    IF (NEW.intake_data ? 'auto_released_at') AND NOT (COALESCE(OLD.intake_data, '{}'::jsonb) ? 'auto_released_at') THEN
        NEW.status := OLD.status;
        NEW.intake_data := (NEW.intake_data - 'auto_released_at')
            || jsonb_build_object('release_hold', jsonb_build_object('reasons', jsonb_build_array(v_why), 'at', now()));
        RETURN NEW;
    END IF;

    SELECT b.batch_id INTO v_batch FROM public.batches b WHERE b.id = NEW.batch_id;
    RAISE EXCEPTION 'Batch % can''t go to production: %. Record Pass on Find a batch > Samples first.', COALESCE(v_batch, ''), v_why
        USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE TRIGGER zz_kernel_release_lab_guard
    BEFORE UPDATE ON public.kernel
    FOR EACH ROW
    WHEN (OLD.status IN ('intake', 'receiving') AND NEW.status = 'production')
    EXECUTE FUNCTION public._trg_kernel_release_lab_guard();

-- ----------------------------------------------------------------------------
-- Reads.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_batch_stages(p_include_completed boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_rows  jsonb := '[]'::jsonb;
    r       record;
    v_st    jsonb;
    v_kg    numeric;
    v_cnt   int[] := ARRAY[0,0,0,0,0,0,0,0,0];
    v_sum   numeric[] := ARRAY[0,0,0,0,0,0,0,0,0];
    v_no    int;
    v_names text[] := public._batch_stage_names();
    v_hints text[] := ARRAY['Received and stored', 'Drying in a silo', 'Being cracked', 'In production',
                            'Waiting for lab results', 'Lab passed: ready to count into stock',
                            'In stock: ask for the invoice', 'Invoice asked for', 'Done'];
    v_since timestamptz;
BEGIN
    FOR r IN
        SELECT k.id, b.batch_id AS batch_number, k.grower_name, k.received_date, k.created_at,
               COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg) AS nis_kg
        FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id
        WHERE k.is_active AND b.is_active
    LOOP
        v_st := public._kernel_stage(r.id);
        v_no := (v_st ->> 'stage_no')::int;
        v_kg := COALESCE(r.nis_kg, 0);
        v_cnt[v_no] := v_cnt[v_no] + 1;
        v_sum[v_no] := v_sum[v_no] + v_kg;
        IF v_no < 9 OR p_include_completed THEN
            SELECT l.at INTO v_since FROM public.kernel_stage_log l WHERE l.kernel_id = r.id ORDER BY l.at DESC, l.id DESC LIMIT 1;
            v_rows := v_rows || (v_st || jsonb_build_object(
                'kernel_id', r.id, 'batch_number', r.batch_number, 'grower_name', r.grower_name,
                'received_date', COALESCE(r.received_date, (r.created_at AT TIME ZONE 'Africa/Johannesburg')::date),
                'nis_kg', r.nis_kg, 'since', v_since,
                'invoice', (SELECT jsonb_build_object('requested_at', i.requested_at, 'note', i.note,
                                'invoiced_at', i.invoiced_at, 'invoice_ref', i.invoice_ref, 'legacy', i.legacy)
                            FROM public.kernel_invoice_requests i WHERE i.kernel_id = r.id AND i.cancelled_at IS NULL)));
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true,
        'stages', (SELECT jsonb_agg(jsonb_build_object('no', i, 'name', v_names[i], 'hint', v_hints[i],
                                                       'count', v_cnt[i], 'kg', v_sum[i]) ORDER BY i)
                   FROM generate_series(1, 9) i),
        'batches', COALESCE((SELECT jsonb_agg(e ORDER BY (e ->> 'stage_no')::int, e ->> 'received_date', e ->> 'batch_number')
                             FROM jsonb_array_elements(v_rows) e), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_kernel_stage_history(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'current', public._kernel_stage(p_kernel_id),
        'history', COALESCE(jsonb_agg(jsonb_build_object('stage_no', l.stage_no, 'stage', l.stage, 'at', l.at, 'note', l.note,
            'by_name', (SELECT COALESCE(NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email)
                        FROM public.users u WHERE u.id = l.by_user)) ORDER BY l.at DESC, l.id DESC), '[]'::jsonb))
    FROM public.kernel_stage_log l WHERE l.kernel_id = p_kernel_id;
$$;

-- ----------------------------------------------------------------------------
-- Invoice stages.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active) VALUES
    ('task-invoice-request', 'Tasks: raise a batch invoice',
     'Gets a My Day task (and a WhatsApp nudge) when someone presses Request invoice on a batch in stock.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE f.key = 'task-invoice-request' AND r.role_name IN ('Palladium Manager', 'Procurement Lead', 'admin')
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

-- WhatsApp nudge through the existing open-task reminder (approved template macavation_open_tasks).
-- Quietly does nothing when the Vault secrets are not seeded (as cron_send_open_task_reminders).
CREATE OR REPLACE FUNCTION public._nudge_task_whatsapp(p_kind text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_key  text;
    v_base text;
    v_u    record;
    v_n    int := 0;
BEGIN
    SELECT decrypted_secret INTO v_key  FROM vault.decrypted_secrets WHERE name = 'wa_cron_service_role_key';
    SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'wa_cron_functions_base_url';
    IF COALESCE(v_key, '') = '' OR COALESCE(v_base, '') NOT LIKE 'https://%' THEN RETURN 0; END IF;
    FOR v_u IN
        SELECT x.user_id FROM public.open_task_reminder_recipients() x
        WHERE x.role_name = ANY (public._task_kind_roles(p_kind))
    LOOP
        PERFORM net.http_post(
            url     := rtrim(v_base, '/') || '/send-task-reminder-whatsapp',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
            body    := jsonb_build_object('user_id', v_u.user_id));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '_nudge_task_whatsapp(%) failed: %', p_kind, SQLERRM;
    RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_kernel_invoice(p_kernel_id uuid, p_note text DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_st    jsonb := public._kernel_stage(p_kernel_id);
    k       record;
    v_title text;
    v_desc  text;
    v_task  uuid;
    v_wa    int;
BEGIN
    IF v_st IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Batch not found.'); END IF;
    IF (v_st ->> 'stage_no')::int <> 7 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'An invoice can only be asked for once the batch is in stock (this batch is at ' || (v_st ->> 'stage') || ').');
    END IF;

    INSERT INTO public.kernel_invoice_requests (kernel_id, requested_at, requested_by, note)
    VALUES (p_kernel_id, now(), p_user_id, NULLIF(btrim(COALESCE(p_note, '')), ''))
    ON CONFLICT (kernel_id) DO UPDATE SET requested_at = now(), requested_by = EXCLUDED.requested_by, note = EXCLUDED.note,
        invoiced_at = NULL, invoiced_by = NULL, invoice_ref = NULL, cancelled_at = NULL, cancelled_by = NULL, legacy = false;

    SELECT b.batch_id, k2.grower_name, COALESCE(k2.actual_wet_nis_kg, k2.wet_nis_received_kg) AS kg,
           COALESCE(k2.received_date, (k2.created_at AT TIME ZONE 'Africa/Johannesburg')::date) AS rcv
      INTO k
    FROM public.kernel k2 JOIN public.batches b ON b.id = k2.batch_id WHERE k2.id = p_kernel_id;

    v_title := 'Raise the invoice · ' || COALESCE(k.batch_id, 'batch') || COALESCE(' · ' || NULLIF(btrim(k.grower_name), ''), '');
    v_desc  := COALESCE(public._fmt_num2(k.kg) || ' kg nut in shell, ', '') || 'received ' || public._fmt_day(k.rcv)
        || COALESCE(' · asked by ' || (SELECT COALESCE(NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email)
                                       FROM public.users u WHERE u.id = p_user_id), '')
        || COALESCE(' · ' || NULLIF(btrim(COALESCE(p_note, '')), ''), '');
    v_task := public._open_task('invoice_request', 'invoice:' || p_kernel_id, v_title, v_desc, 'kernel', p_kernel_id);
    UPDATE public.workflow_tasks SET kernel_id = p_kernel_id WHERE id = v_task AND kernel_id IS NULL;

    PERFORM public._kernel_stage_sync(p_kernel_id, p_user_id, NULLIF(btrim(COALESCE(p_note, '')), ''));
    v_wa := public._nudge_task_whatsapp('invoice_request');
    RETURN jsonb_build_object('success', true, 'stage', public._kernel_stage(p_kernel_id), 'whatsapp_nudges', v_wa);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_kernel_invoiced(p_kernel_id uuid, p_invoice_ref text DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_st jsonb := public._kernel_stage(p_kernel_id);
BEGIN
    IF v_st IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Batch not found.'); END IF;
    IF (v_st ->> 'stage_no')::int <> 8 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ask for the invoice first (this batch is at ' || (v_st ->> 'stage') || ').');
    END IF;
    UPDATE public.kernel_invoice_requests
    SET invoiced_at = now(), invoiced_by = p_user_id, invoice_ref = NULLIF(btrim(COALESCE(p_invoice_ref, '')), '')
    WHERE kernel_id = p_kernel_id AND cancelled_at IS NULL;
    PERFORM public._close_tasks('invoice_request', 'invoice:' || p_kernel_id);
    PERFORM public._kernel_stage_sync(p_kernel_id, p_user_id, CASE WHEN NULLIF(btrim(COALESCE(p_invoice_ref, '')), '') IS NOT NULL
                                                                   THEN 'Invoice ' || btrim(p_invoice_ref) END);
    RETURN jsonb_build_object('success', true, 'stage', public._kernel_stage(p_kernel_id));
END;
$$;

-- Senior roles: one step back, only on the invoice stages (the others follow the real data).
CREATE OR REPLACE FUNCTION public.move_kernel_stage_back(p_kernel_id uuid, p_note text DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_st jsonb := public._kernel_stage(p_kernel_id);
    v_no int;
BEGIN
    IF v_st IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Batch not found.'); END IF;
    v_no := (v_st ->> 'stage_no')::int;
    IF v_no = 9 THEN
        UPDATE public.kernel_invoice_requests SET invoiced_at = NULL, invoiced_by = NULL, invoice_ref = NULL, legacy = false
        WHERE kernel_id = p_kernel_id AND cancelled_at IS NULL;
        PERFORM public._open_task('invoice_request', 'invoice:' || p_kernel_id,
            'Raise the invoice · ' || COALESCE((SELECT b.batch_id FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE k.id = p_kernel_id), 'batch'),
            'Moved back from Completed' || COALESCE(' · ' || NULLIF(btrim(COALESCE(p_note, '')), ''), ''), 'kernel', p_kernel_id);
    ELSIF v_no = 8 THEN
        UPDATE public.kernel_invoice_requests SET cancelled_at = now(), cancelled_by = p_user_id
        WHERE kernel_id = p_kernel_id AND cancelled_at IS NULL;
        PERFORM public._close_tasks('invoice_request', 'invoice:' || p_kernel_id);
    ELSE
        RETURN jsonb_build_object('success', false, 'error',
            'Only the invoice stages can be moved back here. Earlier stages follow what was captured: undo that step on its own screen.');
    END IF;
    PERFORM public._kernel_stage_sync(p_kernel_id, p_user_id,
        'Moved back' || COALESCE(': ' || NULLIF(btrim(COALESCE(p_note, '')), ''), ''));
    RETURN jsonb_build_object('success', true, 'stage', public._kernel_stage(p_kernel_id));
END;
$$;

-- Batches already in stock today count as invoiced before these stages existed.
INSERT INTO public.kernel_invoice_requests (kernel_id, requested_at, note, invoiced_at, legacy)
SELECT k.id, now(), 'Completed before the invoice stages were added', now(), true
FROM public.kernel k
WHERE k.is_active AND k.status IN ('complete', 'dispatch')
ON CONFLICT (kernel_id) DO NOTHING;

-- Start the history: the stage each batch is at now.
INSERT INTO public.kernel_stage_log (kernel_id, stage_no, stage, note)
SELECT k.id, (s ->> 'stage_no')::smallint, s ->> 'stage', 'Stage when the history started'
FROM public.kernel k CROSS JOIN LATERAL (SELECT public._kernel_stage(k.id) AS s) x
WHERE k.is_active AND NOT EXISTS (SELECT 1 FROM public.kernel_stage_log l WHERE l.kernel_id = k.id);

-- ----------------------------------------------------------------------------
-- Buttons and API grants.
-- ----------------------------------------------------------------------------
INSERT INTO public.actions (key, module, label, description) VALUES
    ('batch_stages.request_invoice', 'Find a batch', 'Request a batch invoice', 'Batch stages: ask admin to raise the invoice for a batch in stock'),
    ('batch_stages.mark_invoiced', 'Find a batch', 'Mark a batch invoiced', 'Batch stages: mark the invoice as raised (moves the batch to Completed)'),
    ('batch_stages.move_back', 'Find a batch', 'Move a batch back a stage', 'Batch stages: undo Request invoice or Invoiced, to correct a mistake')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.actions a JOIN public.roles r ON
     (a.key = 'batch_stages.request_invoice' AND r.role_name IN ('super_user', 'admin', 'Procurement Lead', 'Production Manager', 'Factory Manager', 'Quality Assurance', 'Sales Exec'))
  OR (a.key = 'batch_stages.mark_invoiced'   AND r.role_name IN ('super_user', 'admin', 'Procurement Lead', 'Palladium Manager', 'Sales Exec'))
  OR (a.key = 'batch_stages.move_back'       AND r.role_name IN ('super_user', 'admin'))
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

REVOKE EXECUTE ON FUNCTION public._kernel_stage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kernel_stage_sync(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._nudge_task_whatsapp(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_kernel_stage_kernel() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_kernel_stage_alloc() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_kernel_stage_run() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_kernel_release_lab_guard() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_batch_stages(boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_stage_history(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_kernel_invoice(uuid, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_kernel_invoiced(uuid, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_kernel_stage_back(uuid, text, uuid) TO anon, authenticated, service_role;

-- Reads: every role that can open a batch page. Writes: the roles holding the matching button.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_permissions rp CROSS JOIN unnest(ARRAY['get_batch_stages', 'get_kernel_stage_history']) fn
WHERE rp.object_type = 'function' AND rp.object_name = 'get_kernel_batch_detail' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = fn AND x.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT ra.role_id, 'function', m.fn, 'EXECUTE', true
FROM (VALUES ('batch_stages.request_invoice', 'request_kernel_invoice'),
             ('batch_stages.mark_invoiced', 'mark_kernel_invoiced'),
             ('batch_stages.move_back', 'move_kernel_stage_back')) AS m(action_key, fn)
JOIN public.actions a ON a.key = m.action_key
JOIN public.role_actions ra ON ra.action_id = a.id AND ra.value = 'true'
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = ra.role_id AND x.object_type = 'function' AND x.object_name = m.fn AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
