-- ============================================================================
-- Report builder — screen-level permissions for the new editor route and the
-- write actions it exposes.
--
-- sales-forecasting-grid (the report LIST, route key kept for compatibility —
-- see WebPortal/modules/sales-reports/) already exists as a feature and is
-- granted to 'PWA Sales' (see 20260302000003_seed_features.sql). It was never
-- granted to 'Sales Exec' or 'Palladium Manager' — the two roles the report
-- builder is actually built for — so this backfills that grant. super_user
-- and admin already bypass feature checks in code (role-menu-config.js
-- hasAccess()) and need no row here.
--
-- sales-report-editor is a brand new route, reached only by picking a row on
-- the list (no sidebar entry, no deep link — see CLAUDE.md "No screen is
-- deep-linkable"). Without a features row + role_features grant, appRouter's
-- roleMenuConfig.hasAccess('sales-report-editor') denies everyone except
-- super_user/admin, so this is required for Sales Exec / Palladium Manager to
-- open the editor at all.
--
-- reports.report.create / .edit / .delete gate the buttons via
-- WebPortal/js/action-access.js (data-action-perm + hasAction()); they do NOT
-- gate the RPCs themselves — override_report_metric_value and friends check
-- report status (draft-only) in SQL but not role, matching how every other
-- report-builder RPC in the two prior migrations behaves (see role_permissions
-- comments there: "the table is vestigial"). Restricting these action grants
-- to the reporting roles is therefore the only enforcement point for "can this
-- role create/edit/delete a report" — kept deliberately narrow rather than
-- following the drift CLAUDE.md warns about (RBAC_GUIDE.md's pattern of
-- granting a new function to every role).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill sales-forecasting-grid (the list) to Sales Exec and Palladium Manager.
-- ----------------------------------------------------------------------------
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'sales-forecasting-grid') f
WHERE r.role_name IN ('Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. New feature: sales-report-editor.
-- Real schema: public.features(id BIGSERIAL, key, name, description, is_active, created_at, updated_at).
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description)
VALUES (
    'sales-report-editor',
    'Sales & Production Report Editor',
    'Edit a draft weekly/monthly director report — sections, entered figures and executive summary'
)
ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'sales-report-editor') f
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. New actions: reports.report.create / .edit / .delete.
-- Real schema: public.actions(id BIGSERIAL, key, module NOT NULL, label, description, is_active, ...)
-- — module has no default and must be supplied.
-- ----------------------------------------------------------------------------
INSERT INTO public.actions (key, module, label, description)
VALUES
    ('reports.report.create', 'Reports', 'Create Report', 'Create a new weekly/monthly draft report'),
    ('reports.report.edit',   'Reports', 'Edit Report',   'Override figures, toggle sections and edit the executive summary on a draft report'),
    ('reports.report.delete', 'Reports', 'Delete Report', 'Delete a draft report')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN public.actions a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
  AND a.key IN ('reports.report.create', 'reports.report.edit', 'reports.report.delete')
ON CONFLICT (role_id, action_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
