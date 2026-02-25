-- Fix RBAC for get_kernel_batches
-- Root cause 1: first attempt used operation='execute' (lowercase) — Lambda checks 'EXECUTE' exact case.
-- Root cause 2: second attempt used integer role IDs — roles.id and role_permissions.role_id are UUID.
-- Correct pattern: declare v_role_id as uuid, loop SELECT id FROM public.roles (returns UUIDs).

-- 1. Remove all bad rows from previous attempts
DELETE FROM public.role_permissions
WHERE object_name = 'get_kernel_batches';

-- 2. Grant correct EXECUTE to all roles using UUID role IDs
DO $$
DECLARE
  v_role_id uuid;
BEGIN
  FOR v_role_id IN SELECT id FROM public.roles
  LOOP
    INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
    VALUES (v_role_id, 'function', 'get_kernel_batches', 'EXECUTE', true)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
