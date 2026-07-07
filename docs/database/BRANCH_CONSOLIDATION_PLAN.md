# Supabase branch topology — final state (executed 2026-07-07)

**Decision:** names now match reality. No data was migrated; only branch labels and guards changed.

| Supabase branch | Ref | Role |
|---|---|---|
| `main` (default) | `sofanhfpxifgdtooefzq` | **PRODUCTION** — macavation.customapp.org, live data, edge functions |
| `dev` (was `UAT`) | `nmdmddugxclpqrwylyfa` | **DEV** — localhost, dev-macavation.customapp.org, all scripts/CLI |
| `archive` (was `prod`) | `yacxxwmihxvmtjvxryrc` | **PARKED — nothing may ever point at it** |

## What was done (2026-07-07)

1. Branch `UAT` renamed to `dev` (ref unchanged — no config, URL, or key changed anywhere).
2. Branch `prod` renamed to `archive`; its git-branch binding removed, so pushes to git `prod` no longer trigger anything against it.
3. `archive`'s ref added to `blockedRefs` in `supabase/projects.json`. Enforcement:
   - `assertAllowedProjectRef` / `assertAllowedSupabaseUrl` throw on it in every script;
   - the portal bootstrap (`WebPortal/js/macavation-supabase.js`) refuses any URL containing it;
   - `npm run db:check-project` scans the repo and **fails if any file references any blocked ref** (FruitLive or archive).
4. History audit: the archive branch has never had a dependent — no commit in the repo's entire history, no config, no site, no Lambda, no stash ever referenced its ref. It was created 2026-03-30 by the git-integration setup, its migrations failed immediately, and it has been inert since.

## Rules going forward

- Production data lives on `main` and is only changed via `CONFIRM_PROD=YES npm run db:apply-prod` per [DEV_TO_PROD_CHECKLIST.md](DEV_TO_PROD_CHECKLIST.md).
- Dev work happens against `dev` (`nmdmddugxclpqrwylyfa`) — the CLI stays linked to it (`npm run db:check-project` verifies).
- **`archive` is write-off storage: never link to it, never route to it, never bind git to it.** If it is ever deleted, nothing anywhere needs to change — that is the point.
- Do not bind Supabase git integration to the `dev` branch; migrations flow through `db:apply` / `db:apply-prod`, not git hooks (`supabase/migrations/` is not the source of truth — `migrations/` is).

## Still open (separate tracks)

- **Schema baseline into git** (needs Docker for `supabase db dump`): capture `dev`'s full schema into `supabase/baselines/` so git can rebuild it — the Phase 2 tables currently exist only in the `dev` database.
- **Production schema alignment**: bring `main` up to `dev`'s schema (21 missing tables, 81 divergent functions) via the baseline diff and `db:apply-prod`.
- **Pre-May 2026 history**: production pointed at FruitLive (`iwxmuemrfopajwvqdiae`) until ~May 2026; any Macavation data from that era may still live there. FruitLive remains blocklisted; sweep it read-only before it is ever deleted.
- **Demo site** (demo-macavation.customapp.org, git `demo` branch) still points at FruitLive — repoint or retire.
