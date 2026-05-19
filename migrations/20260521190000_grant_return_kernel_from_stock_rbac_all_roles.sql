-- Re-apply EXECUTE + role_permissions for Stock → Kernel Production send-back.
-- Fixes Lambda "Access denied: operation EXECUTE is not allowed" when role_permissions are missing or stale.

GRANT EXECUTE ON FUNCTION public.return_kernel_from_stock_to_production(uuid) TO authenticated, service_role, anon;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'return_kernel_from_stock_to_production',
        'upsert_kernel_job_card',
        'get_kernel_jobcard_approval_map',
        'complete_kernel_batch',
        'adjust_kernel_stock_on_hand',
        'update_kernel_stock_batch_info'
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
