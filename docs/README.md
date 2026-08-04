# docs/

This directory is reference material. For anyone editing the portal (`WebPortal/`), the
authority on architecture, deployment and where things actually live is the repo root
`CLAUDE.md` — read that first, not this index.

## Subdirectories

| Path | Purpose | Files |
|---|---|---|
| `docs/architecture/` | Process-driven design notes and architecture write-ups | 3 |
| `docs/database/` | Database function/schema reference | 6 |
| `docs/demo/` | Demo readiness checklists and summaries | 2 |
| `docs/design/` | Design system spec and UI pattern docs | 13 |
| `docs/examples/` | Standalone example doc | 1 |
| `docs/guides/` | How-to guides for specific features/roles | 10 |
| `docs/implementation/` | Implementation summaries for completed features | 3 |
| `docs/markdown-archive/` | Legacy notes moved from the old `markdown files/` folder | 13 |
| `docs/modules/` | Per-module reference docs | 15 |
| `docs/phase2/` | Phase 2 planning, progress and workshop docs | 18 |
| `docs/proposals/` | Standalone proposal doc | 1 |
| `docs/setup/` | Setup instructions | 8 |
| `docs/testing/` | Testing/troubleshooting notes | 3 |
| `docs/user-guide/` | Rendered end-user guide content (see note below) | 48 |

File counts above were counted directly (`find docs/<dir> -type f | wc -l`) after the
de-duplication done by this same change; re-count if you add or remove files, since this
table is not enforced by anything and will drift like every other doc here.

## Start here

Of the 197 files under `docs/`, these are the ones that are both current and load-bearing —
each is either enforced by a script or is the up-to-date top-level plan:

- **`docs/design/DESIGN_SYSTEM.md`** — the design system spec. Enforced by `npm run ui:verify`
  (it currently fails on `dev` with 65 pre-existing violations elsewhere in the codebase — see
  root `CLAUDE.md` — but the spec itself is live).
- **`docs/RBAC_NEW_FUNCTION_CHECKLIST.md`** — the checklist for adding a new RBAC-gated
  function.
- **`docs/phase2/PHASE2_IMPLEMENTATION_PLAN.md`** — the current phase 2 plan. Its status table
  at the top is accurate; per root `CLAUDE.md`, the per-epic "Remaining work" tables below it
  describe a pre-2026-07-06 state and should not be costed or scheduled from.

## Known stale

- **`docs/markdown-archive/`** — legacy notes per `.cursorrules`. Its own `README.md` says to
  prefer current sources (`WebPortal/help/`, `.cursor/rules/`, `migrations/`) over anything
  archived here.
- **PWA documents** (`docs/guides/PWA_OFFLINE_GUIDE.md`, `docs/guides/PWA_ROLES_GUIDE.md`, and
  the archive copies of both plus `PWA_IMPLEMENTATION_SUMMARY.md`) describe a PWA/offline
  feature that has since been retired. They remain for history; do not treat them as describing
  current behaviour.
- **`docs/database/DATABASE_FUNCTIONS_REQUIRED.md`** — its content predates most of 2026's
  migrations, so treat any function list in it as a historical snapshot, not a current
  inventory.

## Open questions

These are filing decisions this change deliberately did not make, because each needs a human
judgment call this run cannot verify from inside the repo:

1. **`RBAC_GUIDE.md` exists in three places and they disagree:** `docs/RBAC_GUIDE.md` (161
   lines), `docs/guides/RBAC_GUIDE.md` (536 lines), `BluePrint/RBAC_GUIDE.md` (466 lines).
   Root `CLAUDE.md` says the pattern in the `docs/RBAC_GUIDE.md` copy — granting a new function
   to every role — is the one that caused the live permission drift described there. Which of
   the three should be the canonical guide (and whether the other two should then be retired)
   is an RBAC-correctness decision, not a filing one, and is left to a human.

2. **`.claude/rules/` and `.cursor/rules/` hold the same three rules, diverged.**
   `agent-fleet-submit`, `fleet-test-gate` and `git-hygiene` exist in both directories with
   different content (244 lines of diff across the three), and `.cursor/rules/` additionally
   holds four rules with no `.claude/rules/` counterpart (`no-e2e-test-results-in-git.mdc`,
   `supabase-dev-uat.mdc`, `supabase-macavation-only.mdc`, `user-guide-update.mdc`, plus
   `user-guide-on-webportal-changes.mdc`). Root `CLAUDE.md` points Claude Code at one set and
   `.cursorrules` points Cursor at the other. Reconciling them governs agent behaviour in this
   repo — including this run — so it needs a human, not this change.

3. **`BluePrint/` is 13 files of generic, non-project-specific boilerplate** that probably
   belongs under a `docs/reference/`-style location, or should be retired outright. It was left
   in place here because root `CLAUDE.md` cites `BluePrint/RBAC_GUIDE.md` by path (see item 1
   above), and other in-flight changes already edit `CLAUDE.md` — folding `BluePrint/` into
   `docs/` would conflict with those.

4. **Two `docs/markdown-archive/` files diverge from their live counterpart** and were
   therefore kept rather than deleted as duplicates:
   - `MODULE_CREATION_SUMMARY.md` — archive copy 95 lines vs. `docs/modules/MODULE_CREATION_SUMMARY.md`
     95 lines; the only difference is one sentence's wording (the archive copy says "this
     archive folder", the live copy names `docs/markdown-archive/` explicitly).
   - `ROLE_ACCESS_UPDATE.md` — archive copy 123 lines vs. `docs/guides/ROLE_ACCESS_UPDATE.md`
     121 lines; the archive copy has one extra paragraph, about a migration
     (`20260218000001_grant_all_data_functions_to_all_roles.sql`) granting a data function to
     every role, that the live copy does not have. That paragraph describes the same
     grant-to-every-role pattern flagged in item 1 above, so whether the live copy dropped it
     deliberately or by accident is worth a human look.

   Sixteen other same-named pairs between `docs/markdown-archive/` and the live tree were
   byte-identical and the archive copy was deleted as a true duplicate; those two above are the
   only ones kept.

5. **The user guide exists in more than one rendering.** `docs/user-guide/` (48 files) and
   `WebPortal/help/` both hold end-user-facing guide content, with screenshots stored in more
   than one place across the two. Consolidating them is a content decision, not a filing one,
   and per `.cursor/rules/user-guide-update.mdc` is already a live deliverable of other work —
   out of scope here.

6. **Two client-facing documents give unreconciled remaining-effort estimates and neither can
   be verified from inside this repo:** `docs/phase2/progress-update-2026-07-28.html` states
   "roughly 10 to 15 days" of remaining development, while `docs/phase2/PHASE2_IMPLEMENTATION_PLAN.md`,
   written three days later, states "~77-93 person-days" (about 15-19 working weeks). Both are
   client-facing and neither figure is asserted here as correct — reconciling them needs
   whoever owns the estimate, not a repo-only check.
