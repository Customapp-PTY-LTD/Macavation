-- Soft-remove supplier intake rows from the oil table (is_active = false). Only pre-production intake statuses.

CREATE OR REPLACE FUNCTION public.deactivate_supplier_intake_oil_batch(p_oil_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT o.status::text INTO v_status
    FROM public.oil o
    WHERE o.id = p_oil_id AND o.is_active = true;

    IF v_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch not found or already removed');
    END IF;

    IF v_status NOT IN ('awaiting_test', 'release_ready', 'intake') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Only supplier intake batches (awaiting tests or ready for oil production) can be removed. Batches already in production must be handled in Oil Production.'
        );
    END IF;

    UPDATE public.oil
    SET
        is_active = false,
        updated_at = now(),
        updated_by = COALESCE(auth.uid(), updated_by)
    WHERE id = p_oil_id AND is_active = true;

    RETURN jsonb_build_object('success', true, 'id', p_oil_id);
END;
$$;

COMMENT ON FUNCTION public.deactivate_supplier_intake_oil_batch(uuid) IS
    'Sets oil.is_active false for supplier intake batches (awaiting_test, release_ready, or legacy intake). Hidden from get_oil_batches.';

GRANT EXECUTE ON FUNCTION public.deactivate_supplier_intake_oil_batch(uuid) TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY['deactivate_supplier_intake_oil_batch'];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_fn IN ARRAY v_fns
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true);
            ELSE
                UPDATE public.role_permissions
                SET allowed = true
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE';
            END IF;
        END LOOP;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
