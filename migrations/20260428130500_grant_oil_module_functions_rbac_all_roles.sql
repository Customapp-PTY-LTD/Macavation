-- Oil module RBAC unblock:
-- Ensure all roles can execute core Oil Production / Oil Bin / Protein Bin actions.
-- This removes role-based execute blocks for oil module workflows such as "Send to stock".
-- Safe to re-run.

DO $$
DECLARE
    v_fn text;
    v_role_id uuid;
    v_proc regprocedure;
    v_functions text[] := ARRAY[
        'get_oil_batches',
        'get_oil_batch_by_id',
        'upsert_oil_batch',
        'mark_oil_raw_ingredient_empty',
        'get_shift_list',
        'upsert_shift',
        'sync_oil_production_duty_audit',
        'get_oil_bin_batches',
        'start_oil_bin_batch',
        'update_oil_bin_batch',
        'set_oil_bin_batch_raw_ingredient_links',
        'record_oil_bin_batch_ffa_test',
        'send_oil_bin_batch_to_stock',
        'delete_oil_bin_batch',
        'get_protein_bin_batches',
        'start_protein_bin_batch',
        'update_protein_bin_batch',
        'set_protein_bin_batch_raw_ingredient_links',
        'send_protein_bin_batch_to_stock'
    ];
BEGIN
    -- Postgres function grants (all overloads for each function name)
    FOREACH v_fn IN ARRAY v_functions
    LOOP
        FOR v_proc IN
            SELECT p.oid::regprocedure
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = v_fn
        LOOP
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_proc);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_proc);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', v_proc);
        END LOOP;
    END LOOP;

    -- App-level RBAC table entries used by lambda permission checks
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_fn IN ARRAY v_functions
        LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM public.role_permissions
                WHERE role_id = v_role_id
                  AND object_type = 'function'
                  AND object_name = v_fn
                  AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true);
            ELSE
                UPDATE public.role_permissions
                SET allowed = true,
                    updated_at = now()
                WHERE role_id = v_role_id
                  AND object_type = 'function'
                  AND object_name = v_fn
                  AND operation = 'EXECUTE';
            END IF;
        END LOOP;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
