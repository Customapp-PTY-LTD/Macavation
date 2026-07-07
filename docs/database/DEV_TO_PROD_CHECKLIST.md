# Dev → Prod Release Checklist

**Run this every single time anything is promoted from dev to production — code, schema, or data. No exceptions.**

Two databases exist (see `supabase/projects.json`):

| Target | Ref | Used by |
|---|---|---|
| **dev** | `nmdmddugxclpqrwylyfa` | localhost, dev-macavation.customapp.org, all scripts by default |
| **production** | `sofanhfpxifgdtooefzq` | macavation.customapp.org ONLY |

Ground rules:
- The CLI stays linked to **dev** at all times. Production is only ever touched through `db:apply-prod`, which re-links back automatically.
- Every schema/data change is a file in `migrations/` — no ad-hoc SQL against either database.
- Nothing reaches production that was not applied and tested on dev first (`db:apply-prod` enforces this against the dev ledger).

---

## 1. Pre-flight (on git `dev`, before merging anything)

- [ ] `npm run db:check-project` — CLI linked to dev, no blocked/unknown project refs anywhere.
- [ ] `npm run routing:verify` — only `macavation.customapp.org` can resolve to the production DB.
- [ ] Every schema change for this release exists as a `migrations/VERSION_name.sql` file and was applied to dev with `npm run db:apply -- migrations/<file>.sql` (this also records the dev ledger and runs `audit.attach_all()`).
- [ ] Feature-test the release against the dev site / dev DB.
- [ ] `npm run audit:verify` — dev side reports every table covered (owner columns + stamp + audit triggers).
- [ ] `npm run rbac:verify` — expected to pass; if it fails, the only acceptable cause is RBAC changes that are part of this release (they must be in a migration file).

## 2. Promote code (git)

- [ ] Merge `dev` → `prod` (and `main` if it is being kept in sync).
- [ ] On the merged `prod` branch, re-run: `npm run routing:verify` and `npm run db:check-project`.
- [ ] Push and deploy.

## 3. Promote database (migrations)

For **each** migration file in this release, in timestamp order:

- [ ] `CONFIRM_PROD=YES npm run db:apply-prod -- migrations/<file>.sql`

The script refuses to run if the migration is not on the dev ledger, records the production ledger, runs `audit.attach_all()` on production, and re-links the CLI to dev when done — even on failure.

- [ ] Confirm the CLI is back on dev: `npm run db:check-project`.

## 4. Post-release verification

- [ ] `npm run audit:verify` — both databases fully covered; audit log receiving events.
- [ ] `npm run rbac:verify` — roles/permissions content-identical between prod and dev.
- [ ] Live routing: `curl -s https://macavation.customapp.org/js/appRouteConfig.json` — the `prod` environment must point at `sofanhfpxifgdtooefzq`, everything else at `nmdmddugxclpqrwylyfa`.
- [ ] Spot-check one real write on the production site, then confirm it in the audit log (row in `audit.audit_log` with `actor_id` set; query via `supabase db query` while temporarily linked, or Supabase Studio).

## 5. If anything fails

- Code: revert the merge commit on `prod` and redeploy.
- Database: migrations are forward-only — write a new correcting migration, apply it to dev first, then repeat section 3. Never edit an applied migration file.
- If the CLI is ever left linked to production, immediately: `supabase link --project-ref nmdmddugxclpqrwylyfa`.

---

Related docs: [MIGRATION_AUDIT_OWNERSHIP.md](MIGRATION_AUDIT_OWNERSHIP.md) (the audit/ownership system), `docs/setup/UAT_DATABASE.md`, `docs/RBAC_GUIDE.md`.
