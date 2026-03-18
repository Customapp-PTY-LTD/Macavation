-- "Create kernel batch" was blocked: upsert_batch (step 1) and initialize_kernel_for_batch (step 2)
-- need EXECUTE for the user's role. Grant to all active roles that are missing them.

DO $$
DECLARE
  r RECORD;
  func_name TEXT;
  funcs TEXT[] := ARRAY['upsert_batch', 'initialize_kernel_for_batch'];
BEGIN
  FOR r IN
    SELECT id AS role_id FROM public.roles WHERE is_active = true
    AND id NOT IN (
      SELECT role_id FROM public.role_permissions
      WHERE object_type = 'function' AND object_name = 'upsert_batch'
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

-- Extend new-role trigger to include create-batch functions
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
        'get_contacts',
        'get_silos',
        'get_kernel_batches',
        'get_stock_items',
        'get_oil_stock_lots',
        'get_kernel_dispatch_orders',
        'get_kernel_dispatch_order',
        'set_silo_empty',
        'assign_kernel_to_silos',
        'upsert_batch',
        'initialize_kernel_for_batch'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (NEW.id, 'function', v_fn, 'EXECUTE', true);
    END LOOP;
    RETURN NEW;
END;
$$;
