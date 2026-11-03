-- ============================================================================
-- Nut in shell: estimated bag weights at New delivery, real weights at the silo.
--
-- WHY. Mike (2 Nov 2026): the bags are not weighed when a truck comes in, only just before they
-- go into a silo, so New delivery (which needed a weight on every bag) was being skipped and the
-- stock went missing. Mockup: claude.ai/artifact/S4tATiP7sdv3pwKFVgRmSD. His rule: supplier's
-- weight / number of bags = average bag weight. Every bag not weighed gets the average, marked
-- estimated; its real weight is typed in when it goes into a silo. Henry: make it a setting,
-- because the client keeps changing their mind.
--
--   setting   kernel_pipeline_settings 'bag_weighing' = {"where": "intake"|"silo",
--             "silo_unweighed": "allow"|"block"}. intake = every bag weighed at New delivery
--             (the old rule); silo = estimates allowed at New delivery. Default silo + allow.
--   bags      kernel.intake_data.delivery.bags[] may carry "estimated": true. Weighed at the silo
--             later: weight_kg = real, estimated false, estimate_kg = the old figure,
--             weighed_at = 'silo', weighed_on = timestamp.
--   RPCs      save_kernel_delivery refuses estimated bags when where = intake;
--             allocate_bags_to_silo_weighed (new) = allocate_bags_to_silo + the real weights;
--             get_intake_bag_overview / get_silo_allocation_batches return each bag's est flag.
--
-- Storage ledger: a bag goes INTO storage at its estimate, so it must come OUT at the same
-- figure or the area keeps a few kg of ghost stock. allocate_bags_to_silo_weighed therefore
-- allocates first (the storage trigger writes the 'out' row at the estimate) and only then
-- puts the real weight on the silo row and the bag.
-- ============================================================================

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('bag_weighing', '{"where": "silo", "silo_unweighed": "allow"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._bag_weighing_setting()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT '{"where": "silo", "silo_unweighed": "allow"}'::jsonb
           || COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'bag_weighing'), '{}'::jsonb);
$$;

-- ----------------------------------------------------------------------------
-- Settings: the new key (everything else as 20261013110000).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_kernel_pipeline_setting(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    WHEN 'bag_weighing' THEN
        IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
           OR COALESCE(p_value->>'where', '') NOT IN ('intake', 'silo')
           OR COALESCE(p_value->>'silo_unweighed', '') NOT IN ('allow', 'block') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Choose where bags are weighed, and what happens to an unweighed bag at the silo.');
        END IF;
        p_value := jsonb_build_object('where', p_value->>'where', 'silo_unweighed', p_value->>'silo_unweighed');

    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Unknown setting: ' || COALESCE(p_key, 'null'));
    END CASE;

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at)
    VALUES (p_key, p_value, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- New delivery: estimated bags only when the setting allows them (else as before).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_kernel_delivery(
    p_kernel_id uuid, p_bags jsonb DEFAULT '[]'::jsonb, p_transport jsonb DEFAULT '{}'::jsonb,
    p_documents jsonb DEFAULT '[]'::jsonb, p_allow_replace boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bags      jsonb := COALESCE(p_bags, '[]'::jsonb);
    v_total     numeric;
    v_max_no    integer;
    v_prev_next integer;
    v_delivery  jsonb;
BEGIN
    IF jsonb_typeof(v_bags) <> 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bags must be a list');
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_bags) b
        WHERE (b ->> 'no') IS NULL OR (b ->> 'no') !~ '^[0-9]+$'
           OR (b ->> 'weight_kg') IS NULL OR (b ->> 'weight_kg') !~ '^[0-9]+(\.[0-9]+)?$'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Every bag needs a number and a weight (kg).');
    END IF;
    IF (SELECT count(*) <> count(DISTINCT (b ->> 'no')::int) FROM jsonb_array_elements(v_bags) b) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bag numbers must be unique.');
    END IF;
    IF public._bag_weighing_setting() ->> 'where' = 'intake' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_bags) b WHERE COALESCE((b ->> 'estimated')::boolean, false)) THEN
        RETURN jsonb_build_object('success', false, 'error',
            'Every bag must be weighed at New delivery (Kernel Pipeline Settings). Type each bag''s weight.');
    END IF;

    SELECT COALESCE(sum((b ->> 'weight_kg')::numeric), 0), COALESCE(max((b ->> 'no')::int), 0)
    INTO v_total, v_max_no
    FROM jsonb_array_elements(v_bags) b;

    SELECT COALESCE((intake_data #>> '{delivery,next_bag_no}')::int, 1)
    INTO v_prev_next
    FROM public.kernel WHERE id = p_kernel_id AND is_active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;
    IF NOT COALESCE(p_allow_replace, false) AND EXISTS (
        SELECT 1 FROM public.kernel WHERE id = p_kernel_id AND intake_data ? 'delivery') THEN
        RETURN jsonb_build_object('success', false, 'already_has_delivery', true,
            'error', 'This batch number already has a delivery recorded. Use a different batch number.');
    END IF;

    v_delivery := jsonb_build_object(
        'bags',        v_bags,
        'transport',   COALESCE(p_transport, '{}'::jsonb),
        'documents',   COALESCE(p_documents, '[]'::jsonb),
        'next_bag_no', GREATEST(v_prev_next, v_max_no + 1),
        'saved_at',    now()
    );

    UPDATE public.kernel
    SET intake_data       = jsonb_set(COALESCE(intake_data, '{}'::jsonb), ARRAY['delivery'], v_delivery, true),
        actual_wet_nis_kg = CASE WHEN jsonb_array_length(v_bags) > 0 THEN v_total ELSE actual_wet_nis_kg END,
        updated_at        = now()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'weighed_total_kg', v_total,
                              'bag_count', jsonb_array_length(v_bags), 'next_bag_no', v_delivery -> 'next_bag_no');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ----------------------------------------------------------------------------
-- Silos: allocate with real weights. p_weights = {"<bag no>": kg, ...} for the bags weighed now.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_bags_to_silo_weighed(
    p_kernel_id uuid, p_bag_nos integer[], p_silo_number integer,
    p_removed_pre_sizer_kg numeric, p_weights jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_w       jsonb := COALESCE(p_weights, '{}'::jsonb);
    v_res     jsonb;
    v_missing text;
    v_bad     text;
    v_into    numeric;
BEGIN
    IF jsonb_typeof(v_w) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Weights must be a list of bag numbers and kg.');
    END IF;
    SELECT string_agg(key, ', ') INTO v_bad
    FROM jsonb_each_text(v_w)
    WHERE key !~ '^[0-9]+$' OR NOT (key::int = ANY (p_bag_nos))
       OR value !~ '^[0-9]+(\.[0-9]+)?$' OR value::numeric <= 0;
    IF v_bad IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Check the weight of bag ' || v_bad || '.');
    END IF;

    IF public._bag_weighing_setting() ->> 'silo_unweighed' = 'block' THEN
        SELECT string_agg(bag ->> 'no', ', ' ORDER BY (bag ->> 'no')::int) INTO v_missing
        FROM public.kernel k, jsonb_array_elements(k.intake_data #> '{delivery,bags}') bag
        WHERE k.id = p_kernel_id AND (bag ->> 'no')::int = ANY (p_bag_nos)
          AND COALESCE((bag ->> 'estimated')::boolean, false)
          AND NOT v_w ? (bag ->> 'no');
        IF v_missing IS NOT NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Weigh bag ' || v_missing || ' before it goes into the silo.');
        END IF;
    END IF;

    -- At the estimate first, so the storage area is emptied by exactly what went in.
    v_res := public.allocate_bags_to_silo(p_kernel_id, p_bag_nos, p_silo_number, p_removed_pre_sizer_kg);
    IF NOT COALESCE((v_res ->> 'success')::boolean, false) OR v_w = '{}'::jsonb THEN
        RETURN v_res;
    END IF;

    UPDATE public.silo_allocations a
       SET weight_kg = (v_w ->> a.bag_no::text)::numeric,
           remaining_kg = GREATEST((v_w ->> a.bag_no::text)::numeric - a.presizer_kg, 0),
           updated_at = now()
     WHERE a.kernel_id = p_kernel_id AND a.status = 'in_silo' AND v_w ? a.bag_no::text
       AND a.bag_no = ANY (p_bag_nos);

    UPDATE public.kernel k
       SET intake_data = jsonb_set(k.intake_data, '{delivery,bags}', (
               SELECT jsonb_agg(CASE WHEN v_w ? (bag ->> 'no')
                                     THEN bag || jsonb_build_object(
                                              'weight_kg', (v_w ->> (bag ->> 'no'))::numeric,
                                              'estimated', false,
                                              'weighed_at', 'silo',
                                              'weighed_on', now())
                                          || CASE WHEN COALESCE((bag ->> 'estimated')::boolean, false)
                                                  THEN jsonb_build_object('estimate_kg', (bag ->> 'weight_kg')::numeric)
                                                  ELSE '{}'::jsonb END
                                     ELSE bag END ORDER BY ord)
               FROM jsonb_array_elements(k.intake_data #> '{delivery,bags}') WITH ORDINALITY AS t(bag, ord))),
           updated_at = now()
     WHERE k.id = p_kernel_id;

    UPDATE public.kernel k
       SET actual_wet_nis_kg = (SELECT sum((bag ->> 'weight_kg')::numeric)
                                FROM jsonb_array_elements(k.intake_data #> '{delivery,bags}') bag)
     WHERE k.id = p_kernel_id;

    SELECT sum(a.weight_kg - a.presizer_kg) INTO v_into
    FROM public.silo_allocations a
    WHERE a.kernel_id = p_kernel_id AND a.bag_no = ANY (p_bag_nos) AND a.status = 'in_silo';

    RETURN v_res || jsonb_build_object('weighed', (SELECT count(*) FROM jsonb_object_keys(v_w)), 'into_silo_kg', v_into);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_bags_to_silo_weighed(uuid, integer[], integer, numeric, jsonb) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._bag_weighing_setting() FROM PUBLIC, anon, authenticated;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id, 'function', 'allocate_bags_to_silo_weighed', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'allocate_bags_to_silo' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = rp.role_id AND x.object_type = 'function'
                    AND x.object_name = 'allocate_bags_to_silo_weighed' AND x.operation = 'EXECUTE');

-- ----------------------------------------------------------------------------
-- Reads: each bag's estimated flag.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_silo_allocation_batches()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'batches', COALESCE(jsonb_agg(t.x ORDER BY t.x ->> 'received_date' DESC, t.x ->> 'batch_number'), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'kernel_id',      k.id,
            'batch_number',   b.batch_id,
            'grower_name',    k.grower_name,
            'received_date',  k.received_date,
            'waiting_count',  z.waiting,
            'in_silo_count',  z.in_silo,
            'bags',           z.bags
        ) AS x
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        CROSS JOIN LATERAL (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'no',          (bag ->> 'no')::int,
                       'description', bag ->> 'description',
                       'weight_kg',   (bag ->> 'weight_kg')::numeric,
                       'estimated',   COALESCE((bag ->> 'estimated')::boolean, false),
                       'silo_number', a.silo_number,
                       'status',      a.status) ORDER BY (bag ->> 'no')::int), '[]'::jsonb) AS bags,
                   count(*) FILTER (WHERE a.id IS NULL)          AS waiting,
                   count(*) FILTER (WHERE a.status = 'in_silo')  AS in_silo
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(k.intake_data #> '{delivery,bags}') = 'array'
                                           THEN k.intake_data #> '{delivery,bags}' ELSE '[]'::jsonb END) bag
            LEFT JOIN public.silo_allocations a
                   ON a.kernel_id = k.id AND a.bag_no = (bag ->> 'no')::int AND a.status <> 'removed'
        ) z
        WHERE k.is_active
          AND k.status = 'production'
          AND jsonb_typeof(k.intake_data #> '{delivery,bags}') = 'array'
          AND jsonb_array_length(k.intake_data #> '{delivery,bags}') > 0
          AND (z.waiting > 0 OR z.in_silo > 0)
    ) t;
$$;

CREATE OR REPLACE FUNCTION public.get_intake_bag_overview(p_limit integer DEFAULT 300)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'success', true,
        'bag_weighing', public._bag_weighing_setting(),
        'areas', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label,
                                                'capacity_kg', a.capacity_kg) ORDER BY a.display_order, a.code)
            FROM (SELECT * FROM public.nis_storage_areas WHERE is_active ORDER BY display_order LIMIT 50) a), '[]'::jsonb),
        'batches', COALESCE((
            SELECT jsonb_agg(x.row ORDER BY x.received_date DESC NULLS LAST)
            FROM (
                SELECT k.received_date,
                       jsonb_build_object(
                           'kernel_id', k.id,
                           'batch_number', b.batch_id,
                           'grower_name', k.grower_name,
                           'status', k.status,
                           'received_date', k.received_date,
                           'wet_nis_received_kg', k.wet_nis_received_kg,
                           'actual_wet_nis_kg', k.actual_wet_nis_kg,
                           'bags', COALESCE((
                               SELECT jsonb_agg(jsonb_build_object(
                                          'no', w.bag_no,
                                          'kg', w.weight_kg,
                                          'est', COALESCE((e.bag ->> 'estimated')::boolean, false),
                                          'at', CASE WHEN e.bag ->> 'weighed_at' = 'silo' THEN 'silo' END,
                                          'est_kg', NULLIF(e.bag ->> 'estimate_kg', '')::numeric,
                                          'loc', CASE WHEN s.status = 'cracked' THEN 'cracked'
                                                      WHEN s.status IS NOT NULL THEN 'silo:' || s.silo_number
                                                      ELSE COALESCE(l.area_code, '') END)
                                      ORDER BY w.bag_no)
                               FROM public._nis_bag_weights(k.id) w
                               LEFT JOIN LATERAL (
                                   SELECT x.bag FROM jsonb_array_elements(k.intake_data #> '{delivery,bags}') x(bag)
                                   WHERE (x.bag ->> 'no') = w.bag_no::text LIMIT 1) e ON true
                               LEFT JOIN public.silo_allocations s
                                      ON s.kernel_id = k.id AND s.bag_no = w.bag_no AND s.status <> 'removed'
                               LEFT JOIN public.nis_bag_locations l
                                      ON l.kernel_id = k.id AND l.bag_no = w.bag_no), '[]'::jsonb)
                       ) AS row
                FROM public.kernel k
                JOIN public.batches b ON b.id = k.batch_id
                WHERE k.is_active IS NOT FALSE
                  AND k.status IN ('intake', 'receiving', 'production')
                ORDER BY k.received_date DESC NULLS LAST
                LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500)
            ) x), '[]'::jsonb),
        'movements', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', t.id, 'movement_type', t.movement_type, 'from_area', t.from_area, 'to_area', t.to_area,
                       'kg', t.kg, 'batch_number', t.batch_number, 'kernel_id', t.kernel_id,
                       'moved_at', t.moved_at, 'note', t.note, 'by_label', t.by_label) ORDER BY t.moved_at DESC)
            FROM (
                SELECT m.id, m.movement_type, m.from_area, m.to_area, m.kg, m.batch_number, m.kernel_id, m.moved_at, m.note,
                       public.stock_history_user_label(m.created_by) AS by_label
                FROM public.nis_storage_movements m
                ORDER BY m.moved_at DESC
                LIMIT 50
            ) t), '[]'::jsonb)
    );
$$;

NOTIFY pgrst, 'reload schema';
