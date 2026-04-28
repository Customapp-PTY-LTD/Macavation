-- Oil Stock delete permission unblock:
-- Stock Management "Remove oil lot" calls deactivate_oil_stock_lot (soft delete).
-- Ensure all roles can execute it.
-- Safe to re-run.

DO $$
DECLARE
    v_proc regprocedure;
    v_role_id uuid;
BEGIN
    -- Grant on all overloads (if any)
    FOR v_proc IN
        SELECT p.oid::regprocedure
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'deactivate_oil_stock_lot'
    LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_proc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_proc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', v_proc);
    END LOOP;

    -- Lambda RBAC table used by operation checks
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM public.role_permissions
            WHERE role_id = v_role_id
              AND object_type = 'function'
              AND object_name = 'deactivate_oil_stock_lot'
              AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'deactivate_oil_stock_lot', 'EXECUTE', true);
        ELSE
            UPDATE public.role_permissions
            SET allowed = true,
                updated_at = now()
            WHERE role_id = v_role_id
              AND object_type = 'function'
              AND object_name = 'deactivate_oil_stock_lot'
              AND operation = 'EXECUTE';
        END IF;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
