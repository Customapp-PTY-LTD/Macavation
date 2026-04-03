-- Fix "Access denied: operation EXECUTE is not allowed" for Batch Journey permanent delete.
-- Inserts role_permissions for every role in public.roles (no uuid-typed loop — works when roles.id is integer or uuid).
-- Safe to re-run. Requires function delete_kernel_batch_permanent(uuid) from 20260404120001.

GRANT EXECUTE ON FUNCTION public.delete_kernel_batch_permanent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_kernel_batch_permanent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_kernel_batch_permanent(uuid) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id,
       'function',
       'delete_kernel_batch_permanent',
       'EXECUTE',
       true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = 'delete_kernel_batch_permanent'
      AND x.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true
WHERE object_type = 'function'
  AND object_name = 'delete_kernel_batch_permanent'
  AND operation = 'EXECUTE';
