-- Remove disposable E2E users created by Playwright user-crud tests.
-- Matches: email e2e.<segment>@test.macavation.co.za and/or username e2e_* on test domain.
-- Idempotent: safe to re-run. Complements 20260318000001_cleanup_e2e_fixture_users.sql for DBs
-- that accumulated more runs after the earlier migration.

DELETE FROM public.users
WHERE email ILIKE 'e2e.%@test.macavation.co.za'
   OR (
        COALESCE(username, '') LIKE 'e2e\_%' ESCAPE '\'
        AND email ILIKE '%@test.macavation.co.za'
   );

DELETE FROM auth.users
WHERE email ILIKE 'e2e.%@test.macavation.co.za';
