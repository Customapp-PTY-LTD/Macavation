# Gate the module registry: prove every route's assets exist on disk

## Context

`WebPortal/js/appRouteConfig.json` maps ~71 routes to the `html`, `js` and `css` files each screen loads.
**Nothing verifies those paths.** If an entry names a file that does not exist, the screen fails at
runtime — a blank panel or a missing modal — and no check in the repo catches it:

- `routing:verify` proves the 15-host **database** routing guarantee, not asset paths.
- `ui:verify` scans CSS/HTML for design violations; it never reads the registry.
- `verify-phase2-migrations.mjs` checks migration filenames.
- There is **no unit-test suite anywhere** in this repo, and the Playwright suite targets the deployed
  site with real logins, so it cannot run in the merge gate (`package.json`'s `//test:fleet` comment
  explains why adding it would error and block every merge).

This matters right now for a specific reason. The modals tree is disorganised — 38 modal directories
where the directory name and the file inside disagree (`modal-stock-import-oil-lots/` contains
`modal_import_oil_lots.html`; `modal-oil-production/` contains `modal_oil_production_sheet.js`;
`modal-stock-oil-bulk-add/` contains `modal_oil_bulk_add_stock.js`), and one file uses a hyphen where
every sibling uses an underscore (`role-features_grid.js`). Normalising that means renaming dozens of
files and rewriting their registry paths — a change where a single wrong path silently breaks a modal,
with nothing to catch it.

**So build the gate first.** This plan adds the verifier. The rename becomes safe afterwards, and is
deliberately not attempted here.

Recent work makes this timely: the Stage 0 cleanup deleted a set of orphaned module files, and a registry
entry pointing at a deleted file is exactly the failure this check would have caught for free.

## Scope

**In:** one hermetic Node verifier, wired into `test:fleet`.

**Out:** renaming anything, moving anything, or editing `appRouteConfig.json`. If the verifier finds a
genuinely broken path, **report it, do not fix it** — a broken registry entry may mean the screen is
retired rather than misnamed, and that is a judgment call.

**Out:** the modal naming normalisation. It follows once this gate exists.

## Work

### 1. `scripts/verify-registry-paths.mjs`

Pure `fs`/`path`, no dependencies, no network — it has to be safe for the merge gate.

Read `WebPortal/js/appRouteConfig.json`. For every route entry, resolve each `html`, `js` and `css` value
the way the app does and assert the file exists.

**Derive the resolution rule from the loader, not from a guess.** Read `WebPortal/js/appRouter.js` to see
how it combines the registry's `basePath`, each entry's `path`, and the asset value. Encode that rule
once in the script with a comment citing the loader's line. If the loader supports more than one shape
(for example an asset value that already contains a directory separator versus a bare filename), handle
both — and if a shape cannot be determined from the loader, **skip it and print it as unverified**
rather than inventing a rule and reporting a false failure.

Report, in one pass:

1. **Missing files** — a registry entry whose resolved path is absent. This is the failure that fails the
   run.
2. **Unreferenced files** — files under `WebPortal/modules/**` that no registry entry names. Print these
   as **informational only; they must not fail the run.** Three files are legitimately loaded straight
   from `WebPortal/index.html` rather than the registry (`modules/assistant/mac-assistant-api.js`,
   `modules/assistant/mac-assistant-shell.js`, `modules/mascot/mac-mascot.js`), and
   `WebPortal/modules/supply-chain-flow/` is a known unreachable module deliberately left in place
   pending a product decision. Treat `index.html`'s `<script src>` set as a second source of references so
   the assistant and mascot files are not reported, and exclude nothing else — an accurate informational
   list is more useful than a short one.
3. A summary line in the house style of the other verifiers, e.g.
   `REGISTRY PATHS OK (71 routes, N assets, M unreferenced).`

Exit non-zero **only** on a missing file. Print `file:line`-style detail naming the route key and the
offending value so a failure is actionable.

**It must pass on the current tree.** If it does not — if the registry already names a file that does not
exist — **do not "fix" the registry to make it green.** Report the finding in the run summary and leave the
script failing on that entry, then say so plainly. Do not add a grandfather baseline: unlike the migration
prefixes (which are already applied and cannot be renamed), a broken registry path is a live bug worth
surfacing, not debt worth encoding. If this happens the plan's gate step must be skipped rather than the
finding buried — a gate that starts red is honest; a registry edited to hide a bug is not.

### 2. `package.json`

Add `"registry:verify": "node scripts/verify-registry-paths.mjs"` and append `&& npm run registry:verify`
to `test:fleet`, preserving the existing chain and every warning in the `"//test:fleet"` comment key.

Only append it **if step 1 passes on the current tree.** Otherwise expose the script but leave it out of
the gate, and state in the run summary that it is pending the finding it reported.

## Guardrails

- **Do not edit `WebPortal/js/appRouteConfig.json`** for any reason, including to make the new check pass.
- **Do not rename, move or delete any file under `WebPortal/modules/`.** The rename is a later plan; this
  one only measures.
- **Do not delete `WebPortal/modules/supply-chain-flow/`** — it is unreachable by design pending a human
  decision, and this script will list it as unreferenced, which is the correct outcome.
- **Do not fail the run on unreferenced files.** Only a missing file is an error. An over-strict gate here
  would block every future merge over intentionally-unregistered files.
- **Do not add a dependency**, do not create a `package-lock.json`, and do not make the script read the
  network or shell out.
- **Do not add `rbac:verify`, `audit:verify` or the Playwright suite to `test:fleet`** — they need
  Supabase service-role keys or a deployed app and would error, blocking every merge.
- Do not touch `scripts/verify-ui-standard.mjs`, `scripts/verify-routing-guarantee.cjs`,
  `scripts/verify-no-username.mjs`, `scripts/verify-phase2-migrations.mjs`, or
  `scripts/verify-migration-prefixes.mjs`.
- No `.sql` file; nothing under `supabase/`.

## Acceptance criteria

1. `scripts/verify-registry-paths.mjs` exists, uses only `fs`/`path`, and makes no network call —
   **grep-checkable:** it contains no `fetch`, no `http`, no `child_process`, and no `import` of a package
   outside `node:`.
2. It resolves asset paths using a rule read from `WebPortal/js/appRouter.js`, with a comment citing the
   line it derived that from.
3. It exits non-zero on a missing registry-named file, and **zero** when the only findings are
   unreferenced files.
4. Its output names the route key and the offending value for each missing file, and prints a summary line
   with route, asset and unreferenced counts.
5. It does not report `modules/assistant/mac-assistant-api.js`, `modules/assistant/mac-assistant-shell.js`
   or `modules/mascot/mac-mascot.js` as unreferenced — `WebPortal/index.html`'s `<script src>` set is
   treated as a reference source.
6. `WebPortal/js/appRouteConfig.json` is **byte-identical** — `git diff --stat` does not list it.
7. No file under `WebPortal/modules/` is renamed, moved, added or deleted.
8. `package.json` exposes `registry:verify`. It is appended to `test:fleet` **only if** the script passes
   on the current tree; if not, the run summary states the finding and that the gate step was withheld.
9. `npm run test:fleet` passes.
10. No new dependency; no `package-lock.json`; no `.sql` file; nothing under `supabase/`.
