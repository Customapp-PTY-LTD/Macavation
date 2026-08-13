---
depends_on: report-builder-01c-report-list.md
---

# Report builder — the report editor and the override flow

## Context

Last of four small plans replacing `report-builder-01-list-and-editor.md`, which was blocked twice
for being too large. This one builds the editor screen the report list opens into: section toggles,
commentary, the executive summary, and the metric rows where Pete enters figures.

It waits on `report-builder-01c-report-list.md` because it registers its route alongside that plan's
entries in `WebPortal/js/appRouteConfig.json` and `WebPortal/js/appRouter.js` (a real conflict
otherwise), and because it enables that plan's "Open" navigation.

The RPCs are defined in `migrations/20260817090000_report_builder_foundations.sql` and
`migrations/20260817100000_report_instances_and_targets.sql`, both in this checkout. **Whether those
migrations have been applied to any database cannot be verified from this checkout — do not state or
assume that they have.**

**Why the override flow is the heart of this screen.** `resolve_report_metric_value` in
`20260817100000` is a deliberate stub returning NULL for every metric — read it and confirm. So
every figure arrives as "no system data" and Pete types it in with a reason, while the report keeps
system value, entered value and target side by side so the gap stays visible. Background is in
`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`; **do not copy that document's counts or
percentages into code comments, UI copy or commit messages** — they come from database queries this
run cannot re-execute.

## The payload

`getReportInstance` returns one `jsonb` document, or `null` if the id is unknown:

```json
{
  "id": "uuid", "template_name": "Macavation Weekly Report",
  "period_type": "weekly", "period_start": "2026-08-10", "period_end": "2026-08-16",
  "period_label": "Week of 10 Aug 2026", "fy": 2027, "fy_month_index": null,
  "version": 1, "status": "draft", "executive_summary": null,
  "sections": [
    { "section_key": "kernel_production", "label": "Kernel Processing",
      "render_kind": "metric_table", "is_enabled": true,
      "display_order": "000010", "commentary": null,
      "metrics": [
        { "metric_key": "kernel_nis_cracking_kg", "label": "Nut in Shell Cracking",
          "unit": "kg", "division": "kernel", "has_target": true,
          "system_value": null, "target_value": 25000.0, "entered_value": 100758.0,
          "effective_value": 100758.0, "is_overridden": true,
          "override_reason": "…", "overridden_at": "…", "overridden_by_name": "Pete" }
      ],
      "lines": []
    }
  ]
}
```

Two shapes to handle carefully:

- **`display_order` is a zero-padded string** (`LPAD(...,6,'0')`), not a number. Sort it as a string,
  or `parseInt(..., 10)` before comparing numerically.
- **`period_label` may contain internal blank padding.**
  `migrations/20260817090100_fix_report_period_label_padding.sql` exists because
  `report_period_label` produced `"August    2026 (FYE 2027)"`, and whether that fix has been applied
  to any given database is unknowable from here. Normalise for display only:
  `$el.text(String(label == null ? '' : label).replace(/\s+/g, ' ').trim())`. Never synthesise a
  label locally — the title always comes from the server.

`render_kind` is one of `metric_table`, `line_table`, `tracking_table`. **Only `metric_table`
renders content in this plan.** `line_table` and `tracking_table` sections render their header and
toggle plus the empty state "Populated when this section's data source is connected" — their content
arrives in a later plan, and `lines` is always `[]` for now.

## Security invariants

This screen renders and writes user-entered text — override reasons, commentary, the executive
summary. `BluePrint/javascript-jquery-rules.md` is what the review gate checks against.

- **Never pass database or user-entered text through `.html()`, `innerHTML`, or string concatenation
  into markup.** Build the element, then set its text with `.text()`. This covers every override
  reason, commentary, section label, metric label, template name and `overridden_by_name`. Numbers
  may be formatted and concatenated only after `Number()` conversion.
- **Validate the report uuid from `Session` or any `data-*` attribute** with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before any RPC call. A
  truthiness check is not validation.
- Never use a payload value (`metric_key`, `section_key`) as an object property key without first
  rejecting `__proto__` and `constructor`. Prefer a `Map` keyed by those strings.
- `JSON.parse` only inside `try/catch`. No `eval`, no `new Function`, no string-form `setTimeout`.

## FIXED constraints

1. **Register the route in BOTH `WebPortal/js/appRouteConfig.json` AND the hardcoded
   `initializeModule()` switch in `WebPortal/js/appRouter.js`.** A route in only one silently renders
   nothing. Follow the shape of the neighbouring cases; the `sales-forecasting-grid` case is around
   line 433 — re-grep rather than trusting that number. List `js/report-metric-line.js` **before**
   `js/report_editor.js` in the route's `js` array, since the editor calls into it.
2. **No deep-linking.** Read the report id from `Session.get('currentReportId')`
   (`WebPortal/js/session.js:68-84`). `initializeModule` is called as `initializeModule(routeName)`
   with no params (`appRouter.js:252`), so the id cannot arrive as an argument. **A missing or
   malformed id must render an empty state and route back to `sales-forecasting-grid`** rather than
   throwing.
3. **`data-action-perm` is swept once over static markup only** (`CLAUDE.md:29-32`; the sweep is at
   `appRouter.js:253-256`, 100 ms after load) and is inert on anything rendered afterwards. Metric
   rows are rendered afterwards, so gate them with `typeof hasAction === 'function' && hasAction('reports.report.edit')`
   inline at render time (`window.hasAction` is defined at `action-access.js:95`). **Never call it
   with an empty key** — `has('')` returns `true` (`action-access.js:44`).
4. **Module scripts load once per session.** `appRouter.loadJSCode` caches by URL, so the module's
   `init()` runs again on every revisit while top-level code does not. Put all per-visit state
   resetting inside `init()`, and provide `destroy()` that removes namespaced handlers.

## Deliverables

### 1. `WebPortal/modules/sales-reports/js/report-metric-line.js`

One reusable renderer for a metric row, used by every `metric_table` section. Columns:
**Description · System · Entered · Target · Achieved % · Status**.

- **System cell**: the formatted `system_value`, or the literal text "No system data" when it is
  `null`. These must look visibly different — `null` means the database holds no figure, which is not
  the same as a real zero, and today every metric is `null`.
- **Entered cell**: `<input type="number" step="any">` seeded from
  `entered_value ?? system_value`, rendered `disabled` when the report is not a draft or when
  `hasAction('reports.report.edit')` is false.
- **Achieved %**: `effective_value / target_value` as a percentage, or the literal "—" when
  `target_value` is `null`, `0`, or `effective_value` is `null`. **Guard the divide** — targets are
  frequently unset until the targets screen exists, so this path is the common one, not the edge
  case. The result must never render as `NaN`, `Infinity` or the string `"null"`.
- **Status cell**: an "Overridden" pill when `is_overridden`, carrying the reason and
  `overridden_by_name` as text; otherwise empty.

### 2. The override flow

On blur of the Entered input, if the value differs from `system_value`, prompt for a reason before
saving anything:

```js
var result = await Swal.fire({
    input: 'text',
    inputLabel: 'Reason for overriding this figure',
    inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
    showCancelButton: true
});
if (!result.isConfirmed) { $input.val(previousValue); return; }   // revert, save nothing
await dataFunctions.overrideReportMetricValue(reportId, metricKey, value, result.value, userId);
```

`Swal.fire` resolves to an object: `result.value` is the entered text, `result.isConfirmed` the
button state. Cancelling must restore the input's previous value and call nothing.

**Clearing the input entirely calls `clearReportMetricOverride`, not `overrideReportMetricValue`
with a null value** — the override RPC rejects a null value by design, returning
"A value is required. Use clear_report_metric_override to revert."

The server enforces the same rule twice over: a whitespace `p_reason` returns `success = 0` with
"A reason is required when overriding a figure.", and the `report_metric_override_needs_reason`
CHECK constraint rejects it at the table. The prompt is UX, not the control.

Every one of these RPCs returns `success = 0` with a human-readable `error` rather than throwing —
show it via `Swal.fire({icon:'error', text: <error>})` and do not invent your own message when the
server supplied one.

### 3. The editor screen

`html/report_editor.html` and `js/report_editor.js`.

Header: the normalised `period_label`, with the raw `period_start`–`period_end` dates beneath it.
**The title is always derived from the payload, never a typed field** — Pete's workbook contained a
sheet titled "November" whose own start and end dates read 1–31 October, and a derived title cannot
drift from the dates it describes.

A Bootstrap `.accordion`, one `.accordion-item` per section in `display_order`. Each header carries
the section label and a `form-check form-switch` bound to `is_enabled`. Each body holds the section's
metric table (or the empty state for the two non-metric render kinds) plus a commentary `<textarea>`
saving on blur.

Above the accordion, an executive-summary `<textarea>` saving on blur. It arrives pre-filled:
`create_report_instance` copies the previous period's summary forward so Pete edits rather than
retypes.

**Two save-path subtleties, both consequences of the transport rules added in plan 01a:**

- Toggling a section calls `setReportSectionState` with `p_commentary` as `undefined` (not `null`,
  not `''`), so the param is stripped and the server's `COALESCE(p_commentary, commentary)` leaves
  the text alone. Saving commentary passes `p_is_enabled` as `undefined` for the same reason.
- Clearing a commentary or the executive summary must send `''`, which only survives because those
  two wrappers pass `preserveEmptyParams`. Do not re-implement that flag here — it belongs to the
  wrappers.

**Published and superseded reports are read-only.** When `status !== 'draft'`, render inputs
`disabled`, hide the section toggles, and show a banner reading
"Published <date> — figures are locked." Every edit RPC already refuses with "Only a draft report can
be edited." — this is presentation, not the control, and must not be worked around. **Do not build a
publish or re-issue action here**; both belong to a later plan.

A "Refresh figures" action calls `refreshReportInstance`, which is draft-only and preserves
overrides and their reasons while re-reading system values and targets. Report the returned
`metrics_refreshed` count in the success toast.

### 4. Enable navigation from the list

The previous plan left its "Open" action behind a guard because this route did not exist yet. Now
that it does, confirm that guard resolves correctly and that both call sites — the row action and the
post-create path — route here. Change no more of `report_list_grid.js` than that.

### 5. Missing RPCs must not white-screen the module

If a report RPC is absent from the target database, `callFunction` throws. Wrap every call in
`try/catch`, log with `console.warn`, and render
`macEmptyState('fa-file-invoice', 'This report cannot be loaded', 'The report-builder migrations have not been applied to this database.')`
rather than leaving a spinner running. A `getReportInstance` that returns `null` (unknown id) must
show an empty state and offer a route back to the list.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`.
   `ui:verify` is the likely failure: no raw hex outside `WebPortal/css/design-tokens.css` (use
   `--mac-*` tokens), no legacy `var(--phoenix-*)`, Font Awesome icons only, `btn-primary` not
   `btn-success`, no `linear-gradient`, no `.swal2-*` rules outside `css/swal-theme.css`, no bare
   `td`/`th` padding in module CSS, no `min-width` on `.badge`.
2. `grep -n "sales-report-editor" WebPortal/js/appRouter.js` returns a match — the hardcoded switch
   is the step most often missed. `grep -n "js/report-metric-line.js" WebPortal/js/appRouteConfig.json`
   shows it listed before `js/report_editor.js`.
3. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
4. A pure `node` unit check of the metric-row renderer, with no browser and no network. Extract the
   pure value-formatting helpers (system-value text, achieved-% text) into functions the script can
   require, and assert each case:
   - `system_value: null` → the text "No system data", never `"null"` or `"0"`
   - `target_value: null` → achieved % is `"—"`
   - `target_value: 0` → achieved % is `"—"`, not `Infinity`
   - `effective_value: null, target_value: 25000` → achieved % is `"—"`, not `NaN`
   - `effective_value: 100758, target_value: 25000` → a finite percentage string
   Assert no output contains `NaN`, `Infinity` or `"null"`. Delete the scratch script before
   finishing.
5. `grep -rn "\.html(" WebPortal/modules/sales-reports/js/` — review every hit and confirm none
   passes database or user text; reasons, commentary and labels must go through `.text()`.
6. `grep -rn "preserveEmptyParams" WebPortal/modules/` returns nothing — the flag belongs to the
   wrappers in `data-functions.js`, not to this module.
7. `grep -rn "toISOString" WebPortal/modules/sales-reports/js/` returns nothing.
8. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty — no spec file was edited.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job. Adding new
Playwright specs is acceptable as a deliverable — write them to `test.skip` without their env
credentials, like the existing specs — but running them is not a completion gate.

## Out of scope

PDF generation, publish and re-issue, the targets admin screen, the sales Excel import, the metric
resolvers, chart rendering, rendering `line_table` or `tracking_table` content, the RBAC migration,
applying any migration, and editing any Playwright spec, `WebPortal/help/*`, `docs/**`, or
`permission-module-map.js`.
