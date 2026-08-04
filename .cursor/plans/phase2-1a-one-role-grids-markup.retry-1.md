---
retry_of: 8a89dc16-cffd-41ca-a4fc-2c31ef8530ec
---

# Make the three `role_grids_unified.html` copies identical, dropping the stale drift in `roles/`

## Context

`role_grids_unified.html` exists as **three separate copies**, one per module directory:

| Copy | Lines | State |
|---|---|---|
| `WebPortal/modules/roles/html/role_grids_unified.html` | 249 | drifted / stale |
| `WebPortal/modules/role-features/html/role_grids_unified.html` | 213 | canonical |
| `WebPortal/modules/role-permissions/html/role_grids_unified.html` | 213 | canonical (identical to the above) |

Each route loads the copy from its own directory, so **editing "the" unified role markup fixes one screen of three.** That is the problem this plan fixes: one content, three copies, no divergence.

### What the drift actually is (read this before touching anything)

The `roles/` copy's third section (`<div data-access="role-features">`, lines ~166-247) is a **superseded generation of the Role Features UI**, not features-module markup:

- 6-column table (Feature Name / Role / Value / Description / Created / Actions) plus filter controls `#rfFilterRole`, `#rfFilterFeature`, `#rfFilterValue`, `#rfClearFiltersBtn`, `#rfPagination`, `#rfDeleteModal`, `#rfConfirmDeleteBtn`, and `#addFeatureBtn` / `#exportFeaturesBtn`.
- `#featureModal` in that block carries `route-name="role-feature-modal"`, which pairs it with `WebPortal/modules/modals/modal-role-feature/` — a module that still exists.

The canonical copy's third section is the current UI that `role-features/js/role-features_grid.js` actually drives: `#roleSelect`, `#featureSummary`, `#refreshFeaturesBtn`, and a 4-column Access / Feature / Key / Description checkbox table.

**Two corrections to earlier framing, which the next run must not repeat:**

1. **`featuresTable` and `featuresTableBody` are NOT drift.** They exist in *both* variants and are load-bearing in the canonical one: `role-features/html/role_grids_unified.html:191` (`id="featuresTable"`) and `:200` (`id="featuresTableBody"`), consumed by `role-features/js/role-features_grid.js:196` (`renderFeatures`, returns early if absent), `:360` (`clearFeatures`), `:381` (`showLoading`). Removing or renaming them makes selecting a role on Role Features render nothing — no error, no spinner — and nothing in `test:fleet` would catch it. **They must be retained.** Same for `#featureSummary` (`role-features_grid.js:345,366`), `#roleSelect` (`:92,:123`) and `#refreshFeaturesBtn` (`:112`).
2. **There is no user-visible "dead button" bug being fixed.** `roles/js/roles_grid.js:27-29` sets `display:none` on every `[data-access]` block whose value isn't `roles`, so the stale role-features block never renders on the Roles screen. This plan is a de-duplication/consistency cleanup only; do not describe it as a bug fix in the run summary.

The canonical content is therefore the `role-features/` = `role-permissions/` variant, because that is the variant whose ids match `role-features_grid.js`.

## Scope

**In:** making all three copies byte-identical to the canonical variant, which means rewriting exactly one file: `WebPortal/modules/roles/html/role_grids_unified.html`. The stale role-features block goes with it.

**Out:** any change to `roles_grid.js`, `role-features_grid.js`, `role-permissions_grid.js`, or `features_grid.js`. If a screen genuinely needs a control, that is a feature request, not this cleanup.

**Out:** the Features screen itself (`WebPortal/modules/features/`), which keeps its own working markup and handlers.

**Out:** `WebPortal/js/appRouteConfig.json` — no route entry changes (see Work step 1).

**Out:** `WebPortal/modules/modals/modal-role-feature/` and its `role-feature-modal` route entry, and `scripts/apply_user_guide_help_links.mjs`.

**Out:** any restructuring of the per-module `html/` layout or a move to a new shared directory.

## Work

### 1. One content, three identical files — this shape is fixed, not a choice

Do exactly this:

- Replace the entire contents of `WebPortal/modules/roles/html/role_grids_unified.html` with the exact bytes of `WebPortal/modules/role-features/html/role_grids_unified.html`.
- Leave `WebPortal/modules/role-features/html/role_grids_unified.html` and `WebPortal/modules/role-permissions/html/role_grids_unified.html` **untouched** (they are already identical to each other; verify with `md5sum` before and after, do not rewrite them).
- Do **not** delete any of the three files, do **not** create a shared location, and do **not** edit `WebPortal/js/appRouteConfig.json`.

Rationale the next run does not need to re-litigate: the loader fetches `${basePath}/${path}/${html}` (`WebPortal/js/appRouter.js:204` builds `modules/<path>`, `:213` fetches `${resoucePath}/${html}`), and `basePath` is `"modules"` (`appRouteConfig.json:2`). The three routes already carry `"html": "html/role_grids_unified.html"` (`appRouteConfig.json:77`, `:97`, `:117`) with `path` values `roles`, `role-permissions`, `role-features`. Because a single physical file would require at least two routes to use an escaping relative `html` value, and because **no test in `test:fleet` validates route `html` values** (`scripts/verify-routing-guarantee.cjs` only reads host→database mapping; `scripts/verify-ui-standard.mjs` just walks files), collapsing to one physical file would put three admin screens one typo away from loading blank with zero coverage. The byte-identical triplet fixes the live divergence with a diff that is fully provable in-repo (`md5sum`), so that is the deliverable. Keeping three files also leaves `scripts/apply_user_guide_help_links.mjs:1029-1035` (which iterates `roles`, `role-permissions`, `role-features` for this filename) patching all three as it does today.

Expected resolved fetch paths after this change — state these verbatim in the run summary:

- `roles-grid` → `modules/roles/html/role_grids_unified.html`
- `role-permissions-grid` → `modules/role-permissions/html/role_grids_unified.html`
- `role-features-grid` → `modules/role-features/html/role_grids_unified.html`

### 2. Preserve provenance comments

The canonical copy retains provenance comments naming files deleted earlier (`roles_grid.html`, `role-permissions_grid.html`, `role-features_grid.html` at `:4`, `:77`, `:166`) and the three `macavation-help-link` anchors. Copying the file verbatim preserves all of them — do not hand-edit them out.

### 3. Confirm nothing that survives is orphaned (report only)

Grep each `id="…"` in the canonical markup against the JS its route loads (`roles/js/roles_grid.js`, `role-permissions/js/role-permissions_grid.js`, `role-features/js/role-features_grid.js`) and list in the run summary any id with no handler. Do **not** fix them: a missing handler may be intentional (populated dynamically, or bound by a modal module), and guessing would widen this diff.

Also record, as a report line only, that after this change no markup in the repo contains `#featureModal` with `route-name="role-feature-modal"`, so `WebPortal/modules/modals/modal-role-feature/` becomes unreferenced from markup. Flag it as a possible follow-up; **do not delete it or its route entry in this plan.**

## Guardrails

- **Canonical content = the `role-features/` / `role-permissions/` variant.** Do not merge the two variants into a superset — that would re-introduce the stale block this plan removes.
- **`featuresTable`, `featuresTableBody`, `featureSummary`, `roleSelect` and `refreshFeaturesBtn` must exist in the resulting file.** They are consumed by `role-features_grid.js` (`:191/:200` markup → `:196,:360,:381`; `:345,:366`; `:92,:123`; `:112`). Any "remove the features table" reading of this plan is wrong.
- **Do not add handlers** for `#addFeatureBtn` or `#exportFeaturesBtn` to `roles_grid.js` to "make them work". Whether Roles should offer those actions is a product decision.
- **Do not touch `WebPortal/modules/features/`** — its markup (`features_grid.html:7,13,48,58,71`) and handlers (`features_grid.js:63,67`) are correct and in use, and they legitimately use the same id names as the stale block. Scope every "must not appear" grep to the three role module directories so the Features module is not swept up.
- **Do not modify any `*_grid.js`.** This plan is one markup file.
- **Do not modify `WebPortal/js/appRouteConfig.json`.** Its three `html` values are already correct for this shape; changing them is how the screens go blank.
- Do not introduce raw hex, `linear-gradient`, Bootstrap Icons (`bi bi-`), or `btn-success` — `ui:verify` (`scripts/verify-ui-standard.mjs`) is part of `test:fleet` and fails on all four. Copying the canonical file verbatim introduces none of them.
- Do not add `data-dashboard-widget` to anything.
- Do not add `data-action-perm` to a dynamically rendered element; it is swept once over static markup and is inert on injected rows.
- No `.sql` file; no new npm dependency; nothing under `supabase/`.
- Treat `BluePrint/BEST_PRACTICES.md`'s per-module `html/module-name_grid.html` layout sketch as advisory only; the chosen outcome keeps one `html/` file per module, so nothing here depends on it. Do not "fix" that document as part of this plan.

## Acceptance criteria

1. `git diff --stat` lists **exactly one changed file**: `WebPortal/modules/roles/html/role_grids_unified.html`. No file added, no file deleted.
2. `md5sum WebPortal/modules/{roles,role-features,role-permissions}/html/role_grids_unified.html` prints three identical hashes, equal to the pre-change hash of the `role-features/` copy (i.e. the `role-features/` and `role-permissions/` copies are bit-for-bit unchanged from the base branch).
3. The ids unique to the stale copy — `addFeatureBtn`, `exportFeaturesBtn`, `featureModal`, `rfFilterRole`, `rfFilterFeature`, `rfFilterValue`, `rfClearFiltersBtn`, `rfPagination`, `rfDeleteModal`, `rfConfirmDeleteBtn` — appear **nowhere** under `WebPortal/modules/roles/`, `WebPortal/modules/role-features/` or `WebPortal/modules/role-permissions/`.
4. **Retention check (fails the run if violated):** each of the three copies still contains `id="featuresTable"`, `id="featuresTableBody"`, `id="featureSummary"`, `id="roleSelect"`, `id="refreshFeaturesBtn"`, plus the roles-section ids (`rolesTable`, `rolesTableBody`, `rolesPagination`, `roleModal`, `rolesDeleteModal`, …) and the role-permissions-section ids (`permissionsTable`, `permissionsTableBody`, `rpPagination`, `permissionModal`, `rpDeleteModal`, …) exactly as in the canonical variant.
5. `WebPortal/modules/features/` is unmodified — `git diff --stat` does not list it, and `features_grid.js:63,67` still bind `#addFeatureBtn` / `#exportFeaturesBtn` for the Features screen.
6. `WebPortal/js/appRouteConfig.json` is unmodified, and the run summary states the three expected resolved fetch paths listed in Work step 1.
7. No `*_grid.js` file is modified; `WebPortal/modules/modals/modal-role-feature/` and `scripts/apply_user_guide_help_links.mjs` are unmodified.
8. The run summary lists any id in the canonical markup with no handler in its route's JS (report only), and notes that `modal-role-feature` is now unreferenced from markup as a possible follow-up.
9. `npm run test:fleet` passes, including `ui:verify`.
10. No `.sql` file added or changed; nothing under `supabase/`; no new npm dependency.
