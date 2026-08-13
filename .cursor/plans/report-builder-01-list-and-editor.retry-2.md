---
retry_of: 7dd764f9-a021-403b-9b27-446ebef9b9ca
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
`20260817100000` (line 353) is a deliberate stub that returns NULL for every metric (verify by
reading it), so **every figure will show "No system data" until a resolver migration lands**. That is
the expected state, not a bug: Pete enters the figure with a reason, and the report records system
value, entered value and target side by side so the gap is visible. The UI must make that legible
rather than hide it. **Do not copy the investigation document's counts or percentages into code
comments, UI copy or commit messages** — they come from database queries this run cannot re-execute.
Where motivation is needed, reference the document path and nothing more.

## Scope

Two routes only: the report list and the report editor. PDF generation, publishing, the targets
admin screen and the sales import are separate plans and are explicitly OUT OF SCOPE here. Do not
add a Publish button that calls anything — plan 02 adds publishing.

## FIXED constraints — do not change these

1. **Reuse the existing route key `sales-forecasting-grid` for the report list, and keep its
   sidebar `<li>` inside `businessCollapse`.** This is not cosmetic. Four in-repo test-side files
   name the key:
   - `Playwright Tests/user-management/role-screen-access.spec.ts` lines 29, 35, 40, 45, 49, 58, 64,
     69 — route key only, no content assertion.
   - `Playwright Tests/helpers/navigation.helper.ts:53-56` — resolves
     `linkSelector: 'a[route="sales-forecasting-grid"]'` with
     `collapseIds: ['supportCollapse', 'businessCollapse']`.
   - `Playwright Tests/auth/rbac.spec.ts:88-102` — **this one asserts page content**:
     `expect(page.locator('#content-area')).toContainText(/Sales|Forecast|Dashboard/)`.
     Therefore the report list's visible heading **must contain the word "Sales"** (the specified
     label "Sales &amp; Production Reports" satisfies it).
   - `Playwright Tests/helpers/user-guide-screenshot-routes.ts:35` — maps the route key to a
     user-guide anchor. Keeping the key keeps this correct.

   Do **not** edit any file under `Playwright Tests/`. Introducing a new route key instead, or moving
   the item out of `businessCollapse`, breaks these files.
   `WebPortal/modules/admin/js/permission-module-map.js:57` also maps this key to the
   `sales-forecasting` permission slug; leave that file alone (it groups DB permissions by
   `object_name` text, not by folder, so deleting the module folder does not break it).
2. **A new route needs an entry in BOTH `WebPortal/js/appRouteConfig.json` AND the hardcoded
   `initializeModule()` switch in `WebPortal/js/appRouter.js`** — the existing
   `'sales-forecasting-grid'` case is at **`WebPortal/js/appRouter.js:433`** (verified; re-grep
   before editing). A route registered in only one of the two silently renders nothing.
3. **No deep-linking.** The router never reads the URL (every nav link is `href="#"`). Pass the
   current report id between screens via `Session.set('currentReportId', id)`
   (`WebPortal/js/session.js:67-92`), not a query string or hash. `_appRouter.routeParams` exists but
   is only a breadcrumb-label store — `initializeModule` is called as `initializeModule(routeName)`
   with no params (`appRouter.js:252`), so do not try to receive the id as an argument. The editor
   must handle a missing or malformed `currentReportId` by showing an empty state and routing back to
   `sales-forecasting-grid`.
   **That path is routine, not merely defensive:** `routeTo` persists the route name to
   `lastActivePage` (`appRouter.js:558-559`) and `appRouter` restores `lastActivePage` on page load
   (`appRouter.js:40-69`), so `sales-report-editor` can be the first route initialised after a
   browser reload, with `currentReportId` absent or stale.
4. **`data-action-perm` is swept once over static markup only** (the sweep is
   `actionAccess.apply(root)` at `appRouter.js:253-256`, 100 ms after load). It is inert on anything
   rendered after that. For dynamically rendered rows and menu items use the prevailing module idiom
   `typeof hasAction === 'function' && hasAction('<key>')` inline at render time (`window.hasAction`
   is defined at `action-access.js:95` and delegates to `actionAccess.has`). Never call it with an
   empty key — `has('')` returns `true` (`action-access.js:44`).
5. **Module scripts are loaded once per session, but the markup is re-injected on every visit.**
   Verified: `appRouter.loadContent` does `$(elementSelector).html(content)` on **every** navigation
   (`appRouter.js:231`), while `appRouter.loadJSCode` gives each script an id derived from its
   filename and `continue`s if that id already exists (`appRouter.js:790-793`), so the file does not
   re-execute on a second visit. Consequences that are **mandatory**, not advisory:
   - Both new modules must do all of their work inside an idempotent `init()` reached from the
     `initializeModule` switch, and must **not** rely on a bottom-of-file self-init to render.
   - **`init()` must call `bindEvents()` unconditionally, every single time.** Do **not** guard
     binding with a module-scoped `bound` / `initialised` one-shot flag: from the second visit
     onward every handler bound on the first visit points at DOM nodes the router has already
     replaced, which is how the previous attempt silently lost Back, Refresh, Create and the
     executive-summary blur-save. `WebPortal/modules/users/js/users_grid.js:36` re-runs
     `setupEventListeners()` on every `init()` for exactly this reason — model that.
   - Because `bindEvents()` re-runs, it must be idempotent: direct binds use
     `$('#id').off('<event>').on('<event>', …)`; delegated binds use
     `$(document).off('<event>', '<selector>').on('<event>', '<selector>', …)` (the selector-scoped
     `.off` is required — a bare `.off('click')` on `document` would tear down other modules'
     delegated handlers).
   - Anything else cached in a module-level variable across visits is stale too. In particular the
     Flatpickr instance: destroy the previous one before creating a new one and read the live
     instance from `input._flatpickr` at use time, modelled on
     `WebPortal/modules/modals/modal-oil-dispatch-form/js/modal_oil_dispatch_form.js:49-60`.
6. **`MacTableActions` `dataAttrs` keys must already be kebab-case.**
   `WebPortal/js/table-actions.js:22-26` writes each key verbatim into an HTML string as
   `data-<key>="…"`, and the cell HTML is assigned through `innerHTML`, so a camelCase key
   (`{ reportId: … }`) becomes the attribute `data-reportid` and `$(this).attr('data-report-id')`
   returns `null` — this is what killed the Open and Delete actions on the previous attempt. Use
   `dataAttrs: { 'report-id': r.id }`, matching every other module in this repo
   (`oil_dispatch_grid.js:139` `'order-id'`, `crm_grid.js:26` `'contact-id'`,
   `roles_grid.js:152` `'role-id'`). The same rule applies to any `data-*` attribute you set on a
   `<tr>` yourself: use `tr.setAttribute('data-report-id', …)`.

## Security invariants — state and follow these exactly

This screen renders database text that originates from user input (override reasons, commentary,
customer names, style codes, notes).

- **Never pass database or user-entered text through `.html()`, `innerHTML`, or string
  concatenation into markup.** Build the element, then set its text with `.text()` /
  `textContent`. This applies to every override reason, commentary, section label, metric label,
  style code and template name. Numeric values may be formatted and concatenated only after
  `Number()` conversion.
- **No database text in any SweetAlert2 `title` or `html` option, ever.** `title:` and `html:` must
  be static string literals with no `+` concatenation and no template interpolation. SweetAlert2 is
  loaded from a CDN (`index.html:548`) and its escaping behaviour cannot be read from this checkout,
  so do not rely on it. Server-supplied error strings go in `text:` only. If a dialog needs to name
  the metric being edited, use static copy ("Reason for overriding this figure") — do not
  interpolate `metric.label`.
- **`MacTableActions` does not escape item labels.** `table-actions.js:38-45` inserts `item.label`
  and `item.html` into an HTML string verbatim (only `attrs`/`dataAttrs` go through `escapeAttr`).
  Row-action labels must be **static literals only** ("Open", "Delete"); never put a template name,
  period label or any other database text into a `MacTableActions` item label or `html` field.
- `MacStatus.pill` **does** escape its label (`mac-status.js:50-63`) and its markup is safe to assign
  through `innerHTML`. Use `MacStatus.pill(status)` for status text and
  `MacStatus.pill('overridden', 'Overridden')` for the metric status cell — `'overridden'` is absent
  from `TONE_MAP` (`mac-status.js:20-38`) so it renders neutral, `draft` renders warning and
  `published` renders neutral. That is acceptable: **do not edit `mac-status.js` to add a tone and do
  not override `.mac-pill` colours.**
- Assigning a static literal HTML string containing no data (e.g. an icon `<i>` or a spinner) via
  `innerHTML` is allowed. Every `innerHTML` / `.html()` occurrence in the new module files must be
  either a static literal, a `MacStatus.pill(...)` result, or a `macLoadingRow` / `macEmptyRow` /
  `macEmptyState` result (all three escape their arguments — `ui-states.js:12-35`).
- **Validate any uuid read from a `data-*` attribute before using it in an RPC call.** Use an
  explicit regex — `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` — and abort
  if it fails. A truthiness check is not validation. Apply the same check to the id read back from
  `Session.get('currentReportId')` and to `report_instance_id` returned by `create_report_instance`.
- **Never use a value from the payload as an object property key** without first rejecting
  `__proto__` and `constructor`. Prefer a `Map`, or `Object.create(null)`. Every payload-keyed lookup
  in the editor (metric keys, section keys) must be a `Map`.
- `JSON.parse` only inside `try/catch`.
- No `eval`, no `new Function`, no string-form `setTimeout`.
- **Add no new library, CDN tag or npm dependency.** Everything needed is already loaded globally by
  `WebPortal/index.html`: jQuery, Bootstrap, Flatpickr (line 558), SweetAlert2 (line 548),
  `session.js` (561), `mac-status.js` (571), `ui-states.js` (572), `action-access.js` (580),
  `table-actions.js` (589). `npm ci` does not work in this repo (no lockfile, zero dependencies).
- **Do not set `confirmButtonColor` on any Swal call.** Several existing modules pass raw hex
  (`users_grid.js:275` `'#d33'`, `document_management_grid.js:849` `'#dc3545'`); do not copy that
  environment-specific state forward. `WebPortal/css/swal-theme.css` owns Swal button colour, and new
  code must introduce no raw hex.
- Module CSS may use only `--mac-*` tokens that actually exist in `WebPortal/css/design-tokens.css`.
  Verified present and safe to use: `--mac-text-tertiary` (:31), `--mac-warning` (:40),
  `--mac-warning-text` (:42), `--mac-warning-light` (:44), `--mac-danger` (:45).

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
| `set_report_section_state` | `p_report_instance_id, p_section_key`, `p_is_enabled` (DEFAULT NULL), `p_commentary` (DEFAULT NULL) | `success, error`. NULL leaves that field unchanged (`COALESCE(p_commentary, commentary)`, `20260817100000:651-655`) |
| `set_report_executive_summary` | `p_report_instance_id`, `p_summary` (**no default**) | `success, error`. Assigns directly (`executive_summary = p_summary`, `:691-693`), so NULL clears |
| `refresh_report_instance` | `p_report_instance_id` | `success, error, metrics_refreshed` |
| `delete_report_instance` | `p_report_instance_id` | `success, error` — drafts only |

**Every one of these returns `success = 0` with a human-readable `error` string rather than
throwing.** Show `error` to the user via `Swal.fire({icon:'error', text: <error>})`. Do not invent
your own message when the server supplied one. Treat a call as successful only when
`Number(result.success) === 1` **and** `result.queued !== true` (see the offline note in 4a).

`GRANT EXECUTE` and `role_permissions` rows for all of these already exist in the two prior
migrations (`20260817090000:749-772`, `20260817100000:1260-1306`) — the new migration in 4f must not
re-issue them.

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
`metric_table` renders content. `line_table` and `tracking_table` sections must render their header,
toggle and commentary box plus an empty state reading **exactly** "Populated when this section's data
source is connected" — their content arrives in a later plan. `lines` is always `[]` for now, and
**you must not render `lines` at all** (no generic key/value dump, no fallback table): even when
`lines` is non-empty on some future database, this plan renders the empty-state text for those two
`render_kind`s.

**`period_label` may contain internal blank padding.** `20260817090100_fix_report_period_label_padding.sql`
(unapplied, applying it is out of scope) exists because `report_period_label` produced
`"August    2026 (FYE 2027)"`. Whenever a label is displayed, normalise whitespace for display only:
`$el.text(String(label == null ? '' : label).replace(/\s+/g, ' ').trim())`. Never rewrite the label
otherwise, and never synthesise a label locally — the title is always the server's.

## Degradation, permissions and access scope — read before writing any code

These are facts about this repo's code, verified in the files named. The screen must behave
correctly under them; do not restate them as "handled by menu-filter".

1. **A new route is gated by a feature row, not just by the sidebar.** `appRouter.js:137-156` runs
   `roleMenuConfig.hasAccess(routeName)` for **any** route loaded into `#content-area`, and
   `role-menu-config.js:603-628` treats `Session.get('featureKeys')` as authoritative for non-admin
   roles (`admin`/`super_user` bypass by role name at `:607-610`). So until a human applies the new
   migration, clicking "Open" on `sales-report-editor` renders "Access Denied" and bounces to the
   dashboard after 2 s for every non-admin role, including Sales Exec. The `reports.report.*` action
   keys are default-deny (`action-access.js:7-9,43-47`), so "New Report" and "Delete" are hidden for
   non-admins too. `featureKeys`/`actionKeys` are cached at login, so a user must sign out and back
   in after the migration is applied.
2. **Required fallback, so the journey degrades instead of breaking.** `report_list_grid.js` must
   define **two separate, differently-named** helpers. Do not merge them; the previous attempt
   replaced the feature gate with a uuid check under the gate's name, which made verification step 7
   pass while the behaviour was absent.

   ```js
   // (a) Shape check for an id read from a data-* attribute or from Session.
   function isValidReportUuid(id) {
       return typeof id === 'string' &&
           /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
   }

   // (b) Feature-key gate. Mirrors appRouter.js:137-138 exactly. The router only runs its own
   // hasAccess gate when roleMenuConfig exists AND getUserRole() is truthy; a looser check here
   // would block a navigation the router would have allowed. Takes NO arguments.
   function canOpenReportEditor() {
       if (typeof roleMenuConfig === 'undefined' || !roleMenuConfig.getUserRole()) return true;
       return roleMenuConfig.hasAccess('sales-report-editor') === true;
   }
   ```

   `canOpenReportEditor()` must be consulted at **both** places that navigate to the editor — the
   row "Open" action **and** the successful-create path in the New Report modal — and at both places
   `isValidReportUuid(id)` must also pass before `Session.set('currentReportId', id)` is called.
   When `canOpenReportEditor()` returns false: do not route; show
   `Swal.fire({icon:'info', title:'Report editing not enabled', text:'Report editing has not been enabled for your role yet. An administrator must apply the report-builder permissions migration, then sign out and back in.'})`.
   On the create path, still refresh the list afterwards so the new draft is visible. When
   `isValidReportUuid` fails, show `Swal.fire({icon:'error', text:'That report could not be opened.'})`
   and do not route.
3. **Access scope of reusing `sales-forecasting-grid` (state this in the new migration's header
   comment too).** What the reused key exposes is the list screen only, and
   `list_report_instances` (`20260817100000:959-1021`) returns **metadata and counts only** —
   `period_*`, `fy`, `version`, `status`, `section_count`, `override_count`, `metric_count`,
   timestamps, `pdf_storage_path`, `total_count` — **no metric figures**. Every figure comes from
   `get_report_instance`, which is reached only from the editor route behind the new
   `sales-report-editor` feature key. **Which roles currently hold `sales-forecasting-grid` in
   `role_features` cannot be read from this checkout** (no database access). In-repo evidence only:
   `migrations/20260302000003_seed_features.sql:8-34,45-49,118-127` seeded the feature and granted it
   to seven full-access roles plus `PWA Sales`, and the hardcoded pre-login fallback
   `role-menu-config.js:167-177` lists it for `PWA Sales`. Record exactly that, as evidence and not
   as current state; do not assert who has access today.
4. **Missing RPCs must not white-screen the module, and a failure must not destroy the screen.** If a
   report RPC is absent from the target database, `callFunction` throws. Wrap every call in
   `try/catch`, log with `console.warn`, and render
   `macEmptyState('fa-file-invoice', 'Reports are not available yet', 'The report-builder migrations have not been applied to this database.')`
   rather than leaving a spinner. **The empty state must go into a dedicated, always-present
   container element — never over the table or its wrapper.** Concretely:
   - List: put `macEmptyState(...)` into `#srlUnavailableState` and add `d-none` to `#srlTableCard`.
     Never assign to `.card .table-responsive` or to any ancestor of `#srlTableBody`; the previous
     attempt destroyed `#srlTableBody` for the rest of the session that way, so a later Refresh
     rendered nothing. On a subsequent successful load, empty `#srlUnavailableState` and remove
     `d-none` from `#srlTableCard`.
   - Editor: put it into `#sreStateContainer` (a dedicated element, distinct from `#sreLoadingState`
     and `#sreContent`) and hide the other two. Never assign it into `#sreContent` or
     `#sreSectionsAccordion`.
   - Do not use `document.querySelector` with an unscoped selector such as `'.card .table-responsive'`
     anywhere in these modules: it can match another module's leftover markup. Address elements by
     their own ids.

## Deliverables

### 1. `WebPortal/modules/sales-reports/` (new module, replacing the old stub)

- `html/report_list.html`, `js/report_list_grid.js`, `css/sales_reports.css`
- `html/report_editor.html`, `js/report-metric-line.js`, `js/report_editor.js`

Global entry points (referenced verbatim by deliverable 4b — keep these names exactly):
`_salesReportList` + `initializeSalesReportList()`, `_salesReportEditor` +
`initializeSalesReportEditor()`, and `MacReportMetricLine` (deliverable 3).

`report-metric-line.js` exposes only `MacReportMetricLine.render`; it is not a place for shared
utilities. `report_list_grid.js` and `report_editor.js` therefore each define their own local
`isValidReportUuid` (identical body, constraint above). `report-metric-line.js` must never read an id
from the DOM or from `Session` — it uses `ctx.reportId` exactly as handed to it.

Delete `WebPortal/modules/sales-forecasting/` — it is a self-contained stub (nothing outside that
folder references `initializeSalesForecastingGrid` except the router case being repointed) whose only
data call, `dataFunctions.getSalesForecasts()` (`WebPortal/js/data-functions.js:4316-4318`),
hardcodes `return []`. Remove that stub function too. Do **not** edit `WebPortal/help/*`,
`docs/**` or `scripts/apply_user_guide_help_links.mjs`: those still describe "Sales Forecasting", and
correcting the user guide is a separate, human-reviewed action. Carrying the existing Help link
anchor (`help/index.html#sales-forecasting-grid`) into `report_list.html` unchanged is fine.

**Model the list screen on `WebPortal/modules/users/js/users_grid.js`** — it is this repo's
canonical hand-rolled pagination (`currentPage` :19, `itemsPerPage` :20, `setupEventListeners()`
re-run from `init()` :36, delegated click handler on `.pagination .page-link` :62). There is no
DataTables/AG-Grid here. Reuse `MacTableActions` (`WebPortal/js/table-actions.js`) for the row "⋯"
menu — call `MacTableActions.render({items: [...]})` for the cell and `MacTableActions.init(tableEl)`
**after** the rows are in the DOM, as `WebPortal/modules/scheduled-reports/js/scheduled_reports_grid.js:51,90`
does. Use `MacStatus.pill` for status and `macLoadingRow`/`macEmptyRow`/`macEmptyState`
(`WebPortal/js/ui-states.js:37-39`) for the three states.

List columns: Period label · Type (Weekly/Monthly) · Date range · Status pill · Completeness
(`override_count` of `metric_count` overridden) · Last generated · Actions (Open, Delete).
`list_report_instances` returns `total_count` on every row — drive pagination from that rather than
counting client-side. Row action items:

```js
var items = [{ label: 'Open', icon: 'fas fa-arrow-up-right-from-square',
               className: 'js-srl-open-report', dataAttrs: { 'report-id': r.id } }];
if (r.status === 'draft' && typeof hasAction === 'function' && hasAction('reports.report.delete')) {
    items.push({ label: 'Delete', icon: 'fas fa-trash', danger: true,
                 className: 'js-srl-delete-report', dataAttrs: { 'report-id': r.id } });
}
```

Labels stay static literals; keys stay kebab-case (constraints 1 and 6). The delegated handlers read
`$(this).attr('data-report-id')` and pass it through `isValidReportUuid` before doing anything.
Delete must confirm via `Swal`, call `deleteReportInstance`, and surface the RPC's own `error` (the
RPC refuses non-drafts).

**"New Report" modal.** A Bootstrap modal with a period-type radio (Weekly/Monthly) and a Flatpickr
date input. The static trigger button may carry `data-action-perm="reports.report.create"` plus
`data-bs-toggle="modal" data-bs-target="#srlNewReportModal"` (static markup, swept once; opening is
declarative so it does not depend on a JS bind); expect it to be hidden for non-admins until the
migration is applied. The `shown.bs.modal` handler (which initialises Flatpickr, resets the form and
loads template options) must be bound with jQuery `.off('shown.bs.modal').on('shown.bs.modal', …)`
inside `bindEvents()` so it survives the markup re-injection of constraint 5.

**Date handling — mandatory.** Every Flatpickr in this tree is configured `dateFormat: 'd/m/Y'`
(`modal_oil_dispatch_form.js:53`, `oil_production_grid.js:9`, `modal_receiving_checklist.js:9`, and
more), i.e. the input's `.value` is `dd/mm/yyyy`. `p_period_date` is a Postgres `date`: sending
`"17/08/2026"` errors (22008 — a *thrown* HTTP error, not the `success = 0` path), and `"05/03/2026"`
would silently create the **May 3** report instead of **3 March**. So:

- Initialise the picker with `{ dateFormat: 'd/m/Y', allowInput: false, disableMobile: true }`, and
  destroy any previous instance first (constraint 5, modelled on `modal_oil_dispatch_form.js:52-53`).
- Convert to ISO before the call with **exactly this helper, called with exactly these two
  arguments**:

  ```js
  // Local components only. Do NOT use toISOString(): the portal runs at UTC+2, so a local
  // midnight serialises as the PREVIOUS day in UTC and the report would be created for the
  // wrong period. Falls back to parsing the dd/mm/yyyy text.
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

  Call site: `var iso = toIsoDateFromPicker(dateInput && dateInput._flatpickr, dateInput);` — read the
  instance off the element, never from a module-level variable, and never call this helper with one
  argument. The dd/mm/yyyy text branch exists only for the case where Flatpickr failed to load; it is
  used at this one call site and nowhere else.
- Before calling `createReportInstance`, assert the result matches `/^\d{4}-\d{2}-\d{2}$/`; if not,
  show `Swal.fire({icon:'error', text:'Pick a valid date (dd/mm/yyyy).'})` and call nothing.
- Validate the selected template id with `isValidReportUuid` before calling; if it fails show
  `Swal.fire({icon:'error', text:'Choose a report template.'})` and call nothing.
- **Do not implement your own Monday-snapping.** Pass the ISO string as `p_period_date`; the server
  snaps it to the Monday or the 1st. If a report already exists for that period the RPC returns
  `success = 0` with a message naming the period — show it.

### 2. The editor screen

Header shows `period_label` (whitespace-normalised as above) and the raw `period_start`–`period_end`
dates beneath it. **The title is always derived from the payload, never a typed field** — Pete's
workbook had a sheet titled "November" whose own start/end dates read 1–31 October, and a generated
title cannot drift from the dates it describes.

A Bootstrap `.accordion` (`#sreSectionsAccordion`), one `.accordion-item` per section in
`display_order` order. Each header carries the section label (via `.text()` on a child element) and a
`form-check form-switch` toggle bound to `is_enabled` → calls
`setReportSectionState(reportId, sectionKey, isEnabled, undefined)`. Each body holds a metric table
plus a commentary `<textarea>` that saves on blur through
`setReportSectionState(reportId, sectionKey, undefined, text)`.

**Blur-save rules (both textareas):**
- Only call the RPC when the value actually changed from the value last loaded/saved for that field.
  Hold those baselines outside the DOM: a `Map` named `sectionCommentaryBaseline` keyed by
  `section_key` (a `Map`, because the keys come from the payload), and a plain string variable
  `executiveSummaryBaseline`. Update a baseline only after a successful save or a fresh load.
- Pass `undefined` — never `null` — for "leave this field unchanged"; `undefined` is stripped from
  the body under every flag combination, `null` is what `COALESCE` treats as unchanged, and `''` is
  what actually clears (see deliverable 4a).
- A cleared commentary must reach the server as `''` and must visibly stay cleared after the next
  read. A cleared executive summary must reach the server as `null` (which sets the column NULL).
- On `success = 0`, show `error` and restore the baseline text in the textarea so the screen never
  shows unsaved text as saved. Do the same on a thrown error.

Above the accordion, an executive-summary `<textarea>` (`#sreExecutiveSummary`) saving on blur via
`setReportExecutiveSummary`. It arrives pre-filled: `create_report_instance` copies the previous
period's summary forward so Pete edits rather than retypes. Its blur handler is bound in
`bindEvents()` with `.off('blur').on('blur', …)` and therefore re-bound on every visit (constraint 5)
— this was the silent data-loss bug on the previous attempt.

**Published reports are read-only.** When the report `status !== 'draft'`, render inputs as
`disabled`, hide the section toggles, and show a banner reading "Published <date> — figures are
locked. Use Re-issue to correct." Every edit RPC already refuses with "Only a draft report can be
edited." (`20260817100000:646-649,686-689`), so this is presentation; do not attempt to work around
it. Do not build the Re-issue action here — plan 02 owns it.

### 3. `report-metric-line.js` — the reusable metric row

Expose exactly one global: `MacReportMetricLine`, with

- `render(metric, ctx)` → returns a `<tr>` **DOM element** (built with `document.createElement` and
  `.text()`/`textContent`, never an HTML string except for the allowances listed in the security
  invariants), with its own blur handlers already bound;
- `ctx = { reportId: <uuid string>, status: <report status string>, onSaved: function (metricKey) {} }`.

`report_editor.js` must construct and pass `ctx` under **exactly these three property names** and
must call `MacReportMetricLine.render(metric, ctx)`. Do not rename them (`reportInstanceId`,
`readOnly`, `onChanged` are wrong). Derive read-only from `ctx.status !== 'draft'` inside the row.

Columns, in this order: **Description · System · Entered · Target · Achieved % · Status**.

- System cell: the formatted `system_value`, or the text "No system data" when it is `null`. These
  must look different — `null` means the database holds no figure, which is not the same as a real
  zero, and today every metric is `null`.
- Entered cell: an inline `<input type="number" step="any">` seeded from
  `entered_value != null ? entered_value : system_value` (empty when both are null), with
  `disabled` set when `ctx.status !== 'draft'`. **Not** a pencil button that opens a dialog.
- Target cell: formatted `target_value`, or "—".
- Achieved %: `effective_value / target_value` as a percentage, or "—" when `target_value` is null,
  zero or non-finite. **Guard the divide-by-zero** — `target_value` is frequently null until the
  targets screen exists.
- Status cell: `MacStatus.pill('overridden', 'Overridden')` when `is_overridden`, otherwise empty.
  The override reason and `overridden_by_name` may be shown as a tooltip/secondary line — via
  `.text()` / `.attr('title', …)` / `element.title = …` only.
- Set the row's own key with `tr.setAttribute('data-metric-key', String(metric.metric_key || ''))`.

**Blur flow on the Entered input.** Keep `lastSavedRaw` in the row's closure, seeded from the value
the input was rendered with, and updated on every successful save and on every revert. On blur:

```js
var raw = $input.val();
if (raw === lastSavedRaw) { return; }                 // nothing changed → call nothing
if (raw === '') {
    // Revert path. Only meaningful if the server currently holds an override.
    if (!metric.is_overridden) { $input.val(lastSavedRaw); return; }   // nothing to clear
    // → clearReportMetricOverride (below)
}
var value = Number(raw);
if (raw !== '' && !Number.isFinite(value)) {
    $input.val(lastSavedRaw);
    await Swal.fire({icon: 'error', text: 'Enter a number.'});
    return;                                            // save nothing
}
// A typed value equal to system_value means "revert to the system figure":
// if metric.is_overridden → clearReportMetricOverride; otherwise call nothing.
var result = await Swal.fire({
    title: 'Override figure',                          // static literal — never metric.label
    input: 'text',
    inputLabel: 'Reason for overriding this figure',
    inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
    showCancelButton: true
});
if (!result.isConfirmed) { $input.val(lastSavedRaw); return; }   // revert, save nothing
await dataFunctions.overrideReportMetricValue(
    ctx.reportId, metric.metric_key, value, result.value, dataFunctions.getCurrentUserId());
```

`Swal.fire` resolves to an object; `result.value` is the entered text and `result.isConfirmed` is the
button state. Cancelling must restore the input's previous value and call nothing.

**Never call `override_report_metric_value` with a non-finite value or a blank reason.**
`p_entered_value` and `p_reason` have no DEFAULTs (`20260817100000:533-534`), so a stripped one is a
thrown schema-cache error rather than the friendly `success = 0` message; the wrapper's
`preserveNullParams` keeps the names in the body as a backstop, but the client-side validation above
is the control. Clearing the input (or typing the system value) calls `clearReportMetricOverride`,
**not** the override RPC with null — the override RPC rejects a NULL value by design ("A value is
required. Use clear_report_metric_override to revert."). And do not call
`clearReportMetricOverride` when `metric.is_overridden` is false: there is nothing to clear and the
call is pure noise.

The server enforces the reason twice over (`NULLIF(TRIM(COALESCE(p_reason,'')),'')` →
"A reason is required when overriding a figure.", plus the
`report_metric_override_needs_reason` CHECK constraint), so the prompt is UX, not the control.

**After any successful metric write** (`success = 1`), the row calls
`if (typeof ctx.onSaved === 'function') ctx.onSaved(metric.metric_key);` and does nothing else — it
must **not** re-read the report itself, and must **not** trigger a whole-screen reload. On
`success = 0` it shows the RPC's `error` and restores `lastSavedRaw`.

**The re-read and partial re-render live in `report_editor.js`**, in a function named
`handleMetricSaved(metricKey)` which is what the editor passes as `ctx.onSaved`:

1. `var fresh = await dataFunctions.getReportInstance(state.reportId, true);` (force refresh —
   `effective_value`, `is_overridden`, `overridden_by_name` and `overridden_at` are server-computed).
2. Build a local `Map` named `freshMetricIndex` from `metric_key` → metric object across all
   sections of `fresh` (a `Map`, never a plain object — payload keys must not become property keys).
3. Look up `metricKey`; if absent, stop (leave the row as is).
4. Replace **only that row**: the editor keeps a `Map` named `metricRowIndex` (`metric_key` →
   `HTMLTableRowElement`) populated as rows are rendered. Take the old `<tr>` from `metricRowIndex`,
   build the new one with `MacReportMetricLine.render(freshMetric, ctx)` using the **same** `ctx`
   object, `oldTr.replaceWith(newTr)`, then `metricRowIndex.set(metricKey, newTr)`.
5. Update `state.report` to `fresh` and re-seed `sectionCommentaryBaseline` from it, but **do not
   touch any textarea's DOM value** — a save on one metric must not overwrite text Pete is mid-way
   through typing elsewhere.

Do not re-render the whole accordion on a blur, and do not call the editor's `load()` from a metric
write: that collapses every section back to "first open" and loses scroll position. `metricRowIndex`
is rebuilt from scratch (cleared, then repopulated) on every full `load()`/`renderSections()`.

### 4. Wiring

**4a. `WebPortal/js/data-functions.js` — transport change first, wrappers second.**

Add an opt-in flag so a param can be sent as an empty string. Default behaviour must be byte-for-byte
unchanged for every existing caller (the only three references to `buildPostgrestRpcBody` in the repo
are `data-functions.js:497` (definition), `:521` (`tryKernelRpcSupabaseFallback`, passes no options)
and `:602` (`callSupabaseRpc`); no test asserts on it — confirm with a grep before editing).

```js
// buildPostgrestRpcBody (line 497). New: preserveEmptyStrings. '' is otherwise stripped, which
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

- `callSupabaseRpc` (line 602):
  `scope.buildPostgrestRpcBody(params, { preserveNulls: options.preserveNullParams === true, preserveEmptyStrings: options.preserveEmptyParams === true })`
- `callFunction` (line 741-746):
  `{ useAnonAuth: true, preserveNullParams: options.preserveNullParams === true, preserveEmptyParams: options.preserveEmptyParams === true }`

`undefined` is still stripped in every case — that is what "leave unchanged" relies on.

Then remove `getSalesForecasts` and add the report wrappers. Use exactly these names and argument
orders; deliverables 1–3 reference them verbatim:

| Wrapper | Signature |
|---|---|
| `getReportTemplates` | `(periodType, token = null, forceRefresh = false)` |
| `getReportCurrentPeriod` | `(periodType, token = null, forceRefresh = false)` |
| `listReportInstances` | `(periodType, status, limit, offset, token = null, forceRefresh = false)` |
| `createReportInstance` | `(templateId, periodDateIso, token = null)` |
| `getReportInstance` | `(reportInstanceId, forceRefresh = false, token = null)` |
| `overrideReportMetricValue` | `(reportInstanceId, metricKey, enteredValue, reason, actorUserId, token = null)` |
| `clearReportMetricOverride` | `(reportInstanceId, metricKey, token = null)` |
| `setReportSectionState` | `(reportInstanceId, sectionKey, isEnabled, commentary, token = null)` |
| `setReportExecutiveSummary` | `(reportInstanceId, summary, token = null)` |
| `refreshReportInstance` | `(reportInstanceId, token = null)` |
| `deleteReportInstance` | `(reportInstanceId, token = null)` |

Rules for the wrappers, following the existing `callFunction(...)` style (see `upsertDashboardTarget`
at `data-functions.js:1655-1674` as the model, including its `preserveNullParams` comment and its
`clearCachePattern` call):

- **Reads** (`getReportTemplates`, `getReportCurrentPeriod`, `listReportInstances`,
  `getReportInstance`) pass an **explicit** `cacheKey`, `cacheTtl`, and honour a `forceRefresh`
  argument. The explicit key is mandatory: the default key is `functionName_JSON(params)`
  (`data-functions.js:640`), which the invalidation patterns below would not match. Prefixes:
  `report_list_` for `listReportInstances` (append `JSON.stringify` of the four params),
  `report_instance_` + the id for `getReportInstance`, `report_templates_` for `getReportTemplates`,
  `report_current_period_` for `getReportCurrentPeriod`. The last two are deliberately **not**
  invalidated by the write wrappers — templates and the current period are not changed by anything
  this screen writes.
- **Every write** (the other seven) passes `useCache: false`, `offlineOperation: false`, and then
  calls both `this.clearCachePattern('report_instance_')` and `this.clearCachePattern('report_list_')`.
  - `useCache: false` is not optional: `callFunction` caches by `cacheKey` and returns the cached
    value on a later identical call, so toggling a section off → on → off would see the third write
    served from cache and never sent to the server (`clearCachePattern` is substring-based,
    `data-functions.js:129-135`).
  - `offlineOperation: false` is not optional either: with the default (`data-functions.js:644`),
    when `navigator.onLine` is false `callFunction` queues any RPC whose name contains
    "create"/"update"/"delete" and returns `{ success: true, offline: true, queued: true }`
    (`:660-696`) without contacting the server. `create_report_instance` and
    `delete_report_instance` both match, so the UI would treat a queued no-op as a real create (and
    then try to open a report with an `undefined` id). Setting `offlineOperation: false` makes the
    call fail loudly into the `catch` instead. Callers must still require
    `Number(result.success) === 1 && result.queued !== true`.
- `overrideReportMetricValue` and `setReportExecutiveSummary` pass `preserveNullParams: true`
  (`p_entered_value`, `p_reason` and `p_summary` have no DEFAULTs and must always appear in the body).
- `setReportSectionState` passes `preserveEmptyParams: true`, takes `isEnabled` and `commentary`
  where `undefined` means "leave unchanged", and must document that `''` clears while `null` does
  not. It is the **only** wrapper that passes `preserveEmptyParams`.
- `setReportExecutiveSummary` normalises its argument:
  `var text = (typeof summary === 'string' && summary.trim() !== '') ? summary : null;` — the raw
  text when non-blank (preserving internal newlines), `null` when blank.
- `createReportInstance` takes an already-ISO `p_period_date` string; it must not do any date
  parsing of its own, and must not set `preserveNullParams` (a preserved null `p_period_date` would
  reach the function and raise instead of being caught client-side).
- Actor ids come from `dataFunctions.getCurrentUserId()` (`data-functions.js:248-254`), which returns
  `null` when unknown. Never fabricate one, and do not substitute `Session.getUserId()` — use
  `getCurrentUserId` for consistency with every other write path in this file.
- `getReportCurrentPeriod` is added for completeness of the RPC surface; **neither screen in this
  plan calls it.** Do not wire a date prefill from it — that would add an ISO→dd/mm/yyyy conversion
  this plan does not need. Always pass an explicit `'weekly'` or `'monthly'` to
  `getReportTemplates`/`getReportCurrentPeriod`; never call them with null.
- `create_report_instance`, `override_report_metric_value`, `set_report_section_state`,
  `set_report_executive_summary`, `refresh_report_instance`, `clear_report_metric_override`,
  `delete_report_instance` and `list_report_instances` all return `RETURNS TABLE`, which PostgREST
  serialises as an array; `get_report_instance` returns a bare `jsonb`. Unwrap the single-row ones
  with `Array.isArray(raw) ? raw[0] : raw` and leave `get_report_instance` /
  `list_report_instances` / `get_report_templates` as returned.

**4b. `WebPortal/js/appRouteConfig.json`** — repoint `sales-forecasting-grid` at
`path: "sales-reports"`, `html: "html/report_list.html"`, js `["js/report_list_grid.js"]`,
css `["css/sales_reports.css"]`; keep its `description` a "Sales …" string (it is used for
breadcrumbs). Add `sales-report-editor` with `path: "sales-reports"`,
`html: "html/report_editor.html"`, css `["css/sales_reports.css"]`, and js **in this order**:
`["js/report-metric-line.js", "js/report_editor.js"]` — `loadJSCode` loads sequentially
(`appRouter.js:787-808`), so `MacReportMetricLine` must be listed first, and `report_editor.js` must
still guard with `typeof MacReportMetricLine !== 'undefined'` before rendering a metric table. Keep
JSON valid — `npm run registry:verify` fails on a path that does not exist on disk, and
`routing:verify` also `JSON.parse`s this file (`scripts/verify-routing-guarantee.cjs:39`).

**4c. `WebPortal/js/appRouter.js`** — repoint the existing `'sales-forecasting-grid'` case (line 433)
to `initializeSalesReportList()` and add a `'sales-report-editor'` case calling
`initializeSalesReportEditor()`, both in the `if (typeof X === 'function') X();` shape of the
neighbouring cases.

**4d. `WebPortal/index.html`** — relabel the existing `businessCollapse` item (lines 274-278) to
"Sales &amp; Production Reports" with `<i class="fas fa-file-invoice me-2">` and
`title="Sales & Production Reports"`. **Keep `data-route` and `route` as `sales-forecasting-grid`**
(constraint 1). Add no sidebar item for the editor — it is reached by button only. Font Awesome 6.4.0
is loaded (`index.html:22`), so FA6 icon names (`fa-file-invoice`, `fa-triangle-exclamation`,
`fa-rotate-left`, `fa-arrow-up-right-from-square`) are valid; Bootstrap Icons are banned by
`ui:verify`.

**4e. `WebPortal/js/role-menu-config.js`** — update the `'sales-forecasting-grid'` entry
(lines 395-401) so `label` reads `'Sales & Production Reports'` and `icon` is `'fas fa-file-invoice'`,
matching `index.html`. That entry is the label fallback used when the sidebar DOM is unavailable
(`getPortalModuleLabel`, `role-menu-config.js:455-489`), so leaving it stale shows the old name in
those surfaces. Change nothing else in this file:
- Do **not** add `sales-report-editor` to `menuStructure`: `getAccessibleMenus` returns
  `Object.keys(menuStructure)` for admins (`:638`) and `menu-filter.js` drives sidebar visibility
  from those keys, and the editor has no sidebar item — modal-style routes are absent from
  `menuStructure` for the same reason.
- Do **not** touch `portalModuleOrder` (`:494-527`); it lists route keys, and the key is unchanged.
- Do **not** touch the `'PWA Sales'` fallback list (`:167-177`) or any role's `menus` array in
  `menuConfig`.

**4f. A migration** adding the `features` / `role_features` / `actions` / `role_actions` rows,
modelled on `migrations/20260812100000_crm_whatsapp_module.sql:542-599` for the insert idiom and the
real column names (`features(key, name, description)` with `key` UNIQUE —
`20260302000001_create_features_tables.sql:6-8`; `actions(key, module, label, description)` where
`module` is NOT NULL with no default — `20260602100000_create_actions_tables.sql:11-14`). Name the
file with a UTC timestamp prefix later than `20260817100000`.

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
- **Inserts only, and every statement must be `ON CONFLICT … DO NOTHING`.** "Inserts only" means: no
  statement may alter or remove a row this migration does not itself introduce, and no statement may
  overwrite an existing row at all. Concretely, the new `features` row uses
  `ON CONFLICT (key) DO NOTHING` — **not** `DO UPDATE SET name/description/updated_at`. The model
  file does use `DO UPDATE` at `:555-558`; deliberately diverge from it here and match
  `20260302000003_seed_features.sql:34` instead, so that a human reading the diff can see the
  migration cannot change anything that already exists. No `UPDATE`, no `DELETE`, no changes to any
  other role's rows.
- **Do not loop over every role**, and do **not** add anything to
  `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql`; `CLAUDE.md:34-39` records
  that pattern as the cause of the current permission drift.
- **Do not add a `role_permissions` seeding block and do not issue any `GRANT EXECUTE`.** The model
  file has both (`:601-647`), but its `role_permissions` block loops over every role — which this
  plan forbids — and this migration creates no new functions: `GRANT EXECUTE` and `role_permissions`
  rows for every report RPC already exist in `20260817090000:749-772` and
  `20260817100000:1260-1306`. There is nothing left to grant. End the file with
  `NOTIFY pgrst, 'reload schema';` following the repo idiom.
- Header comment must record, as the reason a human should read it before applying:
  - that the screen behind the existing `sales-forecasting-grid` key changes from "Sales
    Forecasting" (a dead stub) to the director report list;
  - that the list RPC (`list_report_instances`) returns **metadata and counts only, no metric
    figures**, and that every figure is behind the new `sales-report-editor` feature key;
  - that **the current membership of `sales-forecasting-grid` in `role_features` was not verifiable
    when this migration was written** (no database access from the authoring environment). State
    only the in-repo evidence (`20260302000003_seed_features.sql:8-34,45-49,118-127`;
    `role-menu-config.js:167-177`). Do **not** write any sentence asserting what is or is not
    currently granted — e.g. "It was never granted to 'Sales Exec' or 'Palladium Manager'" is
    forbidden, because nothing in this checkout can establish it;
  - that `admin`/`super_user` bypass the feature check in code (`role-menu-config.js:607-610`), so
    their rows are belt-and-braces;
  - that users must sign out and back in after this is applied, because `featureKeys`/`actionKeys`
    are cached at login.
- **You cannot apply this migration** — the fleet has no database credentials. Author the file only,
  claim nothing about it having been applied, and rely on the fallback in "Degradation" §2 for the
  interim state.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. This is the gate. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`
   (`package.json:27`).
   - `ui:verify` is the likely failure for a new module: no raw hex in CSS outside
     `WebPortal/css/design-tokens.css` (use `--mac-*` tokens), no `var(--phoenix-*)`/legacy vars,
     Font Awesome only (no `bi bi-`), `btn-primary` not `btn-success`, no `linear-gradient`, no
     `.swal2-*` rules outside `css/swal-theme.css`, no bare `td`/`th` padding in module CSS, no
     `min-width` on `.badge`.
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
5. `grep -rn "\.html(\|innerHTML" WebPortal/modules/sales-reports/js/` — review every hit and confirm
   each is a static literal, a `MacStatus.pill(...)` result, or a
   `macLoadingRow`/`macEmptyRow`/`macEmptyState` result. No database or user text may appear.
   `grep -rn "title:\|html:" WebPortal/modules/sales-reports/js/` — every Swal `title:`/`html:` is a
   static literal with no `+`.
6. `grep -n "preserveEmptyStrings\|preserveEmptyParams" WebPortal/js/data-functions.js` shows the
   flag threaded in exactly three transport places (`buildPostgrestRpcBody`, `callSupabaseRpc`,
   `callFunction`) plus **exactly one** wrapper call site — `setReportSectionState`. No other report
   wrapper passes it.
7. `grep -c "canOpenReportEditor" WebPortal/modules/sales-reports/js/report_list_grid.js` is at
   least 3 (definition + the "Open" call site + the post-create call site), **and**
   `grep -n "roleMenuConfig.hasAccess('sales-report-editor')" WebPortal/modules/sales-reports/js/report_list_grid.js`
   returns exactly one hit inside `canOpenReportEditor`. Both checks must pass: the count alone
   passed last time on a wrong implementation. `grep -n "function canOpenReportEditor()" …` shows the
   zero-argument form, and `grep -n "isValidReportUuid" …` shows the separate uuid helper used at
   both navigation sites and in the delete handler.
8. `grep -rn "toISOString" WebPortal/modules/sales-reports/js/` returns nothing.
   `grep -n "useCache: false" WebPortal/js/data-functions.js | grep -ci report` and
   `grep -n "offlineOperation: false" WebPortal/js/data-functions.js | grep -ci report` are both
   **7** (one per write wrapper: create, override, clear, section-state, executive-summary, refresh,
   delete).
9. `grep -rn "sales-forecasting-grid" "Playwright Tests/"` output is unchanged from the base branch
   (no file under `Playwright Tests/` edited at all).
10. `grep -rn "dataAttrs" WebPortal/modules/sales-reports/js/` shows only kebab-case keys
    (`'report-id'`); `grep -rniE "dataAttrs: *\{ *[a-z]+[A-Z]" WebPortal/modules/sales-reports/js/`
    returns nothing. Every `data-*` attribute the modules read back is spelled identically to the one
    written.
11. `grep -rn "bound\b" WebPortal/modules/sales-reports/js/` returns nothing (no one-shot bind flag),
    and `grep -n "bindEvents" WebPortal/modules/sales-reports/js/report_list_grid.js` /
    `… report_editor.js` each show the definition plus one **unconditional** call from `init()`.
    `grep -rn "\.on(" WebPortal/modules/sales-reports/js/` — every jQuery bind is preceded by a
    matching `.off(...)` with the same event (and the same selector, for delegated binds on
    `document`).
12. `grep -n "onSaved\|reportId\|status" WebPortal/modules/sales-reports/js/report-metric-line.js`
    and the corresponding `ctx` literal in `report_editor.js` use the same three property names;
    `grep -rn "reportInstanceId\|readOnly\|onChanged" WebPortal/modules/sales-reports/js/report-metric-line.js`
    returns nothing. `grep -n "getReportInstance\|load()" WebPortal/modules/sales-reports/js/report-metric-line.js`
    returns nothing (the row never re-reads or reloads), and `grep -n "new Map(" WebPortal/modules/sales-reports/js/report_editor.js`
    shows `metricRowIndex`, `sectionCommentaryBaseline` and the local `freshMetricIndex`.
13. `grep -rn "table-responsive\|querySelector('\." WebPortal/modules/sales-reports/js/` shows no
    error path writing over the table or its wrapper; the failure states target
    `#srlUnavailableState` / `#sreStateContainer` only.
14. `grep -nE "DO UPDATE|^\s*UPDATE|^\s*DELETE|GRANT EXECUTE|FOR .* IN SELECT id FROM public.roles" migrations/<new file>.sql`
    returns nothing, and `grep -c "DO NOTHING" migrations/<new file>.sql` matches the number of
    INSERT statements.

**Do not add a "verify before finishing" step that needs a browser, a logged-in session, a
screenshot, a database, or the deployed demo site.** Playwright here runs against
`https://demo-macavation.customapp.org` (`Playwright Tests/playwright.config.ts:30`) and cannot run
inside the fleet job. Adding new Playwright spec files is out of scope for this attempt — do not add
or edit anything under `Playwright Tests/`.

## Out of scope

PDF generation, publish/re-issue, the targets admin screen, the sales Excel import, the metric
resolvers, chart rendering, applying any migration, editing `WebPortal/help/*` or `docs/**`, editing
or adding any Playwright spec or helper, editing `BluePrint/**`, editing shared helpers
(`table-actions.js`, `mac-status.js`, `ui-states.js`, `action-access.js`, `session.js`) other than the
scoped `data-functions.js` change in 4a, and changing `permission-module-map.js`,
`role-menu-config.js`'s `portalModuleOrder`/`menuStructure` membership, or any role's
`menuConfig.menus` array.
