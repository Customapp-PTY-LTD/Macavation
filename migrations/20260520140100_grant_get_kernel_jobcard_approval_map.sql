-- Grant get_kernel_jobcard_approval_map to all roles (portal batch list approval ticks).

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.role_permissions
            WHERE role_id = v_role_id
              AND object_type = 'function'
              AND object_name = 'get_kernel_jobcard_approval_map'
              AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'get_kernel_jobcard_approval_map', 'EXECUTE', true);
        END IF;
    END LOOP;
END $$;
