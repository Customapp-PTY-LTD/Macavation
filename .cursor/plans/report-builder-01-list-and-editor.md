# Report builder — report list and editor screens

## Context

Pete (Sales Exec) produces Macavation's weekly and monthly director reports in
"Macavation Weekly and Monthly Reports.xlsx", a 63-sheet workbook. This plan builds the first two
screens that replace it: a report list, and the report editor where he fills a report in and
overrides figures.

The database side is already built, applied to dev, and merged to `dev` in this repo. Everything
this plan calls exists — see `migrations/20260817090000_report_builder_foundations.sql` and
`migrations/20260817100000_report_instances_and_targets.sql`, both on `dev`.

**Why overrides are central.** `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md` §0.4 records
that kernel cracking capture is unreliable in both directions (75 of 120 cracking day-rows carry no
tonnage; 15 of 41 complete batches have no cracking rows at all). `resolve_report_metric_value` is
currently a deliberate stub returning NULL for every metric, so **every figure will show "No system
data" until the resolver migration lands**. That is the expected state, not a bug: Pete enters the
figure with a reason, and the report records system value, entered value and target side by side so
the gap is visible. The UI must make that legible rather than hide it.

## Scope

Two routes only: the report list and the report editor. PDF generation, publishing, the targets
admin screen and the sales import are separate plans and are explicitly OUT OF SCOPE here. Do not
add a Publish button that calls anything — plan 02 adds publishing.

## FIXED constraints — do not change these

1. **Reuse the existing route key `sales-forecasting-grid` for the report list, and keep its
   sidebar `<li>` inside `businessCollapse`.** This is not cosmetic. `Playwright Tests/user-management/role-screen-access.spec.ts`
   names `sales-forecasting-grid` in eight role allow/restrict lists (lines 29, 35, 40, 45, 49, 58,
   64, 69), and `Playwright Tests/helpers/navigation.helper.ts:53-56` resolves it via
   `linkSelector: 'a[route="sales-forecasting-grid"]'` with `collapseIds: ['supportCollapse',
   'businessCollapse']`. Both reference it **only as a route key** — neither asserts the page's
   heading or contents — so reusing the key keeps all of it passing while the screen changes
   completely. Introducing a new key instead, or moving the item out of `businessCollapse`, breaks
   those specs. `WebPortal/modules/admin/js/permission-module-map.js:57` also maps this key.
2. **A new route needs an entry in BOTH `WebPortal/js/appRouteConfig.json` AND the hardcoded
   `initializeModule()` switch in `WebPortal/js/appRouter.js`** (see the existing
   `'sales-forecasting-grid'` case at `WebPortal/js/appRouter.js:407`). A route registered in only
   one of the two silently renders nothing.
3. **No deep-linking.** The router never reads the URL (`CLAUDE.md`). Pass the current report id
   between screens via `Session.set('currentReportId', id)` (`WebPortal/js/session.js`), not a query
   string or hash.
4. **`data-action-perm` is swept once over static markup only** (`CLAUDE.md`, and
   `WebPortal/js/action-access.js`). It is inert on anything rendered after route load. For
   dynamically rendered rows call `actionAccess.has('<key>')` inline at render time — that is what
   the existing dashboard code does.

## Security invariants — state and follow these exactly

These are the rules `BluePrint/javascript-jquery-rules.md` is checked against, and this screen
renders database text that originates from user input (override reasons, commentary, customer
names, style codes, notes).

- **Never pass database or user-entered text through `.html()`, `innerHTML`, or string
  concatenation into markup.** Build the element, then set its text with `.text()`. This applies to
  every override reason, commentary, section label, metric label, style code and template name.
  Numeric values may be formatted and concatenated only after `Number()` conversion.
- **Validate any uuid read from a `data-*` attribute before using it in an RPC call.** Use an
  explicit regex — `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` — and abort
  if it fails. A truthiness check is not validation.
- **Never use a value from the payload as an object property key** without first rejecting
  `__proto__` and `constructor`. Prefer a `Map`, or `Object.create(null)`.
- `JSON.parse` only inside `try/catch`.
- No `eval`, no `new Function`, no string-form `setTimeout`.

## RPC contracts — these exist on dev; call them exactly as written

All are reached through `dataFunctions.callFunction(name, params)` in
`WebPortal/js/data-functions.js`, which POSTs to `rest/v1/rpc/<name>` with the anon key. Parameter
names must match exactly, including the `p_` prefix.

| RPC | Params | Returns |
|---|---|---|
| `get_report_templates` | `p_period_type` (`'weekly'`\|`'monthly'`\|null) | rows: `id, code, name, period_type` |
| `get_report_current_period` | `p_period_type` | one row: `period_type, period_start, period_end, fy, fy_month_index, period_label` |
| `list_report_instances` | `p_period_type, p_status, p_limit, p_offset` | rows incl. `id, template_name, period_type, period_start, period_end, period_label, fy, version, status, section_count, override_count, metric_count, generated_at, published_at, pdf_storage_path, total_count`. `p_limit` is capped at 100 server-side; `total_count` repeats on every row |
| `create_report_instance` | `p_template_id, p_period_date, p_actor_user_id` | one row: `success (int), error (text), report_instance_id (uuid)` |
| `get_report_instance` | `p_report_instance_id` | a single `jsonb` document (shape below), or NULL if not found |
| `override_report_metric_value` | `p_report_instance_id, p_metric_key, p_entered_value, p_reason, p_actor_user_id` | `success, error` |
| `clear_report_metric_override` | `p_report_instance_id, p_metric_key` | `success, error` |
| `set_report_section_state` | `p_report_instance_id, p_section_key, p_is_enabled, p_commentary` | `success, error`. NULL leaves that field unchanged |
| `set_report_executive_summary` | `p_report_instance_id, p_summary` | `success, error` |
| `refresh_report_instance` | `p_report_instance_id` | `success, error, metrics_refreshed` |
| `delete_report_instance` | `p_report_instance_id` | `success, error` — drafts only |

**Every one of these returns `success = 0` with a human-readable `error` string rather than
throwing** (see the function bodies in `migrations/20260817100000_report_instances_and_targets.sql`).
Show `error` to the user via `Swal.fire({icon:'error', text: <error>})`. Do not invent your own
message when the server supplied one.

`get_report_instance` returns:

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

Note `display_order` is a **zero-padded string** (`"000010"`) because it is used as a jsonb sort
key. Sort with it as a string, or `parseInt(..., 10)` before comparing numerically — do not assume
it is already a number.

`render_kind` is one of `metric_table`, `line_table`, `tracking_table`. In this plan only
`metric_table` renders content; `line_table` and `tracking_table` sections must render their header
and toggle plus an empty state reading "Populated when this section's data source is connected" —
their content arrives in a later plan. `lines` is always `[]` for now.

## Deliverables

### 1. `WebPortal/modules/sales-reports/` (new module, replacing the old stub)

- `html/report_list.html`, `js/report_list_grid.js`, `css/sales_reports.css`
- `html/report_editor.html`, `js/report_editor.js`, `js/report-metric-line.js`

Delete `WebPortal/modules/sales-forecasting/` — it is a stub whose only data call,
`dataFunctions.getSalesForecasts()` (`WebPortal/js/data-functions.js:4314-4318`), hardcodes
`return []`, and whose buttons say "coming soon". Remove that stub function too.

**Model the list screen on `WebPortal/modules/users/js/users_grid.js`** — it is this repo's
canonical hand-rolled pagination (`itemsPerPage`, `currentPage`, manual slice, Bootstrap
`.pagination` markup, click handler on `.pagination .page-link`). There is no DataTables/AG-Grid
here. Reuse `MacTableActions` (`WebPortal/js/table-actions.js`) for the row "⋯" menu,
`MacStatus.pill` (`WebPortal/js/mac-status.js`) for status, and
`macLoadingRow`/`macEmptyRow`/`macEmptyState` (`WebPortal/js/ui-states.js`) for the three states.

List columns: Period label · Type (Weekly/Monthly pill) · Date range · Status pill · Completeness
(`override_count` of `metric_count` overridden) · Last generated · Actions (Open, Delete).
`list_report_instances` already returns `total_count` on every row — drive pagination from that
rather than counting client-side.

"New Report" opens a Bootstrap modal: period type radio (Weekly/Monthly) and a Flatpickr date
input. **Do not implement your own Monday-snapping.** Pass whatever date the user picks straight to
`create_report_instance` as `p_period_date`; the server snaps it to the Monday or the 1st. If a
report already exists for that period the RPC returns `success = 0` with a message naming the
period — show it.

### 2. The editor screen

Header shows `period_label` and the raw `period_start`–`period_end` dates beneath it. **The title is
always derived from the payload, never a typed field** — Pete's workbook had a sheet titled
"November" whose own start/end dates read 1–31 October, and a generated title cannot drift from the
dates it describes.

A Bootstrap `.accordion`, one `.accordion-item` per section in `display_order`. Each header carries
the section label and a `form-check form-switch` toggle bound to `is_enabled` → calls
`set_report_section_state`. Each body holds a metric table plus a commentary `<textarea>` that saves
on blur through the same RPC.

Above the accordion, an executive-summary `<textarea>` saving on blur via
`set_report_executive_summary`. It arrives pre-filled: `create_report_instance` copies the previous
period's summary forward so Pete edits rather than retypes.

### 3. `report-metric-line.js` — the reusable metric row

Columns: **Description · System · Entered · Target · Achieved % · Status**.

- System cell: the formatted `system_value`, or the text "No system data" when it is `null`. These
  must look different — `null` means the database holds no figure, which is not the same as a real
  zero, and today every metric is `null`.
- Entered cell: a `<input type="number" step="any">` seeded from `entered_value ?? system_value`.
- Achieved %: `effective_value / target_value` as a percentage, or "—" when `target_value` is null
  or zero. **Guard the divide-by-zero** — `target_value` is frequently null until the targets screen
  exists.
- Status cell: an "Overridden" pill when `is_overridden`, otherwise empty.

**Override flow.** On blur, if the entered number differs from `system_value`, prompt for a reason
before saving:

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

`Swal.fire` resolves to an object; `result.value` is the entered text and `result.isConfirmed` is
the button state. Cancelling must restore the input's previous value and call nothing. Clearing the
input entirely calls `clear_report_metric_override`, not `override_report_metric_value` with null —
the override RPC rejects a null value by design.

The server enforces the same rule twice over (a `p_reason` of whitespace returns
"A reason is required when overriding a figure.", and the
`report_metric_override_needs_reason` CHECK constraint rejects it at the table), so the prompt is
UX, not the control.

**Published reports are read-only.** When `status !== 'draft'`, render inputs as `disabled`,
hide the section toggles, and show a banner reading "Published <date> — figures are locked. Use
Re-issue to correct." Every edit RPC already refuses with "Only a draft report can be edited.", so
this is presentation; do not attempt to work around it. Do not build the Re-issue action here —
plan 02 owns it.

### 4. Wiring

- `WebPortal/js/appRouteConfig.json`: repoint `sales-forecasting-grid` at
  `path: "sales-reports"`, `html: "html/report_list.html"`, js `["js/report_list_grid.js"]`,
  css `["css/sales_reports.css"]`. Add a new `sales-report-editor` entry pointing at the editor
  files. Keep JSON valid — `npm run registry:verify` fails on a path that does not exist on disk.
- `WebPortal/js/appRouter.js`: repoint the existing `'sales-forecasting-grid'` case (line 407) at
  the new module's init, and add a `'sales-report-editor'` case, following the exact shape of the
  neighbouring cases.
- `WebPortal/index.html`: relabel the existing `businessCollapse` item to "Sales &amp; Production
  Reports" with `<i class="fas fa-file-invoice me-2">`. **Keep `data-route` and `route` as
  `sales-forecasting-grid`** (constraint 1). Add no sidebar item for the editor — it is reached by
  button only, like the existing modal routes.
- `WebPortal/js/data-functions.js`: remove the `getSalesForecasts` stub and add wrappers for the
  RPCs in the table above, following the existing `callFunction(...)` wrapper style in that file.
  Read RPCs may use the `dynamic` cache tier; **every write wrapper must pass no cache and must
  invalidate the report's cached read afterwards**, or the editor will show stale figures after an
  override.
- A migration adding the `features` / `role_features` / `actions` / `role_actions` rows, modelled on
  `migrations/20260812100000_crm_whatsapp_module.sql` (which is this repo's most recent example of
  that idiom). Feature key `sales-report-editor`; action keys `reports.report.create`,
  `reports.report.edit`, `reports.report.delete`. Grant to `super_user`, `admin`, `Sales Exec` and
  `Palladium Manager` **only** — Pete and Joslyn both need full rights. Do **not** loop over every
  role and do **not** add these to
  `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql`; `CLAUDE.md` records that
  pattern as the cause of the current permission drift. Name the file with a UTC timestamp prefix
  later than `20260817100000`.
  **You cannot apply this migration** — the fleet has no database credentials. Author the file only.
  The screen must therefore degrade gracefully until a human applies it: if the feature row is
  absent the menu item simply stays hidden, which is the existing `menu-filter.js` behaviour and
  needs no special handling.

## Verification — all runnable inside the checkout

1. `npm run test:fleet` passes. This is the gate. It runs `routing:verify`, `username:verify`,
   `verify-phase2-migrations`, `ui:verify`, `migrations:verify` and `registry:verify`.
   - `ui:verify` is the likely failure for a new module: colours must come from CSS custom
     properties in `WebPortal/css/design-tokens.css` (raw hex is allowed in **that file only**),
     Font Awesome icons only, `btn-primary` not `btn-success`, no `linear-gradient`, no `.swal2-*`
     overrides outside `css/swal-theme.css`.
   - `registry:verify` fails if any path named in `appRouteConfig.json` is missing on disk.
   - `migrations:verify` fails on a duplicate or malformed migration timestamp prefix.
2. `grep -n "sales-report-editor" WebPortal/js/appRouter.js` returns a match — the hardcoded switch
   is the step most often missed.
3. `grep -rn 'route="sales-forecasting-grid"' WebPortal/index.html` still returns a match inside the
   `businessCollapse` block, and `grep -rn "getSalesForecasts" WebPortal/` returns nothing.
4. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
5. `grep -rn "\.html(" WebPortal/modules/sales-reports/js/` — review every hit and confirm none
   passes database or user text. Reasons, commentary and labels must go through `.text()`.

**Do not add a "verify before finishing" step that needs a browser, a logged-in session, a
screenshot, or the deployed demo site.** Playwright in this repo runs against
`https://demo-macavation.customapp.org` and cannot run inside the fleet job. Adding Playwright specs
is fine as a deliverable; running them is not a completion gate here.

## Out of scope

PDF generation, publish/re-issue, the targets admin screen, the sales Excel import, the metric
resolvers, chart rendering, and applying any migration.
