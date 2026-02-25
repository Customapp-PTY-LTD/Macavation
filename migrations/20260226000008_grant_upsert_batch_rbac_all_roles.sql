-- Grant EXECUTE on upsert_batch to all roles (Supplier Intake / oil batch flow).
-- Aligns with ROLE_ACCESS_UPDATE.md and RBAC_TROUBLESHOOTING.md: all authenticated users can call data functions.
-- upsert_oil_batch is already granted in 20260226000007_create_oil_schema_sps.sql.

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.role_permissions
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'upsert_batch' AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'upsert_batch', 'EXECUTE', true);
        END IF;
    END LOOP;
END $$;
