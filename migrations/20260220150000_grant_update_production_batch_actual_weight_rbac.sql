-- Grant EXECUTE on update_production_batch_actual_weight to ALL roles (fixes "Access denied: operation EXECUTE is not allowed").
-- Run this in the Supabase project that your Lambda uses (SUPABASE_URL). If you use multiple projects, run in each.

DO $$
DECLARE
  v_role_id uuid;
BEGIN
  FOR v_role_id IN SELECT id FROM public.roles
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'update_production_batch_actual_weight' AND operation = 'EXECUTE'
    ) THEN
      INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
      VALUES (v_role_id, 'function', 'update_production_batch_actual_weight', 'EXECUTE', true);
    END IF;
  END LOOP;
END $$;
