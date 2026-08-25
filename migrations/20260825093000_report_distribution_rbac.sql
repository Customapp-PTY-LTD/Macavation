-- RBAC for the Report Distribution screen — one feature key, reusing the existing actions.
--
-- Context. migrations/20260822090200_report_whatsapp_send_rbac.sql:6 deliberately added NO
-- features/role_features rows, because at that time no screen existed for them to reveal: a feature
-- key pointing at nothing puts a dead link in the sidebar. The screen now exists
-- (WebPortal/modules/report-distribution/, route key report-distribution-grid), so this migration
-- adds its feature key.
--
-- No new ACTION is added. Writes on that screen are gated on reports.recipient.manage, which
-- already exists and is already granted to the same four roles
-- (migrations/20260822090200_report_whatsapp_send_rbac.sql:56-70). Adding a second, near-identical
-- action would be exactly the kind of duplication that produced this repo's existing drift between
-- role_actions and role_permissions.
--
-- Granted to the same four roles that hold every other report action — super_user, admin, Sales Exec
-- and Palladium Manager — named explicitly rather than looped over every role. CLAUDE.md records
-- "grant to every role" as the direct cause of this repo's existing permission drift.
--
-- ⚠ A route stays hidden until BOTH of these are true: this feature row exists, AND the user logs
-- out and back in. Session.get('featureKeys') is populated at login (WebPortal/js/appRouter.js:137-155),
-- so an already-signed-in super_user will not see the new sidebar entry until they re-authenticate.
-- appRouter reaches the page by route regardless, which is the quickest way to confirm it works.
--
-- Idempotent: ON CONFLICT on both inserts, so a re-run is a no-op.

-- ============================================================================
-- 1. FEATURE — report-distribution-grid
--
-- The key must match the route key in WebPortal/js/appRouteConfig.json exactly. A mismatch produces
-- a screen that is permanently invisible with no error anywhere, which is a genuinely slow thing to
-- diagnose.
-- ============================================================================

INSERT INTO public.features (key, name, description)
VALUES (
    'report-distribution-grid',
    'Report Distribution',
    'Who receives the daily, weekly and monthly Sales & Production reports on WhatsApp'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'report-distribution-grid') f
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
