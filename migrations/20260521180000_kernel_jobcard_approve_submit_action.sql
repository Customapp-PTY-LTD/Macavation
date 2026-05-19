-- Reliable Jobcard approved: submit_action in JSON + single upsert_kernel_job_card overload.
-- Re-opens complete (stock) batches to qa when approving so release-to-stock path can run.

DROP FUNCTION IF EXISTS public.upsert_kernel_job_card(uuid, jsonb);
DROP FUNCTION IF EXISTS public.upsert_kernel_job_card(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.upsert_kernel_job_card(uuid, jsonb, boolean, boolean);

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
    v_was_approved    boolean;
    v_sync_stock      boolean;
    v_now_approved    boolean;
    v_request_approve boolean;
    v_job_card_store  jsonb;
    v_submit          text;
BEGIN
    SELECT COALESCE(jobcard_approved, false)
    INTO v_was_approved
    FROM public.kernel
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    v_submit := lower(trim(COALESCE(
        p_job_card_data ->> 'submit_action',
        p_job_card_data ->> '_submit_action',
        ''
    )));

    v_request_approve := COALESCE(p_jobcard_approved, false)
        OR p_finalize_without_production IS TRUE
        OR v_submit IN ('approve', 'approved', 'jobcard_approved')
        OR COALESCE(
            lower(trim(COALESCE(p_job_card_data ->> 'jobcard_approved', ''))) IN ('true', '1', 'yes'),
            false
        )
        OR (
            p_job_card_data ? 'jobcard_approved'
            AND jsonb_typeof(p_job_card_data -> 'jobcard_approved') = 'boolean'
            AND (p_job_card_data -> 'jobcard_approved') = 'true'::jsonb
        );

    v_job_card_store := p_job_card_data
        - 'jobcard_approved'
        - 'submit_action'
        - '_submit_action';

    v_sync_stock := public.kernel_job_card_has_stock_quantities(v_job_card_store)
        AND (v_request_approve OR v_was_approved);

    UPDATE public.kernel
    SET
        job_card_data = v_job_card_store,
        packing_data = CASE
            WHEN v_sync_stock THEN public.sync_kernel_job_card_to_packing_data(v_job_card_store)
            ELSE packing_data
        END,
        jobcard_approved = CASE
            WHEN v_request_approve THEN true
            ELSE jobcard_approved
        END,
        status = CASE
            WHEN v_request_approve AND COALESCE(status::text, '') = 'complete' THEN 'qa'::varchar
            WHEN p_finalize_without_production IS TRUE
                 AND COALESCE(status::text, '') NOT IN ('complete', 'dispatch', 'qa')
                THEN 'qa'::varchar
            ELSE status
        END,
        production_finished_at = CASE
            WHEN p_finalize_without_production IS TRUE THEN COALESCE(production_finished_at, NOW())
            WHEN v_request_approve AND production_finished_at IS NULL THEN NOW()
            ELSE production_finished_at
        END,
        qa_data = CASE
            WHEN p_finalize_without_production IS TRUE
                 AND (qa_data IS NULL OR qa_data = '{}'::jsonb OR qa_data = 'null'::jsonb)
                THEN jsonb_build_object(
                    'job_card_only_release_ready', true,
                    'recorded_at', to_jsonb(NOW())
                )
            WHEN v_request_approve
                 AND (qa_data IS NULL OR qa_data = '{}'::jsonb OR qa_data = 'null'::jsonb)
                THEN jsonb_build_object(
                    'job_card_approved_at', to_jsonb(NOW()),
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
        'jobcard_approved', v_now_approved,
        'has_jobcard_approved', v_now_approved
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_kernel_job_card(uuid, jsonb, boolean, boolean) TO authenticated, service_role, anon;

NOTIFY pgrst, 'reload schema';
