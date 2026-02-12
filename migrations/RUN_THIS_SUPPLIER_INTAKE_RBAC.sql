-- Run this in Supabase SQL Editor to fix "Access denied: operation EXECUTE is not allowed"
-- when saving a batch in Supplier Intake.
-- Your role id from the error: 9c69485d-0116-4cf6-b7e6-2ff6c025478e
-- Use the SAME Supabase project as the app (Lambda env SUPABASE_URL). Then sign out and sign in.

-- Option A: If role_permissions has UNIQUE(role_id, object_type, object_name, operation)
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
VALUES
  ('9c69485d-0116-4cf6-b7e6-2ff6c025478e'::uuid, 'function', 'get_supplier_intake_batches', 'EXECUTE', true),
  ('9c69485d-0116-4cf6-b7e6-2ff6c025478e'::uuid, 'function', 'create_supplier_intake_batch', 'EXECUTE', true)
ON CONFLICT (role_id, object_type, object_name, operation)
DO UPDATE SET allowed = true;

-- Option B: If Option A fails (no unique constraint), run this instead:
-- UPDATE public.role_permissions SET allowed = true
-- WHERE role_id = '9c69485d-0116-4cf6-b7e6-2ff6c025478e' AND object_type = 'function' AND operation = 'EXECUTE'
--   AND object_name IN ('get_supplier_intake_batches', 'create_supplier_intake_batch');
-- INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
-- SELECT '9c69485d-0116-4cf6-b7e6-2ff6c025478e'::uuid, 'function', 'get_supplier_intake_batches', 'EXECUTE', true
-- WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = '9c69485d-0116-4cf6-b7e6-2ff6c025478e'::uuid AND rp.object_type = 'function' AND rp.object_name = 'get_supplier_intake_batches' AND rp.operation = 'EXECUTE');
-- INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
-- SELECT '9c69485d-0116-4cf6-b7e6-2ff6c025478e'::uuid, 'function', 'create_supplier_intake_batch', 'EXECUTE', true
-- WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = '9c69485d-0116-4cf6-b7e6-2ff6c025478e'::uuid AND rp.object_type = 'function' AND rp.object_name = 'create_supplier_intake_batch' AND rp.operation = 'EXECUTE');
