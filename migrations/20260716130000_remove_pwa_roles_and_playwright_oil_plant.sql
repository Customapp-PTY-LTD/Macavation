-- Remove PWA roles and obsolete Playwright / PWA test accounts from production.
-- Dev already culled these via 20260709170000; this migration is safe to re-run (0 rows on dev).
--
-- Order: users first (users.role_id is ON DELETE NO ACTION), then roles.
-- role_features / role_permissions / role_actions for removed roles CASCADE from roles.

BEGIN;

DELETE FROM public.users
WHERE lower(email) IN (
    'playwright.oil.plant@macavation.co.za',
    'cedric.keown@gmail.com'
);

DELETE FROM public.roles
WHERE role_name LIKE 'PWA %';

COMMIT;

NOTIFY pgrst, 'reload schema';
