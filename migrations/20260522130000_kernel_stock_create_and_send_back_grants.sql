-- Stock Add Batch (import_historical_kernel_batch) + Send back grants for all roles.

GRANT EXECUTE ON FUNCTION public.import_historical_kernel_batch(
    character varying, character varying, uuid, date, timestamptz, numeric,
    numeric, numeric, numeric, numeric, numeric, numeric, numeric,
    numeric, numeric, numeric, date, numeric
) TO authenticated, service_role, anon;

GRANT EXECUTE ON FUNCTION public.return_kernel_from_stock_to_production(uuid, text)
    TO authenticated, service_role, anon;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'import_historical_kernel_batch',
        'return_kernel_from_stock_to_production'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        FOR v_role_id IN SELECT id FROM public.roles
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = v_role_id
                  AND object_type = 'function'
                  AND object_name = v_fn
                  AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true);
            ELSE
                UPDATE public.role_permissions
                SET allowed = true, updated_at = now()
                WHERE role_id = v_role_id
                  AND object_type = 'function'
                  AND object_name = v_fn
                  AND operation = 'EXECUTE';
            END IF;
        END LOOP;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
