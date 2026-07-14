-- Cull unused / test / duplicate roles and two obsolete user accounts.
--
-- Keeps the eight in-use roles (confirmed with the owner 2026-07-09):
--   super_user, admin, Shareholder, Sales Exec, Factory Manager,
--   Production Manager, Palladium Manager, Quality Assurance.
--
-- Safe by construction — verified against dev on 2026-07-09:
--   * The two users below have NO inbound references anywhere
--     (created_by / updated_by / *_by / manager_id / etc. all zero).
--     password_reset_tokens (CASCADE) and documents.uploaded_by (SET NULL)
--     self-clean.
--   * role_actions, role_features, role_permissions and notifications FK to
--     roles ON DELETE CASCADE, so their rows for the culled roles clean up.
--   * No test_instances.run_by_role / test_scenarios.role_required point at a
--     culled role.
-- users.role_id is ON DELETE NO ACTION, so the two users are removed first.

BEGIN;

-- 1. Remove the two obsolete accounts.
--      cedric.keown@gmail.com                  — sole member of "PWA Field Operations"
--      playwright.oil.plant@macavation.co.za   — Playwright E2E test account ("Oil Plant Manager")
DELETE FROM public.users
WHERE lower(email) IN (
    'cedric.keown@gmail.com',
    'playwright.oil.plant@macavation.co.za'
);

-- 2. Remove the 15 unused / test / duplicate roles.
DELETE FROM public.roles
WHERE role_name IN (
    'Oil Plant Manager',        -- inactive, E2E, only the Playwright test user
    'PWA Field Operations',     -- only cedric.keown@gmail.com (removed above)
    'PWA Document Management',  -- 0 users
    'PWA Finance',              -- 0 users
    'PWA Grower Intake',        -- 0 users
    'PWA Production',           -- 0 users
    'PWA Quality Assurance',    -- 0 users
    'PWA Sales',                -- 0 users
    'PWA Stock Management',     -- 0 users
    'Admnistrator1',            -- typo of "Administrator", 0 users
    'General Manager',          -- inactive, E2E, 0 users
    'KP Data Admin',            -- inactive, never assigned
    'Office Administrator',     -- inactive, E2E, 0 users
    'QA Supervisor',            -- E2E, 0 users
    'Test Role'                 -- test, 0 users
);

COMMIT;
