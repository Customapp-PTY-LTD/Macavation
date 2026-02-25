-- Migration: Create kernel detail read function + 3 upsert write functions
-- Replaces old per-table functions (dropped tables):
--   get_kernel_job_card, get_kernel_packing_sample, get_kernel_production_stages* (all dropped)
--   create_kernel_job_card, create_kernel_packing_sample, save_kernel_production_stages* (all dropped)
-- New pattern: 1 read + 3 targeted writes, all UPSERT (update-or-set) on kernel.jsonb columns.

-- ============================================================
-- 1. get_kernel_batch_detail — full kernel row for modals
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_kernel_batch_detail(
    p_kernel_id uuid
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
    production_finished_at timestamptz,
    is_active boolean,
    intake_data jsonb,
    cracking_data jsonb,
    washing_data jsonb,
    sorting_data jsonb,
    packing_data jsonb,
    job_card_data jsonb,
    qa_data jsonb,
    dispatch_data jsonb,
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
        k.id,
        k.batch_id,
        b.batch_id AS batch_number,
        k.grower_name,
        k.supplier_id,
        k.status::varchar,
        k.received_date,
        k.wet_nis_received_kg,
        k.actual_wet_nis_kg,
        k.production_finished_at,
        k.is_active,
        k.intake_data,
        COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb) AS cracking_data,
        COALESCE(NULLIF(k.washing_data, 'null'::jsonb), '[]'::jsonb) AS washing_data,
        COALESCE(NULLIF(k.sorting_data, 'null'::jsonb), '[]'::jsonb) AS sorting_data,
        COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb) AS packing_data,
        COALESCE(k.job_card_data, '{}'::jsonb) AS job_card_data,
        COALESCE(k.qa_data, '{}'::jsonb) AS qa_data,
        COALESCE(k.dispatch_data, '{}'::jsonb) AS dispatch_data,
        k.created_at,
        k.updated_at
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id
      AND k.is_active = true;
END;
$$;

-- ============================================================
-- 2. upsert_kernel_production — save day stage data + finish production + job card
--    All fields default NULL/false so callers only pass what they need.
--    - Day save:   pass p_day_index + at least one stage data param
--    - Finish:     pass p_finish_production = true (sets production_finished_at, status → 'qa')
--    - Job card:   pass p_job_card_data
--    These can be combined in one call (e.g. finish + job card together).
-- ============================================================
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

    -- Update stage arrays at p_day_index if supplied
    IF p_day_index IS NOT NULL THEN
        IF p_cracking_data IS NOT NULL THEN
            v_len := jsonb_array_length(v_cracking);
            IF p_day_index < v_len THEN
                v_cracking := jsonb_set(v_cracking, ARRAY[p_day_index::text], p_cracking_data);
            ELSE
                v_cracking := v_cracking || jsonb_build_array(p_cracking_data);
            END IF;
        END IF;

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
        cracking_data       = CASE WHEN p_day_index IS NOT NULL AND p_cracking_data IS NOT NULL
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

-- ============================================================
-- 3. upsert_kernel_job_card — save / replace job card JSONB
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_kernel_job_card(
    p_kernel_id     uuid,
    p_job_card_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel
    SET job_card_data = p_job_card_data,
        updated_at    = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 4. upsert_kernel_qa — save / replace QA (packing sample) JSONB
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_kernel_qa(
    p_kernel_id uuid,
    p_qa_data   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel
    SET qa_data    = p_qa_data,
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- RBAC: Grant EXECUTE to all roles for all 4 new functions
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_fn varchar;
    v_fns varchar[] := ARRAY[
        'get_kernel_batch_detail',
        'upsert_kernel_production',
        'upsert_kernel_job_card',
        'upsert_kernel_qa'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
