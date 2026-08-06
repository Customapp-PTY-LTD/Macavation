---
depends_on: oil-sheet-ai-02-edge-function.md
---

# AI production-sheet ingestion — upload screen and extraction list

## Context

Plans 01 and 02 built the database layer and the `extract-oil-sheet` edge function. This plan builds
the first half of the user-facing feature: a new portal screen where the factory manager picks a
sheet type, uploads a photo or scan of a paper GMP production sheet, and watches it get read. The
second half — the side-by-side review and the commit into `shift_tracking` — is
`oil-sheet-ai-04-review-and-confirm.md`, which builds on the module this plan creates.

The two forms in scope are **MP02-9 Rev3** (food grade) and **MP02-12 REV 04** (cosmetic oil).

**Neither the migration nor the edge function is live when this merges.** A human applies plan 01's
migration and deploys plan 02's function out of band. `dev` auto-deploys on merge
(`CLAUDE.md:8-11`), so this screen will be reachable before its backend exists. Everything here must
therefore **degrade gracefully**: if an RPC 404s or the edge function is unreachable, show an empty
state or a plain error toast — never an unhandled exception, never a blank panel.

## Conventions this repo enforces — read before writing any code

- **The app is `WebPortal/` only** (`CLAUDE.md:8-11`). The top-level `modules/`, `js/`, `css/`
  directories are empty husks left on disk; ignore them.
- **No build step, no framework, no ES modules.** Classic `<script>` tags, jQuery, Bootstrap 5
  modals, SweetAlert2, `window.*` globals. Module JS is an IIFE returning an object literal, exposed
  through a `window.initializeXxx` function — see
  `WebPortal/modules/oil-production/js/oil_production_grid.js:6`, `:343` (`init`), `:352`
  (`bindEvents`), `:2132` (the global).
- **No screen is deep-linkable** (`CLAUDE.md:41-43`). The router never reads the URL. Navigation
  between the list and the review screen happens in-module, not via a route change.
- **Design tokens only.** `npm run ui:verify` is part of `npm run test:fleet` and **fails on any raw
  hex outside `WebPortal/css/design-tokens.css`** (`CLAUDE.md:46-52`). Use `--mac-*` variables.
  No gradients. No bare `td`/`th` padding — row height comes from `--mac-table-cell-padding-*`.
  `btn-success` is banned; one filled green `btn-primary` per view
  (`docs/design/DESIGN_SYSTEM.md:44`). Font Awesome icons only.
- **`registry:verify` gates the merge.** Every file named in `WebPortal/js/appRouteConfig.json` must
  exist (`scripts/verify-registry-paths.mjs:10-30`).
- **`data-action-perm` is inert on dynamically rendered markup** (`CLAUDE.md:29-32`) — the router
  sweeps it once over static HTML only. For anything rendered by JS, call `hasAction()` inline, the
  way `oil_production_grid.js:808-811` does.

## Reuse these — do not reimplement

| Need | Use | Where |
|---|---|---|
| Status pill | `MacStatus.pill(status)` | `WebPortal/js/mac-status.js:66` |
| Row action menu | `MacTableActions.render(...)` + `.init(el)` | `WebPortal/js/table-actions.js:144` |
| Loading / empty rows | `macLoadingRow(colspan)`, `macEmptyRow(colspan)`, `macEmptyState(icon,title,hint)` | `WebPortal/js/ui-states.js:17,23,29` |
| Toasts | `_common.showSuccessToast` / `showErrorToast` / `showInfoToast` | `WebPortal/js/common.js:46,51,61` |
| Confirm / error dialogs | `Swal.fire(...)` | skinned by `WebPortal/css/swal-theme.css` |
| Date display | `_common.formatDateDDMMYYYY(value)` | `WebPortal/js/common.js:121-129` |
| Date picker | `flatpickr` with `dateFormat: 'd/m/Y'` | `oil_production_grid.js:9` |
| HTML escaping | the module-local `escapeHtml` helper | `oil_production_grid.js` (copy the pattern) |
| Archival file upload | `_common.uploadFile({ file, resourceFolder, fileId })` | `WebPortal/js/common.js:362-417` |
| Collapsible sections | `initMacSectionCollapses(root)` | `WebPortal/js/mac-section-collapse.js:36` |

## Work

### 1. New module `WebPortal/modules/oil-sheet-ai/`

```
html/oil_sheet_ai_grid.html
js/oil_sheet_ai_grid.js
css/oil_sheet_ai_grid.css
```

**`oil_sheet_ai_grid.html`** — two sections in one panel, using the standard module-content shell
copied from `WebPortal/modules/oil-production/html/oil_production_grid.html`:

- *Upload* — a sheet-type `<select>` (Food Grade (MP02-9) / Cosmetic Oil (MP02-12); the
  `protein_powder` option is present but `disabled` with the label "(not yet supported)"), a
  drag-and-drop zone wrapping `<input type="file" accept=".pdf,image/*">`, a thumbnail preview of
  the chosen file, and an Upload & Extract `btn-primary`.
- *Recent extractions* — a table: Date, Sheet type, Status, Confidence, Uploaded by, Uploaded at,
  and a `MacTableActions` menu (Review, Re-extract, Delete). A Refresh button.

**`oil_sheet_ai_grid.js`** — IIFE `_oilSheetAiGrid` with `init()`, `bindEvents()`, `loadExtractions()`,
`renderExtractions()`, `handleFileSelect()`, `handleUpload()`; global
`window.initializeOilSheetAiGrid` at the end. Bind row handlers with delegated
`$(document).on('click', '.osa-…', …)` because rows are re-rendered.

Client-side preprocessing before upload, in this order:

1. Reject anything over 20 MB outright with a toast.
2. **Images:** draw to a canvas and downscale so the longest edge is **2000px**, export as JPEG at
   quality 0.85. Not 1568 — that figure comes from older vision models; `claude-opus-5` reads images
   up to 2576px on the long edge, and the extra resolution is exactly what faint pencil digits need.
   Skip the downscale if the image is already smaller.
3. **PDFs:** pass through unchanged, `media_type: "application/pdf"`. Do not attempt to rasterise —
   no PDF library is vendored in this repo and this plan does not add one.
4. Keep the resulting JPEG data URL for `preview_image`, and the bare base64 (no `data:` prefix) for
   the extraction call.

Then:

- Call `_common.uploadFile({ file: downscaledFile, resourceFolder: 'Macavation/OilProductionSheets',
  fileId: 'sheet_' + sheetType + '_' + isoDate })` for the archival copy. This is the same
  `resourceFolder` the oil module already writes to (`oil_production_grid.js:685`). **Upload the
  downscaled file, not the original** — the helper caps at 6 MB (`common.js:367`) and a phone photo
  of an A3 sheet will exceed it. Treat a failed archival upload as a warning, not a blocker: carry
  on with extraction and pass `s3_file_id: null`.
- POST to the edge function. There is no `supabase.functions.invoke` anywhere in this repo — the
  convention is a plain `fetch`, and the canonical header shape is
  `WebPortal/modules/assistant/mac-assistant-api.js:59-71`:

  ```js
  var c = window.MACAVATION_SUPABASE;
  var url = String(c.url || '').replace(/\/$/, '') + '/functions/v1/extract-oil-sheet';
  var headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + c.anonKey,
      apikey: c.anonKey,
      'X-Portal-Session': Session.get('token')
  };
  ```

  Extraction takes 15–60 seconds. Show a spinner and a "Reading the sheet…" message on the button
  (the pattern at `oil_production_grid.js:230-232`), disable the form, and set an explicit
  `AbortController` timeout of 150 seconds with a clear message if it fires.
- On success, refresh the list and toast. Leave navigation to the review screen to plan 04; for now
  the Review row action can toast "Review screen coming in the next release" — plan 04 replaces it.

**`oil_sheet_ai_grid.css`** — `.osa-*` classes only, `--mac-*` tokens only. Model the dropzone on the
existing `.op-ps-*` styling in `WebPortal/modules/oil-production/css/oil_production_grid.css`.

### 2. Data access — `WebPortal/js/data-functions.js`

Add four methods to the `dataFunctions` object, following the shape of `upsertOilBatch`
(`data-functions.js:4438-4462`) — build a `p_`-prefixed params object, call `this.callFunction(...)`,
then `clearCachePattern` on writes:

- `getOilSheetExtractions(options, token, forceRefresh)` → `get_oil_sheet_extractions`,
  `cacheKey: 'oil_sheet_extractions'`
- `getOilSheetExtractionById(id, token)` → `get_oil_sheet_extraction_by_id`, `useCache: false`
- `updateOilSheetExtractionReview(data, token)` → `update_oil_sheet_extraction_review`
- `confirmOilSheetExtraction(data, token)` → `confirm_oil_sheet_extraction`

The last two are consumed by plan 04 but belong here, because both plans would otherwise edit
`data-functions.js` and race to merge into it.

Every one of these must tolerate the RPC not existing yet: `callFunction` throws on a non-2xx, so
wrap the call sites in `try/catch` and render an empty state rather than letting the rejection escape.

### 3. Registration — four files, all four required

1. **`WebPortal/js/appRouteConfig.json`** — add next to `oil-production-grid` (lines 651-679):

   ```json
   "oil-sheet-ai-grid": {
       "description": "AI Production Sheet Ingestion",
       "path": "oil-sheet-ai",
       "html": "html/oil_sheet_ai_grid.html",
       "js": [ "js/oil_sheet_ai_grid.js" ],
       "css": [ "css/oil_sheet_ai_grid.css" ]
   }
   ```

2. **`WebPortal/js/appRouter.js`** — add to the initializer map beside `'oil-production-grid'`
   (lines 438-442):

   ```js
   'oil-sheet-ai-grid': () => {
       if (typeof initializeOilSheetAiGrid === 'function') {
           initializeOilSheetAiGrid();
       }
   },
   ```

3. **`WebPortal/index.html`** — a nav `<li>` inside the `#oilCollapse` block (starts line 175),
   matching the surrounding markup exactly: `class="nav-item d-none"`,
   `data-route="oil-sheet-ai-grid"`, an `<a class="nav-link" href="#" route="oil-sheet-ai-grid">`, a
   Font Awesome icon (`fas fa-file-import`), and a label. Add the module's `<script>` tag only if the
   route registry does not already load it — it does, so **no script tag is needed**.

4. **`WebPortal/js/role-menu-config.js`** — a `menuStructure` entry beside `'oil-production-grid'`
   (lines 359-364) with `route`, `icon`, `label: 'AI Sheet Upload'`, `category: 'oil'`,
   `parent: 'oilCollapse'`; and add the route to `portalModuleOrder` (around line 503) so it sorts
   into the oil group.

The feature key `oil-sheet-ai-grid` and the action keys `oil.sheet.ai_upload` / `oil.sheet.ai_review`
are seeded by plan 01's migration. Do not add a second migration here.

## Security invariants

- **Render every value with `.text()` or an escaped template — never raw `innerHTML`.** The list shows
  `file_name`, `shift_supervisor` and other fields that originate in a model reading an uploaded
  file. Treat all of it as untrusted. Copy the `escapeHtml` helper from `oil_production_grid.js` and
  use it on every interpolation.
- Gate the Upload button with an inline `typeof hasAction === 'function' && hasAction('oil.sheet.ai_upload')`
  check at render time. `data-action-perm` will not work here — the markup is dynamic
  (`CLAUDE.md:29-32`).
- Send the portal session token in `X-Portal-Session`. Never put it in a query string or log it.
- Never log the base64 payload.

## Verify before finishing

- `npm run test:fleet` passes. Two checks in it are the ones that will catch mistakes here:
  `registry:verify` fails if `appRouteConfig.json` names a file that does not exist, and
  `ui:verify` fails on any raw hex in the new CSS.
- Grep the new CSS for `#` followed by a hex digit — there must be no matches.
- Grep the new JS for `innerHTML` and confirm every occurrence is assigned a string built only from
  escaped values.
- Confirm the route key is spelled `oil-sheet-ai-grid` identically in all four registration files —
  a mismatch fails silently at runtime with a blank panel, which is precisely what
  `registry:verify` exists to catch and cannot catch across `appRouter.js`.

You cannot log into the deployed site from this environment. Do not claim the screen was opened or
that an upload succeeded; verification here is the static gate plus reading the diff.
