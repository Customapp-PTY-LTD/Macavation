-- Harden job-card style parsing (string vs array, weight_kg vs kg) and always prefer job card in stock when styles exist.

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
        v_text := trim(both '"' from (p_val #>> '{}'));
        IF v_text IS NULL OR btrim(v_text) = '' THEN
            RETURN '[]'::jsonb;
        END IF;
        BEGIN
            IF left(btrim(v_text), 1) = '[' THEN
                RETURN v_text::jsonb;
            END IF;
            RETURN '[]'::jsonb;
        EXCEPTION
            WHEN OTHERS THEN
                RETURN '[]'::jsonb;
        END;
    END IF;
    RETURN '[]'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.kernel_job_card_row_cartons(p_row jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(
        NULLIF(p_row ->> 'cartons', '')::numeric,
        NULLIF(p_row ->> 'Cartons', '')::numeric,
        0
    );
$$;

CREATE OR REPLACE FUNCTION public.kernel_job_card_row_kg(p_row jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(
        NULLIF(p_row ->> 'weight_kg', '')::numeric,
        NULLIF(p_row ->> 'weight', '')::numeric,
        NULLIF(p_row ->> 'kg', '')::numeric,
        NULLIF(p_row ->> 'Weight_kg', '')::numeric,
        0
    );
$$;

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
        v_cartons := public.kernel_job_card_row_cartons(v_row);
        v_kg := public.kernel_job_card_row_kg(v_row);
        IF v_cartons > 0 OR v_kg > 0 THEN
            RETURN true;
        END IF;
    END LOOP;

    FOR v_row IN
        SELECT value
        FROM jsonb_array_elements(public.kernel_job_card_styles_array(p_job_card_data -> 'butter_grade_styles'))
    LOOP
        v_cartons := public.kernel_job_card_row_cartons(v_row);
        v_kg := public.kernel_job_card_row_kg(v_row);
        IF v_cartons > 0 OR v_kg > 0 THEN
            RETURN true;
        END IF;
    END LOOP;

    RETURN false;
END;
$$;

-- Rebuild sync to use row helpers for kg/cartons.
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
        v_cartons := public.kernel_job_card_row_cartons(v_row);
        v_kg := public.kernel_job_card_row_kg(v_row);
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
        v_cartons := public.kernel_job_card_row_cartons(v_row);
        v_kg := public.kernel_job_card_row_kg(v_row);
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
DECLARE
    v_sync jsonb;
BEGIN
    v_sync := CASE
        WHEN public.kernel_job_card_has_stock_quantities(p_job_card_data)
            THEN public.sync_kernel_job_card_to_packing_data(p_job_card_data)
        ELSE NULL
    END;

    UPDATE public.kernel
    SET
        job_card_data = p_job_card_data,
        packing_data = CASE WHEN v_sync IS NOT NULL THEN v_sync ELSE packing_data END,
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
        'stock_synced', v_sync IS NOT NULL
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
