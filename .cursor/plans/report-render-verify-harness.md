# Add an automated check for the report renderers

## Context

The Sales & Production report builder renders three kinds of section: metric tables, line tables and
tracking tables. `WebPortal/modules/sales-reports/js/report-pdf-builder.js` turns a
`get_report_instance` payload into a pdfmake document definition, and it is now reachable from the UI
(a Download PDF button, commit `8165081`).

Nothing tests any of it. Three of its four line types and its whole tracking-table renderer were
added recently, and the next planned change refactors exactly this code. This plan adds the
regression check that makes that refactor safe.

## Follow this repo's existing convention — do not introduce a test framework

There is **no JS unit-test runner and no `*.test.mjs` file anywhere under `WebPortal/`**. The
established pattern for an executable check is a `scripts/verify-*.mjs` script wired into the
`test:fleet` npm script. Model this on those:

- `scripts/verify-ui-standard.mjs` — pure `fs` reads, reports `file:line` violations, exits non-zero
- `scripts/verify-migration-prefixes.mjs`
- `scripts/verify-registry-paths.mjs`

Do **not** add `node --test`, a `package.json` dependency, or any new devDependency. Node's built-in
`assert` and `vm` modules are sufficient.

## The gate must stay hermetic

`package.json:26` carries an explicit comment on `test:fleet`: it "Must stay FAST and HERMETIC: pure
Node stdlib, no browser, no login, no network, no deployed app," and warns that adding anything that
calls Supabase "would ERROR and block every merge." This script must obey that. **All fixtures are
literal objects declared inside the script — never a database read, never a network call, never a
file outside the repo.**

## Deliverable

Create `scripts/verify-report-rendering.mjs`.

It loads the builder into a stub context and exercises it:

```js
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('WebPortal/modules/sales-reports/js/report-pdf-builder.js', 'utf8'), ctx);
const build = ctx.window.ReportPdfBuilder.buildReportDocDefinition;
```

This works today and is intended, not a trick: that file's own header (lines 5-9) states it "has no
reference to the DOM, to any global rendering library, or to any UI framework helper at evaluation
time, so it can be evaluated with plain `vm.Script`/`require` and no browser." It exports exactly one
symbol at line 481: `w.ReportPdfBuilder = { buildReportDocDefinition: buildReportDocDefinition }`.

### Assertions required

Read `report-pdf-builder.js` first and assert against what it actually does. At minimum:

1. **Each of the four line types in `LINE_COLUMN_DEFS` (line 149)** — `kernel_sales_line`,
   `oil_sales_line`, `oil_export_line`, `kernel_sales_style_line` — given a section with one line of
   that type, produces a table whose header row labels equal that type's column labels in order.
2. **Totals row honours `TOTALLED_KEYS` (line 199).** Given two lines, the totals row shows a summed
   value for `quantity_kg`, `vat_excl_zar`, `weight_kg`, `usd_debit`, `rand_value` and `cartons`, and
   an empty string for `price_per_kg` and `usd_zar_rate` — summing a unit price or an exchange rate
   is not a total. Assert the first cell of that row reads `Total`.
3. **Tracking table (line 322).** A `tracking_table` section whose lines are `tracking_line` rows
   renders a 4-column table, and the two financial-year column headers are derived from the row
   payload's own `fy_prior` / `fy_current` values (e.g. `FYE 2026`, `FYE 2027`), not computed by the
   renderer.
4. **`variance_pct: null` renders as an empty string, never `0%`.** This distinction is load-bearing:
   a null variance means the prior year was zero or absent, and `0%` would claim the two years were
   equal.
5. **Unknown `line_type` degrades, does not throw.** A section whose lines carry a `line_type` absent
   from `LINE_COLUMN_DEFS` routes to `buildUnrecognisedLineTable` (line 261) and reports the row
   count rather than raising.
6. **Empty section.** A `line_table` section with `lines: []` renders the "No rows for this period."
   empty table rather than throwing.
7. **Draft watermark.** A payload with `status: 'draft'` sets `docDefinition.watermark.text` to
   `DRAFT`; a payload with `status: 'published'` has no `watermark` property.

Report failures as readable messages and `process.exit(1)`; print a one-line summary and exit 0 on
success, matching the tone of the existing verify scripts.

### Wire it in

Add it to `test:fleet` in `package.json`, preserving the existing chain order and `&&` style. Leave
the `//test:fleet` documentation comment intact.

## Verification before finishing

All hermetic and runnable by you:

1. `npm run test:fleet` exits 0.
2. `node scripts/verify-report-rendering.mjs` alone exits 0.
3. **Prove the check can fail**: temporarily change one expected value in one fixture assertion,
   confirm the script exits non-zero with a readable message, then revert that edit. A check that
   cannot fail is not a check. Do not leave the temporary edit in the diff.

## Out of scope

- Any change to `report-pdf-builder.js` itself. If an assertion reveals a genuine bug, report it in
  your summary rather than fixing it here — this plan exists to establish the baseline.
- Any change to `report_editor.js`.
- Rendering a real PDF binary. Only the document definition is asserted; pdfmake is a browser-side
  CDN dependency and is deliberately not installed.
