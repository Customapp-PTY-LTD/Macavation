-- Grant EXECUTE on supplier intake batch functions to all roles
-- so that saving a batch in Supplier Intake works for every role.

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_supplier_intake_batches', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'get_supplier_intake_batches' AND rp.operation = 'EXECUTE'
);

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_supplier_intake_batch', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'create_supplier_intake_batch' AND rp.operation = 'EXECUTE'
);

-- Ensure any existing permission rows are allowed (so save produces the batch)
UPDATE public.role_permissions SET allowed = true
WHERE object_type = 'function' AND operation = 'EXECUTE'
  AND object_name IN ('get_supplier_intake_batches', 'create_supplier_intake_batch');
