-- Report builder RBAC (Phase 2 of 4 for the Sales Exec reporting feature) — feature and action
-- seeds only.
--
-- The report-builder tables and RPCs already exist in migrations/20260817090000_report_builder_
-- foundations.sql and migrations/20260817100000_report_instances_and_targets.sql, both of which
-- already carry their own function-grant and role_permissions blocks for every function they
-- introduce. This migration adds ONLY the menu-visibility (features/role_features) and
-- button-permission (actions/role_actions) rows for the editor screen and its buttons — it must
-- not, and does not, re-grant any function.
--
-- Why no new feature row for the report LIST: the list screen reuses the existing
-- 'sales-forecasting-grid' feature key, already seeded at migrations/20260302000003_seed_features.
-- sql:45-49,118-127. Which roles currently hold that key cannot be read from this checkout, so
-- this migration does not touch role_features for it — changing that row's grants here would
-- silently alter who can see an existing screen, which is out of scope for RBAC additions for a
-- screen that does not exist yet.
--
-- What the report LIST actually exposes vs. what the EDITOR exposes: list_report_instances
-- (migrations/20260817100000_report_instances_and_targets.sql) returns period_*, fy, version,
-- status, section_count, override_count, metric_count, timestamps, pdf_storage_path and
-- total_count — metadata and counts only, no metric figures. Every actual figure comes from
-- get_report_instance (same file), reachable only from the editor route. That route is gated
-- behind the new 'sales-report-editor' feature key seeded below, so a role without that key sees
-- the list (via 'sales-forecasting-grid') but cannot open a report to see its numbers.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260817110000_report_builder_rbac.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).
--
-- Known consequence of not yet applying this file, recorded rather than fixed here (handling it in
-- the UI belongs to the plan that builds the list/editor screens, not to this migration):
-- WebPortal/js/appRouter.js:137-155 runs roleMenuConfig.hasAccess(routeName) for any route loaded
-- into #content-area, and WebPortal/js/role-menu-config.js:603-628 treats Session.get('featureKeys')
-- as authoritative for non-admin roles. featureKeys and actionKeys are cached at login, so until
-- this migration is applied the editor route is gated off for every non-admin role — and even
-- after it is applied, an already-logged-in user must sign out and back in to pick up the new
-- feature/action keys.
--
-- Convention followed: migrations/20260812100000_crm_whatsapp_module.sql's seeding block (real
-- schema: public.features(id BIGSERIAL, key, name, description, ...), public.actions(id BIGSERIAL,
-- key, module NOT NULL, label, description, ...) — module has no default and must be supplied).
-- role_features.value and role_actions.value are text, not boolean — the literal 'true' is used
-- for both, never a bare boolean, or comparisons elsewhere raise
-- "operator does not exist: text = boolean".

-- ============================================================================
-- 1. Feature: sales-report-editor
-- ============================================================================

INSERT INTO public.features (key, name, description)
VALUES (
    'sales-report-editor',
    'Report Editor',
    'Open, edit and override figures on a weekly or monthly report'
)
ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

-- Grant sales-report-editor to the four roles that own this reporting: super_user, admin, and the
-- two people who own reporting between them — Sales Exec (Pete) and Palladium Manager (Joslyn).
-- Not looped over every role: CLAUDE.md records "grant to every role" as the direct cause of this
-- repo's current permission drift between the actions/role_actions layer and role_permissions.
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'sales-report-editor') f
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- ============================================================================
-- 2. Actions: report editor buttons, module 'Sales Reporting'
--
-- reports.report.publish and reports.report.generate have no data-action-perm referencing them
-- yet — the publish and PDF-generation UI land in a later plan. An action key with no
-- data-action-perm referencing it is inert (WebPortal/js/action-access.js is default-deny and
-- simply never consults it), so seeding them now costs nothing and lets this feature need exactly
-- one RBAC migration rather than three.
-- ============================================================================

INSERT INTO public.actions (key, module, label, description)
VALUES
    ('reports.report.create',   'Sales Reporting', 'Create Report',      'Create a new weekly or monthly report'),
    ('reports.report.edit',     'Sales Reporting', 'Edit Report',        'Edit a draft report''s sections and figures'),
    ('reports.report.delete',   'Sales Reporting', 'Delete Report',      'Delete a draft report'),
    ('reports.report.publish',  'Sales Reporting', 'Publish Report',     'Freeze and publish a report'),
    ('reports.report.generate', 'Sales Reporting', 'Generate Report PDF', 'Generate the PDF for a published report')
ON CONFLICT (key) DO NOTHING;

-- Grant all five action rows to the same four roles as the feature row above.
INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (
    SELECT id FROM public.actions
    WHERE key IN (
        'reports.report.create', 'reports.report.edit', 'reports.report.delete',
        'reports.report.publish', 'reports.report.generate'
    )
) a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, action_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
