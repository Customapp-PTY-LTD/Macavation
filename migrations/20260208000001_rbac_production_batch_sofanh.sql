-- RBAC for production batch functions on project sofanhfpxifgdtooefzq
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor) for https://sofanhfpxifgdtooefzq.supabase.co
-- Requires: public.roles and public.role_permissions tables exist (standard RBAC setup)

-- Grant EXECUTE on kernel batch RPCs to every role (so Create kernel batch works for all users)
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_production_batches', 'EXECUTE', true
FROM public.roles r
ON CONFLICT (role_id, object_type, object_name, operation) DO UPDATE SET allowed = true;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_production_batch_simple', 'EXECUTE', true
FROM public.roles r
ON CONFLICT (role_id, object_type, object_name, operation) DO UPDATE SET allowed = true;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_production_batch', 'EXECUTE', true
FROM public.roles r
ON CONFLICT (role_id, object_type, object_name, operation) DO UPDATE SET allowed = true;
