# Branch consolidation plan: end state = `main` + `prod`, UAT deleted

**Decision (2026-07-07):** production data **stays on `main`** (`sofanhfpxifgdtooefzq`) — it is never migrated. The empty `prod` branch (`yacxxwmihxvmtjvxryrc`) is rebuilt as the new **dev** database. The `UAT` branch (`nmdmddugxclpqrwylyfa`, today's dev DB) is deleted **only when the confidence checklist below is 100% green**.

Why this direction: moving production data to another branch is a full cutover with downtime and real risk, purchased only for nicer branch names. Keeping production untouched is zero-risk; the `prod` branch can be renamed `dev` at the end if naming should match meaning (rename is a label change only — the ref and URLs never change).

Current confidence in deleting UAT: **0%** — it holds the only copy of the Phase 2 schema (21 tables not recreatable from the repo), the audit system, and the working dev environment. The phases below take it to 100%.

---

## Phase 0 — Prerequisite (one-time, this machine)

- [ ] Docker Desktop running (`supabase db dump` needs it; `pg_dump` is not installed locally).

## Phase 1 — Make git able to rebuild dev *(0% → ~80%)*

The keystone: once the schema lives in git, UAT stops being unique.

- [ ] With CLI linked to dev: `supabase db dump --linked -f supabase/baselines/dev_schema_<date>.sql` (full schema: tables, functions, triggers, RLS, grants).
- [ ] Dump seed-worthy data (RBAC tables, config/reference tables) to `supabase/baselines/dev_seed_<date>.sql`.
- [ ] Commit both to git `dev`, mirror to `prod` branch.
- [ ] **Gate:** rebuild proof — apply the baseline to a scratch database (local `supabase start`, or the `prod` branch itself in Phase 2) and schema-diff against dev: zero drift.

## Phase 2 — Rebuild the `prod` branch as the new dev

- [ ] Remove/repoint the branch's git binding (currently git `prod`) so Supabase git integration stops running failed migrations against it.
- [ ] Reset the branch to empty.
- [ ] Apply the Phase 1 baseline schema + seed; run `select audit.attach_all();`.
- [ ] Deploy the 3 edge functions (`send-daily-digest`, `send-daily-digest-whatsapp`, `evaluate-stock-alerts-cron`) to the new ref.
- [ ] Seed working data from production (adapt `scripts/copy-prod-data-to-uat.mjs` to the new target).
- [ ] **Gate:** `audit:verify` and `rbac:verify` pass against the new DB; the portal runs against it locally.

## Phase 3 — Repoint dev routing (one place, by design)

- [ ] `supabase/projects.json`: dev ref `nmdmddug…` → `yacxxwm…`; run `npm run supabase:sync-portal`.
- [ ] Update `supabase/remote.toml`; re-link CLI: `supabase link --project-ref yacxxwmihxvmtjvxryrc`.
- [ ] `npm run routing:verify` + `npm run db:check-project` green; commit, mirror to `prod` git branch, deploy the dev site.
- [ ] From here, nothing routes to UAT. Production routing is untouched throughout.

## Phase 4 — Soak, then the 100% checklist

Freeze UAT (no writes) and work normally on the new dev DB for 1–2 weeks. Delete UAT only when **every** box is ticked:

- [ ] Phase 1 rebuild gate passed (git provably reconstructs the schema).
- [ ] New dev ledger reconciled with `migrations/` files.
- [ ] Repo sweep on **all git branches**: zero references to `nmdmddugxclpqrwylyfa` in code, config, docs, `.cursor/mcp.json`.
- [ ] `audit:verify` + `rbac:verify` + `routing:verify` green.
- [ ] **Supabase Storage checked**: any buckets/files in UAT (e.g. Document Management uploads — dev has 58 `documents` rows) copied to the new dev DB or explicitly written off.
- [ ] Data worth keeping copied (or explicitly written off) — UAT's operational data is mostly a stale June copy of prod.
- [ ] Soak period passed with no "that only existed in UAT" surprises.
- [ ] Final full dump of UAT (schema + data) archived somewhere durable as a last-resort snapshot.
- [ ] Then: `supabase branches delete UAT` → end state **`main` (production) + `prod` (dev)**.

## Phase 5 — Optional, cosmetic

- [ ] Rename branch `prod` → `dev` if names should match meaning. Zero functional impact; skip if the requirement is literally the names `main` + `prod`.

---

## Separate track (not blocked by any of this)

Production schema alignment — the 21 Phase-2 tables and 81 divergent functions missing from `main` — is its own release, driven by the same Phase 1 baseline (diff baseline vs production, review, apply via `CONFIRM_PROD=YES npm run db:apply-prod`). Do it via [DEV_TO_PROD_CHECKLIST.md](DEV_TO_PROD_CHECKLIST.md).
