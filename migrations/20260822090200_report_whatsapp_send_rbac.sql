-- RBAC for WhatsApp report distribution — button permissions only, no new screen.
--
-- The send flow lives inside the EXISTING report editor route ('sales-report-editor', seeded at
-- migrations/20260817110000_report_builder_rbac.sql), as a button plus an inline Bootstrap modal in
-- WebPortal/modules/sales-reports/html/report_editor.html. There is no new sidebar destination, so
-- this migration adds NO features/role_features rows — adding a feature key for a screen that does
-- not exist would be inert at best and would move an unrelated screen's visibility at worst.
--
-- Two action keys, because they gate genuinely different risks:
--   reports.report.send      — send a published report's figures to a phone number
--   reports.recipient.manage — add to / deactivate entries on the saved distribution list
--
-- Granted to the same four roles that already hold the report-builder write actions and RPCs
-- (migrations/20260817100000_report_instances_and_targets.sql:1294-1306,
--  migrations/20260821180000_report_targets_module.sql) — super_user, admin, Sales Exec and
-- Palladium Manager. Not looped over every role: CLAUDE.md records "grant to every role" as the
-- direct cause of this repo's existing drift between role_actions and role_permissions.
--
-- Convention (copied from migrations/20260821180000_report_targets_module.sql, which states it
-- explicitly): actions(key, module, label, description); role_actions(role_id, action_id, value)
-- where value is TEXT, so the literal is the string 'true', not a boolean.
--
-- NOTE for the UI that consumes these keys: CLAUDE.md records that data-action-perm is swept ONCE
-- over static markup in #content-area and is therefore INERT on markup rendered later. The
-- recipient rows in the send modal are rendered dynamically, so their controls must be gated by
-- calling hasAction('reports.recipient.manage') inline at render time
-- (WebPortal/js/action-access.js:95). Only the static "Send via WhatsApp" toolbar button in
-- report_editor.html can rely on data-action-perm.
--
-- Idempotent: ON CONFLICT on both inserts, so a re-run is a no-op.

-- ============================================================================
-- 1. ACTION — reports.report.send
-- ============================================================================

INSERT INTO public.actions (key, module, label, description)
VALUES (
    'reports.report.send',
    'Sales Reporting',
    'Send Report on WhatsApp',
    'Send a published Sales & Production report to selected WhatsApp numbers'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE key = 'reports.report.send') a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, action_id) DO NOTHING;

-- ============================================================================
-- 2. ACTION — reports.recipient.manage
-- ============================================================================

INSERT INTO public.actions (key, module, label, description)
VALUES (
    'reports.recipient.manage',
    'Sales Reporting',
    'Manage Report Recipients',
    'Add, relabel and deactivate saved WhatsApp recipients for report distribution'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE key = 'reports.recipient.manage') a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, action_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
