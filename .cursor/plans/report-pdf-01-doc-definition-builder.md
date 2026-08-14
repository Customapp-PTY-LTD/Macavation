# Report PDF — the document-definition builder (pure function, no wiring)

## Context

Pete's directors receive a PDF of the weekly/monthly report. This plan adds **one new file
containing one pure function** that turns a report payload into a pdfmake document definition.

It deliberately does **not**: add any CDN tag, add any button, touch `WebPortal/index.html`, touch
`WebPortal/js/appRouteConfig.json`, touch `WebPortal/js/appRouter.js`, or modify any existing file.
Nothing loads this file yet. Wiring it up is a separate plan. That split is deliberate: an earlier
combined version of this work was blocked twice, and all of its risk was in the document content,
none in the wiring.

The function is pure and DOM-free, so it is verified entirely by a Node harness with no browser, no
network and no database.

## The single most important fact

**`section.lines` is populated. It is not empty.** An earlier revision of this plan asserted
"`lines` is always `[]`" and was correctly blocked: that claim was false, and it drove a branch that
would have printed *"No data captured for this section."* under headings that hold hundreds of rows —
a false statement in a document sent to directors.

Verified by calling `get_report_instance` against the dev database for a real July 2026 report:

| section_key | render_kind | lines |
|---|---|---|
| `kernel_sales_lines` | `line_table` | 14 |
| `oil_sales_lines` | `line_table` | 4 |

`migrations/20260819110000_report_resolvers_from_data_page.sql` defines
`populate_report_instance_lines`, and both `refresh_report_instance` and `create_report_instance`
(`migrations/20260819120000_create_report_instance_populates_lines.sql`) call it. Line population is
live behaviour.

**Therefore this builder renders line-table content.** Do not write any note claiming a section has
no data unless its `lines` array is genuinely empty.

## The payload

`get_report_instance` returns one jsonb document:

```json
{
  "id": "…", "template_name": "Macavation Monthly Report",
  "period_type": "monthly", "period_start": "2026-07-01", "period_end": "2026-07-31",
  "period_label": "July 2026 (FYE 2027)", "fy": 2027, "version": 1, "status": "draft",
  "executive_summary": null,
  "sections": [
    { "section_key": "kernel_production", "label": "Kernel Processing",
      "render_kind": "metric_table", "is_enabled": true,
      "display_order": "000010", "commentary": null,
      "metrics": [ { "metric_key": "…", "label": "Nut in Shell Cracking", "unit": "kg",
                     "system_value": 100758.0, "target_value": null, "entered_value": null,
                     "effective_value": 100758.0, "is_overridden": false,
                     "override_reason": null, "overridden_by_name": null } ],
      "lines": [] },
    { "section_key": "kernel_sales_lines", "label": "Kernel Sales Lines",
      "render_kind": "line_table", "is_enabled": true, "display_order": "000030",
      "metrics": [],
      "lines": [ { "line_type": "kernel_sales_line", "sort_index": 1,
                   "payload": { "sale_date": "2026-07-01", "customer_name": "Gracious Bakers",
                                "invoice_number": null, "style_code": null,
                                "description": "Macadamia Style 5 Commercial 11.34kg box",
                                "cartons": 2, "quantity_kg": 22.68, "price_per_kg": 130,
                                "vat_excl_zar": 2948.4 } } ] }
  ]
}
```

Facts that must be handled exactly, each verified:

- **`display_order` is a zero-padded STRING** (`LPAD(...,6,'0')`, `20260817100000…:751`), not a
  number. Sort as a string, or `parseInt(x, 10)` first.
- **`effective_value` = `COALESCE(entered_value, system_value)`** and **`is_overridden` =
  `entered_value IS NOT NULL`** — both computed server-side (`20260817100000…:722-789`). Use them;
  do not recompute.
- **Nulls occur inside line payloads.** Real rows have `invoice_number: null` and
  `style_code: null`. A null must render as an empty cell — never the string `"null"`, never `0`.
- `status` is one of `draft`, `published`, `superseded` (`20260817100000…:148`).
- `render_kind` is one of `metric_table`, `line_table`, `tracking_table`
  (`20260819090000…:267-268`).
- `period_label` may contain runs of internal blanks; normalise for display only with
  `String(x == null ? '' : x).replace(/\s+/g, ' ').trim()`.

## Deliverable — one new file

`WebPortal/modules/sales-reports/js/report-pdf-builder.js`

Export exactly one namespace, following the evaluation pattern used by
`WebPortal/modules/sales-reports/js/report-metric-line.js` so the file is requirable in a Node
harness with no DOM:

```js
(function (w) {
    'use strict';
    // …private helpers…
    w.ReportPdfBuilder = { buildReportDocDefinition: buildReportDocDefinition };
})(typeof window !== 'undefined' ? window : this);
```

**Do not modify `report-metric-line.js`.** Its `formatNumber` and `safeKey` are private, and
`WebPortal/modules/sales-reports/js/report_editor.js:168` is its only consumer. Give this file its
own private number formatter rather than widening that module's exports — this file must have zero
blast radius on anything that already ships.

`buildReportDocDefinition(report)` returns a plain pdfmake document-definition **object**. It must
not reference `pdfMake`, `document`, `window`, jQuery, or any DOM API, and must not perform I/O.

### Document structure

- `pageSize: 'A4'`, `pageMargins: [32, 70, 32, 40]`.
- `header`: "Macavation" left, the normalised `period_label` right.
- `footer(currentPage, pageCount)`: `Page N of M` plus a generation date. **Take the date from an
  optional second argument** `buildReportDocDefinition(report, opts)` where `opts.generatedOn` is a
  pre-formatted string; default to `''` when absent. Do **not** call `new Date()` inside the
  builder — that would make the function impure and its output untestable.
- Title block: `template_name`, normalised `period_label`, the raw `period_start`–`period_end`
  range, and `Version N` when `version > 1`.
- `executive_summary` when non-empty.
- When `status !== 'published'`, set pdfmake's `watermark` to `'DRAFT'`.

### Sections

Iterate `report.sections` where `is_enabled` is true, in `display_order` (string-safe). For each,
emit the section `label`, then its `commentary` if non-empty, then its body by `render_kind`:

**`metric_table`** — a table with `headerRows: 1`, `layout: 'lightHorizontalLines'`, columns:
`Description · System · Entered · Target · Achieved %`.
- System: formatted `system_value`, or `No system data` when it is `null`.
- Entered: formatted `entered_value`, or an em dash when it is `null`.
- Achieved %: `effective_value / target_value` as a percentage, or an em dash when `target_value`
  is `null` or `0`, or `effective_value` is `null`. **Guard the divide** — unset targets are the
  common case, not an edge case. Never emit `NaN` or `Infinity`.
- When `is_overridden`, give the Entered cell a distinct `color` and append the `override_reason`
  as a footnote row beneath the table.

**`line_table`** — render the rows. Column sets are fixed per `line_type`, because these payloads
are produced by known server functions:

| `line_type` | Columns, in order |
|---|---|
| `kernel_sales_line` | Date (`sale_date`) · Customer (`customer_name`) · Invoice (`invoice_number`) · Style (`style_code`) · Description (`description`) · Cartons (`cartons`) · Qty kg (`quantity_kg`) · Price/kg (`price_per_kg`) · Value excl VAT (`vat_excl_zar`) |
| `oil_sales_line` | Date (`sale_date`) · Customer (`customer_name`) · Invoice (`invoice_number`) · Product (`product_line`) · Description (`description`) · Qty kg (`quantity_kg`) · Price/kg (`price_per_kg`) · Value excl VAT (`vat_excl_zar`) |

- `headerRows: 1` so the header repeats across page breaks.
- Numeric columns right-aligned and formatted; text columns as-is; **a null or undefined value
  renders as an empty string**.
- Append a totals row summing `quantity_kg` and `vat_excl_zar` for that section.
- **An unrecognised `line_type`** (any section whose dataset lands later) renders a single italic
  row: `N rows are not shown in this PDF.` with the real count. This is honest — it states the rows
  exist and are omitted — and must never claim the section has no data.
- **A genuinely empty `lines` array** renders a single italic row: `No rows for this period.`

**`tracking_table`** — no data source exists for these yet; treat exactly like an empty
`line_table`: emit the heading and `No rows for this period.` Never assert that data was not
captured.

**Banned string.** The sentence `No data captured for this section.` must not appear anywhere in
the file. An earlier revision printed it under `Kernel Sales Lines`, which normally holds hundreds
of frozen rows.

### Closing note

When any metric in the document has `is_overridden` true, append a closing line:
`N of M figures in this report were entered manually.` Compute both numbers from the payload.

## Verification — Node only, no browser, no network, no database

1. `npm run test:fleet` passes. It is
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`.
   Note this file is **not** added to `appRouteConfig.json` by this plan, so `registry:verify` will
   list it under its informational "unreferenced files" heading — that is expected and does not fail
   the run.
2. **A Node harness exercising `buildReportDocDefinition` against a hand-written fixture.** The file
   is DOM-free at evaluation time, so it can be loaded with `vm` or a plain `require` shim. The
   fixture must contain, in one payload:
   - an enabled `metric_table` section with: one overridden metric; one metric whose
     `system_value` is `null`; one whose `target_value` is `null`; one whose `target_value` is `0`;
   - an enabled `kernel_sales_lines` section with **two** lines, one of which has
     `invoice_number: null` and `style_code: null`;
   - an enabled `oil_sales_lines` section with one line;
   - an enabled section whose `lines` is `[]`;
   - an enabled section with one line of an **unrecognised** `line_type`;
   - a disabled section;
   - a `period_label` containing a run of several blanks;
   - `display_order` values as zero-padded strings, deliberately out of order.

   Assert all of:
   - the result has a `content` array;
   - the disabled section does not appear;
   - sections appear in `display_order` order;
   - the two sales sections each render a row per line plus a totals row, and the totals equal the
     sum of their `vat_excl_zar` values;
   - the unrecognised-`line_type` section reports the real row count and does **not** claim there is
     no data;
   - the genuinely empty section says `No rows for this period.`;
   - `JSON.stringify(result)` contains **no** `NaN`, no `Infinity`, no `"null"` string, no
     `undefined`, no run of two or more consecutive spaces, and **not** the banned sentence
     `No data captured for this section.`

   Delete the harness script before finishing.
3. The builder is pure. Two separate greps, each with a stated expected result:
   - `grep -c 'pdfMake\|document\.\|jQuery\|\$(' WebPortal/modules/sales-reports/js/report-pdf-builder.js`
     → **`0`**. None of those may appear at all.
   - `grep -n 'window' WebPortal/modules/sales-reports/js/report-pdf-builder.js`
     → **exactly one line**, the closing wrapper, byte-identical to the last line of
     `report-metric-line.js`:
     `})(typeof window !== 'undefined' ? window : this);`
     Any other mention of `window` means the file is not DOM-free.
   - `grep -c 'new Date(' WebPortal/modules/sales-reports/js/report-pdf-builder.js` → **`0`**; the
     generation date arrives via `opts.generatedOn`, which is what keeps the function testable.
4. `grep -rn "No data captured for this section" WebPortal/` returns nothing.
5. `git status --short` shows exactly one added file and **no modified files**.

**No verify step may need a browser, a logged-in session, a screenshot, a database, or the deployed
demo site.** Playwright here targets `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run in the fleet job.

## Out of scope

Adding pdfmake to `WebPortal/index.html`; registering this file in `appRouteConfig.json`; any
toolbar button; any download behaviour; modifying `report-metric-line.js`, `report_editor.js` or any
other existing file; publishing; any migration; editing any Playwright spec, `WebPortal/help/*` or
`docs/**`.
