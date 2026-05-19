-- Dedicated approve RPC (small param list for Lambda proxy). Call after upsert_kernel_job_card saves job_card_data.

CREATE OR REPLACE FUNCTION public.approve_kernel_job_card(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_approved boolean;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel id is required');
    END IF;

    UPDATE public.kernel
    SET jobcard_approved = true,
        updated_at = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    SELECT COALESCE(jobcard_approved, false) INTO v_approved
    FROM public.kernel
    WHERE id = p_kernel_id;

    RETURN jsonb_build_object(
        'success', true,
        'jobcard_approved', v_approved,
        'has_jobcard_approved', v_approved
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.approve_kernel_job_card(uuid) IS
    'Sets kernel.jobcard_approved = true. Used when upsert_kernel_job_card cannot pass p_jobcard_approved through the API proxy.';

GRANT EXECUTE ON FUNCTION public.approve_kernel_job_card(uuid) TO authenticated, service_role, anon;

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
