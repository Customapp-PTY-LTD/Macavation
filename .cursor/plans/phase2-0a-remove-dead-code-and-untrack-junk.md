# Delete unreachable portal files and untrack `agent-tools/`

## Context

Phase 2 opens with an organisation pass. `CLAUDE.md` already documents that this repo contains decoy
files that cost real discovery time — "`WebPortal/modules/dashboard/html/executive_dashboard.html` is
a 37-line dead stub still reading 'Chart will be displayed here'. **Nothing renders it.**" That is
not the only one.

Every file listed below was verified unreferenced before this plan was written. The verification
method for each is stated so you can re-run it rather than trusting this document.

**The router registry is the authority on what is live.** `WebPortal/js/appRouteConfig.json` holds 71
routes; `WebPortal/index.html` loads three further scripts directly (`modules/assistant/mac-assistant-api.js`
at `:595`, `mac-assistant-shell.js` at `:596`, `modules/mascot/mac-mascot.js` at `:597`). A module
file that appears in neither is loaded by nothing.

This plan is deletions only. It authors no migration, changes no behaviour, and touches no script.

## Scope

**In:** deleting 10 unreachable files, 3 empty directories, 5 root-level orphans, and `e2e/`;
untracking `agent-tools/`; one paragraph added to `CLAUDE.md`.

**Out — deliberately not touched:**

- **`WebPortal/modules/supply-chain-flow/`.** It is in neither `appRouteConfig.json` nor
  `role-menu-config.js` (0 matches in both), so it is unreachable — but `scripts/apply_user_guide_help_links.mjs:1037`
  **writes to** `WebPortal/modules/supply-chain-flow/html/supply_chain_flow.html`, the same script
  references the module at `:158`, `:295`, `:368`, `:414`, `:521`, `:885`, and
  `scripts/ingest-macavation-assistant-kb.mjs:114` maps it into the assistant knowledge base.
  `WebPortal/assets/docs/user-guide.html:201` documents "supply chain flow" as a live feature.
  Deleting it would break a script that is meant to be run after new screens ship. Whether this
  module should be reinstated into the registry or retired is a **product decision for a human** —
  leave every file under it exactly as is.
- **Top-level `modules/`, `css/`, `js/`, and `styles.css`** — a separate plan owns those.
- **`scripts/check-supabase-project.mjs`** — it names `qa-data-seeder.html` and
  `test-scenarios-viewer.html` in `SCAN_FILES` (`:35-38`), which this plan deletes. **Do not edit it
  here.** It degrades gracefully: `:191-193` guards each entry with `if (fs.existsSync(abs))`. The
  stale entries are removed by the follow-on plan that owns that file, so that two plans do not edit
  it concurrently.

## Work

### 1. Delete the three dead dashboard markup files

```
WebPortal/modules/dashboard/html/dashboard.html                 (387 lines)
WebPortal/modules/dashboard/html/executive_dashboard.html       (37 lines)
WebPortal/modules/dashboard/html/amanda_dashboard.html          (30 lines)
```

All three routes that mention a dashboard — `dashboard` (`appRouteConfig.json:28-40`),
`amanda-dashboard` (`:691-699`) and `executive-dashboard` (`:702-710`) — every one loads
`"html": "html/dashboard_unified.html"`. None of these three files is named by any route.

`dashboard.html` is the dangerous one and is **not** yet documented as a decoy. Its own line 1 reads
`<!-- Unified Dashboard: all role-specific content in one file… -->` and line 119
`<!-- ===== FROM: Executive dashboard (executive_dashboard.html) ===== -->`, so it presents itself as
the real unified dashboard. It is a stale earlier generation of `dashboard_unified.html`, and it was
last modified by a design-system sweep — i.e. someone has already edited a file that renders nowhere.

Verification: the only remaining match for `executive_dashboard.html` after deletion is an HTML
comment at `dashboard_unified.html:198`. Leave that comment alone; it is provenance, not a reference.

### 2. Delete the three superseded role-screen markup files

```
WebPortal/modules/roles/html/roles_grid.html                          (95 lines)
WebPortal/modules/role-permissions/html/role-permissions_grid.html    (113 lines)
WebPortal/modules/role-features/html/role-features_grid.html          (53 lines)
```

All three were superseded by `role_grids_unified.html`. The only matches for these filenames anywhere
in `WebPortal/` are HTML provenance comments inside the three `role_grids_unified.html` copies
(`:4`, `:77`, `:166`). Leave those comments alone.

### 3. Delete the two dead `receiving_checklist_shared.js` copies

```
WebPortal/modules/grower-intake/js/receiving_checklist_shared.js      (275 lines)
WebPortal/modules/supplier-intake/js/receiving_checklist_shared.js    (153 lines)
```

Same filename, different content — they are not copies of each other. The only reference to either
anywhere in the repo is `js/appRouteConfig.json:185`, which is the **non-deployed** top-level
registry, not `WebPortal/js/appRouteConfig.json`. Neither is named by any live route.

### 4. Delete two dead files from the shared layer

```
WebPortal/js/app-new.js     (162 lines)
WebPortal/js/router.js      (150 lines)
```

Neither is in the `<script src>` set of `WebPortal/index.html`, `signin.html` or
`reset-password.html`, and neither has any other reference.

**`WebPortal/js/router.js` is the priority here — it is an active footgun.** Its line 1 reads
`// Hope Diamond Transport Admin Portal - Router`: it was copied in from an unrelated project. It
declares `var _appRouter = {…}`, **the same global name as the live router** in
`WebPortal/js/appRouter.js`. Its route table lists 7 routes including `users-form` and `roles-form`,
which do not exist in this app. If anyone ever adds a `<script src="js/router.js">` tag it silently
replaces the real router. Delete it rather than leaving a loaded gun in the shared directory.

### 5. Delete three empty module directories

```
WebPortal/modules/role-actions/
WebPortal/modules/executive-dashboard/
WebPortal/modules/amanda-dashboard/
```

All three contain zero files. The `executive-dashboard` and `amanda-dashboard` **routes** are
unaffected — both carry `"path": "dashboard"` (`appRouteConfig.json:693`, `:704`), so they already
load their assets from `WebPortal/modules/dashboard/`, not from these directories.

Note git does not track empty directories, so these will not appear in the diff. Remove them on disk
anyway; leaving them invites someone to put a file in one and wonder why nothing loads.

### 6. Delete five root-level orphans

```
test-scenarios-viewer.html   (2149 lines)  test-management UI for a system already removed
qa-data-seeder.html          (1751 lines)  superseded by Playwright Tests/scripts/cleanup-e2e-test-data.mjs
macavation-updates.html      (493 lines)   changelog viewer, nothing links it
sw.js                        (230 lines)   PWA retired
manifest.json                (51 lines)    PWA retired
```

`sw.js` and `manifest.json` are unambiguously dead: `WebPortal/index.html:12` reads
`<!-- (manifest link removed — no manifest.json ships with the portal; PWA retired) -->`, and
`WebPortal/js/index.js:34-35` actively *unregisters* service workers. There is no `WebPortal/sw.js`
or `WebPortal/manifest.json`, so these root copies are the only ones and nothing serves them.

The only references to any of these five are in documentation (`docs/QA_VIEWER_REQUIREMENTS.md`,
`docs/guides/PWA_OFFLINE_GUIDE.md`, `docs/implementation/PWA_IMPLEMENTATION_SUMMARY.md` and their
`docs/markdown-archive/` duplicates) plus the two `SCAN_FILES` entries deliberately left for the
follow-on plan. The `manifest.json` matches under `scripts/` are all a *different* file
(`.tmp_mig/batch08_out/manifest.json`) — do not touch those scripts.

**Leave the documentation alone.** A separate plan owns `docs/`; deleting doc files here would
collide with it.

### 7. Delete `e2e/`

`e2e/` holds exactly one tracked file (`e2e/README.md`, titled "E2E tests (legacy location)") plus 19
empty directories mirroring the real suite. The real suite is `Playwright Tests/` (21 `.spec.ts`
files, its own `package.json` and lockfile) and is untouched by this plan.

Also remove the now-dead `e2e/test-results/` line from `.gitignore` (`:33`). **Keep** `.gitignore:24`
(`e2e/.env.e2e`) only if `e2e/` survives — since it does not, remove that line too. Do not touch any
other `.gitignore` line, in particular not `Playwright Tests/test-results/` (`:34`) or
`Playwright Tests/playwright-report/` (`:35`), which guard the live suite.

Leave `.cursor/rules/no-e2e-test-results-in-git.mdc` alone — it is prose guidance, and a separate
plan owns the rules directories.

### 8. Untrack `agent-tools/`

`agent-tools/` is listed in `.gitignore:39` but 614 files are tracked, because it was committed
before the ignore rule was added and `.gitignore` does not untrack retrospectively. It holds one-off
MCP migration chunk fragments (`soh_mcp/exec_segments/seg_001…`) — build debris, not tooling anything
depends on.

```bash
git rm -r --cached agent-tools/
```

**`--cached` only.** Do not delete the directory from disk: it is ignored, so leaving the files
locally is harmless, and removing them would destroy a developer's local scratch space for no gain.

Verify with `git ls-files agent-tools/ | wc -l` → `0`.

Do **not** attempt the same for `Playwright Tests/playwright-report/` or
`Playwright Tests/test-results/`. Both are already untracked (`git ls-files` returns 0 for each);
running `git rm --cached` on them would fail with `did not match any files`.

### 9. Record the second decoy in `CLAUDE.md`

The "Dashboard markup — the decoy" paragraph names only `executive_dashboard.html`. Both decoys are
being deleted by this plan, so rewrite that paragraph to state what is true afterwards: the live
markup is `dashboard_unified.html` (~691 lines) serving three dashboards partitioned by `data-access`
wrappers, and the two dead stubs plus a stale 387-line `dashboard.html` generation that used to sit
beside it have been removed. Keep the existing warning about markup landing in the wrong
`data-access` block — that hazard is unchanged.

Do not restructure the rest of `CLAUDE.md`.

## Guardrails

- **Deletions only.** Do not "improve" any file that survives. No behaviour change belongs in this
  diff.
- **Do not touch `WebPortal/modules/supply-chain-flow/`** for the reasons in Scope.
- **Do not edit `scripts/check-supabase-project.mjs`, `scripts/sync-portal-supabase-config.mjs`, or
  `scripts/verify-routing-guarantee.cjs`.** A follow-on plan owns all three; concurrent edits would
  conflict.
- **Do not touch anything under `docs/`, `BluePrint/`, `.claude/rules/`, or `.cursor/rules/`** — other
  plans own those. `CLAUDE.md` (repo root) is the single documentation file this plan may edit.
- **Do not delete top-level `modules/`, `css/`, `js/`, or `styles.css`.**
- **Do not add or remove an npm dependency**, and do not create a `package-lock.json`. This repo has
  zero dependencies by design.
- **Do not weaken `package.json`'s `test:fleet` script** or any script it calls.
- Do not delete `WebPortal/index_supabase.js` — it is 2,050 lines of dead Lambda handler, but
  `docs/database/DIRECT_SUPABASE_ONLY.md:15` says it is retained deliberately. Out of scope.

## Acceptance criteria

Each is checkable from the diff or by running the named command.

1. These 10 files no longer exist: `WebPortal/modules/dashboard/html/{dashboard,executive_dashboard,amanda_dashboard}.html`,
   `WebPortal/modules/roles/html/roles_grid.html`,
   `WebPortal/modules/role-permissions/html/role-permissions_grid.html`,
   `WebPortal/modules/role-features/html/role-features_grid.html`,
   `WebPortal/modules/{grower-intake,supplier-intake}/js/receiving_checklist_shared.js`,
   `WebPortal/js/app-new.js`, `WebPortal/js/router.js`.
2. These 5 root files no longer exist: `test-scenarios-viewer.html`, `qa-data-seeder.html`,
   `macavation-updates.html`, `sw.js`, `manifest.json`.
3. `e2e/` no longer exists, and `.gitignore` no longer contains `e2e/test-results/` or `e2e/.env.e2e`.
   `.gitignore` still contains both `Playwright Tests/` ignore lines.
4. `git ls-files agent-tools/ | wc -l` prints `0`, and `agent-tools/` still exists on disk.
5. `git ls-files | grep -c "^WebPortal/modules/supply-chain-flow/"` prints `3` — the module is
   untouched.
6. **No `.sql` file is added, deleted or modified.** No file under `docs/`, `BluePrint/`,
   `.claude/rules/` or `.cursor/rules/` is modified. No file under `scripts/` is modified.
7. `grep -c "dashboard_unified" CLAUDE.md` is at least 1, and `CLAUDE.md` no longer presents
   `executive_dashboard.html` as a file that currently exists.
8. `grep -rn "js/router\.js\|app-new\.js" WebPortal/ --include=*.html` returns nothing.
9. `npm run test:fleet` passes.
10. `node scripts/check-supabase-project.mjs` still exits 0 — deleting the two `SCAN_FILES` entries'
    targets must not break it, which is the point of the `existsSync` guard at `:191-193`.
11. `package.json` is byte-identical to its state before this plan.
