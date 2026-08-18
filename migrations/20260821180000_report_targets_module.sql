-- Report Targets & Prior-Period Baselines — screen wiring (features/actions only).
--
-- The underlying tables/RPCs (report_period_targets, report_manual_baselines,
-- get_report_metrics, get_report_period_targets, upsert_report_period_target,
-- copy_report_period_targets, get_report_manual_baselines, upsert_report_manual_baseline)
-- already exist and are already granted (migrations/20260817090000_report_builder_foundations.sql,
-- migrations/20260817100000_report_instances_and_targets.sql — see those files' own RBAC
-- sections, which already scope the write RPCs to the same four roles below). This migration
-- only adds the menu-visible feature for the new WebPortal/modules/report-targets/ screen and
-- the action key that gates its inline Save/Copy/Add-baseline controls.
--
-- Convention: features(key, name, description); role_features(role_id, feature_id, value text);
-- actions(key, module, label, description); role_actions(role_id, action_id, value text) —
-- value columns are text, not boolean, so the literal is the string 'true'.
-- Modeled on migrations/20260812100000_crm_whatsapp_module.sql section 4.

-- ============================================================================
-- 1. FEATURE — report-targets-grid (sidebar menu visibility)
-- ============================================================================

INSERT INTO public.features (key, name, description)
VALUES (
    'report-targets-grid',
    'Report Targets',
    'Set per-period report targets and enter prior-period baselines'
)
ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'report-targets-grid') f
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- ============================================================================
-- 2. ACTION — reports.target.edit (gates inline Save / Copy / Add baseline controls)
-- ============================================================================

INSERT INTO public.actions (key, module, label, description)
VALUES (
    'reports.target.edit',
    'Reports',
    'Edit Report Targets',
    'Set per-period report targets and enter prior-period baselines'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE key = 'reports.target.edit') a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, action_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
