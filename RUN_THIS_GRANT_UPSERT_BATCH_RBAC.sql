-- Run this in Supabase SQL Editor on the project your Lambda uses (e.g. iwxmuemrfopajwvqdiae).
-- Fixes RBAC 403 for upsert_batch / upsert_oil_batch / get_oil_batches for all roles.
-- After running: have users log out and log back in.

DO $$
DECLARE
    v_role_id uuid;
    v_fn      text;
    v_fns     text[] := ARRAY['upsert_batch', 'upsert_oil_batch', 'get_oil_batches'];
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
            END IF;
        END LOOP;
    END LOOP;
END $$;
