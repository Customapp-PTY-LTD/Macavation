-- Grant EXECUTE on Kernel Dispatch list/detail to roles that were missing it.
-- Fixes: "Access denied: operation EXECUTE is not allowed" on Kernel Dispatch page.

DO $$
DECLARE
  r RECORD;
  func_name TEXT;
  funcs TEXT[] := ARRAY['get_kernel_dispatch_orders', 'get_kernel_dispatch_order'];
BEGIN
  FOR r IN
    SELECT id AS role_id FROM public.roles WHERE is_active = true
    AND id NOT IN (
      SELECT role_id FROM public.role_permissions
      WHERE object_type = 'function' AND object_name = 'get_kernel_dispatch_orders'
      AND operation = 'EXECUTE' AND allowed = true
    )
  LOOP
    FOREACH func_name IN ARRAY funcs
    LOOP
      INSERT INTO public.role_permissions (id, role_id, object_type, object_name, operation, allowed, created_at, updated_at)
      SELECT gen_random_uuid(), r.role_id, 'function', func_name, 'EXECUTE', true, now(), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM public.role_permissions
        WHERE role_id = r.role_id AND object_type = 'function'
        AND object_name = func_name AND operation = 'EXECUTE'
      );
    END LOOP;
  END LOOP;
END $$;
