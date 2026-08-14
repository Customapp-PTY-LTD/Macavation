---
retry_of: 0b8857d2-257b-4d86-9fc6-dea97af13ed6
---

# Report builder — PDF export

## Context

Pete's directors receive a PDF. This plan adds PDF generation and download from the report editor.
Publishing and re-issuing are a separate plan; nothing here changes a report's status.

**This plan carries no `depends_on`: everything it builds on is already merged into `dev`.** Verified
against this checkout before submission — confirm each before starting, and if any is missing, stop
and report rather than creating it here. Note the exact paths: the module's assets live under
`html/`, `js/` and `css/` subdirectories, **not** flat in the module root.

- `WebPortal/modules/sales-reports/html/report_editor.html`
- `WebPortal/modules/sales-reports/html/report_list.html`
- `WebPortal/modules/sales-reports/js/report-metric-line.js`
- `WebPortal/modules/sales-reports/js/report_editor.js`
- `WebPortal/modules/sales-reports/js/report_list_grid.js`
- `WebPortal/modules/sales-reports/css/sales_reports.css`
- `sales-report-editor` is registered in **both** `WebPortal/js/appRouteConfig.json` (route entry at
  line 651, `js: ["js/report-metric-line.js", "js/report_editor.js"]`) and the `initializeModule()`
  switch in `WebPortal/js/appRouter.js` (line 438, calling `initializeReportEditor`).
- `getReportInstance` exists in `WebPortal/js/data-functions.js` (line 5986).
- `pdfmake` is **not** yet in `WebPortal/index.html` — this plan adds it.

Note the report's figure inputs are being made read-only in a separate change (data entry moves to a
new Sales & Production Data page). That does not affect this plan: the PDF renders the payload it is
given either way.

Report data comes from the `getReportInstance` wrapper. **This plan adds no new wrapper and no new
RPC** — generating a PDF is a pure client-side transform of a payload the editor already holds in
`state.payload` (`report_editor.js`, assigned in `load()` and `reloadAndRerender()`).

The report-builder RPCs are defined in `migrations/20260817090000_report_builder_foundations.sql`
and `migrations/20260817100000_report_instances_and_targets.sql`, both in this checkout. **Whether
those migrations have been applied to any database cannot be verified from this checkout — do not
state or assume that they have.** Background on the feature is in
`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`; **do not copy that document's counts or
percentages into code comments, UI copy or commit messages** — they come from database queries this
run cannot re-execute.

## Third-party dependency — exact and pinned

The app has no build step and no npm dependencies; every library is a CDN `<script>` tag in
`WebPortal/index.html` (see the existing SheetJS and Chart.js tags around lines 545–555). Add both
of these, next to the existing Chart.js tag:

```html
<script src="https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js"></script>
```

Both are required — `vfs_fonts.js` carries the embedded font data and pdfmake throws without it.
Version `0.2.10` exactly; do not use a floating tag.

**Match the existing tags' shape exactly: plain `src` only. Do NOT add `integrity` or `crossorigin`
attributes.** Every CDN tag already in `WebPortal/index.html` (jQuery 3.7.1, Bootstrap 5.3.0,
xlsx 0.18.5, Chart.js 4.4.1, `@supabase/supabase-js`, sweetalert2, choices.js, flatpickr,
signature_pad) omits SRI. `BluePrint/javascript-jquery-rules.md` still asks for SRI hashes; the
shipped code has moved past that line, so adding SRI here would make this one tag inconsistent with
every other tag on the page. **Correcting that document is explicitly out of scope for this plan**
and is a separate, human-reviewed decision — do not edit `BluePrint/**` and do not add SRI.

pdfmake rather than jsPDF because this report is a sequence of roughly fifteen stacked tables of
differing shapes: pdfmake takes a declarative `docDefinition` and handles page breaks, repeating
table header rows and per-page `header`/`footer` callbacks itself, where jsPDF would need
hand-maintained Y-position bookkeeping across every table. Server-side rendering is rejected: no
Deno PDF library is vetted in this repo and every existing edge function is thin JSON glue.

## Reuse — do not re-implement the number formatting

`WebPortal/modules/sales-reports/js/report-metric-line.js` is the existing, on-screen renderer for
every `metric_table` row and it **already implements every formatting rule this PDF needs**:

- `formatSystemValue(metric)` — `null`/`undefined`/non-finite `system_value` → `'No system data'`,
  otherwise `formatNumber(system_value)`.
- `formatAchievedPct(metric)` — `'\u2014'` (em dash) when `target_value` is null/undefined/non-finite/`0`
  or `effective_value` is null/undefined/non-finite, otherwise
  `formatNumber(effective/target * 100) + '%'` with a final `Number.isFinite` guard.
- a **private** `formatNumber(value)` — `toFixed(2)`, comma thousands separators, deliberately
  locale-independent (its own comment: "No toLocaleString/Intl.NumberFormat").

Constraints that follow, all mandatory:

1. **Deliverable 1 must call `ReportMetricLine.formatSystemValue` and
   `ReportMetricLine.formatAchievedPct` — do not re-derive, copy, or "simplify" either.** The PDF and
   the screen must be incapable of disagreeing.
2. **Never format a figure with `toLocaleString`, `toLocaleDateString`, `Intl.NumberFormat` or
   `Intl.DateTimeFormat` anywhere in this change.** These are locale/ICU dependent and would print
   different thousands separators and decimals from the screen Pete signed off.
3. `formatNumber` is currently **not exported**. The PDF's *Target* column needs it, so make one
   additive change to `report-metric-line.js`: add `formatNumber: formatNumber` to the
   `w.ReportMetricLine = { ... }` object literal and add one line to that file's header comment
   noting it is now exported. **Do not change the body of `formatNumber`, `formatSystemValue`,
   `formatAchievedPct`, `safeKey` or `buildMetricRow`, and do not change the file's IIFE/global
   pattern.** Blast radius check: `grep -rn "ReportMetricLine" WebPortal Playwright\ Tests` shows
   exactly two hits today — the definition itself and `report_editor.js:168`
   (`ReportMetricLine.buildMetricRow`). Adding a property to the exported object cannot alter that
   one call site, and no test or spec references the module. Re-run that grep after your edit and
   confirm the only new hits are your own new file.
4. **`formatNumber` is unsafe on non-finite input** — it returns the literal string `"NaN"`
   (`Number('x').toFixed(2)`). The existing on-screen Target cell calls it guarded only against
   `null`/`undefined` (`report_editor.js`'s row builder, `report-metric-line.js:79`). At the new PDF
   call site you must guard harder: render `'\u2014'` unless
   `value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value))`.
   This is a deliberate, documented, one-way divergence: the PDF prints an em dash exactly where the
   screen would print `NaN`, and nowhere else. Note it in a comment on that helper.
5. **No fallback formatter.** If `ReportMetricLine` (or any of the three functions it must expose) is
   absent when `buildReportDocDefinition` runs, `throw new Error('report-pdf-builder requires ReportMetricLine')`.
   Do **not** define a local copy as a fallback and do not silently substitute one — a fallback is
   exactly how the two renderers would drift apart unnoticed.
6. The scope of the "identical to the on-screen row" invariant, checked against every cell
   `report-metric-line.js` actually renders: it binds the **System**, **Target** and **Achieved %**
   cells, which are `.text()` cells produced by the functions above. It does **not** bind the
   **Entered** cell — on screen that is an `<input>` seeded with the raw, unformatted
   `String(entered_value ?? system_value)` (`report-metric-line.js:66-67, 74`), i.e. there is no
   formatted screen value for the PDF to match. In the PDF, render **Entered** as
   `formatNumber(entered_value)` under the same finite guard as rule 4, and `'\u2014'` when
   `entered_value` is null/undefined/blank/non-finite.
7. `report-metric-line.js`'s header comment references `scripts/tmp-verify-report-metric-line.cjs`.
   **That file does not exist in this checkout** (it was a deleted scratch harness). Do not assume it
   exists, do not restore it, and do not copy that reference into the new file's header comment.

## Security invariants

- pdfmake takes **text values, not markup** — pass strings straight into `text:` properties. Never
  build an HTML string from report data and never call `.html()` with any of it. The payload
  contains user-entered text (override reasons, commentary, executive summary).
- Coerce numbers with `Number()` before formatting. A `null` must render as the literal
  "No system data" (system value) or an em dash (target / entered / achieved %) — never `0`, `NaN`,
  `Infinity` or the string `"null"`.
- Validate the report uuid with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before use. In the editor the
  id already comes from `Session` via the existing `getCurrentReportId()`/`isReportUuid()` pair — use
  `state.reportId`/`state.payload`; do not add a second id source and do not read the id from a route
  argument.
- **Never use a payload value as an object property key.** Build the `docDefinition` out of arrays
  and literal keys only; if a lookup is unavoidable use a `Map` (the pattern `report_editor.js`
  already uses for `pendingOverrides`/`pendingCommentary`) and reject `__proto__`, `constructor` and
  `prototype`. `report-metric-line.js`'s `safeKey` is private and is **not** exported — do not reach
  for it, and do not treat its `''` return as a usable key.
- The download filename is derived from payload data, so it must be sanitised: the final string must
  match `/^[A-Za-z0-9._-]+\.pdf$/`. No path separators, no spaces, no payload text pasted in raw.
- The "Download PDF" button is gated with `data-action-perm="reports.report.generate"`, swept once
  over static markup at `appRouter.js:253-256`. `action-access.js` is default-deny, **with one
  documented exception you must not try to "fix": `ALWAYS_ALLOW_ROLES = ['super_user', 'admin']`
  (`action-access.js:18`) always sees the button even if the permission seed is absent.** That is
  acceptable here because the PDF is a pure client-side transform of a payload the user has already
  been served; it grants no new data access. Do not modify `action-access.js`.

## Payload shapes to handle

All confirmed against `public.get_report_instance` in
`migrations/20260817100000_report_instances_and_targets.sql:722-789`:

- Top level: `template_name`, `period_type`, `period_start`, `period_end`, `period_label`, `version`,
  `status`, `executive_summary`, `sections` (array, may be `[]`).
- Each section: `section_key`, `label`, `render_kind`, `is_enabled`, `display_order`, `commentary`,
  `metrics` (array), `lines` (array).
- Each metric: `metric_key`, `label`, `unit`, `system_value`, `target_value`, `entered_value`,
  `effective_value` (= `COALESCE(entered_value, system_value)`), `is_overridden`
  (= `entered_value IS NOT NULL`), `override_reason`, `overridden_by_name`.
- **`display_order` is a zero-padded string** (`LPAD(...,6,'0')`), not a number. Sort as a string or
  `parseInt(..., 10)` first. Treat any missing/blank `display_order` as sorting last; keep the sort
  stable.
- **`period_label` may contain internal blank padding.**
  `migrations/20260817090100_fix_report_period_label_padding.sql` exists because
  `report_period_label` produced `"August    2026 (FYE 2027)"`, and whether it has been applied to
  any given database is unknowable from here. Normalise for display only:
  `String(label == null ? '' : label).replace(/\s+/g, ' ').trim()` — the same expression as
  `displayLabel()` in `report_editor.js:39-41`. Never synthesise a label locally.
- `render_kind` is one of `metric_table`, `line_table`, `tracking_table` (CHECK constraint,
  `...090000_...sql:267`). Only `metric_table` has content at this stage; `lines` is always `[]`.
- `status` is one of `draft`, `published`, `superseded` (`report_instances_status_check`,
  `...100000_...sql:148`) — all three must be handled, see the watermark rule.

## Deliverable 1 — `WebPortal/modules/sales-reports/js/report-pdf-builder.js`

A **pure** module exposing exactly one global namespace object:

```js
w.ReportPdfBuilder = {
    buildReportDocDefinition: buildReportDocDefinition,
    fileNameFor: fileNameFor
};
```

Use the same namespace-assignment IIFE as `report-metric-line.js`:
`(function (w) { 'use strict'; ... })(typeof window !== 'undefined' ? window : this);`. At evaluation
time the file must not reference `document`, `$`, `jQuery`, `Swal`, `dataFunctions`, `Session` or
`pdfMake`, so it can be evaluated with plain `vm.Script` and no DOM. It must not touch the DOM, call
an RPC, or reference `pdfMake` at any time.

**These two exported names — `ReportPdfBuilder.buildReportDocDefinition` and
`ReportPdfBuilder.fileNameFor` — are the only names Deliverable 2 may call. Deliverable 2 must not
invent a different namespace, a bare global function, or a different spelling.**

### `buildReportDocDefinition(report, options)`

`report` is the `getReportInstance` payload. `options` is optional; the only key read is
`options.generatedOn`, a `'YYYY-MM-DD'` string. **The function must be deterministic: no `new Date()`,
no `Date.now()`, no `toISOString()`, no locale APIs inside this module.** If
`options.generatedOn` is absent or does not match `/^\d{4}-\d{2}-\d{2}$/`, omit the generation date
from the footer entirely (print just "Page N of M") rather than inventing one.

Returns a pdfmake `docDefinition` object:

- `pageSize: 'A4'`, `pageMargins: [32, 70, 32, 40]`.
- `header`: "Macavation" left, the normalised `period_label` right.
- `footer(currentPage, pageCount)`: `'Page ' + currentPage + ' of ' + pageCount`, plus
  `'Generated ' + options.generatedOn` when that value was supplied and valid.
- A title block: `template_name`, normalised `period_label`, the raw `period_start`–`period_end`
  range, and `'Version ' + version` when `version > 1`.
- The executive summary when present and non-blank.
- Then each section where `is_enabled` is true, in `display_order`: heading (`section.label`,
  normalised), `commentary` if present and non-blank, then its table.
  - `metric_table` → columns **Description · System · Entered · Target · Achieved %**, with
    `headerRows: 1` so the header repeats across page breaks, and `layout: 'lightHorizontalLines'`.
    Cell values come from the reuse rules above: Description = normalised `metric.label`;
    System = `ReportMetricLine.formatSystemValue(metric)`; Entered and Target = guarded
    `ReportMetricLine.formatNumber` per rule 4/6; Achieved % =
    `ReportMetricLine.formatAchievedPct(metric)`.
  - `line_table` / `tracking_table` → heading plus one italic row reading "No data captured for this
    section." **Do not omit the section** — a section Pete switched on must appear, or he cannot tell
    "switched off" from "empty". Any unrecognised `render_kind` takes this same branch.
- An overridden figure (`metric.is_overridden === true`) must be visually distinguishable (a
  different `color` on that cell — a literal colour string in JS is fine; `ui:verify`'s hex rules
  apply to CSS files only), and each overridden row's reason must appear — as a footnote row beneath
  its table or an extra column, with `override_reason` passed as a plain string into `text:`.
  Directors need to see why a number was entered by hand.
- A closing line when any figure was overridden: `N + ' of ' + M + ' figures in this report were entered manually.'`
  **Compute both numbers from the payload; do not hardcode.** For internal consistency, both counts
  cover exactly the metrics that appear in this document: `M` = every metric in every **enabled**
  section, `N` = those of them with `is_overridden === true`. Emit the line only when `N > 0`.
- Watermark, derived from `report.status`, whose only legal values are `draft`, `published`,
  `superseded`:
  - `'published'` → **no** `watermark` key at all.
  - `'superseded'` → `watermark: 'SUPERSEDED'` (it *was* issued; do not label it DRAFT).
  - `'draft'`, or any other/missing value → `watermark: 'DRAFT'` (fail towards "not issued").

### `fileNameFor(report)`

Returns e.g. `Macavation-Weekly-Report-2026-08-10.pdf`, built from `period_type` and `period_start`.

- **Do not use `toISOString()`** — it converts to UTC and can shift the date across a day boundary
  for a South African user. `period_start` is already a `YYYY-MM-DD` string, so use it directly.
- Date segment: `String(report.period_start || '').slice(0, 10)`; include it only if it matches
  `/^\d{4}-\d{2}-\d{2}$/`, otherwise omit the segment (`Macavation-Weekly-Report.pdf`). Never
  substitute a value derived from `new Date()`.
- Type segment: only `weekly` → `Weekly` and `monthly` → `Monthly` (the `period_type` CHECK values);
  anything else → omit the type word.
- Assert the result against `/^[A-Za-z0-9._-]+\.pdf$/` before returning; if it somehow fails, return
  the constant `'Macavation-Report.pdf'`.

## Deliverable 2 — the download action

In `WebPortal/modules/sales-reports/html/report_editor.html`, add a second button to the existing
`.btn-toolbar` div (alongside `#reportEditorRefreshFiguresBtn`), modelled on that button's markup:

```html
<button type="button" class="btn btn-outline-secondary" id="reportEditorDownloadPdfBtn" data-action-perm="reports.report.generate">
    <i class="fas fa-file-pdf me-1"></i>Download PDF
</button>
```

`ui:verify` scans every `.html`/`.js` under `WebPortal/`: use a Font Awesome (`fas`/`far`) icon —
**never a `bi bi-*` Bootstrap Icon** — and **never `btn-success`**; do not introduce
`var(--phoenix-*)` or the other legacy token names. `reports.report.generate` is seeded by
`migrations/20260817110000_report_builder_rbac.sql:88`; if that migration has not been applied the
button is hidden for every role except `super_user`/`admin` (see the security invariant above).

In `report_editor.js`, bind it inside the existing `bindEvents()` with the existing namespace so the
existing `destroy()` (`$(document).off('.reportEditor')`) still removes it:

```js
$(document).on('click.reportEditor', '#reportEditorDownloadPdfBtn', function () {
    handleDownloadPdf();
});
```

```js
function handleDownloadPdf() {
    if (!state.payload) return;
    if (typeof pdfMake === 'undefined' || !pdfMake.createPdf) {
        Swal.fire({ icon: 'error', title: 'Could not create the PDF', text: 'The PDF library is not available. Please reload the page and try again.' });
        return;
    }
    var docDefinition = ReportPdfBuilder.buildReportDocDefinition(state.payload, { generatedOn: todayYmd() });
    pdfMake.createPdf(docDefinition).download(ReportPdfBuilder.fileNameFor(state.payload));
}
```

- `createPdf(...).download(name)` triggers the browser download and **returns nothing** — do not
  `await` it and do not branch on its result.
- `todayYmd()` is a small private helper in `report_editor.js` returning today's **local** date as
  `'YYYY-MM-DD'` from `getFullYear()`/`getMonth()+1`/`getDate()` with zero padding. **Do not use
  `toISOString()`** and do not reuse `formatDateOnly()` here — that helper only slices an existing
  string at `'T'` and has nothing to slice for "today".
- Wrap the body of `handleDownloadPdf` in `try/catch`; on a throw, `console.warn('[sales-reports] PDF generation failed', err)`
  and show the same Swal error. Deliverable 1 throws deliberately when `ReportMetricLine` is missing,
  and that must surface as a message, not an unhandled exception.
- Available on drafts, published and superseded reports alike; do not disable it by status.

## Wiring

- `WebPortal/index.html`: the two CDN tags above, plain `src` only.
- `WebPortal/js/appRouteConfig.json`: **insert** `"js/report-pdf-builder.js"` into the
  `sales-report-editor` route's `js` array **between** the two existing entries, so the array reads
  exactly:

  ```json
  "js": [
      "js/report-metric-line.js",
      "js/report-pdf-builder.js",
      "js/report_editor.js"
  ]
  ```

  Keep the JSON valid — `registry:verify` fails on any registry-named path missing from disk.
- No change to `WebPortal/js/appRouter.js` is needed: the route already exists at line 438.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`
   (`package.json:27`).
2. `grep -c "pdfmake@0.2.10" WebPortal/index.html` returns `2` — the library and `vfs_fonts`.
   `grep -n "pdfmake" WebPortal/index.html` shows neither tag carries `integrity` or `crossorigin`.
3. `grep -n "js/report-pdf-builder.js" WebPortal/js/appRouteConfig.json` shows it listed after
   `js/report-metric-line.js` and before `js/report_editor.js`, and
   `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
4. `grep -rn -B2 -A2 "createPdf" WebPortal/modules/sales-reports/js/` — read the printed context and
   confirm the call is neither `await`ed nor used in an `if`/`.then()`/assignment. (`-r` is required:
   the argument is a directory.)
5. **A pure `node` unit check of `ReportPdfBuilder.buildReportDocDefinition`**, with no browser, no
   network and without loading pdfmake — the function returns a plain object, so pdfmake is only
   needed to *render* it. Write a scratch `.cjs` script that uses `node:vm` to evaluate
   `report-metric-line.js` and then `report-pdf-builder.js` **in the same context object** (each
   file's IIFE receives that context as `w`, since `window` is undefined there), then calls
   `context.ReportPdfBuilder.buildReportDocDefinition(fixture, { generatedOn: '2026-08-20' })`.
   Note `scripts/tmp-verify-report-metric-line.cjs` does **not** exist in this checkout — write your
   own harness.

   Fixture (hand-written, and containing none of the banned tokens itself) must include:
   - an enabled `metric_table` section with: one overridden metric (`entered_value` set,
     `is_overridden: true`, an `override_reason`); one metric whose `system_value` is `null` and
     `target_value` is `null`; one whose `target_value` is `0`; one whose `target_value` is the
     string `"abc"` (the non-finite guard);
   - an enabled `line_table` section with `lines: []` and `metrics: []`;
   - a disabled section;
   - a `period_label` containing runs of blanks;
   - `status: 'superseded'` in one call and `status: 'published'` in a second call.

   Assert:
   - the result has a `content` array;
   - the disabled section's label does **not** appear anywhere in the output;
   - the empty `line_table` section's label **does** appear, with "No data captured for this section.";
   - `status: 'superseded'` yields `watermark` containing `'SUPERSEDED'`, and `status: 'published'`
     yields no `watermark` key;
   - the "N of M figures … entered manually" line reports `N`/`M` counted over enabled sections only;
   - **by recursively walking the returned object** (do not rely on `JSON.stringify` for this —
     `JSON.stringify` renders `NaN` and `Infinity` as bare `null`, so a real `NaN` would slip
     through): every leaf is a `string`, `number`, `boolean` or `function` (the `header`/`footer`
     callbacks); every `number` leaf satisfies `Number.isFinite`; no `string` leaf contains `NaN`,
     `Infinity`, `undefined`, `null`, or a run of two or more consecutive spaces.
   - calling `buildReportDocDefinition` in a fresh context **without** `ReportMetricLine` throws.

   Delete the scratch script before finishing (`git status --porcelain` shows no stray file).
6. `grep -rn "\.html(\|innerHTML\|toLocaleString\|toLocaleDateString\|Intl\." WebPortal/modules/sales-reports/js/report-pdf-builder.js`
   returns nothing.
7. `grep -n "toISOString" WebPortal/modules/sales-reports/js/report-pdf-builder.js` returns nothing
   (exit status 1). **Scope this grep to the new file only.** Do not run it across the directory and
   do not "clean up" the match it would find: `report_editor.js:58` legally contains the token inside
   the explanatory comment `// String-slice only (no Date arithmetic, no toISOString) — same idiom as report_list_grid.js.`
   That comment must be left exactly as it is. Separately confirm your own new code in
   `report_editor.js` adds no `toISOString` call: `grep -n "toISOString" WebPortal/modules/sales-reports/js/report_editor.js`
   must still show that single line-58 comment and nothing else.
8. `grep -rn "ReportMetricLine" WebPortal/ "Playwright Tests/"` shows the definition, the added
   `formatNumber` export, `report_editor.js:168`, and only your new file's call sites — no other
   consumer was disturbed.
9. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty — no spec file was edited.
10. `git diff --name-only origin/dev` lists only: `WebPortal/index.html`,
    `WebPortal/js/appRouteConfig.json`, `WebPortal/modules/sales-reports/html/report_editor.html`,
    `WebPortal/modules/sales-reports/js/report_editor.js`,
    `WebPortal/modules/sales-reports/js/report-metric-line.js`, and the new
    `WebPortal/modules/sales-reports/js/report-pdf-builder.js`.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job. Every grep above
must be exactly as written — scoped to a file where the outcome is "returns nothing", and with `-r`
whenever the target is a directory.

## Out of scope

Publishing, re-issuing, uploading the PDF anywhere, WhatsApp delivery, the targets admin screen, the
sales Excel import, the metric resolvers, chart rendering, rendering `line_table` or
`tracking_table` content, any migration, changing `action-access.js` or its `super_user`/`admin`
bypass, any behavioural change to `report-metric-line.js` beyond exporting `formatNumber`, adding SRI
attributes to any script tag, and editing any Playwright spec, `BluePrint/**`, `WebPortal/help/*`,
`docs/**`, or `permission-module-map.js`.
