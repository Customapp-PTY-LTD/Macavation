-- Sales & Production Data page RBAC — feature and action seeds only.
--
-- The data-page tables and RPCs already exist in
-- migrations/20260819090000_data_page_production_daily.sql, which already carries its own
-- function-grant and role_permissions blocks (reads to every role; writes to super_user, admin,
-- Sales Exec, Palladium Manager). This migration adds ONLY the menu-visibility
-- (features/role_features) row for the new screen and the button-permission (actions/role_actions)
-- row that gates its edit controls — it must not, and does not, re-grant any function.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260820090000_sales_data_page_rbac.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).
--
-- Known consequence of not yet applying this file: WebPortal/js/appRouter.js:137-155 runs
-- roleMenuConfig.hasAccess(routeName) for any route loaded into #content-area, and
-- WebPortal/js/role-menu-config.js:603-628 treats Session.get('featureKeys') as authoritative for
-- non-admin roles. featureKeys and actionKeys are cached at login, so until this migration is
-- applied the sales-data-grid route is gated off for every non-admin role — and even after it is
-- applied, an already-logged-in user must sign out and back in to pick up the new feature/action
-- keys. The sidebar link stays hidden by menu-filter.js in the meantime; this is expected.
--
-- Convention followed: migrations/20260817110000_report_builder_rbac.sql's seeding block (real
-- schema: public.features(id BIGSERIAL, key, name, description, ...), public.actions(id BIGSERIAL,
-- key, module NOT NULL, label, description, ...) — module has no default and must be supplied).
-- role_features.value and role_actions.value are text, not boolean — the literal 'true' is used
-- for both, never a bare boolean, or comparisons elsewhere raise
-- "operator does not exist: text = boolean".

-- ============================================================================
-- 1. Feature: sales-data-grid
-- ============================================================================

INSERT INTO public.features (key, name, description)
VALUES (
    'sales-data-grid',
    'Sales & Production Data',
    'Pete''s standing data page — daily production and the other reporting datasets'
)
ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

-- Grant to the four roles that own this reporting: super_user, admin, and the two people who own
-- reporting between them — Sales Exec (Pete) and Palladium Manager (Joslyn). Not looped over every
-- role: CLAUDE.md records "grant to every role" as the direct cause of this repo's current
-- permission drift between the actions/role_actions layer and role_permissions.
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'sales-data-grid') f
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- ============================================================================
-- 2. Action: reports.data.edit — gates every input/save/reseed control on the data page.
-- ============================================================================

INSERT INTO public.actions (key, module, label, description)
VALUES (
    'reports.data.edit',
    'Sales Reporting',
    'Edit Data Page',
    'Edit, save and re-seed rows on the Sales & Production Data page'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE key = 'reports.data.edit') a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, action_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
