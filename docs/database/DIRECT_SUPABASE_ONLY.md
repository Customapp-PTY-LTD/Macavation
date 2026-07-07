# Direct Supabase only — AWS Lambda proxy retired (2026-07-07)

The portal now talks to Supabase directly for **everything**: auth, RPCs, and REST. No AWS Lambda is called anywhere in the browser code.

## What replaced what

| Old (AWS Lambda) | New (direct Supabase) |
|---|---|
| `POST <lambda>/auth/login` (email) | RPC `auth_login_email` — bcrypt verified **in-database** (`migrations/20260707150000_auth_login_email_direct.sql`) |
| `POST <lambda>/auth/login` (google) | Edge Function `auth-google` — verifies the Google id_token server-side inside Supabase, then looks up `public.users` |
| `POST <lambda>/proxy/function` (all RPCs) | `dataFunctions.callSupabaseRpc` → PostgREST `/rest/v1/rpc/<fn>` with the anon key (305/306 public functions already grant anon EXECUTE) |
| Sign-up via proxy | RPC `create_user_simple` directly (it already hashes the password in-database) |
| `authService.callFunction` / `makeAuthenticatedRequest` | Direct PostgREST / retired (throws with guidance) |

`WebPortal/index_supabase.js` is the old Lambda's handler source — it stays in the repo for reference but nothing calls it. The `LambdaProxyUrl` values in `appRouteConfig.json` / `macavation-supabase.js` are dormant config; no code fetches them.

## Token semantics (important, honest)

The session `token` is now a **client-side session marker only**. Under the Lambda it was validated per proxied request; direct PostgREST calls always rode on the anon key — which is how the app's direct-fallback path already worked. Real enforcement lives in the database (grants, function guards, RLS). If per-user server-side authorization is ever required, the path is Supabase Auth JWTs (the audit system's actor resolution already prefers JWT claims when present).

Who-did-what still works: both write paths send `X-User-Id`, which the audit triggers record (`audit.audit_log`) and stamp into `created_by`/`updated_by`.

## Status / rollout

- **Dev: live.** Migration applied, `auth-google` deployed, end-to-end tested (signup → wrong-password rejected → login returns token+user → no email enumeration; edge function error paths verified).
- **Prod DB: live (2026-07-07).** Both migrations applied via `db:apply-prod` (audit/ownership 20260707130000 + auth 20260707150000), `auth-google` deployed to `sofanhfpxifgdtooefzq`, both smoke-tested. `npm run audit:verify` passes on both databases.
- **Remaining:**
  1. Push git branches and deploy the portal; verify login on the prod site.
  2. Once stable: decommission the two AWS Lambdas (rzrx… prod, lizt… dev) and their Function URLs.

## Notes

- 4 of 18 users have no `password_hash` — they could never use email sign-in; they are Google-only or need a password set (`create_user_simple`/admin reset).
- `auth_login_email` returns one generic message for every failure (no email enumeration), and inactive accounts are refused.
- Consider adding rate limiting on auth attempts later (e.g. a failed-attempt counter table or Supabase Auth migration).
