-- ============================================================================
-- "Needs attention" on the home dashboard (Mike's MacView alertsList, 27 Nov 2026).
--
-- WHY. MacView's home page has one list of things going wrong, each linking to the batch. The
-- portal has the pieces spread over several screens. This gathers them in ONE read, built on the
-- rules that already exist (no second copy of any of them):
--
--   MacView rule                          ours (source reused)
--   ------------------------------------  ----------------------------------------------------------
--   batch overspec / marginal             _kernel_intake_lab (20261127110000) fail_reasons / marginal
--                                         (sample_spec_thresholds, same rule as classifySpec)
--   lab fail / hold                       intake: a current manual Hold / Reject (kernel_intake_reviews)
--                                         finished: get_kernel_positive_release state failed /
--                                         needs_decision / rejected (20261111090000)
--   no lab result after 2+ days           _kernel_intake_lab missing, still at intake, received 2-60
--                                         days ago (MacView's window)
--   finished stock near best-before       get_kernel_batches best_before_date (job card, or packing
--                                         start + kernel_best_before_months) on batches with stock
--                                         left; within 60 days (MacView) or past
--   finished stock not yet released       status 'qa' (production finished, not transferred to stock)
--                                         with its positive-release state; at the lab past the
--                                         expected days is flagged as late
--   truck / load check problem            intake_data.receiving_checklist, the six questions of
--                                         modal_grower_receiving_checklist.js CHECKS; "No" to pallets
--                                         with a "no pallets" comment is not a problem
--   low recovery against target           get_kernel_batches sound_kernel_recovery_pct against the
--                                         Targets module 'sound_kernel_recovery_pct' (dashboard_targets)
--                                         minus 5 points (MacView: minSKR - 5); finished in the last
--                                         30 days. No target set = this check is skipped.
--
-- Severity: 'bad' (red), 'warn' (amber), 'info' (blue), as MacView. Window: deliveries from the last
-- 90 days that are not complete, so old history does not flood the list (same as the round-1 tasks).
--
-- Who sees it: action 'dashboard.needs_attention' (checked with hasAction at render time), on for
-- every role that runs the factory; not Shareholder. Change it in Role Actions.
-- Idempotent. Needs 20261111090000 and 20261127110000.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_needs_attention()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today   date := public._sast_today();
    v_items   jsonb := '[]'::jsonb;
    k         record;
    v_lab     jsonb;
    v_recv    date;
    v_days    int;
    v_name    text;
    v_miss    text[];
    v_rc      jsonb;
    v_probs   text[];
    c         record;
    v_ans     text;
    v_note    text;
    v_pr      jsonb;
    v_exp     int;
    p         jsonb;
    v_target  numeric;
    b         record;
    v_left    numeric;
    v_bbdays  int;
BEGIN
    -- ---------------------------------------------------------------- intake deliveries
    FOR k IN
        SELECT kk.id, kk.status, kk.grower_name, kk.intake_data, kk.created_at, kk.received_date, bb.batch_id AS batch_number
        FROM public.kernel kk
        JOIN public.batches bb ON bb.id = kk.batch_id
        WHERE kk.is_active AND kk.status <> 'complete'
          AND kk.created_at >= now() - interval '90 days'
    LOOP
        v_lab  := public._kernel_intake_lab(k.id);
        v_recv := COALESCE(k.received_date,
                  (COALESCE((k.intake_data #>> '{delivery,saved_at}')::timestamptz, k.created_at) AT TIME ZONE 'Africa/Johannesburg')::date);
        v_days := v_today - v_recv;
        v_name := COALESCE(' (' || NULLIF(btrim(k.grower_name), '') || ')', '');

        -- Manual decision on the intake results wins (round 1: a current Hold / Reject).
        IF v_lab ->> 'outcome' IN ('hold', 'reject') THEN
            v_items := v_items || jsonb_build_object('severity', 'bad', 'kind', 'lab_hold',
                'kernel_id', k.id, 'batch_number', k.batch_number, 'section', 'samples',
                'text', 'Batch ' || k.batch_number || v_name || ' is '
                    || CASE WHEN v_lab ->> 'outcome' = 'hold' THEN 'on hold' ELSE 'rejected' END
                    || ' after its intake lab results'
                    || COALESCE(': ' || NULLIF(v_lab #>> '{review,note}', ''), '') || '.');
        ELSIF jsonb_array_length(COALESCE(v_lab -> 'fail_reasons', '[]')) > 0 THEN
            v_items := v_items || jsonb_build_object('severity', 'bad', 'kind', 'overspec',
                'kernel_id', k.id, 'batch_number', k.batch_number, 'section', 'samples',
                'text', 'Batch ' || k.batch_number || v_name || ' is overspec: '
                    || array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_lab -> 'fail_reasons')), '; ')
                    || CASE WHEN COALESCE((v_lab #>> '{review,current}')::boolean, false)
                            THEN ' (reviewed)' ELSE '' END || '.');
        ELSIF jsonb_array_length(COALESCE(v_lab -> 'marginal', '[]')) > 0 THEN
            v_items := v_items || jsonb_build_object('severity', 'warn', 'kind', 'marginal',
                'kernel_id', k.id, 'batch_number', k.batch_number, 'section', 'samples',
                'text', 'Batch ' || k.batch_number || v_name || ' is marginal: '
                    || array_to_string(ARRAY(SELECT jsonb_array_elements_text(v_lab -> 'marginal')), '; ') || '.');
        END IF;

        -- No lab results yet, 2+ days after receiving (still at intake).
        IF k.status IN ('intake', 'receiving') AND v_days BETWEEN 2 AND 60
           AND jsonb_array_length(COALESCE(v_lab -> 'missing', '[]')) > 0 THEN
            SELECT array_agg(x) INTO v_miss FROM jsonb_array_elements_text(v_lab -> 'missing') x;
            v_items := v_items || jsonb_build_object('severity', 'warn', 'kind', 'lab_missing',
                'kernel_id', k.id, 'batch_number', k.batch_number, 'section', 'samples',
                'text', 'Batch ' || k.batch_number || v_name || ' received ' || v_days || ' days ago has '
                    || CASE WHEN cardinality(v_miss) = 3 THEN 'no sample lab results yet'
                            ELSE 'no ' || array_to_string(v_miss, ' or ') || ' result yet' END || '.');
        END IF;

        -- Truck / load checks on arrival (last 30 days).
        v_rc := k.intake_data -> 'receiving_checklist';
        IF jsonb_typeof(v_rc) = 'object' AND v_days <= 30 THEN
            v_probs := '{}';
            FOR c IN
                SELECT * FROM (VALUES
                    (1, 'vehicle_clean', 'Vehicle not clean', 'no'),
                    (2, 'vehicle_enclosed', 'Vehicle not fully enclosed', 'no'),
                    (3, 'hazard_substances', 'Hazardous substances on the truck', 'yes'),
                    (4, 'pest_infestations', 'Signs of pests', 'yes'),
                    (5, 'pallets_condition', 'Pallets not in good condition', 'no'),
                    (6, 'raw_materials_condition', 'Raw materials not in good condition', 'no')
                ) AS x(ord, key, label, bad) ORDER BY ord
            LOOP
                v_ans  := lower(btrim(COALESCE(v_rc ->> c.key, '')));
                v_note := NULLIF(btrim(COALESCE(v_rc #>> ARRAY['item_comments', c.key], '')), '');
                CONTINUE WHEN v_ans <> c.bad;
                CONTINUE WHEN c.key = 'pallets_condition' AND v_note ~* 'no\s*pallet';
                v_probs := v_probs || (c.label || COALESCE(' (' || v_note || ')', ''));
            END LOOP;
            IF cardinality(v_probs) > 0 THEN
                v_items := v_items || jsonb_build_object('severity', 'warn', 'kind', 'truck_check',
                    'kernel_id', k.id, 'batch_number', k.batch_number, 'section', NULL,
                    'text', 'Batch ' || k.batch_number || v_name || ': vehicle check problem: '
                        || array_to_string(v_probs, '; ') || '.');
            END IF;
        END IF;
    END LOOP;

    -- ---------------------------------------------------------------- finished, not released
    v_pr  := public.get_kernel_positive_release();
    v_exp := COALESCE((v_pr ->> 'expected_days')::int, 10);
    FOR k IN
        SELECT kk.id, kk.grower_name, bb.batch_id AS batch_number
        FROM public.kernel kk JOIN public.batches bb ON bb.id = kk.batch_id
        WHERE kk.is_active AND kk.status = 'qa'
    LOOP
        p := NULL;
        SELECT e INTO p FROM jsonb_array_elements(COALESCE(v_pr -> 'batches', '[]')) e
        WHERE e ->> 'kernel_id' = k.id::text LIMIT 1;
        v_name := COALESCE(' (' || NULLIF(btrim(k.grower_name), '') || ')', '');
        v_items := v_items || jsonb_build_object(
            'severity', CASE WHEN p ->> 'state' IN ('failed', 'needs_decision', 'rejected') THEN 'bad'
                             WHEN p ->> 'state' = 'at_lab' AND COALESCE((p ->> 'is_late')::boolean, false) THEN 'bad'
                             ELSE 'warn' END,
            'kind', CASE WHEN p ->> 'state' IN ('failed', 'needs_decision', 'rejected') THEN 'lab_fail' ELSE 'not_released' END,
            'kernel_id', k.id, 'batch_number', k.batch_number, 'section', NULL,
            'text', 'Finished batch ' || k.batch_number || v_name || ' ' ||
                CASE p ->> 'state'
                    WHEN 'failed' THEN 'failed its lab test (test ' || COALESCE(p ->> 'test_number', '1') || '): retest or decide.'
                    WHEN 'needs_decision' THEN 'failed its lab retest and needs a decision.'
                    WHEN 'rejected' THEN 'was rejected by the lab' || COALESCE(': ' || NULLIF(p ->> 'rejected_reason', ''), '') || '.'
                    WHEN 'at_lab' THEN 'is at the lab, ' || COALESCE(p ->> 'days_at_lab', '?') || ' working days'
                         || CASE WHEN COALESCE((p ->> 'is_late')::boolean, false)
                                 THEN ' (expected within ' || v_exp || '): chase the results.' ELSE '.' END
                    WHEN 'reprocessing' THEN 'is being reprocessed: redo the End sample.'
                    WHEN 'passed' THEN 'passed its lab tests and is waiting to be released to stock.'
                    ELSE 'is waiting for food safety release (no lab test captured yet).'
                END);
    END LOOP;

    -- ---------------------------------------------------------------- finished stock: best-before, recovery
    SELECT t.target_value INTO v_target FROM public.dashboard_targets t
    WHERE t.metric_key = 'sound_kernel_recovery_pct' AND COALESCE(t.effective_from, '-infinity'::date) <= v_today
    ORDER BY t.effective_from DESC NULLS LAST, t.updated_at DESC NULLS LAST LIMIT 1;

    FOR b IN SELECT * FROM public.get_kernel_batches('complete,qa', NULL, 2000, 0) LOOP
        IF b.status = 'complete' AND b.best_before_date IS NOT NULL THEN
            SELECT COALESCE(SUM((value)::numeric), 0) INTO v_left
            FROM jsonb_each_text(COALESCE(b.remaining_by_style, '{}'::jsonb))
            WHERE value ~ '^-?[0-9.]+$';
            v_bbdays := b.best_before_date - v_today;
            IF v_left > 0 AND v_bbdays <= 60 THEN
                v_items := v_items || jsonb_build_object(
                    'severity', CASE WHEN v_bbdays < 0 THEN 'bad' ELSE 'warn' END, 'kind', 'best_before',
                    'kernel_id', b.id, 'batch_number', b.batch_number, 'section', NULL,
                    'text', 'Finished batch ' || b.batch_number || ' (' || public._fmt_num2(v_left) || ' kg in stock) is '
                        || CASE WHEN v_bbdays < 0 THEN 'past' ELSE 'within 60 days of' END
                        || ' its best-before date (' || public._fmt_day(b.best_before_date) || ').');
            END IF;
        END IF;

        IF v_target IS NOT NULL AND b.sound_kernel_recovery_pct IS NOT NULL
           AND b.production_finished_at >= now() - interval '30 days'
           AND b.sound_kernel_recovery_pct < v_target - 5 THEN
            v_items := v_items || jsonb_build_object('severity', 'info', 'kind', 'low_recovery',
                'kernel_id', b.id, 'batch_number', b.batch_number, 'section', NULL,
                'text', 'Batch ' || b.batch_number || ' recovery was ' || to_char(b.sound_kernel_recovery_pct, 'FM990D0')
                    || '%, well below the ' || to_char(v_target, 'FM990D0') || '% target.');
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'today', v_today,
        'recovery_target', v_target,
        'items', COALESCE((
            SELECT jsonb_agg(e ORDER BY CASE e ->> 'severity' WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, e ->> 'batch_number')
            FROM jsonb_array_elements(v_items) e), '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_needs_attention() TO anon, authenticated, service_role;

-- Button-level switch: who sees the card.
INSERT INTO public.actions (key, module, label, description) VALUES
    ('dashboard.needs_attention', 'Dashboard', 'See "Needs attention"',
     'The home page list of batches that need attention: overspec, lab fails, missing results, best-before, not released, truck checks, low recovery')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.actions a
JOIN public.roles r ON r.role_name IN ('super_user', 'admin', 'Factory Manager', 'Production Manager', 'Quality Assurance',
                                       'Sales Exec', 'Palladium Manager', 'Procurement Lead')
WHERE a.key = 'dashboard.needs_attention'
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

-- API layer: the same roles.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', 'get_needs_attention', 'EXECUTE', true
FROM public.roles r
WHERE r.role_name IN ('super_user', 'admin', 'Factory Manager', 'Production Manager', 'Quality Assurance',
                      'Sales Exec', 'Palladium Manager', 'Procurement Lead')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = r.id AND x.object_type = 'function' AND x.object_name = 'get_needs_attention' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
