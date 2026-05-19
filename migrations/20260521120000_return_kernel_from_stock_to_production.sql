-- Stock → Kernel Production: move kernel row from finished stock (complete) back to QA pipeline.
-- WebPortal stock "Send back to production" must call this (not update_production_batch).

CREATE OR REPLACE FUNCTION public.return_kernel_from_stock_to_production(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status varchar;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel id is required');
    END IF;

    SELECT status::varchar
    INTO v_status
    FROM public.kernel
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    IF v_status IN ('qa', 'production') THEN
        RETURN jsonb_build_object(
            'success', true,
            'kernel_id', p_kernel_id,
            'status', v_status,
            'already_in_production', true
        );
    END IF;

    IF v_status NOT IN ('complete', 'in_finished_stock') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Batch must be in finished stock (complete) to send back to production (current status: ' || COALESCE(v_status, '?') || ')'
        );
    END IF;

    UPDATE public.kernel
    SET
        status = 'qa',
        jobcard_approved = false,
        updated_at = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    RETURN jsonb_build_object(
        'success', true,
        'kernel_id', p_kernel_id,
        'status', 'qa'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.return_kernel_from_stock_to_production(uuid) IS
    'Moves a kernel batch from finished stock (status complete) back to QA so it appears on Kernel Production. Clears jobcard_approved for re-approval.';

GRANT EXECUTE ON FUNCTION public.return_kernel_from_stock_to_production(uuid) TO authenticated, service_role, anon;

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'return_kernel_from_stock_to_production', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;
