-- ============================================================================
-- Intake lab results checked and reviewed (Mike's MacView, 27 Nov 2026).
--
-- WHY. A delivery's moisture, PV and FFA (the ziplock sample, kernel.intake_data.ziplock_sample)
-- are coloured green / amber / red against Kernel Pipeline Settings > Sample spec limits
-- (sample_spec_thresholds) while they are typed, and auto-release (20261103140000) holds a batch
-- that is not green. Nobody is asked to capture a missing result, and nobody signs off a result
-- that is over spec. MacView has both; this adds them on the SAME limits (no second limits table).
--
-- Mapping to MacView: "within spec" = green (ok), "marginal" = amber (warn), "overspec" = red (bad).
--
-- What this adds:
--   kernel_intake_reviews     one row per delivery: decision pass | hold | reject | reviewed, note,
--                             who / when, and the moisture / PV / FFA it was given for. If the
--                             results change later the review no longer counts (MacView specAcked).
--   _kernel_intake_lab(id)    per delivery: each result with its band and limits, the automatic
--                             result (pass, or fail with reasons "PV 5.80 overspec (above 5.00)"),
--                             the review, and the outcome (a current manual decision wins).
--   get_kernel_intake_lab(p_kernel_id)                     read for the batch page
--   review_kernel_intake_results(p_kernel_id, p_decision, p_note, p_user_id)
--                             records the sign-off. It does NOT move the batch: releasing a held
--                             batch is still Grower Intake > Needs a decision.
--   tasks   intake_results_missing    "Moisture, PV & FFA results to capture": a delivery still at
--                                     intake with any of the three blank (says which)
--           intake_results_overspec   "PV / FFA overspec, needs review": PV or FFA red and no
--                                     current review; Mark reviewed closes it, a changed result
--                                     reopens it
--           Both are Role Features switches (task-<kind>), on for Quality Assurance, Factory
--           Manager and Production Manager. Only deliveries from the last 90 days count, so old
--           history does not flood My Day. Checked on every change and daily at 05:40 SAST.
--   action  intake_results.review (Pass / Hold / Reject / Mark reviewed buttons).
--
-- Idempotent. Needs the task plumbing (20261027130000, 20261027140000, 20261028120000).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kernel_intake_reviews (
    kernel_id    uuid PRIMARY KEY REFERENCES public.kernel(id),
    decision     text NOT NULL CHECK (decision IN ('pass', 'hold', 'reject', 'reviewed')),
    note         text,
    moisture     numeric,
    pv           numeric,
    ffa          numeric,
    reviewed_by  uuid,
    reviewed_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kernel_intake_reviews ENABLE ROW LEVEL SECURITY;

-- A typed result as a number; anything unreadable counts as blank.
CREATE OR REPLACE FUNCTION public._safe_num(p text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
    RETURN NULLIF(btrim(p), '')::numeric;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

-- Same rule as _common.classifySpec (common.js): 'ok' | 'warn' | 'bad', or NULL (no value / no limits).
CREATE OR REPLACE FUNCTION public._spec_band(p_test_key text, p_value numeric)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT CASE
        WHEN p_value IS NULL OR s.green_limit IS NULL OR s.yellow_limit IS NULL THEN NULL
        WHEN s.direction = 'min' THEN CASE WHEN p_value >= s.green_limit THEN 'ok' WHEN p_value >= s.yellow_limit THEN 'warn' ELSE 'bad' END
        ELSE CASE WHEN p_value <= s.green_limit THEN 'ok' WHEN p_value <= s.yellow_limit THEN 'warn' ELSE 'bad' END
    END
    FROM (SELECT p_test_key AS k) x
    LEFT JOIN public.sample_spec_thresholds s ON s.test_key = x.k;
$$;

CREATE OR REPLACE FUNCTION public._fmt_num2(p numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(p, 'FM999G990D00'); $$;

-- Everything about one delivery's intake results, in one place (used by the page and the tasks).
CREATE OR REPLACE FUNCTION public._kernel_intake_lab(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    k        public.kernel%ROWTYPE;
    z        jsonb;
    rv       public.kernel_intake_reviews%ROWTYPE;
    t        record;
    v_val    numeric;
    v_band   text;
    v_tests  jsonb := '[]'::jsonb;
    v_fail   text[] := '{}';
    v_marg   text[] := '{}';
    v_miss   text[] := '{}';
    v_vals   jsonb := '{}'::jsonb;
    v_auto   text;
    v_cur    boolean := false;
    v_out    text;
BEGIN
    SELECT * INTO k FROM public.kernel WHERE id = p_kernel_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    z := COALESCE(k.intake_data -> 'ziplock_sample', '{}'::jsonb);

    FOR t IN
        SELECT * FROM (VALUES (1, 'moisture', 'moisture', 'Moisture', '%'),
                              (2, 'pv', 'peroxide', 'PV', ''),
                              (3, 'ffa', 'ffa', 'FFA', '%')) AS x(ord, test_key, field, label, unit)
        ORDER BY ord
    LOOP
        v_val := public._safe_num(z ->> (t.field || '_result'));
        v_band := public._spec_band(t.test_key, v_val);
        v_vals := v_vals || jsonb_build_object(t.test_key, v_val);
        IF v_val IS NULL THEN v_miss := v_miss || t.label::text; END IF;
        IF v_band = 'bad' THEN
            v_fail := v_fail || (SELECT t.label || ' ' || public._fmt_num2(v_val) || t.unit || ' overspec ('
                || CASE WHEN s.direction = 'min' THEN 'below ' ELSE 'above ' END
                || public._fmt_num2(s.yellow_limit) || t.unit || ')'
                FROM public.sample_spec_thresholds s WHERE s.test_key = t.test_key);
        ELSIF v_band = 'warn' THEN
            v_marg := v_marg || (t.label || ' ' || public._fmt_num2(v_val) || t.unit || ' marginal');
        END IF;
        v_tests := v_tests || jsonb_build_object(
            'key', t.test_key, 'label', t.label, 'unit', t.unit, 'value', v_val, 'band', v_band,
            'required', z -> (t.field || '_required'),
            'limits', (SELECT jsonb_build_object('direction', s.direction, 'green', s.green_limit, 'yellow', s.yellow_limit)
                       FROM public.sample_spec_thresholds s WHERE s.test_key = t.test_key));
    END LOOP;

    v_auto := CASE WHEN cardinality(v_fail) > 0 THEN 'fail'
                   WHEN cardinality(v_miss) = 3 THEN 'none'
                   ELSE 'pass' END;

    SELECT * INTO rv FROM public.kernel_intake_reviews WHERE kernel_id = p_kernel_id;
    IF FOUND THEN
        v_cur := rv.moisture IS NOT DISTINCT FROM (v_vals ->> 'moisture')::numeric
             AND rv.pv IS NOT DISTINCT FROM (v_vals ->> 'pv')::numeric
             AND rv.ffa IS NOT DISTINCT FROM (v_vals ->> 'ffa')::numeric;
    END IF;

    v_out := CASE WHEN v_cur AND rv.decision IN ('pass', 'hold', 'reject') THEN rv.decision ELSE v_auto END;

    RETURN jsonb_build_object(
        'kernel_id', k.id, 'status', k.status,
        'tests', v_tests, 'values', v_vals,
        'missing', to_jsonb(v_miss), 'fail_reasons', to_jsonb(v_fail), 'marginal', to_jsonb(v_marg),
        'auto_result', v_auto,
        'overspec', EXISTS (SELECT 1 FROM jsonb_array_elements(v_tests) e
                            WHERE e ->> 'key' IN ('pv', 'ffa') AND e ->> 'band' = 'bad'),
        'review', CASE WHEN rv.kernel_id IS NULL THEN NULL ELSE jsonb_build_object(
            'decision', rv.decision, 'note', rv.note, 'at', rv.reviewed_at, 'by', rv.reviewed_by,
            'by_name', (SELECT COALESCE(NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email)
                        FROM public.users u WHERE u.id = rv.reviewed_by),
            'values', jsonb_build_object('moisture', rv.moisture, 'pv', rv.pv, 'ffa', rv.ffa),
            'current', v_cur) END,
        'outcome', v_out);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_kernel_intake_lab(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT CASE WHEN x IS NULL THEN jsonb_build_object('success', false, 'error', 'Delivery not found.')
                ELSE x || jsonb_build_object('success', true) END
    FROM (SELECT public._kernel_intake_lab(p_kernel_id) AS x) s;
$$;

CREATE OR REPLACE FUNCTION public.review_kernel_intake_results(
    p_kernel_id uuid, p_decision text, p_note text DEFAULT NULL, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_lab  jsonb;
    v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
    IF p_decision NOT IN ('pass', 'hold', 'reject', 'reviewed') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pick Pass, Hold, Reject or Mark reviewed.');
    END IF;
    IF p_decision IN ('hold', 'reject') AND v_note IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Say why it is on hold or rejected.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kernel WHERE id = p_kernel_id AND is_active) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery not found.');
    END IF;
    v_lab := public._kernel_intake_lab(p_kernel_id);
    IF v_lab ->> 'auto_result' = 'none' THEN
        RETURN jsonb_build_object('success', false, 'error', 'There are no results to review yet.');
    END IF;

    INSERT INTO public.kernel_intake_reviews (kernel_id, decision, note, moisture, pv, ffa, reviewed_by, reviewed_at)
    VALUES (p_kernel_id, p_decision, v_note,
            (v_lab #>> '{values,moisture}')::numeric, (v_lab #>> '{values,pv}')::numeric, (v_lab #>> '{values,ffa}')::numeric,
            p_user_id, now())
    ON CONFLICT (kernel_id) DO UPDATE SET
        decision = EXCLUDED.decision, note = EXCLUDED.note, moisture = EXCLUDED.moisture, pv = EXCLUDED.pv,
        ffa = EXCLUDED.ffa, reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at;

    RETURN public._kernel_intake_lab(p_kernel_id) || jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- My Day tasks.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active) VALUES
    ('task-intake-results-missing', 'Tasks: moisture, PV & FFA to capture',
     'Gets a My Day task for each delivery still at intake that is missing its moisture, PV or FFA result.', true),
    ('task-intake-results-overspec', 'Tasks: PV / FFA overspec review',
     'Gets a My Day task when a delivery''s PV or FFA is over spec (red), until someone marks it reviewed.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

CREATE OR REPLACE FUNCTION public._kernel_intake_lab_tasks(p_kernel_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    k       public.kernel%ROWTYPE;
    v_lab   jsonb;
    v_batch text;
    v_title text;
    v_recv  date;
    v_today date := public._sast_today();
    v_miss  text[];
    v_when  text;
    v_id    uuid;
    v_in    boolean;
BEGIN
    SELECT * INTO k FROM public.kernel WHERE id = p_kernel_id;
    v_in := FOUND AND k.is_active AND k.created_at >= now() - interval '90 days';

    IF v_in THEN
        v_lab := public._kernel_intake_lab(p_kernel_id);
        SELECT b.batch_id INTO v_batch FROM public.batches b WHERE b.id = k.batch_id;
        v_title := COALESCE(v_batch, 'Delivery') || COALESCE(' · ' || NULLIF(btrim(k.grower_name), ''), '');
        v_recv := (COALESCE((k.intake_data #>> '{delivery,saved_at}')::timestamptz, k.created_at) AT TIME ZONE 'Africa/Johannesburg')::date;
        v_when := 'received ' || public._fmt_day(v_recv) || ' (' ||
                  CASE WHEN v_today - v_recv <= 0 THEN 'today' WHEN v_today - v_recv = 1 THEN 'yesterday'
                       ELSE (v_today - v_recv) || ' days ago' END || ')';
    END IF;

    -- Results to capture: still at intake and any of the three blank.
    IF v_in AND k.status IN ('intake', 'receiving') AND jsonb_array_length(v_lab -> 'missing') > 0 THEN
        SELECT array_agg(x) INTO v_miss FROM jsonb_array_elements_text(v_lab -> 'missing') x;
        v_id := public._open_task('intake_results_missing', 'lab_missing:' || p_kernel_id, v_title,
            CASE WHEN cardinality(v_miss) = 1 THEN v_miss[1]
                 ELSE array_to_string(v_miss[1:cardinality(v_miss) - 1], ', ') || ' and ' || v_miss[cardinality(v_miss)] END
            || ' outstanding · ' || v_when,
            'kernel', p_kernel_id);
        UPDATE public.workflow_tasks SET kernel_id = p_kernel_id WHERE id = v_id AND kernel_id IS NULL;
    ELSE
        PERFORM public._close_tasks('intake_results_missing', 'lab_missing:' || p_kernel_id);
    END IF;

    -- Overspec review: PV or FFA red, not complete, and no review given for these values.
    IF v_in AND k.status <> 'complete' AND (v_lab ->> 'overspec')::boolean
       AND NOT COALESCE((v_lab #>> '{review,current}')::boolean, false) THEN
        v_id := public._open_task('intake_results_overspec', 'lab_overspec:' || p_kernel_id, v_title,
            array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_lab -> 'fail_reasons')), ' · ')
            || CASE WHEN jsonb_typeof(v_lab -> 'review') = 'object' THEN ' · the results changed since the last review' ELSE '' END
            || ' · ' || v_when,
            'kernel', p_kernel_id);
        UPDATE public.workflow_tasks SET kernel_id = p_kernel_id WHERE id = v_id AND kernel_id IS NULL;
    ELSE
        PERFORM public._close_tasks('intake_results_overspec', 'lab_overspec:' || p_kernel_id);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_intake_lab_task_checks()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r   record;
    v_n integer := 0;
BEGIN
    FOR r IN
        SELECT id FROM public.kernel WHERE is_active AND created_at >= now() - interval '90 days'
        UNION
        SELECT kernel_id FROM public.workflow_tasks
        WHERE kind IN ('intake_results_missing', 'intake_results_overspec') AND status NOT IN ('completed', 'dismissed')
          AND kernel_id IS NOT NULL
        LIMIT 5000
    LOOP
        PERFORM public._kernel_intake_lab_tasks(r.id);
        v_n := v_n + 1;
    END LOOP;
    RETURN jsonb_build_object('success', true, 'deliveries_checked', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_kernel_intake_lab_tasks()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public._kernel_intake_lab_tasks(NEW.kernel_id);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_kernel_row_lab_tasks()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public._kernel_intake_lab_tasks(NEW.id);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_spec_limits_lab_tasks()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.run_intake_lab_task_checks();
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_intake_lab_tasks
    AFTER INSERT OR UPDATE OF intake_data, status, is_active ON public.kernel
    FOR EACH ROW EXECUTE FUNCTION public._trg_kernel_row_lab_tasks();

CREATE OR REPLACE TRIGGER kernel_intake_review_tasks
    AFTER INSERT OR UPDATE ON public.kernel_intake_reviews
    FOR EACH ROW EXECUTE FUNCTION public._trg_kernel_intake_lab_tasks();

CREATE OR REPLACE TRIGGER spec_limits_lab_tasks
    AFTER INSERT OR UPDATE ON public.sample_spec_thresholds
    FOR EACH STATEMENT EXECUTE FUNCTION public._trg_spec_limits_lab_tasks();

-- Daily, so "2 days ago" counts up and deliveries older than 90 days drop out. 03:40 UTC = 05:40 SAST.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'intake-lab-task-checks') THEN
        PERFORM cron.unschedule('intake-lab-task-checks');
    END IF;
    PERFORM cron.schedule('intake-lab-task-checks', '40 3 * * *', 'SELECT public.run_intake_lab_task_checks()');
END $$;

-- Switches: MacView gives these to Food Safety; our nearest roles are Quality Assurance, Factory
-- Manager and Production Manager. Change them in Role Features.
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE f.key IN ('task-intake-results-missing', 'task-intake-results-overspec')
  AND r.role_name IN ('Quality Assurance', 'Factory Manager', 'Production Manager')
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

-- Buttons: Pass / Hold / Reject / Mark reviewed.
INSERT INTO public.actions (key, module, label, description) VALUES
    ('intake_results.review', 'Find a batch', 'Review intake lab results',
     'Mark a delivery''s moisture, PV and FFA results as reviewed, or decide Pass, Hold or Reject')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.actions a
JOIN public.roles r ON r.role_name IN ('super_user', 'admin', 'Quality Assurance', 'Factory Manager', 'Production Manager', 'Sales Exec')
WHERE a.key = 'intake_results.review'
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

-- ----------------------------------------------------------------------------
-- Grants.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._kernel_intake_lab(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kernel_intake_lab_tasks(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_intake_lab_task_checks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_kernel_intake_lab_tasks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_kernel_row_lab_tasks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_spec_limits_lab_tasks() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_kernel_intake_lab(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_kernel_intake_results(uuid, text, text, uuid) TO anon, authenticated, service_role;

-- API layer: read for every role that can open a batch page; review for roles that hold the action.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', 'get_kernel_intake_lab', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'get_kernel_batch_detail' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = 'get_kernel_intake_lab' AND x.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', 'review_kernel_intake_results', 'EXECUTE', true
FROM public.roles r
WHERE r.role_name IN ('super_user', 'admin', 'Quality Assurance', 'Factory Manager', 'Production Manager', 'Sales Exec')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = r.id AND x.object_type = 'function' AND x.object_name = 'review_kernel_intake_results' AND x.operation = 'EXECUTE');

SELECT public.run_intake_lab_task_checks();

NOTIFY pgrst, 'reload schema';
