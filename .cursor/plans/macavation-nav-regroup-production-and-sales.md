# Regroup the sidebar: put Reports, Targets, Alerts, Sales Data, and Forecasting under one "Production & Sales" section

## Context

Users (Henry, and the "Sales Exec" role in particular — `WebPortal/js/role-menu-config.js:20`)
have to visit three unrelated sidebar branches to see one coherent picture of production/sales
performance:

- **Sales & Production Reports** (`sales-forecasting-grid`) and **Sales & Production Data**
  (`sales-data-grid`) live under Support → **Business** (`WebPortal/index.html:265-291`).
- **Targets** (`report-targets-grid`) and **Stock Alert Rules** (`stock-alert-rules-grid`) live
  under **User & access** (`WebPortal/index.html:301-327`) — grouped there only because they were
  bolted onto the admin menu as afterthoughts, not because they relate to user/role administration.
- **Kernel forecast** (`kernel-production-forecast-grid`) and **Oil forecast**
  (`oil-production-forecast-grid`) are separate top-level items directly under Support
  (`WebPortal/index.html:210-219`), split by product line rather than grouped with Reports/Targets
  at all.

All six screens read from the same underlying production/sales tables
(`resolve_report_metric_value`, `data_production_daily`, `report_period_targets`,
`report_metrics` — confirmed via `WebPortal/modules/sales-reports/js/report_editor.js`,
`WebPortal/modules/report-targets/js/report_targets_grid.js`,
`WebPortal/modules/sales-data/js/sales_data_grid.js`). This is a pure navigation/grouping
change — no route, table, or business logic changes.

## Fixed contract: how nav visibility actually works (read `WebPortal/js/menu-filter.js` in full
before touching anything)

- Each sidebar `<li class="nav-item d-none" data-route="...">` in `WebPortal/index.html` starts
  hidden. `menu-filter.js`'s `showMenu()` (`WebPortal/js/menu-filter.js:89-98`) removes `d-none`
  from a leaf item if the user's `featureKeys` include its route. This looks the item up by
  `data-route`/`route` attribute, not by which collapse it sits inside — so **moving a `<li>` to a
  different collapse block does not change who can see it.**
- Parent collapse `<li>` visibility is separate: `updateParentMenus()`
  (`WebPortal/js/menu-filter.js:124-153`) iterates a **hardcoded array of collapse element ids**
  (`WebPortal/js/menu-filter.js:125-134`) and shows/hides each parent based on whether any child
  inside it is visible. **Any new collapse id introduced in `index.html` MUST be added to this
  array, or that parent will stay permanently hidden (`d-none`) even when its children are
  visible** — this is not optional, there is no other mechanism that reveals a parent.
- `WebPortal/js/role-menu-config.js`'s `menuStructure` map (`WebPortal/js/role-menu-config.js:
  260-443`) is separate metadata (icon/label/category/`parent` per route) consumed elsewhere (e.g.
  a "Customize modules" admin screen) — it is NOT what drives sidebar DOM structure, but it must
  be kept in sync with `index.html`'s actual grouping or it silently misdescribes the menu. This
  exact class of drift already caused a real bug once: see the comment at
  `WebPortal/js/role-menu-config.js:428-429` ("`report-targets-grid` was missing from this map
  entirely, so the Targets screen vanished"). Do not reintroduce that failure mode — every route
  touched by this plan must have its `parent`/`category` fields updated to match its new
  `index.html` location, for every route moved.
- `userManagementCollapse` carries **desktop flyout positioning behavior** specific to its id —
  `WebPortal/js/index.js:122-125,416-456,466-485` and CSS selectors keyed on
  `[data-bs-target="#userManagementCollapse"]` in `WebPortal/css/index.css:306-317` and
  `WebPortal/css/main.css:649-660`. Do **not** rename or repurpose the `userManagementCollapse`
  id itself. Targets and Stock Alert Rules are being moved OUT of it (as plain `<li>` relocations)
  into the new group below, which must be a normal (non-flyout) collapse like `businessCollapse`.

## Deliverable

1. **Rename and expand `businessCollapse` into the new home**, in `WebPortal/index.html`:
   - Rename the toggle label from "Business" to "Production & Sales" (icon: keep
     `fa-briefcase`, or switch to `fa-chart-line` — pick one, either is fine, just keep it
     consistent between the `<a>` text and any label elsewhere).
   - Keep the element id `businessCollapse` as-is (do not rename the id — it is referenced
     nowhere outside `index.html`/`menu-filter.js`/`role-menu-config.js`, which this plan already
     updates, but keeping the id stable minimizes blast radius).
   - Inside it, in this order, place: **Sales & Production Reports** (`sales-forecasting-grid`,
     already there), **Targets** (`report-targets-grid`, moved from `userManagementCollapse`),
     **Stock Alert Rules** (`stock-alert-rules-grid`, moved from `userManagementCollapse`),
     **Sales & Production Data** (`sales-data-grid`, already there), **Kernel forecast**
     (`kernel-production-forecast-grid`, moved from being a direct child of `supportCollapse`),
     **Oil forecast** (`oil-production-forecast-grid`, moved from being a direct child of
     `supportCollapse`), **Financial Management** (`financial-management-grid`, already there —
     leave it in place, do not reorder it before the six above).
   - Every moved `<li>` keeps its existing `class="nav-item d-none"`, `data-route="..."`, `route="..."`,
     icon, and label exactly as they are today — this plan relocates markup, it does not restyle,
     rename, or re-icon any individual item (the toggle label rename above is the only text change).
   - Remove the two now-empty source `<li>` entries for Kernel forecast and Oil forecast from
     directly under `supportCollapse` (`WebPortal/index.html:210-219`), and the two now-empty
     entries for Targets and Stock Alert Rules from `userManagementCollapse`
     (`WebPortal/index.html:315-324`). Do not remove `admin-grid`'s `<li>` — User & access keeps
     that single item and keeps its flyout behavior.

2. **Update `WebPortal/js/role-menu-config.js`'s `menuStructure` map** for every one of the four
   moved routes (`report-targets-grid`, `stock-alert-rules-grid`, `kernel-production-forecast-grid`,
   `oil-production-forecast-grid`): change `parent` to `'businessCollapse'` and `category` to
   `'business'`, matching the two routes that were already there (`sales-forecasting-grid`,
   `financial-management-grid`). Leave `icon`/`label`/`route` fields untouched.

3. **No change needed to `menu-filter.js`'s `collapseIds` array** — `businessCollapse` is already
   in it (`WebPortal/js/menu-filter.js:132`) since it already existed before this plan. If you find
   yourself needing to add a new collapse id anywhere, stop and re-read the Fixed Contract section
   above — this plan is scoped to reuse `businessCollapse`, not create a new one.

4. **Update the toggle's `title` attribute** on the businessCollapse `<a>` to match the new label
   (currently `title="Business"` — change to `title="Production & Sales"`), and update
   `userManagementCollapse`'s toggle `title` if the removed items make its current
   `"Accounts, roles, and which modules each role can open"` description read oddly — check the
   actual current text at `WebPortal/index.html:304` before deciding whether it still reads
   correctly with two fewer children (it likely does, since it never mentioned targets/alerts by
   name, but read it to confirm before leaving it alone).

5. **Bump the router cache-busting version token** on the `appRouter.js` script tag in
   `WebPortal/index.html` (currently `?v=20260904e` — the comment immediately above it at
   `WebPortal/index.html:590-594` explains why this is required for any deployed change to reach a
   browser that has visited the portal before). Use today's date in the same `YYYYMMDDx` format
   the existing token uses.

## Explicitly out of scope (do not touch)

- No changes to any module's HTML/JS/CSS files themselves (`sales-reports/`, `report-targets/`,
  `stock-alert-rules/`, `sales-data/`, `kernel-production/`, `oil-production/`) — this plan only
  moves sidebar `<li>` markup and the matching metadata.
- No changes to `appRouteConfig.json` route definitions, RPCs, or Supabase functions.
- No changes to `report_metrics.label` vs `admin_label` naming (a separate, later concern).
- No de-duplication of the Kernel Forecast stock-aggregation code
  (`WebPortal/modules/kernel-production/js/kernel_production_forecast_grid.js`) against
  `stock-alerts-shared.js` — separate, later concern.
- Do not touch `userManagementCollapse`'s id, its flyout JS in `index.js`, or its CSS selectors.

## Verification (run these yourself before finishing; every check below is scriptable)

1. `grep -c 'data-route="report-targets-grid"\|data-route="stock-alert-rules-grid"\|data-route="kernel-production-forecast-grid"\|data-route="oil-production-forecast-grid"\|data-route="sales-forecasting-grid"\|data-route="sales-data-grid"' WebPortal/index.html`
   must return exactly `6` (one `<li data-route="...">` per route, no duplicates, none dropped).
2. Confirm all six of those `<li>` elements are now nested inside `<div class="collapse" id="businessCollapse">...</div>` and not inside `kernelCollapse`, `oilCollapse`, `supportCollapse`'s direct children, or `userManagementCollapse` — read the file section by eye (grep line numbers, then confirm nesting depth) since this is a structural DOM check a text grep alone can't fully prove.
3. `grep -n "supportCollapse" -A 20 WebPortal/index.html` — confirm Kernel forecast/Oil forecast `<li>` entries are gone from directly under it (only the CRM/Quality/Documents/Business/Palladium items remain as direct children).
4. `grep -n "userManagementCollapse" -A 20 WebPortal/index.html` — confirm only `admin-grid`'s `<li>` remains as a child.
5. In `WebPortal/js/role-menu-config.js`, confirm `report-targets-grid`, `stock-alert-rules-grid`, `kernel-production-forecast-grid`, `oil-production-forecast-grid` each now show `parent: 'businessCollapse'` and `category: 'business'` in their `menuStructure` entries.
6. Run `npm run routing:verify && npm run ui:verify && npm run registry:verify` (a subset of `test:fleet` — these three are the ones that parse `WebPortal/index.html`/`appRouteConfig.json`/routing structure; the rest of `test:fleet` is WhatsApp/report-payload logic untouched by this plan) and confirm all three exit 0.
7. Confirm the `appRouter.js` `?v=` token in `WebPortal/index.html` changed from `20260904e` to a new, later value.

## Report back

State which of the six routes moved, their final `parent`/`category` values, the old and new
`?v=` token, and the exit status of the three verify scripts run in step 6. Keep the report under
200 words — this is a mechanical relocation, not a design decision, so there's nothing else worth
narrating.
