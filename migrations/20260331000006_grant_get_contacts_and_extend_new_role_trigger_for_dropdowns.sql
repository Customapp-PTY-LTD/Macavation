-- Newly created users (or roles) could not load dropdowns because get_contacts (and other
-- data functions) were not granted. Fix: (1) Grant get_contacts to all roles missing it.
-- (2) Extend the new-role trigger to grant get_contacts and the same data functions we
-- grant in stock/dispatch/silos migrations so new roles get dropdown/data access.

-- (1) Backfill get_contacts for every role that doesn't have it
INSERT INTO public.role_permissions (id, role_id, object_type, object_name, operation, allowed, created_at, updated_at)
SELECT gen_random_uuid(), r.id, 'function', 'get_contacts', 'EXECUTE', true, now(), now()
FROM public.roles r
WHERE r.id NOT IN (
  SELECT role_id FROM public.role_permissions
  WHERE object_type = 'function' AND object_name = 'get_contacts' AND operation = 'EXECUTE'
);

-- (2) Extend trigger: when a new role is created, also grant dropdown/data functions
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
        'assign_kernel_to_silos'
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
