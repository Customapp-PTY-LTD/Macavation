-- Kernel dispatch: allow completing dispatch (save dispatch record / mark order dispatched).
-- Fixes "Access denied: operation EXECUTE is not allowed" for roles such as Production Manager
-- when saving the dispatch form (save_kernel_dispatch_record was not in 20260331000009 array).
-- Safe to re-run.

GRANT EXECUTE ON FUNCTION public.save_kernel_dispatch_record(
    uuid,
    text, text, text, text, text, text,
    text, text, text,
    date,
    text, text,
    time,
    text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.save_kernel_dispatch_record(
    uuid,
    text, text, text, text, text, text,
    text, text, text,
    date,
    text, text,
    time,
    text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.save_kernel_dispatch_record(
    uuid,
    text, text, text, text, text, text,
    text, text, text,
    date,
    text, text,
    time,
    text, text
) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id,
       'function',
       'save_kernel_dispatch_record',
       'EXECUTE',
       true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = 'save_kernel_dispatch_record'
      AND x.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true,
    updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'save_kernel_dispatch_record'
  AND operation = 'EXECUTE';

-- New roles: extend auto-grant so kernel dispatch works without a separate RBAC migration.
CREATE OR REPLACE FUNCTION public.grant_login_menu_permissions_for_new_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fn text;
    v_fns text[] := ARRAY[
        'get_users',
        'get_roles',
        'get_user_by_id',
        'get_features_for_role',
        'get_role_by_id',
        'get_features',
        'get_role_features',
        'save_kernel_dispatch_record',
        'create_kernel_dispatch_order',
        'update_kernel_dispatch_order_cartons',
        'get_kernel_dispatch_orders',
        'get_kernel_dispatch_order'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        SELECT NEW.id, 'function', v_fn, 'EXECUTE', true
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.role_permissions rp
            WHERE rp.role_id = NEW.id
              AND rp.object_type = 'function'
              AND rp.object_name = v_fn
              AND rp.operation = 'EXECUTE'
        );
    END LOOP;
    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
