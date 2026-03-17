-- Grant EXECUTE on Stock (Kernel) / stock items / oil stock lots to roles that were missing it.
-- Fixes: "Access denied: operation EXECUTE is not allowed" for Sales Exec etc. on Stock (Kernel) page.
-- Lambda/proxy checks role_permissions before calling Supabase.

DO $$
DECLARE
  r RECORD;
  func_name TEXT;
  funcs TEXT[] := ARRAY['get_kernel_batches', 'get_stock_items', 'get_oil_stock_lots'];
BEGIN
  FOR r IN
    SELECT id AS role_id FROM public.roles WHERE is_active = true
    AND id NOT IN (
      SELECT role_id FROM public.role_permissions
      WHERE object_type = 'function' AND object_name = 'get_kernel_batches'
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
