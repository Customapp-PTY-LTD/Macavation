-- Grant record_oil_bin_batch_ffa_test (if 20260331000016 RBAC block was skipped)

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.role_permissions
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'record_oil_bin_batch_ffa_test' AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'record_oil_bin_batch_ffa_test', 'EXECUTE', true);
        ELSE
            UPDATE public.role_permissions SET allowed = true, updated_at = now()
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'record_oil_bin_batch_ffa_test' AND operation = 'EXECUTE';
        END IF;
    END LOOP;
END $$;
