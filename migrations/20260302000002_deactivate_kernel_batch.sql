-- Deactivate kernel batch (soft delete): set is_active = false so batch is hidden from all lists.
-- Can be called at any batch stage (intake, production, qa, dispatch, complete).

CREATE OR REPLACE FUNCTION public.deactivate_kernel_batch(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel
    SET is_active  = false,
        updated_at = NOW()
    WHERE id = p_kernel_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.deactivate_kernel_batch(uuid) IS 'Soft delete: set kernel.is_active = false. Batch disappears from get_kernel_batches and intake lists.';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'deactivate_kernel_batch', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
