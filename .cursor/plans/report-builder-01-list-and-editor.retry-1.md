---
retry_of: b6f60fc9-f862-4e7e-9458-f63ad7aa6fb1
---

# Report builder — report list and editor screens

## Context

Pete (Sales Exec) produces Macavation's weekly and monthly director reports in
"Macavation Weekly and Monthly Reports.xlsx", a 63-sheet workbook. This plan builds the first two
screens that replace it: a report list, and the report editor where he fills a report in and
overrides figures.

The database side is authored and merged: `migrations/20260817090000_report_builder_foundations.sql`
and `migrations/20260817100000_report_instances_and_targets.sql` are both in this checkout and every
RPC this plan calls is defined in them. **Whether those migrations have been applied to any database
cannot be verified from this checkout — do not state or assume that they have.** The sibling
`migrations/20260817090100_fix_report_period_label_padding.sql` explicitly records that applying it
is out of scope, so treat "the resolver/label state on the live dev database is unknown" as the
working assumption and handle a missing RPC gracefully (see "Degradation" below).

**Why overrides are central.** `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md` §0.4 records
that kernel cracking capture is unreliable in both directions. `resolve_report_metric_value` in
`20260817100000` is a deliberate stub that returns NULL for every metric (verify by reading it), so
**every figure will show "No system data" until a resolver migration lands**. That is the expected
state, not a bug: Pete enters the figure with a reason, and the report records system value, entered
value and target side by side so the gap is visible. The UI must make that legible rather than hide
it. **Do not copy the investigation document's counts or percentages into code comments, UI copy or
commit messages** — they come from database queries this run cannot re-execute. Where motivation is
needed, reference the document path and nothing more.

## Scope

Two routes only: the report list and the report editor. PDF generation, publishing, the targets
admin screen and the sales import are separate plans and are explicitly OUT OF SCOPE here. Do not
add a Publish button that calls anything — plan 02 adds publishing.

## FIXED constraints — do not change these

1. **Reuse the existing route key `sales-forecasting-grid` for the report list, and keep its
   sidebar `<li>` inside `businessCollapse`.** This is not cosmetic. Three test sites name the key:
   - `Playwright Tests/user-management/role-screen-access.spec.ts` lines 29, 35, 40, 45, 49, 58, 64,
     69 — route key only, no content assertion.
   - `Playwright Tests/helpers/navigation.helper.ts:53-56` — resolves
     `linkSelector: 'a[route="sales-forecasting-grid"]'` with
     `collapseIds: ['supportCollapse', 'businessCollapse']`.
   - `Playwright Tests/auth/rbac.spec.ts:88-101` — **this one asserts page content**:
     `expect(page.locator('#content-area')).toContainText(/Sales|Forecast|Dashboard/)`.
     Therefore the report list's visible heading **must contain the word "Sales"** (the specified
     label "Sales &amp; Production Reports" satisfies it). Do not ship a heading that would fail
     that regex, and **do not edit any of these three spec files** to accommodate the change.

   Introducing a new route key instead, or moving the item out of `businessCollapse`, breaks these
   specs. `WebPortal/modules/admin/js/permission-module-map.js:57` also maps this key to the
   `sales-forecasting` permission slug; leave that file alone (it groups DB permissions by
   `object_name` text, not by folder, so deleting the module folder does not break it).
2. **A new route needs an entry in BOTH `WebPortal/js/appRouteConfig.json` AND the hardcoded
   `initializeModule()` switch in `WebPortal/js/appRouter.js`** — the existing
   `'sales-forecasting-grid'` case is at **`WebPortal/js/appRouter.js:433`** (not 407; the earlier
   citation was wrong — re-grep before editing). A route registered in only one of the two silently
   renders nothing.
3. **No deep-linking.** The router never reads the URL (`CLAUDE.md`, verified: every nav link is
   `href="#"`). Pass the current report id between screens via `Session.set('currentReportId', id)`
   (`WebPortal/js/session.js:68-84`), not a query string or hash. `_appRouter.routeParams`
   (`appRouter.js:14`, `:667`) exists but is only a breadcrumb-label store — `initializeModule` is
   called as `initializeModule(routeName)` with no params (`appRouter.js:252`), so do not try to
   receive the id as an argument. The editor must handle a missing or malformed
   `currentReportId` by showing an empty state and routing back to `sales-forecasting-grid`.
4. **`data-action-perm` is swept once over static markup only** (`CLAUDE.md:29-32`; the sweep is
   `actionAccess.apply(#content-area)` at `appRouter.js:253-256`, 100 ms after load). It is inert on
   anything rendered after that. For dynamically rendered rows and menu items use the prevailing
   module idiom `typeof hasAction === 'function' && hasAction('<key>')` inline at render time
   (`window.hasAction` is defined at `action-access.js:95` and delegates to `actionAccess.has`).
   Never call it with an empty key — `has('')` returns `true` (`action-access.js:44`).
5. **Module scripts are loaded once per session.** `appRouter.loadJSCode` (`appRouter.js:787-793`)
   gives each script an id derived from its filename and `continue`s if that id already exists, so
   on a second visit to the screen the markup is re-injected but the file does not re-execute. Both
   new modules must therefore do all of their work inside an idempotent `init()` reached from the
   `initializeModule` switch, must re-bind handlers with `.off().on()` (or delegate from
   `document`), and must **not** rely on a bottom-of-file self-init to render.

## Security invariants — state and follow these exactly

These are the rules `BluePrint/javascript-jquery-rules.md` is checked against, and this screen
renders database text that originates from user input (override reasons, commentary, customer names,
style codes, notes).

- **Never pass database or user-entered text through `.html()`, `innerHTML`, or string
  concatenation into markup.** Build the element, then set its text with `.text()`. This applies to
  every override reason, commentary, section label, metric label, style code and template name.
  Numeric values may be formatted and concatenated only after `Number()` conversion.
- **`MacTableActions` does not escape item labels.** `WebPortal/js/table-actions.js:39,45` inserts
  `item.label` into an HTML string verbatim (only `attrs`/`dataAttrs` go through `escapeAttr`).
  Row-action labels must be **static literals only** ("Open", "Delete"); never put a template name,
  period label or any other database text into a `MacTableActions` item label or `html` field.
  `MacStatus.pill` does escape its label (`mac-status.js:50-63`) and is safe for status text.
- **Validate any uuid read from a `data-*` attribute before using it in an RPC call.** Use an
  explicit regex — `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` — and abort
  if it fails. A truthiness check is not validation. Apply the same check to the id read back from
  `Session.get('currentReportId')`.
- **Never use a value from the payload as an object property key** without first rejecting
  `__proto__` and `constructor`. Prefer a `Map`, or `Object.create(null)`. The metric-key lookup the
  editor needs for partial re-render must be a `Map`.
- `JSON.parse` only inside `try/catch`.
- No `eval`, no `new Function`, no string-form `setTimeout`.
- **Add no new library, CDN tag or npm dependency.** Everything needed is already loaded globally by
  `WebPortal/index.html`: jQuery, Bootstrap, Flatpickr (line 558), SweetAlert2, `session.js`,
  `mac-status.js`, `ui-states.js`, `action-access.js`, `table-actions.js`. `npm ci` does not work in
  this repo (no lockfile, zero dependencies).

## RPC contracts — these exist in the migrations; call them exactly as written

All are reached through `dataFunctions.callFunction(name, params, token, options)` in
`WebPortal/js/data-functions.js`, which POSTs to `rest/v1/rpc/<name>` with the anon key. Parameter
names must match exactly, including the `p_` prefix.

| RPC | Params (defaults as declared) | Returns |
|---|---|---|
| `get_report_templates` | `p_period_type` (DEFAULT NULL) | rows: `id, code, name, period_type` |
| `get_report_current_period` | `p_period_type` (**no default**) | one row: `period_type, period_start, period_end, fy, fy_month_index, period_label` |
| `list_report_instances` | `p_period_type, p_status, p_limit` (50), `p_offset` (0) | rows incl. `id, template_id, template_name, period_type, period_start, period_end, period_label, fy, version, status, section_count, override_count, metric_count, generated_at, published_at, pdf_storage_path, total_count`. `p_limit` capped `LEAST(COALESCE(p_limit,50),100)`; `total_count` repeats on every row |
| `create_report_instance` | `p_template_id`, `p_period_date` (**no defaults**), `p_actor_user_id` (DEFAULT NULL) | one row: `success (int), error (text), report_instance_id (uuid)` |
| `get_report_instance` | `p_report_instance_id` | a single `jsonb` document (shape below), or NULL if not found |
| `override_report_metric_value` | `p_report_instance_id, p_metric_key, p_entered_value, p_reason` (**no defaults**), `p_actor_user_id` (DEFAULT NULL) | `success, error` |
| `clear_report_metric_override` | `p_report_instance_id, p_metric_key` | `success, error` |
| `set_report_section_state` | `p_report_instance_id, p_section_key`, `p_is_enabled` (DEFAULT NULL), `p_commentary` (DEFAULT NULL) | `success, error`. NULL leaves that field unchanged (`COALESCE(p_commentary, commentary)`) |
| `set_report_executive_summary` | `p_report_instance_id`, `p_summary` (**no default**) | `success, error` |
| `refresh_report_instance` | `p_report_instance_id` | `success, error, metrics_refreshed` |
| `delete_report_instance` | `p_report_instance_id` | `success, error` — drafts only |

**Every one of these returns `success = 0` with a human-readable `error` string rather than
throwing.** Show `error` to the user via `Swal.fire({icon:'error', text: <error>})`. Do not invent
your own message when the server supplied one.

### The parameter-stripping rule that governs every call above

`dataFunctions.buildPostgrestRpcBody` (`WebPortal/js/data-functions.js:497-512`) **removes any
param whose value is `null`, `undefined` or `''`** before the body is serialised, unless the caller
passes `preserveNullParams` (which preserves `null` only — never `''`). PostgREST resolves the
overload from the exact set of parameter *names* in the body, so a stripped param that has **no
DEFAULT** produces a thrown `"Could not find the function public.<name>(...) in the schema cache"`
error, not the `success = 0` path this plan tells the UI to display. Consequences the code must
handle explicitly:

- Clearing a section commentary by sending `''` (or `null`) leaves the old text in place, because
  `''` is stripped and `set_report_section_state` does `COALESCE(p_commentary, commentary)`. Pete's
  deletion would silently not stick in a director-facing report.
- Clearing the executive summary by sending `''` or `null` without the flag sends only
  `p_report_instance_id`, and `p_summary` has no DEFAULT → thrown schema-cache error.

The fix is deliverable 4a below. Do not work around it per-call-site.

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

`display_order` is a **zero-padded string** (`LPAD(...,6,'0')`). Sort with it as a string, or
`parseInt(..., 10)` before comparing numerically — do not assume it is already a number.

`render_kind` is one of `metric_table`, `line_table`, `tracking_table`. In this plan only
`metric_table` renders content; `line_table` and `tracking_table` sections must render their header
and toggle plus an empty state reading "Populated when this section's data source is connected" —
their content arrives in a later plan. `lines` is always `[]` for now.

**`period_label` may contain internal blank padding.** `20260817090100_fix_report_period_label_padding.sql`
(unapplied, applying it is out of scope) exists because `report_period_label` produced
`"August    2026 (FYE 2027)"`. Whenever a label is displayed, normalise whitespace for display only:
`$el.text(String(label == null ? '' : label).replace(/\s+/g, ' ').trim())`. Never rewrite the label
otherwise, and never synthesise a label locally — the title is always the server's.

## Degradation, permissions and access scope — read before writing any code

These are facts about this repo's code, verified in the files named. The screen must behave
correctly under them; do not restate them as "handled by menu-filter".

1. **A new route is gated by a feature row, not just by the sidebar.** `appRouter.js:137-155` runs
   `roleMenuConfig.hasAccess(routeName)` for **any** route loaded into `#content-area`, and
   `role-menu-config.js:603-628` treats `Session.get('featureKeys')` as authoritative for non-admin
   roles (admin/`super_user` bypass by role name). So until a human applies the new migration,
   clicking "Open" on `sales-report-editor` renders "Access Denied" and bounces to the dashboard
   after 2 s for every non-admin role, including Sales Exec. The `reports.report.*` action keys are
   default-deny (`action-access.js:7-9,43-47`), so "New Report" and "Delete" are hidden for
   non-admins too. `featureKeys`/`actionKeys` are cached at login, so a user must sign out and back
   in after the migration is applied.
2. **Required fallback, so the journey degrades instead of breaking.** `report_list_grid.js` must
   define, once:

   ```js
   // Mirrors appRouter.js:137-138 exactly. The router only runs its own hasAccess gate when
   // roleMenuConfig exists AND getUserRole() is truthy; a looser check here would block a
   // navigation the router would have allowed.
   function canOpenReportEditor() {
       if (typeof roleMenuConfig === 'undefined' || !roleMenuConfig.getUserRole()) return true;
       return roleMenuConfig.hasAccess('sales-report-editor') === true;
   }
   ```

   `canOpenReportEditor()` must be consulted at **both** places that navigate to the editor — the
   row "Open" action **and** the successful-create path in the New Report modal. When it returns
   false: do not route; show
   `Swal.fire({icon:'info', title:'Report editing not enabled', text:'Report editing has not been enabled for your role yet. An administrator must apply the report-builder permissions migration, then sign out and back in.'})`.
   On the create path, still refresh the list afterwards so the new draft is visible.
3. **Access scope of reusing `sales-forecasting-grid` (state this in the new migration's header
   comment too).** What the reused key exposes is the list screen only, and
   `list_report_instances` (`20260817100000:959-1021`) returns **metadata and counts only** —
   `period_*`, `fy`, `version`, `status`, `section_count`, `override_count`, `metric_count`,
   timestamps, `pdf_storage_path`, `total_count` — **no metric figures**. Every figure comes from
   `get_report_instance`, which is reached only from the editor route behind the new
   `sales-report-editor` feature key. **Which roles currently hold `sales-forecasting-grid` in
   `role_features` cannot be read from this checkout** (no database access). In-repo evidence only:
   `migrations/20260302000003_seed_features.sql:45-49,118-127` seeded it to seven full-access roles
   plus `PWA Sales`, and the hardcoded pre-login fallback `role-menu-config.js:167-177` lists it for
   `PWA Sales`. Record exactly that, as evidence and not as current state; do not assert who has
   access today.
4. **Missing RPCs must not white-screen the module.** If a report RPC is absent from the target
   database, `callFunction` throws. Wrap every call in `try/catch`, log with `console.warn`, and
   render `macEmptyState('fa-file-invoice', 'Reports are not available yet', 'The report-builder
   migrations have not been applied to this database.')` rather than leaving a spinner.

## Deliverables

### 1. `WebPortal/modules/sales-reports/` (new module, replacing the old stub)

- `html/report_list.html`, `js/report_list_grid.js`, `css/sales_reports.css`
- `html/report_editor.html`, `js/report-metric-line.js`, `js/report_editor.js`

Global entry points (referenced verbatim by deliverable 4b — keep these names exactly):
`_salesReportList` + `initializeSalesReportList()`, `_salesReportEditor` +
`initializeSalesReportEditor()`, and `MacReportMetricLine` (deliverable 3).

Delete `WebPortal/modules/sales-forecasting/` — it is a self-contained stub (nothing outside that
folder references `initializeSalesForecastingGrid` except the router case being repointed) whose only
data call, `dataFunctions.getSalesForecasts()` (`WebPortal/js/data-functions.js:4314-4318`),
hardcodes `return []`. Remove that stub function too. Do **not** edit `WebPortal/help/*`,
`docs/**` or `scripts/apply_user_guide_help_links.mjs`: those still describe "Sales Forecasting", and
correcting the user guide is a separate, human-reviewed action. Carrying the existing Help link
anchor (`help/index.html#sales-forecasting-grid`) into `report_list.html` unchanged is fine.

**Model the list screen on `WebPortal/modules/users/js/users_grid.js`** — it is this repo's
canonical hand-rolled pagination (`currentPage` :19, `itemsPerPage` :20, manual slice :164-165,
Bootstrap `.pagination` markup :222-241, delegated click handler on `.pagination .page-link` :62).
There is no DataTables/AG-Grid here. Reuse `MacTableActions` (`WebPortal/js/table-actions.js`) for
the row "⋯" menu — call `MacTableActions.render({items: [...]})` (or `renderCell`) for the cell and
`MacTableActions.init(tableElement)` **after** the rows are in the DOM, as
`WebPortal/modules/scheduled-reports/js/scheduled_reports_grid.js:51,90` does. Use `MacStatus.pill`
(`WebPortal/js/mac-status.js`) for status (note: `draft` maps to the warning tone and `published` is
not in `TONE_MAP` so it renders neutral — that is acceptable; do not add a tone or override
`.mac-pill` colours), and `macLoadingRow`/`macEmptyRow`/`macEmptyState`
(`WebPortal/js/ui-states.js:37-39`) for the three states.

List columns: Period label · Type (Weekly/Monthly pill) · Date range · Status pill · Completeness
(`override_count` of `metric_count` overridden) · Last generated · Actions (Open, Delete).
`list_report_instances` returns `total_count` on every row — drive pagination from that rather than
counting client-side. Build the Delete item into the actions array only when
`typeof hasAction === 'function' && hasAction('reports.report.delete')` (dynamic markup: constraint
4). Delete must confirm via `Swal`, call `deleteReportInstance`, and surface the RPC's own `error`
(the RPC refuses non-drafts).

**"New Report" modal.** A Bootstrap modal with a period-type radio (Weekly/Monthly) and a Flatpickr
date input. The static trigger button may carry `data-action-perm="reports.report.create"` (static
markup, swept once); expect it to be hidden for non-admins until the migration is applied.

**Date handling — mandatory.** Every Flatpickr in this tree is configured `dateFormat: 'd/m/Y'`
(`oil_production_grid.js:9`, `modal_send_to_dispatch.js:10`, `modal_receiving_checklist.js:9`, and
nine more), i.e. the input's `.value` is `dd/mm/yyyy`. `p_period_date` is a Postgres `date`:
sending `"17/08/2026"` errors (22008 — a *thrown* HTTP error, not the `success = 0` path), and
`"05/03/2026"` would silently create the **May 3** report instead of **3 March** — precisely the
period/title drift §2 exists to prevent. So:

- Initialise the picker with `{ dateFormat: 'd/m/Y', allowInput: false, disableMobile: true }`, the
  same options object shape the modals use.
- Convert to ISO before the call, preferring the picker's own `Date`:

  ```js
  // Local components only. Do NOT use toISOString(): the portal runs at UTC+2, so a local
  // midnight serialises as the PREVIOUS day in UTC and the report would be created for the
  // wrong period. Falls back to parsing the dd/mm/yyyy text, modelled on
  // modal_receiving_checklist.js:11-17.
  function toIsoDateFromPicker(fpInstance, inputEl) {
      var d = fpInstance && fpInstance.selectedDates && fpInstance.selectedDates[0];
      if (d instanceof Date && !isNaN(d.getTime())) {
          return d.getFullYear() + '-' +
                 String(d.getMonth() + 1).padStart(2, '0') + '-' +
                 String(d.getDate()).padStart(2, '0');
      }
      var raw = inputEl && typeof inputEl.value === 'string' ? inputEl.value.trim() : '';
      var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
      if (!m) return null;
      return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  ```
- Before calling `createReportInstance`, assert the result matches `/^\d{4}-\d{2}-\d{2}$/`; if not,
  show `Swal.fire({icon:'error', text:'Pick a valid date (dd/mm/yyyy).'})` and call nothing.
- **Do not implement your own Monday-snapping.** Pass the ISO string as `p_period_date`; the server
  snaps it to the Monday or the 1st. If a report already exists for that period the RPC returns
  `success = 0` with a message naming the period — show it.

### 2. The editor screen

Header shows `period_label` (whitespace-normalised as above) and the raw `period_start`–`period_end`
dates beneath it. **The title is always derived from the payload, never a typed field** — Pete's
workbook had a sheet titled "November" whose own start/end dates read 1–31 October, and a generated
title cannot drift from the dates it describes.

A Bootstrap `.accordion`, one `.accordion-item` per section in `display_order` order. Each header
carries the section label (via `.text()`) and a `form-check form-switch` toggle bound to
`is_enabled` → calls `setReportSectionState(reportId, sectionKey, isEnabled, undefined)`. Each body
holds a metric table plus a commentary `<textarea>` that saves on blur through
`setReportSectionState(reportId, sectionKey, undefined, text)`.

**Blur-save rules (both textareas):**
- Only call the RPC when the value actually changed from the value last loaded/saved for that field.
- Pass `undefined` — never `null` — for "leave this field unchanged"; `undefined` is stripped from
  the body under every flag combination, `null` is what `COALESCE` treats as unchanged, and `''` is
  what actually clears (see deliverable 4a).
- A cleared commentary must reach the server as `''` and must visibly stay cleared after the next
  read. A cleared executive summary must reach the server as `null` (which sets the column NULL).
- On `success = 0`, show `error` and restore the previously-saved text in the textarea so the screen
  never shows unsaved text as saved.

Above the accordion, an executive-summary `<textarea>` saving on blur via
`setReportExecutiveSummary`. It arrives pre-filled: `create_report_instance` copies the previous
period's summary forward so Pete edits rather than retypes.

### 3. `report-metric-line.js` — the reusable metric row

Expose exactly one global: `MacReportMetricLine`, with

- `render(metric, ctx)` → returns a `<tr>` **DOM element** (built with `document.createElement` and
  `.text()`, never an HTML string), with its own blur handlers already bound;
- `ctx` = `{ reportId: <uuid string>, status: <report status string>, onSaved: function (metricKey) {} }`.

`report_editor.js` must call it under exactly these names. Columns: **Description · System ·
Entered · Target · Achieved % · Status**.

- System cell: the formatted `system_value`, or the text "No system data" when it is `null`. These
  must look different — `null` means the database holds no figure, which is not the same as a real
  zero, and today every metric is `null`.
- Entered cell: an `<input type="number" step="any">` seeded from `entered_value ?? system_value`.
- Achieved %: `effective_value / target_value` as a percentage, or "—" when `target_value` is null
  or zero. **Guard the divide-by-zero** — `target_value` is frequently null until the targets screen
  exists.
- Status cell: an "Overridden" pill when `is_overridden`, otherwise empty. The override reason and
  `overridden_by_name` may be shown as a tooltip/secondary line — via `.text()`/`.attr('title', …)`
  only.

**Override flow.** On blur, if the entered number differs from `system_value`, prompt for a reason
before saving:

```js
var raw = $input.val();
var value = Number(raw);
if (raw === '' ) { /* clear path, below */ }
else if (!Number.isFinite(value)) {
    $input.val(previousValue);
    await Swal.fire({icon: 'error', text: 'Enter a number.'});
    return;                                   // save nothing
}
var result = await Swal.fire({
    input: 'text',
    inputLabel: 'Reason for overriding this figure',
    inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
    showCancelButton: true
});
if (!result.isConfirmed) { $input.val(previousValue); return; }   // revert, save nothing
await dataFunctions.overrideReportMetricValue(
    ctx.reportId, metric.metric_key, value, result.value, dataFunctions.getCurrentUserId());
```

`Swal.fire` resolves to an object; `result.value` is the entered text and `result.isConfirmed` is the
button state. Cancelling must restore the input's previous value and call nothing.

**Never call `override_report_metric_value` with a non-finite value or a blank reason.**
`p_entered_value` and `p_reason` have no DEFAULTs, so a stripped one is a thrown schema-cache error
rather than the friendly `success = 0` message; the wrapper's `preserveNullParams` keeps the names in
the body as a backstop, but the client-side validation above is the control. Clearing the input
entirely calls `clearReportMetricOverride`, **not** the override RPC with null — the override RPC
rejects a NULL value by design ("A value is required. Use clear_report_metric_override to revert.").

The server enforces the reason twice over (`NULLIF(TRIM(COALESCE(p_reason,'')),'')` →
"A reason is required when overriding a figure.", plus the
`report_metric_override_needs_reason` CHECK constraint), so the prompt is UX, not the control.

**After a successful metric write**, re-read the report with `getReportInstance(reportId, true)`
(force refresh) and re-render **only that metric's row** — `effective_value`, `is_overridden`,
`overridden_by_name` and `overridden_at` are server-computed. Locate the metric in the fresh payload
with a `Map` keyed by `metric_key` (never a plain object — payload keys must not become property
keys). Do not re-render the whole accordion on a blur; that would steal focus and scroll position.

**Published reports are read-only.** When `ctx.status !== 'draft'`, render inputs as `disabled`, hide
the section toggles, and show a banner reading "Published <date> — figures are locked. Use Re-issue
to correct." Every edit RPC already refuses with "Only a draft report can be edited.", so this is
presentation; do not attempt to work around it. Do not build the Re-issue action here — plan 02 owns
it.

### 4. Wiring

**4a. `WebPortal/js/data-functions.js` — transport change first, wrappers second.**

Add an opt-in flag so a param can be sent as an empty string. Default behaviour must be byte-for-byte
unchanged for every existing caller (the only three references to `buildPostgrestRpcBody` in the repo
are `data-functions.js:497` (definition), `:521` (`tryKernelRpcSupabaseFallback`, passes no options)
and `:602` (`callSupabaseRpc`); no test asserts on it — confirm with a grep before editing).

```js
// buildPostgrestRpcBody (~line 497). New: preserveEmptyStrings. '' is otherwise stripped, which
// makes it impossible to clear a text column through an RPC that COALESCEs NULL onto the old value.
buildPostgrestRpcBody: function (params, options) {
    const out = {};
    if (!params || typeof params !== 'object') return out;
    const preserveNulls = !!(options && options.preserveNulls);
    const preserveEmptyStrings = !!(options && options.preserveEmptyStrings);
    Object.keys(params).forEach(function (key) {
        const val = params[key];
        if (preserveNulls && val === null) { out[key] = null; return; }
        if (preserveEmptyStrings && val === '') { out[key] = ''; return; }
        if (val !== null && val !== undefined && val !== '') { out[key] = val; }
    });
    return out;
}
```

Thread it through both layers, keeping these exact names (public option `preserveEmptyParams`,
internal option `preserveEmptyStrings` — mirroring the existing `preserveNullParams`/`preserveNulls`
pair):

- `callSupabaseRpc` (~line 602):
  `scope.buildPostgrestRpcBody(params, { preserveNulls: options.preserveNullParams === true, preserveEmptyStrings: options.preserveEmptyParams === true })`
- `callFunction` (~line 745):
  `{ useAnonAuth: true, preserveNullParams: options.preserveNullParams === true, preserveEmptyParams: options.preserveEmptyParams === true }`

`undefined` is still stripped in every case — that is what "leave unchanged" relies on.

Then remove `getSalesForecasts` and add the report wrappers. Use exactly these names; deliverables
1–3 reference them verbatim:

`getReportTemplates`, `getReportCurrentPeriod`, `listReportInstances`, `createReportInstance`,
`getReportInstance`, `overrideReportMetricValue`, `clearReportMetricOverride`,
`setReportSectionState`, `setReportExecutiveSummary`, `refreshReportInstance`,
`deleteReportInstance`.

Rules for the wrappers, following the existing `callFunction(...)` style (see
`upsertDashboardTarget` at `data-functions.js:1655-1674` as the model, including its
`preserveNullParams` comment and its `clearCachePattern` call):

- **Reads** pass an **explicit** `cacheKey` prefixed `report_list_` (list) or `report_instance_`
  (single report), `cacheTtl: this.cache.ttl.dynamic`, and honour a `forceRefresh` argument. The
  explicit key is mandatory: the default key is `functionName_JSON(params)`, which the invalidation
  patterns below would not match.
- **Every write** passes `useCache: false` and then calls both
  `this.clearCachePattern('report_instance_')` and `this.clearCachePattern('report_list_')`.
  `useCache: false` is not optional: `callFunction` caches by `functionName + JSON.stringify(params)`
  and returns the cached value on a later identical call, so toggling a section off → on → off would
  see the third write served from cache and never sent to the server
  (`clearCachePattern` is substring-based, `data-functions.js:129-135`).
- `overrideReportMetricValue` and `setReportExecutiveSummary` pass `preserveNullParams: true`
  (`p_entered_value`, `p_reason` and `p_summary` have no DEFAULTs and must always appear in the body).
- `setReportSectionState` passes `preserveEmptyParams: true`, takes `isEnabled` and `commentary`
  where `undefined` means "leave unchanged", and must document that `''` clears while `null` does
  not.
- `setReportExecutiveSummary` normalises its argument:
  `var text = (typeof summary === 'string' && summary.trim() !== '') ? summary : null;` — the raw
  text when non-blank (preserving internal newlines), `null` when blank.
- `createReportInstance` takes an already-ISO `p_period_date` string; it must not do any date
  parsing of its own, and must not set `preserveNullParams` (a preserved null `p_period_date` would
  reach the function and raise instead of being caught client-side).
- Actor ids come from `dataFunctions.getCurrentUserId()` (`data-functions.js:248-254`), which returns
  `null` when unknown. Never fabricate one.

**4b. `WebPortal/js/appRouteConfig.json`** — repoint `sales-forecasting-grid` at
`path: "sales-reports"`, `html: "html/report_list.html"`, js `["js/report_list_grid.js"]`,
css `["css/sales_reports.css"]`; keep its `description` a "Sales …" string (it is used for
breadcrumbs). Add `sales-report-editor` with `path: "sales-reports"`,
`html: "html/report_editor.html"`, and js **in this order**:
`["js/report-metric-line.js", "js/report_editor.js"]` — `loadJSCode` loads sequentially
(`appRouter.js:787-808`), so `MacReportMetricLine` must be listed first, and `report_editor.js` must
still guard with `typeof MacReportMetricLine !== 'undefined'`. Keep JSON valid —
`npm run registry:verify` fails on a path that does not exist on disk.

**4c. `WebPortal/js/appRouter.js`** — repoint the existing `'sales-forecasting-grid'` case (line 433)
to `initializeSalesReportList()` and add a `'sales-report-editor'` case calling
`initializeSalesReportEditor()`, both in the `if (typeof X === 'function') X();` shape of the
neighbouring cases.

**4d. `WebPortal/index.html`** — relabel the existing `businessCollapse` item (lines 274-278) to
"Sales &amp; Production Reports" with `<i class="fas fa-file-invoice me-2">` and
`title="Sales & Production Reports"`. **Keep `data-route` and `route` as `sales-forecasting-grid`**
(constraint 1). Add no sidebar item for the editor — it is reached by button only.

**4e. `WebPortal/js/role-menu-config.js`** — update the `'sales-forecasting-grid'` entry
(lines 395-401) so `label` reads `'Sales & Production Reports'` and `icon` is `'fas fa-file-invoice'`,
matching `index.html`. This entry is the label fallback used when the sidebar DOM is unavailable
(`role-menu-config.js:451-489`), so leaving it stale shows the old name in those surfaces. Do **not**
add `sales-report-editor` to `menuStructure`: `getAccessibleMenus` returns `Object.keys(menuStructure)`
for admins (`:638`) and `menu-filter.js` drives sidebar visibility from those keys, and the editor has
no sidebar item — modal-style routes are absent from `menuStructure` for the same reason. Do not
change any role's `menus` array in `menuConfig`.

**4f. A migration** adding the `features` / `role_features` / `actions` / `role_actions` rows,
modelled on `migrations/20260812100000_crm_whatsapp_module.sql:542-599` (this repo's most recent
example of the idiom, with the real column names: `features(key, name, description)`,
`actions(key, module, label, description)` — `module` is NOT NULL and has no default). Name the file
with a UTC timestamp prefix later than `20260817100000`.

- Feature key `sales-report-editor` (must equal the route key — `hasAccess` compares the route name
  against `featureKeys`), name "Report Builder — Editor".
- Action keys `reports.report.create`, `reports.report.edit`, `reports.report.delete`, module
  `'Reports'`.
- Grant the new feature and the three actions to `super_user`, `admin`, `Sales Exec` and
  `Palladium Manager` **only**, by explicit `role_name IN (...)` lists.
- Also insert `role_features` for the **existing** `sales-forecasting-grid` feature for
  `Sales Exec` and `Palladium Manager`, so the list screen is reachable for the two roles this
  feature is for. Whether those rows already exist cannot be verified from this checkout — say so in
  a comment, and use `ON CONFLICT (role_id, feature_id) DO NOTHING` so re-running is a no-op.
- **Inserts only.** No `UPDATE`, no `DELETE`, no changes to any other role's rows, and nothing that
  removes an existing grant. Do **not** loop over every role, and do **not** add these to
  `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql`; `CLAUDE.md:34-39` records
  that pattern as the cause of the current permission drift.
- Header comment must record, as the reason a human should read it before applying: that the screen
  behind the existing `sales-forecasting-grid` key changes from "Sales Forecasting" (a dead stub) to
  the director report list; that the list RPC returns metadata and counts only, no metric figures;
  and that the current membership of that key in `role_features` was not verifiable when the
  migration was written.
- Follow the file's own idiom for `role_permissions` seeding if the model file's pattern applies, but
  do not widen it beyond the four roles above.
- **You cannot apply this migration** — the fleet has no database credentials. Author the file only,
  claim nothing about it having been applied, and rely on the fallback in "Degradation" §2 for the
  interim state.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. This is the gate. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`.
   - `ui:verify` is the likely failure for a new module: no raw hex outside
     `WebPortal/css/design-tokens.css` (use `--mac-*` tokens), no `var(--phoenix-*)`/legacy vars,
     Font Awesome icons only, `btn-primary` not `btn-success`, no `linear-gradient`, no `.swal2-*`
     rules outside `css/swal-theme.css`, no bare `td`/`th` padding in module CSS, no `min-width` on
     `.badge`.
   - `registry:verify` fails if any path named in `appRouteConfig.json` is missing on disk.
   - `migrations:verify` fails on a duplicate or malformed migration timestamp prefix.
2. `grep -n "sales-report-editor" WebPortal/js/appRouter.js` returns a match — the hardcoded switch
   is the step most often missed. `grep -n "js/report-metric-line.js" WebPortal/js/appRouteConfig.json`
   shows it listed before `js/report_editor.js`.
3. `grep -rn 'route="sales-forecasting-grid"' WebPortal/index.html` still returns a match inside the
   `businessCollapse` block, and `grep -rn "getSalesForecasts\|initializeSalesForecastingGrid" WebPortal/`
   returns nothing.
4. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
5. `grep -rn "\.html(" WebPortal/modules/sales-reports/js/` — review every hit and confirm none
   passes database or user text. Reasons, commentary and labels must go through `.text()`.
6. `grep -n "preserveEmptyStrings\|preserveEmptyParams" WebPortal/js/data-functions.js` shows the
   flag in `buildPostgrestRpcBody`, `callSupabaseRpc` and `callFunction`, and
   `grep -rn "preserveEmptyParams" WebPortal/js/data-functions.js` shows it used by
   `setReportSectionState` only.
7. `grep -c "canOpenReportEditor" WebPortal/modules/sales-reports/js/report_list_grid.js` is at
   least 3 (definition + the "Open" call site + the post-create call site).
8. `grep -rn "toISOString" WebPortal/modules/sales-reports/js/` returns nothing, and
   `grep -rn "useCache: false" WebPortal/js/data-functions.js | grep -i report` shows one hit per
   write wrapper.
9. `grep -rn "sales-forecasting-grid" "Playwright Tests/"` output is unchanged from the base branch
   (no spec file edited).

**Do not add a "verify before finishing" step that needs a browser, a logged-in session, a
screenshot, a database, or the deployed demo site.** Playwright here runs against
`https://demo-macavation.customapp.org` (`Playwright Tests/playwright.config.ts:30`) and cannot run
inside the fleet job. Adding Playwright specs is fine as a deliverable — add them as new files that
`test.skip` without their env credentials, like the existing specs — but running them is not a
completion gate, and editing the three specs listed in constraint 1 is forbidden.

## Out of scope

PDF generation, publish/re-issue, the targets admin screen, the sales Excel import, the metric
resolvers, chart rendering, applying any migration, editing `WebPortal/help/*` or `docs/**`,
editing any existing Playwright spec, and changing `permission-module-map.js` or any role's
`menuConfig.menus` array.
