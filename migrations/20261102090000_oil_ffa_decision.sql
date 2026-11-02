-- ============================================================================
-- Oil raws: FFA that is not in spec waits for an exec decision.
--
-- WHY. Henry (2 Nov 2026), from the quick-FFA mockup (claude.ai/artifact/K8EJiU2AYMsYHrYYgPETxt):
-- FFA is now typed on the receiving checklist or for a whole delivery at once, not only one bag
-- at a time. Until now every recorded FFA sent the bag straight to Ready for Oil Production.
-- From now on "anything that is not in spec needs a decision from one of the three execs -
-- Mark for production, Pete for sales and Mike for procurement - but they all get every message".
--
--   in spec     the FFA green limit on Kernel Pipeline Settings (sample_spec_thresholds 'ffa',
--               direction max). No limit set = no hold, the old behaviour.
--   held bag    status stays awaiting_test; intake_data.ffa_decision = {status:'pending', ...}
--   task kind   oil_ffa_decision, one per bag (dedupe 'oil:<id>'), switch task-oil-ffa-decision
--               on for Factory Manager, Sales Exec and Procurement Lead. The task trigger
--               (20261027150000/160000) puts it in every one of those roles' bells.
--   RPCs        complete_supplier_intake_first_sample_ffa (replaced: same signature, adds the
--               hold), record_supplier_intake_ffa_bulk, decide_oil_ffa
--   trigger     a held bag that is removed or moves on some other way closes its task
-- ============================================================================

CREATE OR REPLACE FUNCTION public._oil_ffa_green_limit()
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT green_limit FROM public.sample_spec_thresholds
    WHERE test_key = 'ffa' AND COALESCE(direction, 'max') = 'max'
    LIMIT 1;
$$;

-- 'cracker_dust' -> 'Cracker dust'
CREATE OR REPLACE FUNCTION public._oil_product_label(p_type text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE WHEN COALESCE(p_type, '') = '' THEN 'Oil raw'
                ELSE upper(left(replace(p_type, '_', ' '), 1)) || lower(substr(replace(p_type, '_', ' '), 2)) END;
$$;

-- 1000 -> '1,000.00' (the portal's weight format)
CREATE OR REPLACE FUNCTION public._fmt_kg2(p_kg numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(round(p_kg, 2), 'FM999G999G990D00'); $$;

-- 0.40 -> '0.4', 7.25 -> '7.25'
CREATE OR REPLACE FUNCTION public._fmt_pct(p numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT trim(trailing '.' FROM trim(trailing '0' FROM to_char(p, 'FM9990D00'))); $$;

-- ----------------------------------------------------------------------------
-- One bag's first FFA. In spec (or no limit set) -> Ready for Oil Production, as before.
-- Not in spec -> stays in Awaiting tests, marked for a decision, and the execs get a task.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_supplier_intake_first_sample_ffa(
    p_oil_id     uuid,
    p_ffa_pct    numeric,
    p_updated_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row    RECORD;
    v_intake jsonb;
    v_limit  numeric;
    v_held   boolean;
    v_kg     numeric;
BEGIN
    IF p_oil_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_oil_id is required');
    END IF;
    IF p_ffa_pct IS NULL OR p_ffa_pct < 0 OR p_ffa_pct > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'FFA % must be between 0 and 100');
    END IF;

    SELECT id, batch_id, intake_data, status
    INTO v_row
    FROM public.oil
    WHERE id = p_oil_id AND is_active = true;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil batch not found');
    END IF;

    v_intake := COALESCE(v_row.intake_data, '{}'::jsonb);
    IF v_intake ? 'supplier_intake_official_ffa_at' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Official supplier intake FFA is already recorded for this batch. Use Quality Assurance for any further tests.'
        );
    END IF;

    v_limit := public._oil_ffa_green_limit();
    v_held := v_limit IS NOT NULL AND p_ffa_pct > v_limit;

    v_intake := v_intake || jsonb_build_object(
        'official_ffa', to_jsonb(p_ffa_pct),
        'ffa', to_jsonb(p_ffa_pct),
        'supplier_intake_official_ffa_at', to_jsonb(now())
    );
    IF v_held THEN
        v_intake := v_intake || jsonb_build_object('ffa_decision', jsonb_build_object(
            'status', 'pending', 'ffa', p_ffa_pct, 'green_limit', v_limit, 'raised_at', now()));
    END IF;

    UPDATE public.oil o
    SET intake_data = v_intake,
        status = CASE WHEN v_held THEN 'awaiting_test' ELSE 'release_ready' END,
        updated_by = COALESCE(p_updated_by, o.updated_by),
        updated_at = NOW()
    WHERE o.id = p_oil_id AND o.is_active = true;

    IF v_held THEN
        v_kg := NULLIF(v_intake ->> 'quantity_kg', '')::numeric;
        PERFORM public._open_task(
            'oil_ffa_decision',
            'oil:' || p_oil_id::text,
            v_row.batch_id || ': FFA ' || public._fmt_pct(p_ffa_pct) || '% is out of spec',
            concat_ws(' · ',
                public._oil_product_label(v_intake ->> 'product_type'),
                NULLIF(COALESCE(v_intake ->> 'supplier', v_intake ->> 'supplier_details'), ''),
                'delivery ' || NULLIF(COALESCE(v_intake ->> 'delivery_note_reference', v_intake ->> 'delivery_note_ref'), ''),
                CASE WHEN v_kg IS NOT NULL THEN public._fmt_kg2(v_kg) || ' kg' END)
              || '. In spec is ' || public._fmt_pct(v_limit) || '% or less. Accept it for production or reject it.',
            'oil',
            p_oil_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'id', p_oil_id, 'held', v_held, 'green_limit', v_limit);
END;
$$;

COMMENT ON FUNCTION public.complete_supplier_intake_first_sample_ffa(uuid, numeric, uuid) IS
  'First Supplier Intake FFA for one bag: stores official FFA on intake_data. In spec (FFA green limit, or no limit set) -> release_ready. Not in spec -> stays awaiting_test with intake_data.ffa_decision pending and an oil_ffa_decision task. Rejects if already recorded.';

-- ----------------------------------------------------------------------------
-- Several bags at once (Record FFA for this delivery). p_items = [{"oil_id": "...", "ffa": 0.4}, ...]
-- Each bag is its own call above, so one bad bag does not stop the rest.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_supplier_intake_ffa_bulk(
    p_items      jsonb,
    p_updated_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item   jsonb;
    v_res    jsonb;
    v_ready  integer := 0;
    v_held   integer := 0;
    v_failed jsonb := '[]'::jsonb;
    v_id     uuid;
    v_ffa    numeric;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_items must be a list of bags');
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        BEGIN
            v_id := (v_item ->> 'oil_id')::uuid;
            v_ffa := (v_item ->> 'ffa')::numeric;
        EXCEPTION WHEN others THEN
            v_failed := v_failed || jsonb_build_array(jsonb_build_object('oil_id', v_item ->> 'oil_id', 'error', 'Not a valid bag or FFA'));
            CONTINUE;
        END;
        v_res := public.complete_supplier_intake_first_sample_ffa(v_id, v_ffa, p_updated_by);
        IF COALESCE((v_res ->> 'success')::boolean, false) THEN
            IF COALESCE((v_res ->> 'held')::boolean, false) THEN v_held := v_held + 1; ELSE v_ready := v_ready + 1; END IF;
        ELSE
            v_failed := v_failed || jsonb_build_array(jsonb_build_object('oil_id', v_id, 'error', v_res ->> 'error'));
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'ready', v_ready, 'held', v_held, 'failed', v_failed);
END;
$$;

-- ----------------------------------------------------------------------------
-- An exec's decision on a held bag. accept -> Ready for Oil Production; reject -> stays out
-- of production, marked rejected (a reason is required). Only roles that get the task (or
-- super_user / admin) may decide. Everyone who got the task is told the outcome.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_oil_ffa(
    p_oil_id        uuid,
    p_decision      text,
    p_note          text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row     RECORD;
    v_intake  jsonb;
    v_dec     jsonb;
    v_role    text;
    v_name    text;
    v_note    text := NULLIF(trim(COALESCE(p_note, '')), '');
    v_roles   text[];
    v_title   text;
    v_body    text;
BEGIN
    IF p_oil_id IS NULL OR p_decision NOT IN ('accept', 'reject') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose accept or reject');
    END IF;
    IF p_decision = 'reject' AND v_note IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Say why the bag is rejected');
    END IF;

    SELECT COALESCE(r.role_name, u.role),
           COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)
      INTO v_role, v_name
      FROM public.users u LEFT JOIN public.roles r ON r.id = u.role_id
     WHERE u.id = p_actor_user_id AND u.is_active;

    v_roles := public._task_kind_roles('oil_ffa_decision');
    IF v_role IS NULL OR NOT (v_role IN ('super_user', 'admin') OR v_role = ANY (v_roles)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only ' || COALESCE(NULLIF(array_to_string(v_roles, ', '), ''), 'the execs') || ' can decide on an out-of-spec FFA');
    END IF;

    SELECT id, batch_id, intake_data, status INTO v_row
      FROM public.oil WHERE id = p_oil_id AND is_active = true
       FOR UPDATE;
    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil batch not found');
    END IF;

    v_intake := COALESCE(v_row.intake_data, '{}'::jsonb);
    v_dec := v_intake -> 'ffa_decision';
    IF v_dec IS NULL OR v_dec ->> 'status' <> 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error',
            CASE WHEN v_dec IS NULL THEN 'This bag is not waiting for a decision'
                 ELSE 'Already ' || (v_dec ->> 'status') || ' by ' || COALESCE(v_dec ->> 'decided_by_name', 'someone else') END);
    END IF;

    v_dec := v_dec || jsonb_build_object(
        'status', CASE WHEN p_decision = 'accept' THEN 'accepted' ELSE 'rejected' END,
        'decided_by', p_actor_user_id, 'decided_by_name', v_name, 'decided_at', now(), 'note', v_note);

    UPDATE public.oil
       SET intake_data = v_intake || jsonb_build_object('ffa_decision', v_dec),
           status = CASE WHEN p_decision = 'accept' THEN 'release_ready' ELSE status END,
           updated_by = COALESCE(p_actor_user_id, updated_by),
           updated_at = now()
     WHERE id = p_oil_id;

    PERFORM public._close_tasks('oil_ffa_decision', 'oil:' || p_oil_id::text);

    v_title := v_row.batch_id || ' ' || CASE WHEN p_decision = 'accept' THEN 'accepted' ELSE 'rejected' END
               || ' by ' || COALESCE(v_name, 'an exec');
    v_body := 'FFA ' || public._fmt_pct((v_dec ->> 'ffa')::numeric) || '%. '
              || CASE WHEN p_decision = 'accept' THEN 'It is now Ready for Oil Production.' ELSE 'It will not go to production.' END
              || CASE WHEN v_note IS NOT NULL THEN ' Note: ' || v_note ELSE '' END;
    INSERT INTO public.notifications (title, body, notification_type, severity, link_route, link_params, target_role_id)
    SELECT v_title, v_body, 'info', 'info', 'supplier-intake-grid', jsonb_build_object('oil_id', p_oil_id), r.id
      FROM public.roles r WHERE r.role_name = ANY (v_roles);

    RETURN jsonb_build_object('success', true, 'id', p_oil_id, 'decision', v_dec ->> 'status');
END;
$$;

-- A held bag that is removed from intake, or moved on by some other screen, needs no decision.
CREATE OR REPLACE FUNCTION public._trg_oil_ffa_decision_close()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF (NOT NEW.is_active OR NEW.status IS DISTINCT FROM 'awaiting_test'
        OR COALESCE(NEW.intake_data #>> '{ffa_decision,status}', '') <> 'pending')
       AND EXISTS (SELECT 1 FROM public.workflow_tasks
                   WHERE kind = 'oil_ffa_decision' AND dedupe_key = 'oil:' || NEW.id::text
                     AND status NOT IN ('completed', 'dismissed')) THEN
        PERFORM public._close_tasks('oil_ffa_decision', 'oil:' || NEW.id::text);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_oil_ffa_decision_close
    AFTER UPDATE OF is_active, status, intake_data ON public.oil
    FOR EACH ROW EXECUTE FUNCTION public._trg_oil_ffa_decision_close();

REVOKE EXECUTE ON FUNCTION public._oil_ffa_green_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_oil_ffa_decision_close() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_supplier_intake_first_sample_ffa(uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_supplier_intake_first_sample_ffa(uuid, numeric, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_supplier_intake_ffa_bulk(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_oil_ffa(uuid, text, text, uuid) TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN (VALUES ('record_supplier_intake_ffa_bulk'), ('decide_oil_ffa')) AS f(fn)
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
    WHERE x.role_id = r.id AND x.object_type = 'function' AND x.object_name = f.fn AND x.operation = 'EXECUTE');

-- ----------------------------------------------------------------------------
-- Task switch: Mark (Factory Manager), Pete (Sales Exec), Mike (Procurement Lead).
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active) VALUES
    ('task-oil-ffa-decision', 'Tasks: oil raw FFA out of spec',
     'Gets a task when an oil raw bag''s FFA is not in spec, to accept it for production or reject it.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
JOIN public.features f ON f.key = 'task-oil-ffa-decision'
WHERE r.role_name IN ('Factory Manager', 'Sales Exec', 'Procurement Lead')
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';
