-- Fix "Access denied: operation EXECUTE is not allowed" for Jobcard approved and related kernel RPCs.
-- Safe to re-run (INSERT missing rows + force allowed = true).

GRANT EXECUTE ON FUNCTION public.approve_kernel_job_card(uuid, jsonb) TO authenticated, service_role, anon;

GRANT EXECUTE ON FUNCTION public.return_kernel_from_stock_to_production(uuid) TO authenticated, service_role, anon;

GRANT EXECUTE ON FUNCTION public.get_kernel_jobcard_approval_map(uuid[]) TO authenticated, service_role, anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', fn.name, 'EXECUTE', true
FROM public.roles r
CROSS JOIN (
    VALUES
        ('approve_kernel_job_card'),
        ('return_kernel_from_stock_to_production'),
        ('get_kernel_jobcard_approval_map')
) AS fn(name)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = fn.name
      AND x.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true,
    updated_at = now()
WHERE object_type = 'function'
  AND object_name IN (
      'approve_kernel_job_card',
      'return_kernel_from_stock_to_production',
      'get_kernel_jobcard_approval_map'
  )
  AND operation = 'EXECUTE';

NOTIFY pgrst, 'reload schema';
