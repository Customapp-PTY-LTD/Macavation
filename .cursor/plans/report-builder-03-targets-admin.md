---
depends_on: report-builder-02b-publish-and-reissue.md
---

# Report builder — per-period targets and prior-period baselines

## Context

Every metric row in Pete's report compares an achieved figure against a target. Those targets are
currently constants typed into each spreadsheet sheet, and they legitimately drift: his sound-kernel
packing target changed part-way through the year, so the same metric has different targets in
different weeks. Until this screen exists, every Achieved % column in the report renders "—".

This plan builds **one new screen** with two tabs: setting targets for a period, and entering
actuals for periods that predate the report builder so the year-on-year tracking tables have a
comparison series.

It waits on `report-builder-02b-publish-and-reissue.md` **purely to avoid merge conflicts** — it
shares no logic with publishing, but both edit `WebPortal/js/data-functions.js`, and it also edits
`WebPortal/js/appRouteConfig.json`, `WebPortal/js/appRouter.js` and `WebPortal/index.html`, which
earlier plans in this chain touch. The fleet runs plans concurrently from separate snapshots and
never auto-resolves a conflict.

The RPCs are defined in `migrations/20260817090000_report_builder_foundations.sql` and
`migrations/20260817100000_report_instances_and_targets.sql`, both in this checkout. **Whether those
migrations have been applied to any database cannot be verified from this checkout — do not state or
assume that they have.** Background is in `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`;
**do not copy that document's counts or percentages into code comments, UI copy or commit
messages.**

## Why a new table rather than `dashboard_targets`

`dashboard_targets` (`migrations/20260602110000_dashboard_targets.sql`) is effective-dated: the row
with the latest `effective_from` wins. That correctly answers "what is the target right now" for a
live dashboard tile, but it cannot express "the target that applied to the week of 3 November", and
it cannot be filled in retroactively for a closed period without disturbing every later period.
`report_period_targets` is keyed on the exact `(metric_key, period_type, period_start)` instead.

**Do not reuse the `dashboard_targets` RPCs, and do not modify that table or the Dashboard Targets
screen.** A Sales Exec editing a report target must never perturb a live dashboard tile.

## Six new wrappers — this plan adds them

Earlier plans added thirteen report wrappers between them. None of these six exist yet; add them to
`WebPortal/js/data-functions.js` following the same rules those plans established.

| Wrapper | RPC | Params (defaults as declared) | Returns |
|---|---|---|---|
| `getReportMetrics` | `get_report_metrics` | `p_section_key`, `p_period_type` (both DEFAULT NULL) | rows: `metric_key, label, section_key, division, unit, aggregation, source_kind, source_args, has_target, display_order` |
| `getReportPeriodTargets` | `get_report_period_targets` | `p_period_type`, `p_period_start` (**no defaults**) | rows: `metric_key, label, section_key, unit, target_value, notes` |
| `upsertReportPeriodTarget` | `upsert_report_period_target` | `p_metric_key`, `p_period_type`, `p_period_date`, `p_target_value` (**no defaults**), `p_notes`, `p_actor_user_id` (DEFAULT NULL) | `success, error` |
| `copyReportPeriodTargets` | `copy_report_period_targets` | `p_period_type`, `p_from_period`, `p_to_period` (**no defaults**), `p_actor_user_id` (DEFAULT NULL) | `success, error, targets_copied` |
| `getReportManualBaselines` | `get_report_manual_baselines` | `p_period_type`, `p_fy` (**no defaults**) | rows: `metric_key, label, period_start, achieved_value, notes` |
| `upsertReportManualBaseline` | `upsert_report_manual_baseline` | `p_metric_key`, `p_period_type`, `p_period_date`, `p_achieved_value` (**no defaults**), `p_notes`, `p_actor_user_id` (DEFAULT NULL) | `success, error` |

Rules:
- **Reads** pass an explicit `cacheKey` prefixed `report_targets_`, with
  `cacheTtl: this.cache.ttl.dynamic`, and honour a `forceRefresh` argument. The explicit key is
  mandatory — the default key is `functionName_JSON(params)`, which the invalidation below would not
  match.
- **Writes** pass `useCache: false` and, after a successful call, `clearCachePattern('report_targets_')`.
  They must **also** call `clearCachePattern('report_instance_')`, because a changed target changes
  what a draft report shows after its next refresh.
- None of these needs `preserveEmptyParams`. Every parameter without a DEFAULT must always be sent.
- Do not swallow a thrown error into a fake success value — a read returning `[]` on failure would
  make an unapplied migration look like "no targets set".

All six RPCs return `success = 0` with a human-readable `error` rather than throwing (the reads
return rows). Show `error` via `Swal.fire({icon:'error', text: <error>})`; do not invent your own
message when the server supplied one.

**Both upserts take any date within the period as `p_period_date` and snap it server-side** to the
Monday or the 1st. Do not snap it in JavaScript, and do not use `toISOString()` — it converts to UTC
and can shift the date across a day boundary for a South African user. Format locally as
`YYYY-MM-DD`.

`upsert_report_period_target` rejects a negative target and an unknown or inactive `metric_key`.

## Security invariants

- **Never pass database or user-entered text through `.html()`, `innerHTML` or string concatenation
  into markup** — metric labels, notes and `error` strings all go through `.text()`
  (`BluePrint/javascript-jquery-rules.md`).
- **`metric_key` must come from a `<select>` populated by `getReportMetrics`, never a free-text
  input.** The existing Dashboard Targets screen accepts free-text `metric_key`, and a typo there
  silently yields "no target"; do not repeat that here, because these values reach a
  director-facing report.
- Validate any uuid read from a `data-*` attribute with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before use.
- Never use a payload value (`metric_key`, `section_key`) as an object property key without
  rejecting `__proto__` and `constructor`. Prefer a `Map`.
- `JSON.parse` only inside `try/catch`. No `eval`, no `new Function`, no string-form `setTimeout`.

## Deliverable — `WebPortal/modules/report-targets/`

New files: `html/report_targets_grid.html`, `js/report_targets_grid.js`.

**Model the interaction on `WebPortal/modules/dashboard-targets/js/dashboard-targets_grid.js`** —
this repo's existing per-row inline-edit table with save and delete via `MacTableActions`. Copy the
interaction pattern, not the data model (see above); its free-text `metric_key` input is the one
thing deliberately not carried over. Follow the module conventions in
`BluePrint/javascript-jquery-rules.md`: IIFE, `init()` and `destroy()`, namespaced events, cached
`$`-prefixed selectors, init call at the bottom of the file.

Two Bootstrap nav-pill tabs.

**Targets tab.** A period-type selector (Weekly / Monthly) and a Flatpickr date input defaulting to
the current period from `getReportCurrentPeriod` (added by
`report-builder-01a-data-functions-transport.md`). Below it, one row per metric from
`getReportPeriodTargets`: Metric label · Section · Unit · Target (`<input type="number">`) · Notes ·
Save.

`get_report_period_targets` **returns a row for every targetable metric even when no target is
set** (`target_value` null), so the screen shows the gaps rather than hiding them. Render an unset
target with a muted "Not set" pill — an unset target is exactly why the report shows "—" in its
Achieved % column.

A "Copy from previous period" button calling `copyReportPeriodTargets`, then reloading. Report the
returned `targets_copied` count in the success toast ("12 targets copied"). Most targets barely move
period to period, so this is the normal way to populate a new period.

**Prior periods tab.** A financial-year selector and a period-type selector, then a table of metrics
with an `achieved_value` input saving through `upsertReportManualBaseline`. Label it clearly as
historical actuals for periods before the report builder existed — it is neither a report nor an
override.

The financial year runs **1 April to 31 March**, so "FYE 2027" means April 2026 to March 2027.
`report_fy_of_date` on the server already encodes this and `get_report_manual_baselines` takes the
FY as `p_fy`. **Do not compute a financial year in JavaScript** — offer a small fixed list of FY
options and pass the chosen integer straight through.

**Missing RPCs must not white-screen the module.** If a report RPC is absent from the target
database, `callFunction` throws. Wrap every call in `try/catch`, log with `console.warn`, and render
`macEmptyState('fa-bullseye', 'Report targets are not available yet', 'The report-builder migrations have not been applied to this database.')`
rather than leaving a spinner running.

## Wiring

- `WebPortal/js/appRouteConfig.json`: add `report-targets-grid` → `path: "report-targets"`,
  `html: "html/report_targets_grid.html"`, js `["js/report_targets_grid.js"]`. Keep the JSON valid —
  `registry:verify` fails on any path missing from disk.
- `WebPortal/js/appRouter.js`: add the matching `'report-targets-grid'` case to the hardcoded
  `initializeModule()` switch, following the shape of its neighbours. **A route registered in only
  one of these two files silently renders nothing.**
- `WebPortal/index.html`: add a sidebar `<li class="nav-item d-none" data-route="report-targets-grid">`
  next to the existing Dashboard Targets item, with `<i class="fas fa-bullseye me-2">`.
- In the report editor, add a small "Edit targets for this period" link in each section footer that
  routes to `report-targets-grid`. Keep target editing out of the editor itself — the editor is for
  entering figures. Change no more of `report_editor.js` than that.
- **A migration** adding `features` / `role_features` for `report-targets-grid` and
  `actions` / `role_actions` for `reports.target.edit`, modelled on
  `migrations/20260812100000_crm_whatsapp_module.sql`. Grant to `super_user`, `admin`, `Sales Exec`
  and `Palladium Manager` **only** — do not loop over every role, and do not add anything to
  `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` (`CLAUDE.md:34-39` records
  that pattern as the cause of this repo's permission drift). `role_features.value` and
  `role_actions.value` are **`text`, not `boolean`** — insert the string `'true'`. Pick a timestamp
  prefix later than every file currently in `migrations/`; check with `ls migrations/ | sort | tail -3`
  at write time rather than assuming a value.
  **You cannot apply this migration** — the fleet has no database credentials. Author the file only.
  Until a human applies it the menu item stays hidden, which is `menu-filter.js`'s existing
  behaviour and needs no special handling.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`.
   `ui:verify` is the likely failure for a new module: no raw hex outside
   `WebPortal/css/design-tokens.css` (use `--mac-*` tokens), no legacy `var(--phoenix-*)`, Font
   Awesome icons only, `btn-primary` not `btn-success`, no `linear-gradient`, no `.swal2-*` rules
   outside `css/swal-theme.css`, no bare `td`/`th` padding in module CSS, no `min-width` on
   `.badge`.
2. `grep -n "report-targets-grid" WebPortal/js/appRouter.js` returns a match — the hardcoded switch
   is the step most often missed — and
   `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
3. All six wrapper names are present:
   `for n in getReportMetrics getReportPeriodTargets upsertReportPeriodTarget copyReportPeriodTargets getReportManualBaselines upsertReportManualBaseline; do grep -q "$n" WebPortal/js/data-functions.js || echo "MISSING $n"; done`
   prints nothing.
4. `grep -rn "dashboard_targets\|getDashboardTargets\|upsertDashboardTarget" WebPortal/modules/report-targets/`
   returns nothing — this screen must not touch the dashboard targets table or its RPCs.
5. `grep -rn "\.html(" WebPortal/modules/report-targets/js/` — review every hit and confirm none
   passes database or user text.
6. `grep -rn "toISOString" WebPortal/modules/report-targets/js/` returns nothing.
7. `ls migrations/ | sort | tail -1` is the new migration file, and `grep -n "'true'" <new file>`
   shows the text literal (not a bare `true`) used for both `value` columns.
8. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty — no spec file was edited.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site**, and do not attempt to run any `db:apply*` script — there are no
credentials. Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`).

## Out of scope

The metric resolvers, the sales Excel import, WhatsApp delivery, PDF storage, chart rendering,
applying any migration, modifying `dashboard_targets` or its screen, and editing any Playwright
spec, `WebPortal/help/*`, `docs/**`, or `permission-module-map.js`.
