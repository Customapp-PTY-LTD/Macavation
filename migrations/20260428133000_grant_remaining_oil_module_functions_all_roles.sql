-- Oil module RBAC sweep:
-- Grant remaining oil-related functions to all roles so no role is blocked by EXECUTE checks.
-- Covers oil production, oil stock, protein stock, and oil dispatch operations used from WebPortal.
-- Safe to re-run.

DO $$
DECLARE
    v_fn text;
    v_role_id uuid;
    v_proc regprocedure;
    v_functions text[] := ARRAY[
        -- Oil Production
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
        'send_protein_bin_batch_to_stock',

        -- Oil Stock (Stock Management - oil view)
        'get_oil_stock_lots',
        'get_oil_stock_summary',
        'create_oil_stock_lot_simple',
        'update_oil_stock_lot_simple',
        'deactivate_oil_stock_lot',
        'get_oil_batch_ingredients_detail',
        'release_oil_stock_lots_to_oil_production',

        -- Oil Dispatch
        'create_oil_dispatch_order',
        'update_oil_dispatch_order_cartons',
        'get_oil_dispatch_orders',
        'get_oil_dispatch_order',
        'save_oil_dispatch_record'
    ];
BEGIN
    -- Postgres grants on all existing overloads
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

    -- Lambda RBAC table entries
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
