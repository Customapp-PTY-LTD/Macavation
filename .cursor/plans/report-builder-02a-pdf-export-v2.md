# Report builder — PDF export

## Context

Pete's directors receive a PDF. This plan adds PDF generation and download from the report editor.
Publishing and re-issuing are a separate plan; nothing here changes a report's status.

**This plan carries no `depends_on`: everything it builds on is already merged into `dev`.** Verified
against `origin/dev` before submission:

- `WebPortal/modules/sales-reports/` contains `report_editor.html`, `report_editor.js`,
  `report-metric-line.js`, `report_list.html`, `report_list_grid.js`.
- `sales-report-editor` is registered in **both** `WebPortal/js/appRouteConfig.json` and the
  `initializeModule()` switch in `WebPortal/js/appRouter.js`.
- `getReportInstance` exists in `WebPortal/js/data-functions.js`.
- `pdfmake` is **not** yet in `WebPortal/index.html` — this plan adds it.

Confirm those before starting; if any is missing, stop and report rather than creating it here.

Note the report's figure inputs are being made read-only in a separate change (data entry moves to a
new Sales & Production Data page). That does not affect this plan: the PDF renders the payload it is
given either way.

Report data comes from the `getReportInstance` wrapper added in
`report-builder-01a-data-functions-transport.md`. **This plan adds no new wrapper and no new RPC** —
generating a PDF is a pure client-side transform of a payload the editor already has.

The report-builder RPCs are defined in `migrations/20260817090000_report_builder_foundations.sql`
and `migrations/20260817100000_report_instances_and_targets.sql`, both in this checkout. **Whether
those migrations have been applied to any database cannot be verified from this checkout — do not
state or assume that they have.** Background on the feature is in
`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`; **do not copy that document's counts or
percentages into code comments, UI copy or commit messages** — they come from database queries this
run cannot re-execute.

## Third-party dependency — exact and pinned

The app has no build step and no npm dependencies; every library is a CDN `<script>` tag in
`WebPortal/index.html` (see the existing SheetJS and Chart.js tags). Add both of these:

```html
<script src="https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js"></script>
```

Both are required — `vfs_fonts.js` carries the embedded font data and pdfmake throws without it.
Version `0.2.10` exactly; do not use a floating tag.

pdfmake rather than jsPDF because this report is a sequence of roughly fifteen stacked tables of
differing shapes: pdfmake takes a declarative `docDefinition` and handles page breaks, repeating
table header rows and per-page `header`/`footer` callbacks itself, where jsPDF would need
hand-maintained Y-position bookkeeping across every table. Server-side rendering is rejected: no
Deno PDF library is vetted in this repo and every existing edge function is thin JSON glue.

## Security invariants

- pdfmake takes **text values, not markup** — pass strings straight into `text:` properties. Never
  build an HTML string from report data and never call `.html()` with any of it. The payload
  contains user-entered text (override reasons, commentary, executive summary).
- Coerce numbers with `Number()` before formatting. A `null` must render as the literal
  "No system data" — never `0`, `NaN`, `Infinity` or the string `"null"`.
- Validate the report uuid from `Session` or a `data-*` attribute with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before use.
- Never use a payload value as an object property key without rejecting `__proto__` and
  `constructor`.

## Payload shapes to handle

Both are documented in `report-builder-01d-report-editor.md` and repeated here because this plan
formats them independently:

- **`display_order` is a zero-padded string** (`LPAD(...,6,'0')`), not a number. Sort as a string or
  `parseInt(..., 10)` first.
- **`period_label` may contain internal blank padding.**
  `migrations/20260817090100_fix_report_period_label_padding.sql` exists because
  `report_period_label` produced `"August    2026 (FYE 2027)"`, and whether it has been applied to
  any given database is unknowable from here. Normalise for display only:
  `String(label == null ? '' : label).replace(/\s+/g, ' ').trim()`. Never synthesise a label
  locally.
- `render_kind` is one of `metric_table`, `line_table`, `tracking_table`. Only `metric_table` has
  content at this stage; `lines` is always `[]`.

## Deliverable 1 — `WebPortal/modules/sales-reports/js/report-pdf-builder.js`

A single **pure** function, `buildReportDocDefinition(report)`, taking the `getReportInstance`
payload and returning a pdfmake `docDefinition` object. Pure and separate so it can be unit-tested
with `node` and reused later without change. It must not touch the DOM, call an RPC, or reference
`pdfMake`.

Structure:
- `pageSize: 'A4'`, `pageMargins: [32, 70, 32, 40]`.
- `header`: "Macavation" left, the normalised `period_label` right.
- `footer(currentPage, pageCount)`: "Page N of M" and the generation date, formatted `en-ZA`.
- A title block: `template_name`, normalised `period_label`, the raw `period_start`–`period_end`
  range, and the version number when `version > 1`.
- The executive summary when present.
- Then each section where `is_enabled` is true, in `display_order`: heading, commentary if present,
  then its table.
  - `metric_table` → columns **Description · System · Entered · Target · Achieved %**, with
    `headerRows: 1` so the header repeats across page breaks, and `layout: 'lightHorizontalLines'`.
  - `line_table` / `tracking_table` → heading plus one italic row reading "No data captured for this
    section." **Do not omit the section** — a section Pete switched on must appear, or he cannot tell
    "switched off" from "empty".
- An overridden figure must be visually distinguishable (a different `color` on that cell), and each
  overridden row's reason must appear — as a footnote row beneath its table or an extra column.
  Directors need to see why a number was entered by hand.
- A closing line when any figure was overridden: "N of M figures in this report were entered
  manually." Compute both numbers from the payload; do not hardcode.
- When `report.status !== 'published'`, set pdfmake's `watermark` to "DRAFT" so an unfinished report
  cannot be mistaken for an issued one.

Formatting rules, identical to the on-screen metric row so the two cannot disagree:
- `system_value === null` → "No system data".
- Achieved % is `effective_value / target_value` as a percentage, or "—" when `target_value` is
  `null` or `0`, or when `effective_value` is `null`. **Guard the divide** — unset targets are the
  common case at this stage, not an edge case.

## Deliverable 2 — the download action

In the editor toolbar, a "Download PDF" button. It is static markup, so gate it with
`data-action-perm="reports.report.generate"` (that key is seeded by
`report-builder-01b-rbac-migration.md`; if that migration has not been applied the button is simply
hidden, which is the correct default-deny behaviour of `WebPortal/js/action-access.js`).

```js
pdfMake.createPdf(buildReportDocDefinition(report)).download(fileNameFor(report));
```

`createPdf(...).download(name)` triggers the browser download and **returns nothing** — do not
`await` it and do not branch on its result.

Define `fileNameFor(report)` in the same module, returning e.g.
`Macavation-Weekly-Report-2026-08-10.pdf` built from `period_type` and `period_start`. Do not use
`toISOString()` — it converts to UTC and can shift the date across a day boundary for a South
African user; `period_start` is already a `YYYY-MM-DD` string, so use it directly.

Available on drafts and published reports alike.

## Wiring

- `WebPortal/index.html`: the two CDN tags above.
- `WebPortal/js/appRouteConfig.json`: append `js/report-pdf-builder.js` to the `sales-report-editor`
  route's `js` array, **before** `js/report_editor.js`. Keep the JSON valid — `registry:verify`
  fails on any path missing from disk.
- No change to `WebPortal/js/appRouter.js` is needed: the route already exists.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`.
2. `grep -c "pdfmake@0.2.10" WebPortal/index.html` returns `2` — the library and `vfs_fonts`.
3. `grep -n "js/report-pdf-builder.js" WebPortal/js/appRouteConfig.json` shows it listed before
   `js/report_editor.js`, and
   `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
4. `grep -n "createPdf" WebPortal/modules/sales-reports/js/` shows the call is neither awaited nor
   branched on.
5. **A pure `node` unit check of `buildReportDocDefinition`**, with no browser, no network and
   without loading pdfmake — the function returns a plain object, so pdfmake is only needed to
   *render* it. Call it with a hand-written fixture containing:
   - an enabled `metric_table` section with one overridden metric, one metric whose `system_value`
     is `null` and `target_value` is `null`, and one whose `target_value` is `0`;
   - an enabled `line_table` section with `lines: []`;
   - a disabled section;
   - a `period_label` containing runs of blanks.

   Assert: the result has a `content` array; the disabled section does **not** appear; the empty
   `line_table` section **does** appear; and `JSON.stringify(result)` contains no `NaN`, no
   `Infinity`, no `"null"` string and no run of two or more consecutive spaces. Delete the scratch
   script before finishing.
6. `grep -rn "\.html(" WebPortal/modules/sales-reports/js/report-pdf-builder.js` returns nothing.
7. `grep -rn "toISOString" WebPortal/modules/sales-reports/js/` returns nothing.
8. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty — no spec file was edited.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job.

## Out of scope

Publishing, re-issuing, uploading the PDF anywhere, WhatsApp delivery, the targets admin screen, the
sales Excel import, the metric resolvers, chart rendering, rendering `line_table` or
`tracking_table` content, any migration, and editing any Playwright spec, `WebPortal/help/*`,
`docs/**`, or `permission-module-map.js`.
