---
depends_on: report-builder-03-targets-admin.md, report-render-verify-harness.md
---
# Remove the duplicated report column definitions

## Why this waits

Two reasons, both real:

- **Shared file.** This plan edits `WebPortal/modules/sales-reports/js/report_editor.js`, and so do
  both `report-builder-02b-publish-and-reissue.md` (its Publish/Re-issue toolbar buttons) and
  `report-builder-03-targets-admin.md`. Run concurrently they would race to merge into the same file
  and produce a conflict the fleet will not auto-resolve. Waiting on `03` covers `02b` too, because
  `03` already waits on it.
- **Safety net.** `report-render-verify-harness.md` adds
  `scripts/verify-report-rendering.mjs`, which asserts what the renderers output. That check is what
  proves this refactor changes no behaviour, so it must exist first.

## Context

The column contract for the report's line tables is **written out twice**:

- `WebPortal/modules/sales-reports/js/report-pdf-builder.js` — `LINE_COLUMN_DEFS` at line 149,
  `TOTALLED_KEYS` at line 199
- `WebPortal/modules/sales-reports/js/report_editor.js` — `LINE_COLUMN_DEFS` at line 409,
  `TOTALLED_KEYS` at line 454

The editor's copy carries a comment at line 402 recording why, and what to do about it:

> Column definitions are intentionally duplicated from report-pdf-builder.js rather than imported:
> that file is not on this route's script list (appRouteConfig.json) and is not loaded in the browser
> at all yet, so depending on it would leave every table blank. When the PDF export is wired up, the
> two lists should be unified — until then this is the only definition that actually renders.

That precondition no longer holds. `js/report-pdf-builder.js` is now on the
`sales-report-editor` route in `WebPortal/js/appRouteConfig.json`, listed **before** `js/report_editor.js`,
and the Download PDF button loads it in the browser. Two copies of the same contract will drift, and
when they do the on-screen table and the exported PDF will disagree about the same report.

## Deliverables

### 1. Export the definitions from `report-pdf-builder.js`

The file already has exactly one export, at line 481:

```js
w.ReportPdfBuilder = { buildReportDocDefinition: buildReportDocDefinition };
```

Extend **that object** — do not add a second global:

```js
w.ReportPdfBuilder = {
    buildReportDocDefinition: buildReportDocDefinition,
    LINE_COLUMN_DEFS: LINE_COLUMN_DEFS,
    TOTALLED_KEYS: TOTALLED_KEYS
};
```

Nothing else in that file changes. Its own internal references keep using the local names.

### 2. Consume them in `report_editor.js`

Delete the duplicated `LINE_COLUMN_DEFS` (line 409) and `TOTALLED_KEYS` (line 454) blocks and the
now-obsolete explanatory comment at line 402. Replace with a read from the shared module, plus a
defensive fallback:

- The editor must **not assume** the builder is loaded. `report-pdf-builder.js` is first in the
  route's `js` array today, but a load-order regression must degrade, not throw.
- If `ReportPdfBuilder` or its `LINE_COLUMN_DEFS` is unavailable, `buildLineTableBody` should fall
  through to its existing "Rows not displayable" empty state — the same branch it already takes when
  `LINE_COLUMN_DEFS[lineType]` is undefined (around line 502). That branch already exists; route to it
  rather than inventing a new message.
- `TOTALLED_KEYS` is used at lines 524 and 539. If it is unavailable, treat it as an empty map so no
  column is totalled — a missing total is a visible absence; a wrong total is a silent lie.

**Only the column contract is shared.** The two files render completely differently — the editor
builds jQuery `<td>` elements, the builder builds pdfmake cell objects. Do **not** try to share any
rendering, formatting or table-building code between them. In particular leave the editor's own
`fmtNum`, `fmtPct` and `isFiniteNum` helpers alone: they exist so the on-screen figure and the PDF
figure format identically, and the comment above them says so.

### 3. Leave `CONNECTED_SECTIONS` where it is

`CONNECTED_SECTIONS` (`report_editor.js:463`) is **not** duplicated in the builder and is not part of
this refactor. It encodes which sections may claim "no rows for this period" versus "not available
yet", which is an editor-only distinction. Do not move or export it.

## Verification before finishing

All hermetic — no database, no browser, no deployed environment:

1. **`node scripts/verify-report-rendering.mjs` passes unchanged.** This is the point of the ordering:
   the harness from `report-render-verify-harness.md` asserts the builder's output, and this refactor
   must not alter it. Do not edit that script to make it pass.
2. `npm run test:fleet` exits 0.
3. `node --check` passes on both changed files.
4. `grep -c "LINE_COLUMN_DEFS" WebPortal/modules/sales-reports/js/report_editor.js` shows the editor
   no longer *defines* it — every remaining occurrence is a read through `ReportPdfBuilder`.
5. `grep -n "var LINE_COLUMN_DEFS\|var TOTALLED_KEYS" WebPortal/modules/sales-reports/js/report_editor.js`
   returns nothing: both local definitions are gone.
6. `grep -n "var LINE_COLUMN_DEFS\|var TOTALLED_KEYS" WebPortal/modules/sales-reports/js/report-pdf-builder.js`
   still returns both: the builder remains the single definition site.
7. Confirm by reading `WebPortal/js/appRouteConfig.json` that `js/report-pdf-builder.js` still precedes
   `js/report_editor.js` in the `sales-report-editor` route's `js` array. The fallback in deliverable 2
   exists precisely so this ordering is not load-bearing, but the ordering should stay correct anyway.

## Out of scope

- Any behaviour change to either renderer. This is a de-duplication only: the same tables, the same
  columns, the same totals, before and after.
- Adding a module loader, bundler or `import`/`export` syntax. The portal loads plain scripts that
  assign onto `window`; follow that (see the namespace-assignment note in the
  `report-pdf-builder.js` header, lines 5-9).
- Any migration or SQL. **This plan writes none.**
