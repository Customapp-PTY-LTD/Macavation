-- Kernel Pipeline v2: menu features, action keys and function permissions
-- for 20261006090000 / 090100 / 090200.
--
-- Features (sidebar):
--   silo-allocation-grid      every role that already sees Kernel Production
--   kernel-pipeline-settings  super_user, admin, Factory Manager, Production Manager, Quality Assurance
-- Actions (buttons, default deny; super_user/admin are always allowed in WebPortal/js/action-access.js):
--   kernel_settings.edit             super_user, admin, Factory Manager
--   grower_intake.edit_batch_number  super_user, admin only. Batch numbers are locked by default (D1);
--                                    switch it on for other roles in Role Permissions.
-- role_permissions EXECUTE rows go to every role that holds the kernel-production-grid feature,
-- matching how the existing kernel RPCs are granted. role_permissions has no unique key, so rows are
-- inserted with NOT EXISTS rather than ON CONFLICT.

-- 1. FEATURES -----------------------------------------------------------------

INSERT INTO public.features (key, name, description)
VALUES ('silo-allocation-grid', 'Silo Allocation', 'Allocate delivered bags to silos, see silo levels and time silo cracking runs'),
       ('kernel-pipeline-settings', 'Kernel Pipeline Settings', 'Sample spec limits, kg per crate, transporters, transport types, silo capacity and bag numbering')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now();

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT rf.role_id, f.id, 'true'
FROM public.role_features rf
JOIN public.features kp ON kp.id = rf.feature_id AND kp.key = 'kernel-production-grid'
CROSS JOIN (SELECT id FROM public.features WHERE key = 'silo-allocation-grid') f
WHERE rf.value = 'true'
ON CONFLICT (role_id, feature_id) DO NOTHING;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'kernel-pipeline-settings') f
WHERE r.role_name IN ('super_user', 'admin', 'Factory Manager', 'Production Manager', 'Quality Assurance')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- 2. ACTIONS ------------------------------------------------------------------

INSERT INTO public.actions (key, module, label, description)
VALUES ('kernel_settings.edit', 'Kernel Pipeline', 'Edit Kernel Pipeline Settings',
        'Change sample spec limits, kg per crate, transporters, transport types, silo capacity and bag numbering'),
       ('grower_intake.edit_batch_number', 'Grower Intake', 'Edit Batch Number',
        'Change the auto-generated batch number on a delivery')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE key = 'kernel_settings.edit') a
WHERE r.role_name IN ('super_user', 'admin', 'Factory Manager')
ON CONFLICT (role_id, action_id) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE key = 'grower_intake.edit_batch_number') a
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT (role_id, action_id) DO NOTHING;

-- 3. FUNCTION PERMISSIONS -------------------------------------------------------

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features kp ON kp.id = rf.feature_id AND kp.key = 'kernel-production-grid'
CROSS JOIN unnest(ARRAY[
    'get_kernel_pipeline_config', 'set_kernel_pipeline_setting', 'upsert_sample_spec_threshold',
    'upsert_crate_weight', 'upsert_transporter', 'upsert_transport_type', 'upsert_silo_capacity',
    'save_kernel_delivery', 'get_silo_overview', 'get_silo_allocation_batches', 'get_silo_runs',
    'allocate_bags_to_silo', 'unallocate_silo_bag', 'open_silo', 'close_silo'
]) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
