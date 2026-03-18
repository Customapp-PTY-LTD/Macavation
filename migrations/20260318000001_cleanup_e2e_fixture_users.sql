-- Remove disposable E2E users created by Playwright user-crud tests (e2e.*@test.macavation.co.za).
-- Safe to re-run: no-op when none match.

DELETE FROM public.users WHERE email LIKE 'e2e.%@test.macavation.co.za';
DELETE FROM auth.users WHERE email LIKE 'e2e.%@test.macavation.co.za';
