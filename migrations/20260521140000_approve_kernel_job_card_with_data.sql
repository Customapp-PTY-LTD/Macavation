-- Jobcard approved: one RPC saves job_card_data + sets jobcard_approved (avoids proxy dropping p_jobcard_approved on upsert).

DROP FUNCTION IF EXISTS public.approve_kernel_job_card(uuid);

CREATE OR REPLACE FUNCTION public.approve_kernel_job_card(
    p_kernel_id      uuid,
    p_job_card_data  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sync     boolean := false;
    v_approved boolean;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel id is required');
    END IF;

    IF p_job_card_data IS NOT NULL
       AND p_job_card_data IS DISTINCT FROM '{}'::jsonb
       AND p_job_card_data IS DISTINCT FROM 'null'::jsonb THEN
        v_sync := public.kernel_job_card_has_stock_quantities(p_job_card_data);
        UPDATE public.kernel
        SET
            job_card_data = p_job_card_data,
            jobcard_approved = true,
            packing_data = CASE
                WHEN v_sync THEN public.sync_kernel_job_card_to_packing_data(p_job_card_data)
                ELSE packing_data
            END,
            updated_at = NOW()
        WHERE id = p_kernel_id
          AND is_active = true;
    ELSE
        UPDATE public.kernel
        SET jobcard_approved = true,
            updated_at = NOW()
        WHERE id = p_kernel_id
          AND is_active = true;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    SELECT COALESCE(jobcard_approved, false) INTO v_approved
    FROM public.kernel
    WHERE id = p_kernel_id;

    RETURN jsonb_build_object(
        'success', true,
        'jobcard_approved', v_approved,
        'has_jobcard_approved', v_approved,
        'stock_synced', v_sync
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_kernel_job_card(uuid, jsonb) TO authenticated, service_role, anon;

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'approve_kernel_job_card', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
