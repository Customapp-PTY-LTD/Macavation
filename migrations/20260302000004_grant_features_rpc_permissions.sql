-- Grant EXECUTE on get_features_for_role to all roles.
-- The other 6 feature functions were already granted in migration 20260218000001.

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_features_for_role', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;
