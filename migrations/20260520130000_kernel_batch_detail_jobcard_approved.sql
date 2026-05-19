-- Expose jobcard_approved on batch detail + upsert_kernel_job_card response for portal checks.

DROP FUNCTION IF EXISTS public.get_kernel_batch_detail(uuid);

CREATE OR REPLACE FUNCTION public.get_kernel_batch_detail(p_kernel_id uuid)
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
    jobcard_approved boolean,
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
        COALESCE(k.jobcard_approved, false) AS jobcard_approved,
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

-- Patch upsert_kernel_job_card return payload (gated version must already be deployed).
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
    v_was_approved boolean;
    v_sync_stock   boolean;
    v_now_approved boolean;
BEGIN
    SELECT COALESCE(jobcard_approved, false)
    INTO v_was_approved
    FROM public.kernel
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    v_sync_stock := public.kernel_job_card_has_stock_quantities(p_job_card_data)
        AND (p_jobcard_approved IS TRUE OR v_was_approved);

    UPDATE public.kernel
    SET
        job_card_data = p_job_card_data,
        packing_data = CASE
            WHEN v_sync_stock THEN public.sync_kernel_job_card_to_packing_data(p_job_card_data)
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

    SELECT COALESCE(jobcard_approved, false) INTO v_now_approved
    FROM public.kernel WHERE id = p_kernel_id;

    RETURN jsonb_build_object(
        'success', true,
        'finalized_without_production', COALESCE(p_finalize_without_production, false),
        'stock_synced', v_sync_stock,
        'jobcard_approved', v_now_approved
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
