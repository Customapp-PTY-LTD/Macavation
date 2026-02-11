-- Grant EXECUTE on receiving checklist and update_production_batch to all roles
-- so that saving the checklist and linking it to the batch (tick) works for every role using Grower Intake.
-- See BluePrint/RBAC_GUIDE.md "Grower Intake: Receiving checklist (checkbox tick)".

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_receiving_checklist', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'create_receiving_checklist' AND rp.operation = 'EXECUTE'
);

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_receiving_checklist', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'update_receiving_checklist' AND rp.operation = 'EXECUTE'
);

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_production_batch', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'update_production_batch' AND rp.operation = 'EXECUTE'
);
