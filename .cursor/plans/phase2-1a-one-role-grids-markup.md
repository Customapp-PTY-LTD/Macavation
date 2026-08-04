# One `role_grids_unified.html`, and remove the dead buttons it grew

## Context

`role_grids_unified.html` exists as **three separate copies**, one per module directory:

| Copy | md5 (first 10) |
|---|---|
| `WebPortal/modules/roles/html/role_grids_unified.html` | `ff1e8c9754` |
| `WebPortal/modules/role-features/html/role_grids_unified.html` | `3b3528daa7` |
| `WebPortal/modules/role-permissions/html/role_grids_unified.html` | `3b3528daa7` |

Two are identical; the `roles/` copy has drifted by about 70 lines. Because each route loads the copy
from its own directory, **editing "the" unified role markup fixes one screen of three.**

### The drift is not a design choice — it is dead markup

The extra content in the `roles/` copy is a features table (`#featuresTableBody`), a feature modal
(`#featureModal`), `#addFeatureBtn`, `#exportFeaturesBtn`, and a set of role-features filter controls
(`#rfFilterRole`, `#rfFilterFeature`, `#rfFilterValue`, `#rfClearFiltersBtn`, `#rfPagination`,
`#rfDeleteModal`, `#rfConfirmDeleteBtn`).

`#addFeatureBtn` and `#exportFeaturesBtn` are bound in exactly one place —
`WebPortal/modules/features/js/features_grid.js:63` and `:67` — which belongs to the **features** module.
The `roles-grid` route loads only `js/roles_grid.js`:

```
roles-grid              | path: roles            | js: ['js/roles_grid.js']
role-permissions-grid   | path: role-permissions | js: ['js/role-permissions_grid.js']
role-features-grid      | path: role-features    | js: ['js/role-features_grid.js']
```

So on the Roles screen those buttons render with **no handler attached**. A user clicks Add or Export and
nothing happens. That settles which copy is canonical without needing a judgment call: the two identical
copies are correct, and the `roles/` copy is the one carrying another module's markup.

## Scope

**In:** collapsing to one shared markup file and pointing all three routes at it; the dead controls go
with the drift.

**Out:** any change to `roles_grid.js`, `role-features_grid.js`, `role-permissions_grid.js`, or
`features_grid.js`. If a screen genuinely needs a control, that is a feature request, not this cleanup.

**Out:** the Features screen itself, which keeps its own working markup and handlers.

## Work

### 1. Establish one shared file

Put the canonical markup at `WebPortal/modules/roles/html/role_grids_unified.html` and delete the other
two, **or** move it to a shared location — either is acceptable, but the content must be the
`3b3528daa7` version (currently in `role-features/` and `role-permissions/`), not the `roles/` one.

Whichever location you choose, update all three route entries in `WebPortal/js/appRouteConfig.json` to
point their `html` at it. Note each route's `path` differs (`roles`, `role-features`,
`role-permissions`), and the loader resolves `html` relative to `basePath` + `path` — so if the file
lives under one module's directory, the other two routes need an `html` value that reaches it. **Verify
the resolution rule by reading the loader in `WebPortal/js/appRouter.js` before choosing**; if a relative
path cannot escape the module directory, keep one physical copy per route and instead make them
byte-identical, and say so in the run summary. A byte-identical triplet is a worse outcome than one file
but still fixes the live inconsistency, and it is better than a broken route.

### 2. Confirm nothing that survives is orphaned

The canonical copy retains provenance comments naming files deleted earlier (`roles_grid.html`,
`role-permissions_grid.html`, `role-features_grid.html` at `:4`, `:77`, `:166`). Leave those comments —
they are history, not references.

Before finishing, grep each id in the canonical markup against the JS that its route loads, and report
any id with no handler. Do not fix those beyond the dead buttons named above; just list them, since a
missing handler may be intentional (populated dynamically) and guessing would widen this diff.

## Guardrails

- **The canonical content is the `3b3528daa7` version.** Do not merge the two variants into a superset —
  that would re-introduce the dead buttons this plan removes.
- **Do not add handlers** for `#addFeatureBtn` or `#exportFeaturesBtn` to `roles_grid.js` to "make them
  work". Whether Roles should offer those actions is a product decision; the Features screen already
  provides them.
- **Do not touch `WebPortal/modules/features/`** — its markup and handlers are correct and in use.
- **Do not modify any `*_grid.js`.** This plan is markup plus registry paths.
- **Verify the three routes still resolve.** A wrong `html` path makes a screen load blank at runtime,
  and `npm run test:fleet` cannot catch it — `routing:verify` proves database-host routing, not asset
  paths. So state in the run summary, per route, the exact resolved path you expect the loader to fetch.
- Do not introduce raw hex, `linear-gradient`, Bootstrap Icons, or `btn-success` — `ui:verify` is part of
  `test:fleet` and fails on all four.
- Do not add `data-dashboard-widget` to anything.
- Do not add `data-action-perm` to a dynamically rendered element; it is swept once over static markup
  and is inert on injected rows.
- No `.sql` file; no new npm dependency; nothing under `supabase/`.

## Acceptance criteria

1. `WebPortal/modules/{roles,role-features,role-permissions}/html/role_grids_unified.html` no longer
   exists as three **differing** files: either one file remains and all three routes point at it, or the
   three are byte-identical (`md5sum` equal), with the chosen approach stated in the run summary.
2. The surviving content is the `3b3528daa7` variant. **Grep-checkable:** `addFeatureBtn`,
   `exportFeaturesBtn`, `featuresTableBody` and `featureModal` appear **nowhere** under
   `WebPortal/modules/roles/`, `role-features/` or `role-permissions/`.
3. `WebPortal/modules/features/` is unmodified — `git diff --stat` does not list it, and
   `features_grid.js:63,67` still bind those two ids for the Features screen.
4. All three route entries in `appRouteConfig.json` have an `html` value that resolves to the surviving
   file, and the run summary names the expected fetch path for each.
5. No `*_grid.js` file is modified.
6. The run summary lists any id in the canonical markup with no handler in its route's JS.
7. `npm run test:fleet` passes, including `ui:verify`.
8. No `.sql` file added or changed; nothing under `supabase/`; no new npm dependency.

<!-- Resubmitted 2026-08-04: the original push of this plan was never picked up by the fleet.
     Content unchanged. The dead Add/Export buttons it removes are still live on the Roles screen. -->
