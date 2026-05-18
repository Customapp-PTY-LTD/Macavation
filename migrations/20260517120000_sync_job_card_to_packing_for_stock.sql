-- Job card is the published source for kernel stock on hand.
-- Production prefills job_card_data; saving the job card syncs packing_data for get_kernel_batches / dispatch.
-- When job_card has style quantities, get_kernel_batches prefers job card over summing legacy packing rows.

-- Parse sound_kernel_styles / butter_grade_styles whether stored as jsonb array or JSON string.
CREATE OR REPLACE FUNCTION public.kernel_job_card_styles_array(p_val jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_text text;
BEGIN
    IF p_val IS NULL OR p_val = 'null'::jsonb THEN
        RETURN '[]'::jsonb;
    END IF;
    IF jsonb_typeof(p_val) = 'array' THEN
        RETURN p_val;
    END IF;
    IF jsonb_typeof(p_val) = 'string' THEN
        v_text := p_val #>> '{}';
        IF v_text IS NULL OR btrim(v_text) = '' THEN
            RETURN '[]'::jsonb;
        END IF;
        BEGIN
            RETURN v_text::jsonb;
        EXCEPTION
            WHEN OTHERS THEN
                RETURN '[]'::jsonb;
        END;
    END IF;
    RETURN '[]'::jsonb;
END;
$$;

-- True when job card has at least one style line with cartons or kg.
CREATE OR REPLACE FUNCTION public.kernel_job_card_has_stock_quantities(p_job_card_data jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_row jsonb;
    v_cartons numeric;
    v_kg numeric;
BEGIN
    IF p_job_card_data IS NULL OR p_job_card_data = '{}'::jsonb OR p_job_card_data = 'null'::jsonb THEN
        RETURN false;
    END IF;

    FOR v_row IN
        SELECT value
        FROM jsonb_array_elements(public.kernel_job_card_styles_array(p_job_card_data -> 'sound_kernel_styles'))
    LOOP
        v_cartons := COALESCE(NULLIF(v_row ->> 'cartons', '')::numeric, 0);
        v_kg := COALESCE(NULLIF(v_row ->> 'weight_kg', '')::numeric, 0);
        IF v_cartons > 0 OR v_kg > 0 THEN
            RETURN true;
        END IF;
    END LOOP;

    FOR v_row IN
        SELECT value
        FROM jsonb_array_elements(public.kernel_job_card_styles_array(p_job_card_data -> 'butter_grade_styles'))
    LOOP
        v_cartons := COALESCE(NULLIF(v_row ->> 'cartons', '')::numeric, 0);
        v_kg := COALESCE(NULLIF(v_row ->> 'weight_kg', '')::numeric, 0);
        IF v_cartons > 0 OR v_kg > 0 THEN
            RETURN true;
        END IF;
    END LOOP;

    RETURN false;
END;
$$;

-- Build one packing_data row from job card (replaces packing_data array on sync).
CREATE OR REPLACE FUNCTION public.sync_kernel_job_card_to_packing_data(p_job_card_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_kg_per_carton constant numeric := 11.34;
    v_row jsonb;
    v_style text;
    v_cartons numeric;
    v_kg numeric;
    v_pack jsonb;
    v_date text;
    v_sk_cartons numeric := 0;
    v_sk_kg numeric := 0;
    v_bt_cartons numeric := 0;
    v_bt_kg numeric := 0;
BEGIN
    v_date := NULLIF(btrim(p_job_card_data ->> 'packing_completion_date'), '');
    IF v_date IS NULL THEN
        v_date := NULLIF(btrim(p_job_card_data ->> 'packing_start_date'), '');
    END IF;
    IF v_date IS NULL OR length(v_date) < 10 THEN
        v_date := current_date::text;
    ELSE
        v_date := left(v_date, 10);
    END IF;

    v_pack := jsonb_build_object(
        'date', v_date,
        'job_card_authoritative', true,
        'synced_from_job_card_at', to_jsonb(NOW()::text),
        'sk_sp_qty', 0, 'sk_sp_cartons', 0,
        'sk_0_qty', 0, 'sk_0_cartons', 0,
        'sk_1_qty', 0, 'sk_1_cartons', 0,
        'sk_1s_qty', 0, 'sk_1s_cartons', 0,
        'sk_4l_qty', 0, 'sk_4l_cartons', 0,
        'sk_5_qty', 0, 'sk_5_cartons', 0,
        'sk_6_qty', 0, 'sk_6_cartons', 0,
        'bt_78_qty', 0, 'bt_78_cartons', 0,
        'bt_high_qty', 0, 'bt_high_cartons', 0,
        'bt_low_qty', 0, 'bt_low_cartons', 0,
        'sk_total_cartons', 0, 'sk_total_qty', 0,
        'bt_total_cartons', 0, 'bt_total_qty', 0,
        'totals_cartons', 0, 'totals_qty', 0
    );

    FOR v_row IN
        SELECT value
        FROM jsonb_array_elements(public.kernel_job_card_styles_array(p_job_card_data -> 'sound_kernel_styles'))
    LOOP
        v_style := upper(btrim(COALESCE(v_row ->> 'style', '')));
        v_cartons := COALESCE(NULLIF(v_row ->> 'cartons', '')::numeric, 0);
        v_kg := COALESCE(NULLIF(v_row ->> 'weight_kg', '')::numeric, 0);
        IF v_kg <= 0 AND v_cartons > 0 THEN
            v_kg := round((v_cartons * v_kg_per_carton)::numeric, 2);
        END IF;
        IF v_cartons <= 0 AND v_kg > 0 THEN
            v_cartons := round((v_kg / v_kg_per_carton)::numeric, 2);
        END IF;
        IF v_cartons <= 0 AND v_kg <= 0 THEN
            CONTINUE;
        END IF;

        CASE v_style
            WHEN 'SP' THEN
                v_pack := jsonb_set(v_pack, '{sk_sp_cartons}', to_jsonb(v_cartons));
                v_pack := jsonb_set(v_pack, '{sk_sp_qty}', to_jsonb(v_kg));
            WHEN '0' THEN
                v_pack := jsonb_set(v_pack, '{sk_0_cartons}', to_jsonb(v_cartons));
                v_pack := jsonb_set(v_pack, '{sk_0_qty}', to_jsonb(v_kg));
            WHEN '1' THEN
                v_pack := jsonb_set(v_pack, '{sk_1_cartons}', to_jsonb(v_cartons));
                v_pack := jsonb_set(v_pack, '{sk_1_qty}', to_jsonb(v_kg));
            WHEN '1S' THEN
                v_pack := jsonb_set(v_pack, '{sk_1s_cartons}', to_jsonb(v_cartons));
                v_pack := jsonb_set(v_pack, '{sk_1s_qty}', to_jsonb(v_kg));
            WHEN '4L' THEN
                v_pack := jsonb_set(v_pack, '{sk_4l_cartons}', to_jsonb(v_cartons));
                v_pack := jsonb_set(v_pack, '{sk_4l_qty}', to_jsonb(v_kg));
            WHEN '5' THEN
                v_pack := jsonb_set(v_pack, '{sk_5_cartons}', to_jsonb(v_cartons));
                v_pack := jsonb_set(v_pack, '{sk_5_qty}', to_jsonb(v_kg));
            WHEN '6' THEN
                v_pack := jsonb_set(v_pack, '{sk_6_cartons}', to_jsonb(v_cartons));
                v_pack := jsonb_set(v_pack, '{sk_6_qty}', to_jsonb(v_kg));
            ELSE
                CONTINUE;
        END CASE;

        v_sk_cartons := v_sk_cartons + v_cartons;
        v_sk_kg := v_sk_kg + v_kg;
    END LOOP;

    FOR v_row IN
        SELECT value
        FROM jsonb_array_elements(public.kernel_job_card_styles_array(p_job_card_data -> 'butter_grade_styles'))
    LOOP
        v_style := upper(btrim(COALESCE(v_row ->> 'style', '')));
        v_cartons := COALESCE(NULLIF(v_row ->> 'cartons', '')::numeric, 0);
        v_kg := COALESCE(NULLIF(v_row ->> 'weight_kg', '')::numeric, 0);
        IF v_kg <= 0 AND v_cartons > 0 THEN
            v_kg := round((v_cartons * v_kg_per_carton)::numeric, 2);
        END IF;
        IF v_cartons <= 0 AND v_kg > 0 THEN
            v_cartons := round((v_kg / v_kg_per_carton)::numeric, 2);
        END IF;
        IF v_cartons <= 0 AND v_kg <= 0 THEN
            CONTINUE;
        END IF;

        IF v_style IN ('7/8', '78') THEN
            v_pack := jsonb_set(v_pack, '{bt_78_cartons}', to_jsonb(v_cartons));
            v_pack := jsonb_set(v_pack, '{bt_78_qty}', to_jsonb(v_kg));
        ELSIF v_style LIKE '%HIGH%' OR v_style LIKE '%FLOAT%' THEN
            v_pack := jsonb_set(v_pack, '{bt_high_cartons}', to_jsonb(v_cartons));
            v_pack := jsonb_set(v_pack, '{bt_high_qty}', to_jsonb(v_kg));
        ELSIF v_style LIKE '%LOW%' OR v_style LIKE '%SINK%' THEN
            v_pack := jsonb_set(v_pack, '{bt_low_cartons}', to_jsonb(v_cartons));
            v_pack := jsonb_set(v_pack, '{bt_low_qty}', to_jsonb(v_kg));
        ELSE
            CONTINUE;
        END IF;

        v_bt_cartons := v_bt_cartons + v_cartons;
        v_bt_kg := v_bt_kg + v_kg;
    END LOOP;

    v_pack := jsonb_set(v_pack, '{sk_total_cartons}', to_jsonb(v_sk_cartons));
    v_pack := jsonb_set(v_pack, '{sk_total_qty}', to_jsonb(round(v_sk_kg::numeric, 2)));
    v_pack := jsonb_set(v_pack, '{bt_total_cartons}', to_jsonb(v_bt_cartons));
    v_pack := jsonb_set(v_pack, '{bt_total_qty}', to_jsonb(round(v_bt_kg::numeric, 2)));
    v_pack := jsonb_set(v_pack, '{totals_cartons}', to_jsonb(v_sk_cartons + v_bt_cartons));
    v_pack := jsonb_set(v_pack, '{totals_qty}', to_jsonb(round((v_sk_kg + v_bt_kg)::numeric, 2)));

    RETURN jsonb_build_array(v_pack);
END;
$$;

-- Yield kg jsonb from job card (same keys as get_kernel_batches).
CREATE OR REPLACE FUNCTION public.kernel_yield_kg_from_job_card(p_job_card_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_elem jsonb;
BEGIN
    v_elem := public.sync_kernel_job_card_to_packing_data(p_job_card_data) -> 0;
    RETURN jsonb_build_object(
        'SP',              COALESCE(NULLIF(v_elem ->> 'sk_sp_qty', '')::numeric, 0),
        '0',               COALESCE(NULLIF(v_elem ->> 'sk_0_qty', '')::numeric, 0),
        '1',               COALESCE(NULLIF(v_elem ->> 'sk_1_qty', '')::numeric, 0),
        '1S',              COALESCE(NULLIF(v_elem ->> 'sk_1s_qty', '')::numeric, 0),
        '4L',              COALESCE(NULLIF(v_elem ->> 'sk_4l_qty', '')::numeric, 0),
        '5',               COALESCE(NULLIF(v_elem ->> 'sk_5_qty', '')::numeric, 0),
        '6',               COALESCE(NULLIF(v_elem ->> 'sk_6_qty', '')::numeric, 0),
        '7/8',             COALESCE(NULLIF(v_elem ->> 'bt_78_qty', '')::numeric, 0),
        'Butter High Oil', COALESCE(NULLIF(v_elem ->> 'bt_high_qty', '')::numeric, 0),
        'Butter Low Oil',  COALESCE(NULLIF(v_elem ->> 'bt_low_qty', '')::numeric, 0)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.kernel_yield_cartons_from_job_card(p_job_card_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_elem jsonb;
BEGIN
    v_elem := public.sync_kernel_job_card_to_packing_data(p_job_card_data) -> 0;
    RETURN jsonb_build_object(
        'SP',              COALESCE(NULLIF(v_elem ->> 'sk_sp_cartons', '')::numeric, 0),
        '0',               COALESCE(NULLIF(v_elem ->> 'sk_0_cartons', '')::numeric, 0),
        '1',               COALESCE(NULLIF(v_elem ->> 'sk_1_cartons', '')::numeric, 0),
        '1S',              COALESCE(NULLIF(v_elem ->> 'sk_1s_cartons', '')::numeric, 0),
        '4L',              COALESCE(NULLIF(v_elem ->> 'sk_4l_cartons', '')::numeric, 0),
        '5',               COALESCE(NULLIF(v_elem ->> 'sk_5_cartons', '')::numeric, 0),
        '6',               COALESCE(NULLIF(v_elem ->> 'sk_6_cartons', '')::numeric, 0),
        '7/8',             COALESCE(NULLIF(v_elem ->> 'bt_78_cartons', '')::numeric, 0),
        'Butter High Oil', COALESCE(NULLIF(v_elem ->> 'bt_high_cartons', '')::numeric, 0),
        'Butter Low Oil',  COALESCE(NULLIF(v_elem ->> 'bt_low_cartons', '')::numeric, 0)
    );
END;
$$;

COMMENT ON FUNCTION public.sync_kernel_job_card_to_packing_data(jsonb) IS
    'Builds a single packing_data row from job_card sound/butter style lines for stock on hand.';

-- upsert_kernel_job_card: persist job card and sync packing for stock.
DROP FUNCTION IF EXISTS public.upsert_kernel_job_card(uuid, jsonb, boolean, boolean);
DROP FUNCTION IF EXISTS public.upsert_kernel_job_card(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.upsert_kernel_job_card(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.upsert_kernel_job_card(
    p_kernel_id                     uuid,
    p_job_card_data                 jsonb,
    p_jobcard_approved              boolean DEFAULT NULL,
    p_finalize_without_production   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel
    SET
        job_card_data = p_job_card_data,
        packing_data = CASE
            WHEN public.kernel_job_card_has_stock_quantities(p_job_card_data)
                THEN public.sync_kernel_job_card_to_packing_data(p_job_card_data)
            ELSE packing_data
        END,
        jobcard_approved = CASE
            WHEN p_jobcard_approved IS TRUE THEN true
            WHEN p_finalize_without_production IS TRUE THEN true
            ELSE jobcard_approved
        END,
        production_finished_at = CASE
            WHEN p_finalize_without_production IS TRUE THEN COALESCE(production_finished_at, NOW())
            ELSE production_finished_at
        END,
        status = CASE
            WHEN p_finalize_without_production IS TRUE
                 AND COALESCE(status::text, '') NOT IN ('complete', 'dispatch', 'qa')
                THEN 'qa'::varchar
            ELSE status
        END,
        qa_data = CASE
            WHEN p_finalize_without_production IS TRUE
                 AND (qa_data IS NULL OR qa_data = '{}'::jsonb OR qa_data = 'null'::jsonb)
                THEN jsonb_build_object(
                    'job_card_only_release_ready', true,
                    'recorded_at', to_jsonb(NOW())
                )
            ELSE qa_data
        END,
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'finalized_without_production', COALESCE(p_finalize_without_production, false),
        'stock_synced', public.kernel_job_card_has_stock_quantities(p_job_card_data)
    );
END;
$$;

-- upsert_kernel_production: when job card payload included, sync packing from job card.
CREATE OR REPLACE FUNCTION public.upsert_kernel_production(
    p_kernel_id         uuid,
    p_day_index         integer  DEFAULT NULL,
    p_cracking_data     jsonb    DEFAULT NULL,
    p_washing_data      jsonb    DEFAULT NULL,
    p_sorting_data      jsonb    DEFAULT NULL,
    p_packing_data      jsonb    DEFAULT NULL,
    p_finish_production boolean  DEFAULT false,
    p_job_card_data     jsonb    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cracking jsonb;
    v_washing  jsonb;
    v_sorting  jsonb;
    v_packing  jsonb;
    v_status   varchar;
    v_date     text;
    v_found    boolean;
    v_i        integer;
    v_has_production_data boolean := false;
    v_keep_entry boolean;
    v_sync_packing jsonb;
BEGIN
    SELECT
        COALESCE(NULLIF(cracking_data, 'null'::jsonb), '[]'::jsonb),
        COALESCE(NULLIF(washing_data,  'null'::jsonb), '[]'::jsonb),
        COALESCE(NULLIF(sorting_data,  'null'::jsonb), '[]'::jsonb),
        COALESCE(NULLIF(packing_data,  'null'::jsonb), '[]'::jsonb),
        status
    INTO v_cracking, v_washing, v_sorting, v_packing, v_status
    FROM public.kernel
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    IF p_cracking_data IS NOT NULL THEN
        v_date := p_cracking_data ->> 'date';
        IF v_date IS NULL OR v_date = '' THEN
            RETURN jsonb_build_object('success', false, 'error', 'cracking_data must include a date field');
        END IF;
        v_keep_entry := (p_cracking_data - 'date') <> '{}'::jsonb;
        IF v_keep_entry THEN v_has_production_data := true; END IF;
        v_found := false;
        FOR v_i IN 0 .. jsonb_array_length(v_cracking) - 1 LOOP
            IF (v_cracking -> v_i ->> 'date') = v_date THEN
                IF v_keep_entry THEN
                    v_cracking := jsonb_set(v_cracking, ARRAY[v_i::text], p_cracking_data);
                ELSE
                    v_cracking := v_cracking - v_i;
                END IF;
                v_found := true;
                EXIT;
            END IF;
        END LOOP;
        IF NOT v_found AND v_keep_entry THEN
            v_cracking := v_cracking || jsonb_build_array(p_cracking_data);
        END IF;
    END IF;

    IF p_washing_data IS NOT NULL THEN
        v_date := p_washing_data ->> 'date';
        IF v_date IS NOT NULL AND v_date <> '' THEN
            v_keep_entry := (p_washing_data - 'date') <> '{}'::jsonb;
            IF v_keep_entry THEN v_has_production_data := true; END IF;
            v_found := false;
            FOR v_i IN 0 .. jsonb_array_length(v_washing) - 1 LOOP
                IF (v_washing -> v_i ->> 'date') = v_date THEN
                    IF v_keep_entry THEN
                        v_washing := jsonb_set(v_washing, ARRAY[v_i::text], p_washing_data);
                    ELSE
                        v_washing := v_washing - v_i;
                    END IF;
                    v_found := true;
                    EXIT;
                END IF;
            END LOOP;
            IF NOT v_found AND v_keep_entry THEN
                v_washing := v_washing || jsonb_build_array(p_washing_data);
            END IF;
        END IF;
    END IF;

    IF p_sorting_data IS NOT NULL THEN
        v_date := p_sorting_data ->> 'date';
        IF v_date IS NOT NULL AND v_date <> '' THEN
            v_keep_entry := (p_sorting_data - 'date') <> '{}'::jsonb;
            IF v_keep_entry THEN v_has_production_data := true; END IF;
            v_found := false;
            FOR v_i IN 0 .. jsonb_array_length(v_sorting) - 1 LOOP
                IF (v_sorting -> v_i ->> 'date') = v_date THEN
                    IF v_keep_entry THEN
                        v_sorting := jsonb_set(v_sorting, ARRAY[v_i::text], p_sorting_data);
                    ELSE
                        v_sorting := v_sorting - v_i;
                    END IF;
                    v_found := true;
                    EXIT;
                END IF;
            END LOOP;
            IF NOT v_found AND v_keep_entry THEN
                v_sorting := v_sorting || jsonb_build_array(p_sorting_data);
            END IF;
        END IF;
    END IF;

    IF p_packing_data IS NOT NULL THEN
        v_date := p_packing_data ->> 'date';
        IF v_date IS NOT NULL AND v_date <> '' THEN
            v_keep_entry := (p_packing_data - 'date') <> '{}'::jsonb;
            IF v_keep_entry THEN v_has_production_data := true; END IF;
            v_found := false;
            FOR v_i IN 0 .. jsonb_array_length(v_packing) - 1 LOOP
                IF (v_packing -> v_i ->> 'date') = v_date THEN
                    IF v_keep_entry THEN
                        v_packing := jsonb_set(v_packing, ARRAY[v_i::text], p_packing_data);
                    ELSE
                        v_packing := v_packing - v_i;
                    END IF;
                    v_found := true;
                    EXIT;
                END IF;
            END LOOP;
            IF NOT v_found AND v_keep_entry THEN
                v_packing := v_packing || jsonb_build_array(p_packing_data);
            END IF;
        END IF;
    END IF;

    v_sync_packing := NULL;
    IF p_job_card_data IS NOT NULL AND public.kernel_job_card_has_stock_quantities(p_job_card_data) THEN
        v_sync_packing := public.sync_kernel_job_card_to_packing_data(p_job_card_data);
    END IF;

    UPDATE public.kernel
    SET
        cracking_data = CASE WHEN p_cracking_data IS NOT NULL THEN v_cracking ELSE cracking_data END,
        washing_data = CASE WHEN p_washing_data IS NOT NULL
                                 AND (p_washing_data ->> 'date') IS NOT NULL
                                 AND (p_washing_data ->> 'date') <> ''
                            THEN v_washing ELSE washing_data END,
        sorting_data = CASE WHEN p_sorting_data IS NOT NULL
                                 AND (p_sorting_data ->> 'date') IS NOT NULL
                                 AND (p_sorting_data ->> 'date') <> ''
                            THEN v_sorting ELSE sorting_data END,
        packing_data = CASE
            WHEN v_sync_packing IS NOT NULL THEN v_sync_packing
            WHEN p_packing_data IS NOT NULL
                 AND (p_packing_data ->> 'date') IS NOT NULL
                 AND (p_packing_data ->> 'date') <> ''
                THEN v_packing
            ELSE packing_data
        END,
        production_finished_at = CASE WHEN p_finish_production THEN NOW() ELSE production_finished_at END,
        status = CASE
                     WHEN v_has_production_data AND status IN ('intake', 'receiving')
                         THEN 'production'::varchar
                     WHEN p_finish_production AND status = 'production'
                         THEN 'qa'::varchar
                     ELSE status
                 END,
        job_card_data = CASE WHEN p_job_card_data IS NOT NULL THEN p_job_card_data ELSE job_card_data END,
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object(
        'success', true,
        'stock_synced', v_sync_packing IS NOT NULL
    );
END;
$$;

-- Release to stock: require job card quantities and re-sync packing from stored job card.
CREATE OR REPLACE FUNCTION public.complete_kernel_batch(
    p_kernel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status varchar;
    v_jc jsonb;
BEGIN
    SELECT status, job_card_data
    INTO v_status, v_jc
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

    IF NOT public.kernel_job_card_has_stock_quantities(v_jc) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Job card must include style quantities (cartons or kg) before releasing to stock. Save the job card after entering or correcting style lines.'
        );
    END IF;

    UPDATE public.kernel
    SET status = 'complete',
        packing_data = public.sync_kernel_job_card_to_packing_data(v_jc),
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- get_kernel_batches: prefer job card yield when job card has style quantities.
DROP FUNCTION IF EXISTS public.get_kernel_batches(varchar, varchar, integer, integer);

CREATE OR REPLACE FUNCTION public.get_kernel_batches(
    p_status varchar DEFAULT NULL,
    p_search varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_id uuid,
    batch_number varchar,
    grower_name varchar,
    supplier_id uuid,
    status varchar,
    received_date date,
    wet_nis_received_kg numeric,
    actual_wet_nis_kg numeric,
    weight_difference_kg numeric,
    production_finished_at timestamptz,
    is_active boolean,
    has_receiving_checklist boolean,
    has_ziplock_sample boolean,
    has_5kg_sample boolean,
    has_job_card boolean,
    has_jobcard_approved boolean,
    has_qa boolean,
    has_dispatch boolean,
    production_day_count integer,
    yield_by_style jsonb,
    remaining_by_style jsonb,
    yield_by_style_cartons jsonb,
    remaining_by_style_cartons jsonb,
    ffa numeric,
    best_before_date date,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id, k.batch_id, b.batch_id AS batch_number, k.grower_name, k.supplier_id, k.status::varchar,
        k.received_date, k.wet_nis_received_kg, k.actual_wet_nis_kg,
        CASE WHEN k.wet_nis_received_kg IS NOT NULL AND k.actual_wet_nis_kg IS NOT NULL THEN k.wet_nis_received_kg - k.actual_wet_nis_kg ELSE NULL END,
        k.production_finished_at, k.is_active,
        (k.intake_data -> 'receiving_checklist' IS NOT NULL AND k.intake_data -> 'receiving_checklist' != '{}'::jsonb AND k.intake_data -> 'receiving_checklist' != 'null'::jsonb) AS has_receiving_checklist,
        (k.intake_data #>> '{ziplock_sample,completed_at}' IS NOT NULL) AS has_ziplock_sample,
        (k.intake_data #>> '{five_kg_sample,completed_at}' IS NOT NULL) AS has_5kg_sample,
        (k.job_card_data IS NOT NULL AND k.job_card_data != '{}'::jsonb AND k.job_card_data != 'null'::jsonb) AS has_job_card,
        COALESCE(k.jobcard_approved, false) AS has_jobcard_approved,
        (k.qa_data IS NOT NULL AND k.qa_data != '{}'::jsonb AND k.qa_data != 'null'::jsonb) AS has_qa,
        EXISTS (SELECT 1 FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id) AS has_dispatch,
        GREATEST(jsonb_array_length(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.washing_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.sorting_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)))::integer AS production_day_count,

        CASE WHEN public.kernel_job_card_has_stock_quantities(k.job_card_data)
            THEN public.kernel_yield_kg_from_job_card(k.job_card_data)
            ELSE (
                SELECT jsonb_build_object('SP', COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty', '')::numeric), 0), '0', COALESCE(SUM(NULLIF(e ->> 'sk_0_qty', '')::numeric), 0), '1', COALESCE(SUM(NULLIF(e ->> 'sk_1_qty', '')::numeric), 0), '1S', COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty', '')::numeric), 0), '4L', COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty', '')::numeric), 0), '5', COALESCE(SUM(NULLIF(e ->> 'sk_5_qty', '')::numeric), 0), '6', COALESCE(SUM(NULLIF(e ->> 'sk_6_qty', '')::numeric), 0), '7/8', COALESCE(SUM(NULLIF(e ->> 'bt_78_qty', '')::numeric), 0), 'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_qty','')::numeric), 0), 'Butter Low Oil', COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0))
                FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) e
            )
        END AS yield_by_style,

        CASE WHEN public.kernel_job_card_has_stock_quantities(k.job_card_data)
            THEN (
                SELECT jsonb_build_object(
                    'SP', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'SP')::numeric, 0) - COALESCE(d.sp, 0)),
                    '0', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '0')::numeric, 0) - COALESCE(d.s0, 0)),
                    '1', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '1')::numeric, 0) - COALESCE(d.s1, 0)),
                    '1S', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '1S')::numeric, 0) - COALESCE(d.s1s, 0)),
                    '4L', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '4L')::numeric, 0) - COALESCE(d.s4l, 0)),
                    '5', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '5')::numeric, 0) - COALESCE(d.s5, 0)),
                    '6', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '6')::numeric, 0) - COALESCE(d.s6, 0)),
                    '7/8', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '7/8')::numeric, 0) - COALESCE(d.s78, 0)),
                    'Butter High Oil', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'Butter High Oil')::numeric, 0) - COALESCE(d.bh, 0)),
                    'Butter Low Oil', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'Butter Low Oil')::numeric, 0) - COALESCE(d.bl, 0))
                )
                FROM (
                    SELECT
                        COALESCE(SUM(CASE WHEN le ->> 'style' = 'SP' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS sp,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '0' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s0,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '1' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s1,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '1S' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s1s,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '4L' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s4l,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '5' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s5,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '6' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s6,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '7/8' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s78,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter High Oil' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS bh,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter Low Oil' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS bl
                    FROM kernel_dispatch_orders o
                    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
                    WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id
                ) d
            )
            ELSE (
                SELECT jsonb_build_object('SP', GREATEST(0, COALESCE(y.sp,0)-COALESCE(d.sp,0)), '0', GREATEST(0, COALESCE(y.s0,0)-COALESCE(d.s0,0)), '1', GREATEST(0, COALESCE(y.s1,0)-COALESCE(d.s1,0)), '1S', GREATEST(0, COALESCE(y.s1s,0)-COALESCE(d.s1s,0)), '4L', GREATEST(0, COALESCE(y.s4l,0)-COALESCE(d.s4l,0)), '5', GREATEST(0, COALESCE(y.s5,0)-COALESCE(d.s5,0)), '6', GREATEST(0, COALESCE(y.s6,0)-COALESCE(d.s6,0)), '7/8', GREATEST(0, COALESCE(y.s78,0)-COALESCE(d.s78,0)), 'Butter High Oil', GREATEST(0, COALESCE(y.bh,0)-COALESCE(d.bh,0)), 'Butter Low Oil', GREATEST(0, COALESCE(y.bl,0)-COALESCE(d.bl,0)))
                FROM (SELECT COALESCE(SUM(NULLIF(e->>'sk_sp_qty','')::numeric),0) AS sp, COALESCE(SUM(NULLIF(e->>'sk_0_qty','')::numeric),0) AS s0, COALESCE(SUM(NULLIF(e->>'sk_1_qty','')::numeric),0) AS s1, COALESCE(SUM(NULLIF(e->>'sk_1s_qty','')::numeric),0) AS s1s, COALESCE(SUM(NULLIF(e->>'sk_4l_qty','')::numeric),0) AS s4l, COALESCE(SUM(NULLIF(e->>'sk_5_qty','')::numeric),0) AS s5, COALESCE(SUM(NULLIF(e->>'sk_6_qty','')::numeric),0) AS s6, COALESCE(SUM(NULLIF(e->>'bt_78_qty','')::numeric),0) AS s78, COALESCE(SUM(NULLIF(e->>'bt_high_qty','')::numeric),0) AS bh, COALESCE(SUM(NULLIF(e->>'bt_low_qty','')::numeric),0) AS bl FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data,'null'::jsonb),'[]'::jsonb)) e) y
                CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS sp, COALESCE(SUM(CASE WHEN le->>'style'='0' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s0, COALESCE(SUM(CASE WHEN le->>'style'='1' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s1, COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s1s, COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s4l, COALESCE(SUM(CASE WHEN le->>'style'='5' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s5, COALESCE(SUM(CASE WHEN le->>'style'='6' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s6, COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s78, COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS bh, COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS bl FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE NULLIF(le->>'kernel_id','')::uuid = k.id) d
            )
        END AS remaining_by_style,

        CASE WHEN public.kernel_job_card_has_stock_quantities(k.job_card_data)
            THEN public.kernel_yield_cartons_from_job_card(k.job_card_data)
            ELSE (
                SELECT jsonb_build_object('SP', COALESCE(SUM(NULLIF(e ->> 'sk_sp_cartons', '')::numeric), 0), '0', COALESCE(SUM(NULLIF(e ->> 'sk_0_cartons', '')::numeric), 0), '1', COALESCE(SUM(NULLIF(e ->> 'sk_1_cartons', '')::numeric), 0), '1S', COALESCE(SUM(NULLIF(e ->> 'sk_1s_cartons', '')::numeric), 0), '4L', COALESCE(SUM(NULLIF(e ->> 'sk_4l_cartons', '')::numeric), 0), '5', COALESCE(SUM(NULLIF(e ->> 'sk_5_cartons', '')::numeric), 0), '6', COALESCE(SUM(NULLIF(e ->> 'sk_6_cartons', '')::numeric), 0), '7/8', COALESCE(SUM(NULLIF(e ->> 'bt_78_cartons', '')::numeric), 0), 'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_cartons','')::numeric), 0), 'Butter Low Oil', COALESCE(SUM(NULLIF(e ->> 'bt_low_cartons', '')::numeric), 0))
                FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) e
            )
        END AS yield_by_style_cartons,

        CASE WHEN public.kernel_job_card_has_stock_quantities(k.job_card_data)
            THEN (
                SELECT jsonb_build_object(
                    'SP', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'SP')::numeric, 0) - COALESCE(dc.sp, 0)),
                    '0', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '0')::numeric, 0) - COALESCE(dc.s0, 0)),
                    '1', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '1')::numeric, 0) - COALESCE(dc.s1, 0)),
                    '1S', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '1S')::numeric, 0) - COALESCE(dc.s1s, 0)),
                    '4L', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '4L')::numeric, 0) - COALESCE(dc.s4l, 0)),
                    '5', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '5')::numeric, 0) - COALESCE(dc.s5, 0)),
                    '6', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '6')::numeric, 0) - COALESCE(dc.s6, 0)),
                    '7/8', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '7/8')::numeric, 0) - COALESCE(dc.s78, 0)),
                    'Butter High Oil', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'Butter High Oil')::numeric, 0) - COALESCE(dc.bh, 0)),
                    'Butter Low Oil', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'Butter Low Oil')::numeric, 0) - COALESCE(dc.bl, 0))
                )
                FROM (
                    SELECT
                        COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS sp,
                        COALESCE(SUM(CASE WHEN le->>'style'='0' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s0,
                        COALESCE(SUM(CASE WHEN le->>'style'='1' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1,
                        COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1s,
                        COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s4l,
                        COALESCE(SUM(CASE WHEN le->>'style'='5' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s5,
                        COALESCE(SUM(CASE WHEN le->>'style'='6' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s6,
                        COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s78,
                        COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bh,
                        COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bl
                    FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE NULLIF(le->>'kernel_id','')::uuid = k.id
                ) dc
            )
            ELSE (
                SELECT jsonb_build_object('SP', GREATEST(0, COALESCE(yc.sp,0)-COALESCE(dc.sp,0)), '0', GREATEST(0, COALESCE(yc.s0,0)-COALESCE(dc.s0,0)), '1', GREATEST(0, COALESCE(yc.s1,0)-COALESCE(dc.s1,0)), '1S', GREATEST(0, COALESCE(yc.s1s,0)-COALESCE(dc.s1s,0)), '4L', GREATEST(0, COALESCE(yc.s4l,0)-COALESCE(dc.s4l,0)), '5', GREATEST(0, COALESCE(yc.s5,0)-COALESCE(dc.s5,0)), '6', GREATEST(0, COALESCE(yc.s6,0)-COALESCE(dc.s6,0)), '7/8', GREATEST(0, COALESCE(yc.s78,0)-COALESCE(dc.s78,0)), 'Butter High Oil', GREATEST(0, COALESCE(yc.bh,0)-COALESCE(dc.bh,0)), 'Butter Low Oil', GREATEST(0, COALESCE(yc.bl,0)-COALESCE(dc.bl,0)))
                FROM (SELECT COALESCE(SUM(NULLIF(e->>'sk_sp_cartons','')::numeric),0) AS sp, COALESCE(SUM(NULLIF(e->>'sk_0_cartons','')::numeric),0) AS s0, COALESCE(SUM(NULLIF(e->>'sk_1_cartons','')::numeric),0) AS s1, COALESCE(SUM(NULLIF(e->>'sk_1s_cartons','')::numeric),0) AS s1s, COALESCE(SUM(NULLIF(e->>'sk_4l_cartons','')::numeric),0) AS s4l, COALESCE(SUM(NULLIF(e->>'sk_5_cartons','')::numeric),0) AS s5, COALESCE(SUM(NULLIF(e->>'sk_6_cartons','')::numeric),0) AS s6, COALESCE(SUM(NULLIF(e->>'bt_78_cartons','')::numeric),0) AS s78, COALESCE(SUM(NULLIF(e->>'bt_high_cartons','')::numeric),0) AS bh, COALESCE(SUM(NULLIF(e->>'bt_low_cartons','')::numeric),0) AS bl FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data,'null'::jsonb),'[]'::jsonb)) e) yc
                CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS sp, COALESCE(SUM(CASE WHEN le->>'style'='0' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s0, COALESCE(SUM(CASE WHEN le->>'style'='1' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1, COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1s, COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s4l, COALESCE(SUM(CASE WHEN le->>'style'='5' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s5, COALESCE(SUM(CASE WHEN le->>'style'='6' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s6, COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s78, COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bh, COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bl FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE NULLIF(le->>'kernel_id','')::uuid = k.id) dc
            )
        END AS remaining_by_style_cartons,

        COALESCE((NULLIF(k.qa_data->>'ffa_result', ''))::numeric, (NULLIF(k.qa_data->>'ffa', ''))::numeric) AS ffa,
        COALESCE((NULLIF(k.job_card_data->>'best_before_date', ''))::date, ((NULLIF(k.job_card_data->>'packing_completion_date', ''))::date + interval '18 months')::date) AS best_before_date,
        k.created_at, k.updated_at
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.is_active = true
      AND (p_status IS NULL OR k.status = p_status OR k.status = ANY(string_to_array(p_status, ',')))
      AND (p_search IS NULL OR b.batch_id ILIKE '%' || p_search || '%' OR k.grower_name ILIKE '%' || p_search || '%')
    ORDER BY k.received_date DESC NULLS LAST, b.batch_id DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

DO $$
DECLARE
    r record;
    v_fn text;
    v_fns text[] := ARRAY[
        'kernel_job_card_styles_array',
        'kernel_job_card_has_stock_quantities',
        'sync_kernel_job_card_to_packing_data',
        'kernel_yield_kg_from_job_card',
        'kernel_yield_cartons_from_job_card'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns LOOP
        FOR r IN SELECT id AS role_id FROM public.roles LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (r.role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
