-- Migration: Change cracking_data upsert to use date as unique key
-- instead of p_day_index positional array index.
-- Other stages (washing, sorting, packing) remain index-based.

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
    v_len      integer;
    v_crack_date text;
    v_found    boolean := false;
    v_i        integer;
BEGIN
    -- Load current arrays
    SELECT
        COALESCE(NULLIF(cracking_data, 'null'::jsonb), '[]'::jsonb),
        COALESCE(NULLIF(washing_data,  'null'::jsonb), '[]'::jsonb),
        COALESCE(NULLIF(sorting_data,  'null'::jsonb), '[]'::jsonb),
        COALESCE(NULLIF(packing_data,  'null'::jsonb), '[]'::jsonb)
    INTO v_cracking, v_washing, v_sorting, v_packing
    FROM public.kernel
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    -- ── Cracking: date-based upsert ──
    IF p_cracking_data IS NOT NULL THEN
        v_crack_date := p_cracking_data ->> 'date';
        IF v_crack_date IS NULL OR v_crack_date = '' THEN
            RETURN jsonb_build_object('success', false, 'error', 'cracking_data must include a date field');
        END IF;

        -- Search existing array for a matching date
        v_found := false;
        FOR v_i IN 0 .. jsonb_array_length(v_cracking) - 1 LOOP
            IF (v_cracking -> v_i ->> 'date') = v_crack_date THEN
                v_cracking := jsonb_set(v_cracking, ARRAY[v_i::text], p_cracking_data);
                v_found := true;
                EXIT;
            END IF;
        END LOOP;

        -- Not found → append
        IF NOT v_found THEN
            v_cracking := v_cracking || jsonb_build_array(p_cracking_data);
        END IF;
    END IF;

    -- ── Washing, Sorting, Packing: still index-based ──
    IF p_day_index IS NOT NULL THEN
        IF p_washing_data IS NOT NULL THEN
            v_len := jsonb_array_length(v_washing);
            IF p_day_index < v_len THEN
                v_washing := jsonb_set(v_washing, ARRAY[p_day_index::text], p_washing_data);
            ELSE
                v_washing := v_washing || jsonb_build_array(p_washing_data);
            END IF;
        END IF;

        IF p_sorting_data IS NOT NULL THEN
            v_len := jsonb_array_length(v_sorting);
            IF p_day_index < v_len THEN
                v_sorting := jsonb_set(v_sorting, ARRAY[p_day_index::text], p_sorting_data);
            ELSE
                v_sorting := v_sorting || jsonb_build_array(p_sorting_data);
            END IF;
        END IF;

        IF p_packing_data IS NOT NULL THEN
            v_len := jsonb_array_length(v_packing);
            IF p_day_index < v_len THEN
                v_packing := jsonb_set(v_packing, ARRAY[p_day_index::text], p_packing_data);
            ELSE
                v_packing := v_packing || jsonb_build_array(p_packing_data);
            END IF;
        END IF;
    END IF;

    -- Apply all updates in one UPDATE
    UPDATE public.kernel
    SET
        cracking_data       = CASE WHEN p_cracking_data IS NOT NULL
                                   THEN v_cracking ELSE cracking_data END,
        washing_data        = CASE WHEN p_day_index IS NOT NULL AND p_washing_data IS NOT NULL
                                   THEN v_washing  ELSE washing_data  END,
        sorting_data        = CASE WHEN p_day_index IS NOT NULL AND p_sorting_data IS NOT NULL
                                   THEN v_sorting  ELSE sorting_data  END,
        packing_data        = CASE WHEN p_day_index IS NOT NULL AND p_packing_data IS NOT NULL
                                   THEN v_packing  ELSE packing_data  END,
        production_finished_at = CASE WHEN p_finish_production
                                      THEN NOW() ELSE production_finished_at END,
        status              = CASE WHEN p_finish_production AND status = 'production'
                                   THEN 'qa'::varchar ELSE status END,
        job_card_data       = CASE WHEN p_job_card_data IS NOT NULL
                                   THEN p_job_card_data ELSE job_card_data END,
        updated_at          = NOW()
    WHERE id = p_kernel_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
