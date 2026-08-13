---
depends_on: report-builder-01a-data-functions-transport.md
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

   **Do not edit any of those three spec files** to accommodate this change. Introducing a new route
   key, or moving the item out of `businessCollapse`, breaks them.
   `WebPortal/modules/admin/js/permission-module-map.js:57` also maps this key to the
   `sales-forecasting` permission slug — leave that file alone. It groups database permissions by
   `object_name` text, not by folder, so deleting the module folder does not affect it.
2. **A route needs an entry in BOTH `WebPortal/js/appRouteConfig.json` AND the hardcoded
   `initializeModule()` switch in `WebPortal/js/appRouter.js`.** The existing
   `'sales-forecasting-grid'` case is at **`WebPortal/js/appRouter.js:433`** — re-grep before
   editing rather than trusting that number. A route registered in only one of the two silently
   renders nothing.
3. **No deep-linking.** The router never reads the URL (`CLAUDE.md`). Pass the selected report id to
   the editor via `Session.set('currentReportId', id)` (`WebPortal/js/session.js:68-84`), not a
   query string or hash. `_appRouter.routeParams` exists but is only a breadcrumb-label store —
   `initializeModule` is called as `initializeModule(routeName)` with no params
   (`appRouter.js:252`), so the id cannot be passed as an argument.
4. **`data-action-perm` is swept once over static markup only** (`CLAUDE.md:29-32`; the sweep is
   `actionAccess.apply(#content-area)` at `appRouter.js:253-256`, 100 ms after load). It is inert on
   anything rendered afterwards. For dynamically rendered rows use the prevailing module idiom
   `typeof hasAction === 'function' && hasAction('<key>')` inline at render time (`window.hasAction`
   is defined at `action-access.js:95`). **Never call it with an empty key** — `has('')` returns
   `true` (`action-access.js:44`).
5. **Do not register the `sales-report-editor` route here.** Its files do not exist yet and
   `npm run registry:verify` fails on any path in `appRouteConfig.json` that is missing on disk. The
   next plan registers it.

## Security invariants

This screen renders database text. `BluePrint/javascript-jquery-rules.md` is what the review gate
checks against.

- **Never pass database or user-entered text through `.html()`, `innerHTML`, or string
  concatenation into markup.** Build the element, then set its text with `.text()`. This covers
  every period label, template name and status value. Numbers may be formatted and concatenated only
  after `Number()` conversion.
- **Validate the report uuid read from a `data-*` attribute before using it in an RPC call**, with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, and abort if it fails. A
  truthiness check is not validation.
- Never use a value from the payload as an object property key without first rejecting `__proto__`
  and `constructor`. Prefer a `Map`.
- `JSON.parse` only inside `try/catch`. No `eval`, no `new Function`, no string-form `setTimeout`.

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

Columns: Period · Type (Weekly/Monthly pill) · Date range · Status pill · Overridden
(`override_count` of `metric_count`) · Generated · Actions (Open, Delete).

`listReportInstances` returns `total_count` on every row — drive pagination from that, not from a
client-side count. `p_limit` is capped server-side at `LEAST(COALESCE(p_limit,50),100)`, so do not
request more than 100.

**Label whitespace.** `period_label` may contain internal blank padding:
`migrations/20260817090100_fix_report_period_label_padding.sql` exists precisely because
`report_period_label` produced `"August    2026 (FYE 2027)"`, and whether that fix has been applied
to any given database is unknowable from here. Whenever a label is displayed, normalise for display
only: `$el.text(String(label == null ? '' : label).replace(/\s+/g, ' ').trim())`. Never synthesise a
label locally — the title always comes from the server.

**Delete** shows a `Swal` confirm then calls `deleteReportInstance`. The RPC refuses anything that
is not a draft, returning `success = 0` with "Only a draft report can be deleted. Published reports
are kept." — show that message rather than inventing one. Gate the row action with
`hasAction('reports.report.delete')` inline.

### 2. New Report

A Bootstrap modal: period type radio (Weekly / Monthly) and a Flatpickr date input, defaulting to
the current period from `getReportCurrentPeriod`. Template id comes from `getReportTemplates`
filtered to the chosen period type.

**Do not implement Monday-snapping in JavaScript.** Pass the picked date straight to
`createReportInstance` as `p_period_date`; the server snaps it to the Monday or the 1st. If a report
already exists for that period the RPC returns `success = 0` with a message naming the period —
display it.

Gate the button with `data-action-perm="reports.report.create"` (it is static markup, so the sweep
covers it).

Do not use `toISOString()` on a picked date — it converts to UTC and can shift the date across a day
boundary for a South African user. Format the date locally as `YYYY-MM-DD`.

### 3. Degradation — this screen must work before the RBAC migration is applied

1. **Editor navigation guard.** Define once in `report_list_grid.js`:

   ```js
   // Mirrors appRouter.js:137-138 exactly. The router only runs its own hasAccess gate when
   // roleMenuConfig exists AND getUserRole() is truthy; a looser check here would block a
   // navigation the router would have allowed.
   function canOpenReportEditor() {
       if (typeof roleMenuConfig === 'undefined' || !roleMenuConfig.getUserRole()) return true;
       return roleMenuConfig.hasAccess('sales-report-editor') === true;
   }
   ```

   Consult it at **both** places that navigate to the editor — the row "Open" action **and** the
   successful-create path. When it returns false, do not route; show
   `Swal.fire({icon:'info', title:'Report editing not enabled', text:'Report editing has not been enabled for your role yet. An administrator must apply the report-builder permissions migration, then sign out and back in.'})`.
   On the create path, still refresh the list afterwards so the new draft is visible.

2. **The editor route may not be registered yet** (the next plan adds it), and an `admin` or
   `super_user` bypasses `hasAccess` by role name, so the guard above will not stop them. Before
   routing, also confirm the route exists in the router's own registry. **Determine how
   `appRouter` resolves a route name from `appRouteConfig.json` by reading
   `WebPortal/js/appRouter.js`, and use that same lookup — do not invent an API.** Cite the
   file:line you used in a code comment. If the route is absent, show the same informational
   `Swal` rather than routing into a blank screen.

3. **Missing RPCs must not white-screen the module.** If a report RPC is absent from the target
   database, `callFunction` throws. Wrap every call in `try/catch`, log with `console.warn`, and
   render `macEmptyState('fa-file-invoice', 'Reports are not available yet', 'The report-builder migrations have not been applied to this database.')`
   rather than leaving a spinner running.

### 4. Wiring and removal of the old stub

- `WebPortal/js/appRouteConfig.json`: repoint the existing `sales-forecasting-grid` entry to
  `path: "sales-reports"`, `html: "html/report_list.html"`, js `["js/report_list_grid.js"]`,
  css `["css/sales_reports.css"]`. Keep the JSON valid.
- `WebPortal/js/appRouter.js`: repoint the existing `'sales-forecasting-grid'` case (around line
  433) at the new module's init, following the shape of its neighbours.
- `WebPortal/index.html`: relabel the existing `businessCollapse` item to
  "Sales &amp; Production Reports" with `<i class="fas fa-file-invoice me-2">`. **Keep both
  `data-route` and `route` as `sales-forecasting-grid`** (constraint 1).
- **Delete `WebPortal/modules/sales-forecasting/`** and, in the same change, remove the
  `getSalesForecasts` wrapper from `WebPortal/js/data-functions.js`. These must happen together:
  the wrapper's only caller is `sales_forecasting_grid.js:46`, and because that call is
  `dataFunctions.getSalesForecasts().catch(...)`, removing the wrapper while the module still exists
  throws a synchronous `TypeError` the `.catch()` does not intercept.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`.
   `ui:verify` is the likely failure for a new module: no raw hex outside
   `WebPortal/css/design-tokens.css` (use `--mac-*` tokens), no `var(--phoenix-*)` or other legacy
   vars, Font Awesome icons only, `btn-primary` not `btn-success`, no `linear-gradient`, no
   `.swal2-*` rules outside `css/swal-theme.css`, no bare `td`/`th` padding in module CSS, no
   `min-width` on `.badge`.
2. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0, and `grep -c "sales-report-editor" WebPortal/js/appRouteConfig.json` returns `0`
   (constraint 5).
3. `grep -rn 'route="sales-forecasting-grid"' WebPortal/index.html` still returns a match inside the
   `businessCollapse` block, and the same `<li>`'s visible text contains "Sales".
4. `grep -rn "getSalesForecasts\|_salesForecastingGrid" WebPortal/` returns nothing, and
   `ls WebPortal/modules/sales-forecasting 2>/dev/null` finds nothing.
5. `grep -c "canOpenReportEditor" WebPortal/modules/sales-reports/js/report_list_grid.js` is at
   least `3` — the definition plus both call sites.
6. `grep -rn "\.html(" WebPortal/modules/sales-reports/js/` — review every hit and confirm none
   passes database or user text.
7. `grep -rn "toISOString" WebPortal/modules/sales-reports/js/` returns nothing.
8. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty — no spec file was edited.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job. Adding new
Playwright specs is acceptable as a deliverable — write them to `test.skip` without their env
credentials, like the existing specs — but running them is not a completion gate.

## Out of scope

The report editor screen, the metric-line component, the override flow, PDF generation, publish and
re-issue, the targets admin screen, the sales Excel import, the metric resolvers, chart rendering,
the RBAC migration (its own plan), applying any migration, and editing any Playwright spec,
`WebPortal/help/*`, `docs/**`, or `permission-module-map.js`.
