# Migration runbook: audit & ownership housekeeping

**Migration:** `migrations/20260707130000_audit_ownership_housekeeping.sql`
**Status:** applied to **dev** 2026-07-07 (verified end-to-end). **NOT yet applied to production** — held deliberately; apply via section "Applying to production" below.

## What it does

From this migration on, everything that enters the database gets an owner and every row change is logged. Forward-only: historical rows are not backfilled (per decision 2026-07-07).

1. **`audit` schema + `audit.audit_log`** — one row per INSERT / UPDATE / DELETE (row level) and TRUNCATE (statement level) on every `public` table: timestamp, table, operation, row id, actor, actor source, DB role, changed columns, and old/new values (UPDATEs store only the changed columns). The log is sealed from API roles (RLS enabled, no grants; not exposed via PostgREST).
2. **Owner columns everywhere** — `created_by uuid` / `updated_by uuid` (→ `public.users.id`, no FK by design) added to every public table that lacks them.
3. **Automatic stamping** — trigger `aaa_stamp_actor` fills `created_by` on INSERT and `updated_by` on INSERT/UPDATE whenever the request carries identity. Explicit values passed by RPCs win (the trigger only fills blanks).
4. **Actor resolution** (`audit.current_actor()`), in priority order:
   - `app.user_id` transaction setting — for server-side scripts: `select set_config('app.user_id', '<users.id uuid>', true);` at the start of the transaction;
   - JWT claims `user_id` / `sub` — when a Supabase-signed JWT is used;
   - `X-User-Id` request header — the portal sends this on every PostgREST call and on Lambda proxy calls;
   - otherwise NULL with `actor_source='unknown'` — **the write is still logged**.
5. **Future tables are covered automatically** — `audit.attach_all()` is idempotent and makes every table compliant; `npm run db:apply` and `npm run db:apply-prod` run it after every migration.
6. **Health checks** — `public.audit_coverage()` (service-role only) reports gaps; `npm run audit:verify` runs it against both databases and fails on any uncovered table. `public.audit_probe()` lets any client path check what actor the DB would attribute to it.

## Client/app side (already in git)

- `WebPortal/js/data-functions.js` sends `X-User-Id` (from `getCurrentUserId()`) on both write paths: direct PostgREST RPC calls and Lambda proxy calls.
- **Lambda proxy TODO (only missing piece for 100% actor coverage):** the Lambda receives `X-User-Id` from the portal but must forward it on its PostgREST/Postgres calls (or run `select set_config('app.user_id', <id>, true)`). Until then, writes proxied through the Lambda are logged with `actor_source='unknown'`. The Lambda source is not in this repo — see `docs/setup/UAT_LAMBDA.md` for where it lives.

## Applying to production

Follow [DEV_TO_PROD_CHECKLIST.md](DEV_TO_PROD_CHECKLIST.md); the DB step is:

```bash
CONFIRM_PROD=YES npm run db:apply-prod -- migrations/20260707130000_audit_ownership_housekeeping.sql
npm run audit:verify   # must report both databases fully covered
```

Notes:
- Nullable columns + triggers only; no data is modified and no downtime is expected.
- Adds one extra insert per row write (audit log). Negligible at current volumes (~24 MB DB).

## Verifying it works (what was run on dev)

1. `POST /rest/v1/rpc/audit_probe` with `X-User-Id: <uuid>` → `{"actor":"<uuid>","source":"header"}`.
2. Insert/update/delete via PostgREST with the header → `created_by`/`updated_by` stamped, three `audit.audit_log` rows with the actor; UPDATE rows list `changed_cols` with old/new values.
3. The same writes **without** the header → still logged, `actor_id NULL`, `actor_source 'unknown'`.

## Operational notes

- The audit log grows with every write. Revisit retention when it gets large (e.g. partition or archive rows older than 12–24 months). Indexed on `occurred_at`, `(table_name, occurred_at)`, and `actor_id`.
- `X-User-Id` is client-supplied and therefore *attributable*, not *tamper-proof* — fine for housekeeping ("who captured what"), not a substitute for authorization. If forensic-grade attribution is ever needed, mint Supabase-signed JWTs at login so the `jwt` source takes over.
- The log records `db_role` and `request_path` too, so service-role/script writes are distinguishable from app writes.
