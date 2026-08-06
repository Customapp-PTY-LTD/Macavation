---
depends_on: oil-sheet-ai-03-upload-and-list.md
---

# AI production-sheet ingestion — review screen and commit

## Context

Plan 03 shipped the upload screen and the extraction list for AI-read paper production sheets. This
plan adds the step that makes the feature safe to use: **a mandatory human review**. Nothing an AI
reads off a handwritten sheet reaches the production record until the factory manager has seen the
scan and the extracted values side by side and pressed Confirm.

That was a deliberate decision by the product owner. Handwriting extraction is materially harder than
the typed-document case, so the design assumes errors and makes them cheap to catch rather than
pretending they will not happen.

The two forms in scope are **MP02-9 Rev3** (food grade) and **MP02-12 REV 04** (cosmetic oil).

**This plan touches the module created by plan 03** (`WebPortal/modules/oil-sheet-ai/`) and adds a
row action to its list. It also relies on `confirmOilSheetExtraction` and
`updateOilSheetExtractionReview`, which plan 03 already added to `WebPortal/js/data-functions.js` —
**do not add them again.**

`dev` auto-deploys on merge (`CLAUDE.md:8-11`) and plan 01's migration is applied by a human out of
band, so this screen must degrade gracefully if `confirm_oil_sheet_extraction` does not exist yet:
catch the error and show a toast, never an unhandled rejection.

## Where confirmed data goes

`confirm_oil_sheet_extraction` (authored in plan 01) appends the corrected object to
`public.shift.shift_tracking → production_sheets[<sheet_type>][]`. That is where the portal already
keeps production sheets — see `WebPortal/modules/oil-production/js/oil_production_grid.js:706-717`,
which builds exactly that structure and saves it through `upsert_shift`. The RPC does the
read-modify-write server-side so two managers confirming sheets for the same day cannot overwrite
each other.

The browser's job is only to produce a corrected object and hand it over. **Do not call
`upsertShift` from this screen** — that would reintroduce the lost-update race the RPC exists to
avoid.

### A limitation to preserve, not to fix

The in-app cosmetic form (`oil_production_grid.js:544-558`) models **MP5.2.3 Rev 06** — a 15-row
time log with crude-kernel / kernel-dust / crush / cracker-dust / cake columns. The sheet actually in
use is **MP02-12 REV 04**, a different document with a 75-slot mix grid, a separate raw-material
traceability table, an IBC table and a totals block. The review form below follows the **paper sheet
in use**, not the older in-app form. `shift_tracking` is free-form jsonb, so it stores the richer
shape without complaint; the consequence is that the older form will not render a REV 04 sheet back.
That is accepted. Do not reshape the data to fit the old form, and do not modify
`oil_production_grid.js` — the existing oil screens are explicitly out of scope.

## Conventions this repo enforces

Same set as plan 03; the ones that bite hardest here:

- **`ui:verify` fails the merge on any raw hex outside `WebPortal/css/design-tokens.css`**
  (`CLAUDE.md:46-52`). The amber "needs attention" highlight must come from existing semantic tokens
  used as a **tint** — a `-light` background with strong text — never a solid coloured slab
  (`docs/design/DESIGN_SYSTEM.md:22-27`).
- **No deep-linking** (`CLAUDE.md:41-43`). The review screen is a view swap inside the
  `oil-sheet-ai-grid` module, not a new route. Keep list state so Back returns to it.
- **`data-action-perm` is inert on dynamic markup** (`CLAUDE.md:29-32`) — gate Confirm with an inline
  `hasAction('oil.sheet.ai_review')` call at render time.
- Reuse `MacStatus.pill`, `macEmptyState`, `_common.showSuccessToast` / `showErrorToast`,
  `_common.formatDateDDMMYYYY`, `Swal.fire`, and the module's `escapeHtml` helper.

## Work

### 1. Review view — `WebPortal/modules/oil-sheet-ai/`

Add a third view to the module (list / upload / review) toggled in JS. Suggested files:
`html/oil_sheet_ai_review.html` for the shell plus `js/oil_sheet_ai_review.js` for the form builder,
both registered in the existing `oil-sheet-ai-grid` entry in `WebPortal/js/appRouteConfig.json`.
`registry:verify` fails the merge if a registered file is missing, so add the entries and the files
in the same change.

**Layout** — two columns on desktop, stacked on mobile (`mobile-first.css` is already loaded):

- **Left, sticky:** the scan. Render `preview_image` (a `data:` URL from the extraction row) into an
  `<img>` with `max-width: 100%`. Add a fullscreen toggle and a simple zoom control — the reviewer is
  comparing pencil digits, so being able to enlarge the scan is the difference between a usable
  screen and an unusable one.
- **Right, scrollable:** the editable form.

**Header strip:** sheet type, production date, a `MacStatus.pill` for status, and a confidence badge
— green ≥ 0.85, amber ≥ 0.70, red below. State plainly next to it that confidence is the model's own
estimate, not a measurement.

**Validation flags panel:** render `validation_flags` (written by plan 02's edge function) as a short
list at the top of the form — each entry has `field`, `severity` and `message`. These are the
deterministic checks (column totals that do not add up, batch numbers that look like a near-miss of
an existing one), and they are more trustworthy than the confidence score. Clicking one scrolls to
and focuses the field it names.

**The form**, built per `sheet_type` from `reviewed_data` if present, else `extracted_data`. Field
ids follow the existing `op_ps_*` convention from
`oil_production_grid.js:509-558` so the two forms stay recognisably the same shape — prefix them
`osa_ps_*` to avoid colliding with the other module if both are ever on the page.

*`food_grade_oil` (MP02-9 Rev3):* date, shift, shift supervisor, signature present; batch number of
product produced, name of product, raw material used; start oil BN + litre; IBC 1/2/3 BN + litre;
then the main table. **The four columns have independent lengths** — 14 raw-material weights against
9 oil-out values and 1 cake-out value is a normal real sheet. Render them as three independent
add/remove row lists, not one aligned grid, and never pad one to match another. Each weight row shows
the literal text the model read (`7.20+7.01`) beside the computed value, both editable; changing the
literal re-evaluates the value if it parses as a simple sum. Below each column, its written total
next to the live recomputed sum, with the difference highlighted when they disagree. Then comments
and the four waste fields.

*`cosmetic_oil` (MP02-12 REV 04):* date, shift, supervisor, start oil BN + litre; the mix grid
(mix number / crush / time) as an add/remove list, not 75 fixed rows — only mixes with data are
extracted; raw-material traceability rows (description + batch no); the IBC table (IBC / oil BN /
literage) plus interruptions; the recipe block and the total-quantities block as separate fixed field
sets — **they are independent figures and must not be cross-computed**; notes; the waste block
including `product_waste_raw` and `cake_kg`; and oil-from-press with its literal text beside the
filter and hydraulic values.

Every field carries an amber tint when its path appears in `low_confidence_fields` or in a
`validation_flags` entry, cleared as soon as the reviewer edits it.

**Actions:**

- **Save draft** → `dataFunctions.updateOilSheetExtractionReview({ id, reviewed_data })`. Status
  stays `extracted`. Also auto-save on a debounced 3-second idle (`_common.debounce`,
  `common.js:204`) with an unobtrusive "Saved" indicator, mirroring
  `modal_oil_production_sheet.js:210-223`.
- **Confirm** → a `Swal.fire` confirmation naming the production date and sheet type, then
  `dataFunctions.confirmOilSheetExtraction({ id, reviewed_data })`. On success: success toast, return
  to the list, refresh. Disable the button while in flight so a double-click cannot fire twice; the
  RPC also rejects a second confirm, so both ends are covered.
- **Re-extract** → confirm, then re-invoke the edge function with the stored `preview_image` and
  discard the current extraction. Warn in the dialog that unsaved review edits are lost.
- **Back** → return to the list without saving, warning via `Swal` if there are unsaved edits.

A `confirmed` extraction opens read-only: no inputs, no Confirm, a banner naming who confirmed it and
when.

### 2. List integration

Replace the placeholder Review row action that plan 03 left in
`WebPortal/modules/oil-sheet-ai/js/oil_sheet_ai_grid.js` with a real call that loads
`getOilSheetExtractionById(id)` and opens the review view. Show Review only for `extracted` and
`confirmed`; for `failed`, offer Re-extract and show `error_message` in a `Swal`.

## Security invariants

- **Every extracted value is untrusted model output derived from an uploaded file.** Render with
  `.text()` or through the module's `escapeHtml` helper. Never assign an extracted string into
  `innerHTML`. This applies to `validation_flags[].message` too.
- `preview_image` goes into `img.src` and nowhere else. Before using it, assert it starts with
  `data:image/` — reject anything else rather than rendering it.
- Gate Confirm with an inline `hasAction('oil.sheet.ai_review')` check at render time.
- Never send the session token anywhere but the `X-Portal-Session` header.

## Verify before finishing

- `npm run test:fleet` passes — in particular `ui:verify` (no raw hex in the new CSS) and
  `registry:verify` (every newly registered file exists).
- Grep the new JS for `innerHTML` and confirm no extracted value reaches it unescaped.
- Grep for `upsertShift` in the new files — there must be no matches; the commit path is
  `confirm_oil_sheet_extraction` only.
- Grep for `oil_production_grid` in the new files — there must be no matches; the existing oil
  screens are out of scope.
- Confirm `updateOilSheetExtractionReview` and `confirmOilSheetExtraction` are **used** here but
  **not redefined** — plan 03 added them to `WebPortal/js/data-functions.js`.

You cannot log into the deployed site or run the Playwright suite from this environment (it targets
the deployed demo site with real logins and is deliberately excluded from the fleet gate —
`package.json:26`). Do not claim a sheet was reviewed or confirmed end to end; verification here is
the static gate plus reading the diff.
