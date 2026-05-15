-- Ensure RBAC for revert_kernel_dispatch_order (fixes "Access denied: operation EXECUTE is not allowed"
-- when the function migration ran on one project but role_permissions was missing or denied on another).
-- Safe to re-run. Function must already exist (20260514120000_revert_kernel_dispatch_order.sql).

GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id,
       'function',
       'revert_kernel_dispatch_order',
       'EXECUTE',
       true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = 'revert_kernel_dispatch_order'
      AND x.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true,
    updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'revert_kernel_dispatch_order'
  AND operation = 'EXECUTE';

NOTIFY pgrst, 'reload schema';
