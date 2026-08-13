---
depends_on: report-builder-01a-data-functions-transport.md
retry_of: d2a97ccc-9403-4119-bee0-d7e3899efabc
---

# Report builder — the report list screen

## Context

Third of four small plans replacing `report-builder-01-list-and-editor.md`, which was blocked twice
for being too large. This one builds **one screen**: the list of weekly and monthly reports, with a
"New Report" action. The editor those reports open into is the next plan and is out of scope here.

It waits on `report-builder-01a-data-functions-transport.md` for two reasons: it calls the wrappers
that plan adds (`listReportInstances`, `createReportInstance`, `getReportTemplates`,
`getReportCurrentPeriod`, `deleteReportInstance`), and both plans edit
`WebPortal/js/data-functions.js`, which would otherwise be a real merge conflict.

That prerequisite was blocked on its first run and has been auto-amended to
`report-builder-01a-data-functions-transport.retry-1.md`. A merged retry satisfies this plan's
`depends_on`, so no change to the dependency is needed — but **do not start this plan until those
wrappers are actually present in `WebPortal/js/data-functions.js` in your checkout.** If they are
absent, stop and report rather than adding them here; adding them in both plans is exactly the merge
conflict the dependency exists to prevent. (In the tree this plan was written against they are
present at `WebPortal/js/data-functions.js:5908-6075`; re-grep rather than trusting that range.)

The RPCs are defined in `migrations/20260817090000_report_builder_foundations.sql` and
`migrations/20260817100000_report_instances_and_targets.sql`, both in this checkout. **Whether those
migrations have been applied to any database cannot be verified from this checkout — do not state or
assume that they have.** The screen must degrade gracefully when they have not.

Background on why this feature exists is in `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`.
**Do not copy that document's counts or percentages into code comments, UI copy or commit
messages** — they come from database queries this run cannot re-execute. Reference the path and
nothing more.

## FIXED constraints — do not change these

1. **Reuse the existing route key `sales-forecasting-grid`, and keep its sidebar `<li>` inside
   `businessCollapse`.** Three test sites depend on it:
   - `Playwright Tests/user-management/role-screen-access.spec.ts` lines 29, 35, 40, 45, 49, 58, 64,
     69 — route key only, no content assertion.
   - `Playwright Tests/helpers/navigation.helper.ts:53-56` — resolves
     `linkSelector: 'a[route="sales-forecasting-grid"]'` with
     `collapseIds: ['supportCollapse', 'businessCollapse']`.
   - `Playwright Tests/auth/rbac.spec.ts:101` — **this one asserts page content**:
     `expect(page.locator('#content-area')).toContainText(/Sales|Forecast|Dashboard/)`. The new
     screen's visible heading **must contain the word "Sales"**; the specified label
     "Sales &amp; Production Reports" satisfies it.

   Two further Playwright files also name this route key —
   `Playwright Tests/helpers/user-guide-screenshot-routes.ts:35` and
   `Playwright Tests/fixtures/test-data.fixture.ts:385` (`expected_dashboard: '/sales-forecasting'`).
   Both are key/path strings, not content assertions; because the route key is unchanged, **neither
   needs editing.** Leave them alone.

   **Do not edit any spec, helper or fixture file under `Playwright Tests/`** to accommodate this
   change. Introducing a new route key, or moving the item out of `businessCollapse`, breaks them.
   `WebPortal/modules/admin/js/permission-module-map.js:57` also maps this key to the
   `sales-forecasting` permission slug — leave that file alone. It groups database permissions by
   `object_name` text, not by folder, so deleting the module folder does not affect it.
2. **A route needs an entry in BOTH `WebPortal/js/appRouteConfig.json` AND the hardcoded
   `initializeModule()` switch in `WebPortal/js/appRouter.js`.** The existing
   `'sales-forecasting-grid'` case is at **`WebPortal/js/appRouter.js:433`**, and its body calls a
   **global function, not a module object**:

   ```js
   'sales-forecasting-grid': () => {                          // appRouter.js:433
       if (typeof initializeSalesForecastingGrid === 'function') {   // :434
           initializeSalesForecastingGrid();                        // :435
       }
   },
   ```

   `initializeSalesForecastingGrid` is defined at
   `WebPortal/modules/sales-forecasting/js/sales_forecasting_grid.js:105` — the file this plan
   deletes. So the case body **must** be repointed at the new module's own init global,
   `initializeReportListGrid` (deliverable 1), or the route silently renders nothing. Re-grep the
   line numbers before editing rather than trusting them. A route registered in only one of the two
   files silently renders nothing.

   **Do not use `.claude/worktrees/**` as evidence for any line number.** That directory holds stale
   checkouts of this repo, and their copies of `appRouter.js` and the module files differ from the
   live tree — an earlier revision of this plan cited a line number taken from one of them and was
   wrong. Only `WebPortal/**` at the repo root is live.
3. **No deep-linking.** The router never reads the URL (`CLAUDE.md:41-43`). Pass the selected report
   id to the editor via `Session.set('currentReportId', id)` (`WebPortal/js/session.js:74-82`), not a
   query string or hash, and guard the call the way existing modules do
   (`typeof Session !== 'undefined' && Session.set` — see
   `WebPortal/modules/modals/modal-user/js/modal_user.js:168`). `_appRouter.routeParams` exists but
   is only a breadcrumb-label store — `initializeModule` is called as `initializeModule(routeName)`
   with no params (`appRouter.js:252`), so the id cannot be passed as an argument.
4. **`data-action-perm` is swept once over static markup only** (`CLAUDE.md:29-32`; the sweep is
   `actionAccess.apply(...)` at `appRouter.js:253-256`, 100 ms after load). It is inert on
   anything rendered afterwards. For dynamically rendered rows use the prevailing module idiom
   `typeof hasAction === 'function' && hasAction('<key>')` inline at render time (`window.hasAction`
   is defined at `action-access.js:95`). **Never call it with an empty key** — `has('')` returns
   `true` (`action-access.js:44`).
5. **Do not register the `sales-report-editor` route here.** Its files do not exist yet and
   `npm run registry:verify` (`scripts/verify-registry-paths.mjs`) fails on any `html`/`js`/`css`
   path in `appRouteConfig.json` that is missing on disk. The next plan registers it.
6. **Never edit a file to make a verification command's expected output come true.** Every count in
   the Verification section is a fact about the base tree plus this plan's prescribed edits. If a
   count does not match, **stop and report** — do not delete, move or rename a line to satisfy it.

## Security invariants

This screen renders database text. `BluePrint/javascript-jquery-rules.md` is what the review gate
checks against.

- **Never pass database or user-entered text through `.html()`, `innerHTML`, or string
  concatenation into markup.** Build the element, then set its text with `.text()`. This covers
  every period label, template name and status value. Numbers may be formatted and concatenated only
  after `Number()` conversion.
- **Validate the report uuid read from a `data-*` attribute before using it in an RPC call**, with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, and abort if it fails. A
  truthiness check is not validation. Use the single helper `isReportUuid(value)` (deliverable 1) for
  this, at every site that puts an id into an RPC call or into `Session`.
- **Helper escaping is not uniform — check before you feed a helper database text.** Verified in this
  checkout: `macLoadingRow` / `macEmptyRow` / `macEmptyState` escape their arguments
  (`ui-states.js:12-35`), and `MacStatus.pill` escapes its label (`mac-status.js:50-64`), so both may
  be used with `.html()`/`innerHTML`. **`MacTableActions.renderItem` does NOT escape `item.label` or
  `item.href` (`table-actions.js:39,45`)** — row-action labels must be literal static strings
  ("Open", "Delete"). Never pass a template name, period label, status or any other database text as
  a `MacTableActions` item label, `href`, or `item.html`.
- **SweetAlert2: use `text:` for any server-supplied string, never `html:`.** SweetAlert2 escapes
  `text` and does not escape `html`.
- Never use a value from the payload as an object property key without first rejecting `__proto__`
  and `constructor`. Prefer a `Map`.
- `JSON.parse` only inside `try/catch`. No `eval`, no `new Function`, no string-form `setTimeout`.

## RPC contracts — read from the migrations in this checkout, do not work from memory

These are the shapes the screen must code against (verified against the migration files named above):

- `list_report_instances(p_period_type, p_status, p_limit, p_offset)` →
  `RETURNS TABLE (id, template_id, template_name, period_type, period_start, period_end,
  period_label, fy, version, status, section_count, override_count, metric_count, generated_at,
  published_at, pdf_storage_path, total_count)`
  (`20260817100000_report_instances_and_targets.sql:959-983`). `p_limit` is capped server-side at
  `LEAST(COALESCE(p_limit,50),100)`, so never request more than 100.
- `get_report_templates(p_period_type)` → `RETURNS TABLE (id, code, name, period_type)`
  (`20260817090000_report_builder_foundations.sql:581-587`), capped at 50 rows.
- `get_report_current_period(p_period_type)` → `RETURNS TABLE (period_type, period_start, period_end,
  fy, fy_month_index, period_label)` (`20260817090000_report_builder_foundations.sql:144-152`). Its
  own comment states it **returns no rows for an unknown period type**, so the modal must treat an
  empty result as "no default date" and still open, not throw.
- `create_report_instance(p_template_id, p_period_date, p_actor_user_id)` →
  `RETURNS TABLE (success integer, error text, report_instance_id uuid)`
  (`20260817100000_report_instances_and_targets.sql:386-391`).
- `delete_report_instance(p_report_instance_id)` → `RETURNS TABLE (success integer, error text)`
  (`20260817100000_report_instances_and_targets.sql:927-928`).

Three consequences that are **mandatory**, not stylistic:

1. **The failure text is in a column named `error`, not `message`.** Read `row.error`. Do not read
   `row.message` for these two RPCs — it does not exist, and falling back to an invented string
   violates the "show the server's message" requirement below.
2. **A `RETURNS TABLE` RPC may arrive as a bare object or as an array of row objects.** This repo
   already handles both shapes explicitly (`admin_grid.js:1019-1021`,
   `role-features_grid.js:274-279`). Normalise once through `firstRpcRow(result)` (deliverable 1)
   instead of indexing blind.
3. **Both write wrappers can return an offline-queue envelope instead of an RPC result.**
   `callFunction` queues any function name containing `create`/`delete` while offline and returns
   `{ success: true, offline: true, queued: true, message: 'Request queued for sync when online' }`
   (`data-functions.js:671-710`, and the wrappers' own comments at `:5959-5961` and `:6069-6071`).
   Note `success` there is boolean `true`, so any numeric success test would read it as a successful
   create. **At BOTH the create and the delete call site, test `isQueuedOffline(result)` FIRST, before
   looking at `success` at all.** Existing precedent for this ordering: `data-functions.js:3384-3385`
   and `:3438-3439`.

## Deliverables

### 1. `WebPortal/modules/sales-reports/`

New files: `html/report_list.html`, `js/report_list_grid.js`, `css/sales_reports.css`.

**Model the screen on `WebPortal/modules/users/js/users_grid.js`** — this repo's canonical
hand-rolled pagination (`itemsPerPage`, `currentPage`, manual slice, Bootstrap `.pagination` markup,
click handler on `.pagination .page-link`). There is no DataTables or AG-Grid here. Reuse
`MacTableActions` (`WebPortal/js/table-actions.js`) for the row "⋯" menu, `MacStatus.pill`
(`WebPortal/js/mac-status.js`) for status, and `macLoadingRow` / `macEmptyRow` / `macEmptyState`
(`WebPortal/js/ui-states.js`) for the three states. Follow the module conventions in
`BluePrint/javascript-jquery-rules.md`: IIFE, `init()` and `destroy()`, namespaced events, cached
`$`-prefixed selectors, init call at the bottom of the file.

**Three defects in the model file must be overridden, not copied** (verified in this checkout):

- `users_grid.js` has **no `destroy()`** and binds four **unnamespaced** delegated handlers on
  `$(document)` (`users_grid.js:62, 80, 86, 92`), which therefore cannot be removed when the SPA
  swaps `#content-area`. In the new module, delegate from the module's own container element and
  namespace every binding `.salesReports`; `destroy()` must call `.off('.salesReports')` on
  everything it bound (and `$(document).off('.salesReports')` if any document-level delegation is
  unavoidable).
- `users_grid.js` auto-inits at the bottom (`:381-383`) **and** is init'd again by the router
  (`appRouter.js:276-279`), so it double-binds. Make `init()` **idempotent**: it must call
  `_reportListGrid.destroy()` as its first step, so a second invocation cannot double-bind.
- `users_grid.js` builds row HTML by concatenating raw payload values. Do not copy that; obey the
  Security invariants above.

Module shape and the exact identifiers later sections depend on:

- `var _reportListGrid = function () { ... }();` with `init`, `destroy`, and the render/paginate
  members.
- `function initializeReportListGrid() { ... _reportListGrid.init(); }` at the bottom of the file,
  invoked once via `$(document).ready(...)`. **This is the global name constraint 2 and deliverable 4
  repoint the router case at — spell it exactly this way in both files.**
- `function displayLabel(value)` — the only way any label reaches the DOM:
  `return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();`
- `function isReportUuid(value)` — the uuid regex from the Security invariants, returning a boolean.
- `function firstRpcRow(result)` — `Array.isArray(result) ? (result[0] || null) : (result && typeof result === 'object' ? result : null)`.
- `function isQueuedOffline(result)` — `!!(result && result.offline === true && result.queued === true)`.
- `function pickerDateToIso(dateStr)` — see deliverable 2.
- `function canOpenReportEditor()` and `function reportEditorRouteExists()` and
  `function openReportEditor(reportId)` — see deliverable 3.

Columns: Period · Type (Weekly/Monthly pill) · Date range · Status pill · Overridden
(`override_count` of `metric_count`) · Generated · Actions (Open, Delete).

`listReportInstances` returns `total_count` on every row — drive pagination from that, not from a
client-side count. Convert it with `Number()` before arithmetic.

**Label whitespace.** `period_label` may contain internal blank padding:
`migrations/20260817090100_fix_report_period_label_padding.sql` exists precisely because
`report_period_label` produced `"August    2026 (FYE 2027)"`, and whether that fix has been applied
to any given database is unknowable from here. Every label displayed goes through `displayLabel`:
`$el.text(displayLabel(row.period_label))`. Never synthesise a label locally — the title always comes
from the server.

**Delete** shows a `Swal` confirm, validates the row's id with `isReportUuid` (abort if it fails),
then calls `deleteReportInstance`. Handling order, exactly:

1. `if (isQueuedOffline(result))` → `Swal.fire({icon:'info', title:'Delete queued', text:'You are offline. The delete will be sent when the connection returns.'})`, then refresh the list. **Do not
   remove the row optimistically** — nothing has been deleted yet.
2. Otherwise `var row = firstRpcRow(result);` and treat `Number(row && row.success) === 1` as success.
3. On failure, show `row && row.error` via `Swal.fire({icon:'error', title:'Could not delete report', text: <that string>})`. The RPC refuses anything that is not a draft with
   `"Only a draft report can be deleted. Published reports are kept."`
   (`20260817100000_report_instances_and_targets.sql:942`) — **show the server's `error` text rather
   than inventing one**; only if `error` is missing or blank use a generic
   `'Could not delete the report.'`.

Gate the row action with `hasAction('reports.report.delete')` inline (the key exists verbatim at
`migrations/20260817110000_report_builder_rbac.sql:86`).

CSS: `--mac-*` tokens only (`WebPortal/css/design-tokens.css`), no raw hex, no `linear-gradient`, no
`.swal2-*` rules, no bare `td`/`th` padding, no `min-width` on `.badge`, Font Awesome icons only,
`btn-primary` not `btn-success` — these are what `npm run ui:verify`
(`scripts/verify-ui-standard.mjs`) enforces.

### 2. New Report

A Bootstrap modal: period type radio (Weekly / Monthly) and a Flatpickr date input, defaulting to
the current period from `getReportCurrentPeriod`. Template id comes from `getReportTemplates`
filtered to the chosen period type; if that returns no template for the chosen period type, disable
the submit and show an inline message rather than calling `createReportInstance` with an empty id.

**Date handling — model the existing repo idiom, do not invent one.** Flatpickr is loaded globally
from `WebPortal/index.html:29,558`. Use the prevailing constant and converter shape, e.g.
`WebPortal/modules/modals/modal-stock-receiving-checklist/js/modal_receiving_checklist.js:9-17`:

```js
var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };

// Local dd/mm/yyyy -> yyyy-mm-dd by string split only. No Date arithmetic, no UTC conversion.
function pickerDateToIso(dateStr) {
    var s = String(dateStr == null ? '' : dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return null;
    var p = s.split('/');
    return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0');
}
```

Pass `pickerDateToIso(...)` straight to `createReportInstance` as `p_period_date`; abort with a
validation message if it returns `null`. **Do not implement Monday-snapping in JavaScript** — the
server snaps to the Monday or the 1st (`report_normalise_period_start`, called at
`20260817100000_report_instances_and_targets.sql:414`).

**Do not use `toISOString()` anywhere in this module** — it converts to UTC and can shift the date
across a day boundary for a South African user.

Result handling, in this order:

1. `if (isQueuedOffline(result))` → `Swal.fire({icon:'info', title:'Report queued', text:'You are offline. The report will be created when the connection returns.'})`, refresh the list, and **do not
   navigate to the editor** (no report id exists yet).
2. Otherwise `var row = firstRpcRow(result);`. If `Number(row && row.success) === 1`, refresh the
   list, then call `openReportEditor(row.report_instance_id)` (deliverable 3).
3. If not successful, show `row && row.error` via `Swal.fire({icon:'error', title:'Could not create report', text: <that string>})` — the RPC names the period in that string
   (`…:420-424`) and also returns `'Unknown or inactive report template.'` and
   `'A date within the reporting period is required.'`. Display the server text; only if `error` is
   missing or blank use a generic `'Could not create the report.'`.

Gate the button with `data-action-perm="reports.report.create"` (it is static markup, so the sweep
covers it; the key exists verbatim at `migrations/20260817110000_report_builder_rbac.sql:84`).

### 3. Degradation — this screen must work before the RBAC migration is applied

1. **Editor navigation guard.** Define once in `report_list_grid.js`:

   ```js
   // Mirrors appRouter.js:137-138 exactly. The router only runs its own hasAccess gate when
   // roleMenuConfig exists AND getUserRole() is truthy; a looser check here would block a
   // navigation the router would have allowed. roleMenuConfig.hasAccess returns a strict
   // boolean (role-menu-config.js:603-628), so `=== true` matches the router's truthiness test.
   function canOpenReportEditor() {
       if (typeof roleMenuConfig === 'undefined' || !roleMenuConfig.getUserRole()) return true;
       return roleMenuConfig.hasAccess('sales-report-editor') === true;
   }
   ```

2. **The editor route may not be registered yet** (the next plan adds it), and an `admin` or
   `super_user` bypasses `hasAccess` by role name (`role-menu-config.js:607-610`), so the guard above
   will not stop them. Use the router's own registry — the lookup, read from the live tree, is
   `_appRouter.routeConfig[routeName]` (`appRouter.js:193-200`), populated from
   `appRouteConfig.json`'s `appRoutes` at `appRouter.js:894`; `_appRouter` is a global declared at
   `appRouter.js:1`. Do not invent any other API. Keep those citations in the code comment:

   ```js
   // Router's own registry lookup: appRouter.js:193 reads _appRouter.routeConfig[routeName]
   // (populated at appRouter.js:894 from appRouteConfig.json "appRoutes"); a missing entry makes
   // loadContent fail with "no route config found" (appRouter.js:195-199). Treating an
   // unavailable registry as "absent" is the fail-closed direction for navigation.
   function reportEditorRouteExists() {
       return !!(typeof _appRouter !== 'undefined' && _appRouter.routeConfig &&
                 _appRouter.routeConfig['sales-report-editor']);
   }
   ```

3. **One funnel, consulted from both navigation points.** Define:

   ```js
   function openReportEditor(reportId) {
       if (!canOpenReportEditor() || !reportEditorRouteExists()) {
           Swal.fire({icon:'info', title:'Report editing not enabled', text:'Report editing has not been enabled for your role yet. An administrator must apply the report-builder permissions migration, then sign out and back in.'});
           return false;
       }
       if (!isReportUuid(reportId)) {
           // Distinct from the message above on purpose: this is a data fault, not a permissions
           // or migration state, and must not be reported as one.
           console.warn('[sales-reports] refusing to open editor for invalid report id');
           Swal.fire({icon:'error', title:'Could not open report', text:'That report could not be opened. Refresh the list and try again.'});
           return false;
       }
       if (typeof Session !== 'undefined' && Session.set) Session.set('currentReportId', reportId);
       _appRouter.routeTo('sales-report-editor', true);   // appRouter.js:556
       return true;
   }
   ```

   `openReportEditor` must be the **only** code path in this module that calls
   `_appRouter.routeTo('sales-report-editor', ...)`. It is called from exactly two places: the row
   "Open" action, and the successful-create path in deliverable 2. On the create path the list is
   refreshed **before** calling it, so the new draft is visible even when navigation is refused.

4. **Missing RPCs must not white-screen the module.** If a report RPC is absent from the target
   database, `callFunction` throws. Wrap every call in `try/catch`, log with `console.warn`, and
   render `macEmptyState('fa-file-invoice', 'Reports are not available yet', 'The report-builder migrations have not been applied to this database.')`
   rather than leaving a spinner running.

### 4. Wiring and removal of the old stub

- `WebPortal/js/appRouteConfig.json`: repoint the existing `sales-forecasting-grid` entry
  (currently at `:640-650`) to `path: "sales-reports"`, `html: "html/report_list.html"`, js
  `["js/report_list_grid.js"]`, css `["css/sales_reports.css"]`, **and update its
  `"description"` (currently `"Sales Forecasting"` at `:641`) to
  `"Sales &amp; Production Reports"`.** The `description` is a third copy of this route's display
  name: `appRouter.js:722` uses it as the breadcrumb label (`let itemLabel = routeConfig.description || routeName;`)
  and inserts the result as markup via `.html()` at `appRouter.js:741`, which is why the HTML entity
  form belongs here. Keep the JSON valid.
- `WebPortal/js/appRouter.js`: repoint the existing `'sales-forecasting-grid'` case (around line
  433) at the new module's init global, keeping the neighbours' shape:

  ```js
  'sales-forecasting-grid': () => {
      if (typeof initializeReportListGrid === 'function') {
          initializeReportListGrid();
      }
  },
  ```

- `WebPortal/index.html:274-278`: relabel the existing `businessCollapse` item. Change the link text
  to `Sales &amp; Production Reports`, the icon to `<i class="fas fa-file-invoice me-2">`, **and the
  anchor's `title="Sales Forecasting"` (line 275) to `title="Sales &amp; Production Reports"`.**
  **Keep both `data-route` and `route` as `sales-forecasting-grid`** (constraint 1).
- **`WebPortal/js/role-menu-config.js:395-401` is a second definition of this route's label and
  icon** and must be updated too, or the old name keeps appearing:

  ```js
  'sales-forecasting-grid': {        // :395
      route: 'sales-forecasting-grid',   // :396
      icon: 'fas fa-chart-line',         // :397
      label: 'Sales Forecasting',        // :398
      category: 'business',              // :399
      parent: 'businessCollapse'         // :400
  ```

  Change **only** line `:398` `label` → `'Sales & Production Reports'` and line `:397` `icon` →
  `'fas fa-file-invoice'` (matching the sidebar). **Use a plain `&` here, not `&amp;`** — this value
  is returned by `getPortalModuleLabel` (`role-menu-config.js:455-489`) and its callers escape it
  before rendering (`WebPortal/modules/admin/js/admin_grid.js:896-900`,
  `WebPortal/modules/role-features/js/role-features_grid.js:213-217`), so an entity would be
  displayed literally as "Sales &amp; Production Reports".

  **Leave `route`, `category` and `parent` exactly as they are** —
  `parent: 'businessCollapse'` is what `Playwright Tests/helpers/navigation.helper.ts:53-56` relies
  on. The replacement label still contains "Sales", which is what
  `Playwright Tests/auth/rbac.spec.ts:101` asserts against page content (satisfied by the screen's
  own heading in `report_list.html`).

  **Do not touch the `menus` arrays** that also name this key, at `role-menu-config.js:171` and
  `:512` — those control which roles see the item, and changing them would silently alter access.
  These edits change **two lines and no line count**: `:397` and `:398`.
- **Leave these alone.** They key off text, not folders, so deleting the module does not affect
  them: `WebPortal/modules/admin/js/permission-module-map.js:31,57`, the
  `detectModuleFromFunction` mapping line at **`WebPortal/js/data-functions.js:829`**
  (`if (functionName.includes('sales') || functionName.includes('forecast')) return 'sales-forecasting';`),
  and everything under `WebPortal/help/`.
- **Delete `WebPortal/modules/sales-forecasting/`** (three files: `css/sales_forecasting_grid.css`,
  `html/sales_forecasting_grid.html`, `js/sales_forecasting_grid.js`) and, in the same change, remove
  the `getSalesForecasts` wrapper from `WebPortal/js/data-functions.js`. Inventory as read from the
  live tree: that identifier has **exactly two** sites — the definition at
  **`WebPortal/js/data-functions.js:4335`** and the single caller at
  `WebPortal/modules/sales-forecasting/js/sales_forecasting_grid.js:46`. They must go together:
  because the call is `dataFunctions.getSalesForecasts().catch(...)`, removing the wrapper while the
  module still exists throws a synchronous `TypeError` the `.catch()` does **not** intercept.
  Re-run `grep -rn "getSalesForecasts" WebPortal/` before editing; if the count is not two, stop and
  report rather than proceeding. The module also defines `_salesForecastingGrid`,
  `window.salesForecastingGrid` (`:103`) and `initializeSalesForecastingGrid` (`:105`); all three
  live only inside the deleted folder, except `initializeSalesForecastingGrid`, which is also called
  from `appRouter.js:434` and is handled by the repoint above.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`
   (`package.json:27`). `ui:verify` is the likely failure for a new module: no raw hex outside
   `WebPortal/css/design-tokens.css` (use `--mac-*` tokens), no `var(--phoenix-*)` or other legacy
   vars, Font Awesome icons only, `btn-primary` not `btn-success`, no `linear-gradient`, no
   `.swal2-*` rules outside `css/swal-theme.css`, no bare `td`/`th` padding in module CSS, no
   `min-width` on `.badge`.
2. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0, and `grep -c "sales-report-editor" WebPortal/js/appRouteConfig.json` returns `0`
   (constraint 5).
3. `grep -rn 'route="sales-forecasting-grid"' WebPortal/index.html` still returns a match inside the
   `businessCollapse` block, and the same `<li>`'s visible text contains "Sales".
4. No dangling reference to the deleted module remains:
   `grep -rn "getSalesForecasts\|initializeSalesForecastingGrid\|_salesForecastingGrid\|salesForecastingGrid" WebPortal/js/ WebPortal/modules/`
   returns nothing, and `ls WebPortal/modules/sales-forecasting 2>/dev/null` finds nothing. Note
   `initializeSalesForecastingGrid` is the identifier `appRouter.js:434` actually calls — greping
   only for `getSalesForecasts` would leave the router pointing at a function that no longer exists.
   The grep is scoped to `WebPortal/js/` and `WebPortal/modules/` because `WebPortal/help/**`
   legitimately still contains the string "sales-forecasting"; that is documentation and out of scope.
4b. **`role-menu-config.js` — access untouched.** Run
   `grep -n "'sales-forecasting-grid'" WebPortal/js/role-menu-config.js`. It must print **exactly
   four** lines, and the same four before and after your edits: `171` (a `menus` array), `395`
   (`'sales-forecasting-grid': {`), `396` (`route: 'sales-forecasting-grid',`) and `512` (the other
   `menus` array). The route entry occupies **two** matching lines, which is why the count is 4 and
   not 3. The prescribed edits touch only `:397` and `:398` and change no line count, so the count
   and the line numbers must both be unchanged. **If the count is not 4, stop and report — never
   delete or move a matching line to change the count** (constraint 6); removing the `route:` line or
   a `menus` entry would silently alter which roles see the module.
4c. **`role-menu-config.js` — the label/icon actually changed, and nothing else did.**
   `git diff -U0 -- WebPortal/js/role-menu-config.js` shows exactly two changed lines: the `icon:`
   line becoming `'fas fa-file-invoice'` and the `label:` line becoming
   `'Sales & Production Reports'`, both inside the entry that starts at `:395`. No other line in that
   file appears in the diff. Also confirm the label uses a plain `&`:
   `grep -c "label: 'Sales & Production Reports'" WebPortal/js/role-menu-config.js` returns `1`, and
   `grep -c "Sales &amp; Production Reports" WebPortal/js/role-menu-config.js` returns `0`.
4d. **Breadcrumb label updated.**
   `grep -c '"description": "Sales Forecasting"' WebPortal/js/appRouteConfig.json` returns `0`, and
   `grep -c "Sales &amp; Production Reports" WebPortal/js/appRouteConfig.json` returns `1`.
5. **Guard wiring, by identifier.** In `WebPortal/modules/sales-reports/js/report_list_grid.js`:
   - `grep -c "canOpenReportEditor" …` is at least `2` (definition + its use inside
     `openReportEditor`).
   - `grep -c "reportEditorRouteExists" …` is at least `2` (same).
   - `grep -c "openReportEditor(" …` is at least `3` — the definition plus the row "Open" action and
     the successful-create path.
   - `grep -c "routeTo('sales-report-editor'" …` is exactly `1` — the single funnel.
   - `grep -c "isQueuedOffline" …` is at least `3` — definition + the create site + the delete site.
   - `grep -c "firstRpcRow" …` is at least `3` — definition + the create site + the delete site.
   - `grep -n "\.message" …` shows no read of `.message` on a `create_report_instance` or
     `delete_report_instance` result; the failure text is read from `.error`.
5b. **Router repoint matches the module's own global.**
   `grep -n "initializeReportListGrid" WebPortal/js/appRouter.js` returns a line inside the
   `'sales-forecasting-grid'` case, and
   `grep -c "initializeReportListGrid" WebPortal/modules/sales-reports/js/report_list_grid.js` is at
   least `2` (definition + the bottom-of-file ready call). The two spellings must be identical.
6. `grep -rn "\.html(\|innerHTML" WebPortal/modules/sales-reports/js/` — review every hit and confirm
   none passes database or user text except through `MacStatus.pill` / `macLoadingRow` /
   `macEmptyRow` / `macEmptyState`, which escape their own arguments. Confirm no database text is
   passed as a `MacTableActions` item `label`, `href` or `html`.
7. `grep -rn "toISOString" WebPortal/modules/sales-reports/js/` returns nothing, and
   `grep -c "pickerDateToIso" WebPortal/modules/sales-reports/js/report_list_grid.js` is at least `2`.
8. **No Playwright file was touched.** `git status --porcelain -- "Playwright Tests/"` is empty and
   `git diff --name-only HEAD -- "Playwright Tests/"` is empty. (Do not use `origin/dev` as the diff
   base — that ref may not be fetched in the job's checkout.)
9. `grep -rn "\.off('\.salesReports')\|destroy" WebPortal/modules/sales-reports/js/report_list_grid.js`
   shows a `destroy()` that removes the module's namespaced handlers, and `init()` calls it first.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job. Adding new
Playwright specs is acceptable as a deliverable — write them to `test.skip` without their env
credentials, like the existing specs — but running them is not a completion gate.

## Out of scope

The report editor screen, the metric-line component, the override flow, PDF generation, publish and
re-issue, the targets admin screen, the sales Excel import, the metric resolvers, chart rendering,
the RBAC migration (its own plan), applying any migration, and editing any Playwright spec, helper or
fixture, `WebPortal/help/*`, `docs/**`, or `permission-module-map.js`.
