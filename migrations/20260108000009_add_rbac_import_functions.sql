-- RBAC permissions for import helper functions (admin + super_user)

DO $$
DECLARE
    admin_role_id UUID;
    super_user_role_id UUID;
    fn TEXT;
BEGIN
    SELECT id INTO admin_role_id FROM public.roles WHERE role_name = 'admin';
    SELECT id INTO super_user_role_id FROM public.roles WHERE role_name = 'super_user';

    IF admin_role_id IS NOT NULL THEN
        FOREACH fn IN ARRAY ARRAY['get_table_columns', 'import_table_rows'] LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = admin_role_id
                  AND object_type = 'function'
                  AND object_name = fn
                  AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (admin_role_id, 'function', fn, 'EXECUTE', true);
            END IF;
        END LOOP;
    END IF;

    IF super_user_role_id IS NOT NULL THEN
        FOREACH fn IN ARRAY ARRAY['get_table_columns', 'import_table_rows'] LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = super_user_role_id
                  AND object_type = 'function'
                  AND object_name = fn
                  AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (super_user_role_id, 'function', fn, 'EXECUTE', true);
            END IF;
        END LOOP;
    END IF;
END
$$;
