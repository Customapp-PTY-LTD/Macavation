# Sales & Production Data page — shell, period selector, and the production tab

## Context

Pete (Sales Exec) runs Macavation from Excel. A report builder is already merged and live on `dev`.
The decision has now been made that **all of Pete's data lives on a standing page — his spreadsheets,
in the app — and the report becomes commentary over figures read from it.**

The backend is built, applied to dev and merged. Every RPC this plan calls exists in
`migrations/20260819090000_data_page_production_daily.sql`. **Whether those migrations have been
applied to any given database cannot be verified from this checkout — do not state or assume that
they have.** The screen must degrade gracefully when they have not.

Real data is already loaded on dev: 583 days of production, 2025-01-01 → 2026-08-06.

This plan builds **the page shell and one tab**. The remaining tabs are a later plan and are out of
scope — build the shell so adding a tab is a column definition, not new rendering code.

## Verified repo facts — trust these, do not re-derive

- **No framework, no build step.** jQuery + Bootstrap 5.3, libraries via CDN in
  `WebPortal/index.html`. `WebPortal/` is the only deployed tree. **Ignore `.claude/worktrees/**` —
  stale copies whose line numbers differ from the live tree.**
- A route needs an entry in **both** `WebPortal/js/appRouteConfig.json` **and** the hardcoded
  `initializeModule()` switch in `WebPortal/js/appRouter.js` (the `'sales-forecasting-grid'` case is
  around line 433 and calls a **global function**, e.g. `initializeSalesForecastingGrid()`, not a
  module object). A route in only one file silently renders nothing.
- **No deep-linking** — the router never reads the URL. Use `Session.set/get`
  (`WebPortal/js/session.js:68,74`).
- `data-action-perm` is swept **once** over static markup ~100 ms after route load
  (`appRouter.js:253-256`); it is inert on anything rendered later. For dynamic rows use
  `typeof hasAction === 'function' && hasAction('<key>')` inline (`action-access.js:95`).
  **`hasAction('')` returns `true`** (`action-access.js:44`) — never call it with an empty key.
- **The module skeleton to copy is `WebPortal/modules/sales-reports/js/report_list_grid.js`.** Its
  own doc-comment records that it deliberately fixes three defects in `users_grid.js`: events
  namespaced and removed in `destroy()`; `init()` calls `destroy()` first; every database value
  reaches the DOM via `.text()` or a self-escaping helper. Copy all three.
- **The row-grid pattern to copy is the kernel job card**:
  `modal_kernel_job_card.js` plus `kernel_job_card_stock.js:82-98` (`collectStyleRowsFromDom` walks
  every `<tr>`, parses numbers, drops blank rows, and the whole array is saved in **one** RPC).
  Live totals recompute into a `<tfoot>` on every keystroke (`modal_kernel_job_card.js:264-267`).
- **Do NOT copy `modal_oil_bulk_add_stock.js`'s save loop** — one RPC per row, so N rows is N round
  trips and a mid-loop failure leaves earlier rows committed.
- **Bulk save convention**: one RPC taking a jsonb array. **Pass the array itself — never
  `JSON.stringify` it** (`data-functions.js:6116-6118` explains why).
- **Numbers**: reuse `parseLocaleNumber()` (`kernel_job_card_stock.js:11-21`). kg inputs are
  `type="number" step="0.01"`. Rounding is `Math.round(x*100)/100`. For display reuse the
  locale-independent `formatNumber()` approach in `report-metric-line.js:21-29` (no `toLocaleString`
  / `Intl`, so it is identical across browsers and inside a Node test).
- **Periods resolve on the SERVER.** Never compute period boundaries in JavaScript. Date conversion
  is string-splitting only (`report_list_grid.js:58-65`) — **no `Date` arithmetic, no
  `toISOString()`**, which shifts across a day boundary for a South African user.
- **Flatpickr idiom**: a local `var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false,
  disableMobile: true };` per file, lazily initialised and guarded by `el._flatpickr`.
- **There is no `beforeunload` anywhere in this app.** The established substitutes are debounced
  autosave plus a `localStorage` draft (`modal_production_stages.js:1774-1795`, flushed on close),
  and `appRouter.js`'s `promptOnFormExit` (defined at `:584`, called at `:87`), which already
  special-cases `stock-management-kernel`'s dispatch draft. That is the extension point.
- **Missing-RPC convention**: wrap every call so a missing RPC renders `macEmptyState(...)` rather
  than white-screening (`report_list_grid.js:211-221` and three more places). Shared helpers:
  `macLoadingRow`/`macEmptyRow`/`macEmptyState` (`ui-states.js:17-40`), `MacStatus.pill`,
  `MacTableActions`.
- `npm run ui:verify` gates: no raw hex outside `WebPortal/css/design-tokens.css` (use `--mac-*`
  tokens), Font Awesome icons only, `btn-primary` not `btn-success`, no `linear-gradient`, no
  `.swal2-*` outside `css/swal-theme.css`, no bare `td`/`th` padding in module CSS, no `min-width`
  on `.badge`. `npm run registry:verify` fails on any path in `appRouteConfig.json` missing on disk.

## RPC contracts — these exist; call them exactly

Reached via `dataFunctions.callFunction(name, params)`. Parameter names must match, `p_` prefix
included.

| RPC | Params | Returns |
|---|---|---|
| `get_data_datasets` | none | rows: `dataset_key, label, description, table_name, period_column, period_kind, report_section_key, supports_reseed, display_order` |
| `get_report_current_period` | `p_period_type` (`'weekly'`\|`'monthly'`, **no default**) | one row: `period_type, period_start, period_end, fy, fy_month_index, period_label` |
| `get_data_production_daily` | `p_date_from`, `p_date_to`, `p_limit` (100), `p_offset` (0) | rows incl. `id, production_date, cracked_kg_system, cracked_kg, cracked_kg_live, sk_packed_kg_system, sk_packed_kg, sk_packed_kg_live, wholes_pct, uncracks_pct, oil_kernel_kg, cracker_dust_kg, shell_fines_kg, compost_kg, shell_kg, data_source, edited_by_name, edited_at, edit_reason, data_quality_flags, notes, total_count`. `p_limit` capped at 400 |
| `upsert_data_production_daily_rows` | `p_rows` (jsonb array), `p_actor_user_id` | `success (int), error (text), rows_written (int)` |
| `delete_data_production_daily_row` | `p_production_date` | `success, error` |
| `reseed_data_production_daily` | `p_date_from`, `p_date_to`, `p_actor_user_id` | `success, error, rows_reseeded` |
| `get_data_production_daily_drift` | `p_date_from`, `p_date_to`, `p_limit`, `p_offset` | rows: `production_date, field_name, stored_system, live_system, effective_value, delta, total_count` |

Write RPCs return `success = 0` with a readable `error` rather than throwing — show it via
`Swal.fire({icon:'error', text: <error>})` and do not invent a message when the server supplied one.

`upsert_data_production_daily_rows` accepts row objects keyed on `production_date` with any of
`cracked_kg, sk_packed_kg, wholes_pct, uncracks_pct, oil_kernel_kg, cracker_dust_kg, shell_fines_kg,
compost_kg, shell_kg, notes, edit_reason`.

## The three-value model this screen exists to show

Each seedable figure has three numbers, and the grid must keep them distinguishable:

- **`<field>_system`** — the factory figure as at the last seed.
- **`<field>_live`** — the factory figure recomputed *now*, returned by the read RPC.
- **`<field>`** — the effective, report-facing figure. This is the only one the user edits, and
  re-seeding never overwrites it.

**Drift** is `_system` ≠ `_live`: the factory has changed its mind since the figure was seeded. Show
it as a note under the cell reading `System now says <live>`. The user's value stands; nothing
changes underneath them.

Byproduct columns (`wholes_pct` … `shell_kg`) have **no** system twin — the factory cannot supply
them. Render them as ordinary inputs with no seeded/drift treatment.

## Deliverables

### 1. `WebPortal/modules/sales-data/`

- `html/sales_data_grid.html`, `css/sales_data_grid.css`
- `js/sales-data-column-defs.js` — a pure data registry, **no DOM at eval time** (same convention as
  `report-metric-line.js`), exporting `window.SalesDataColumnDefs = { get(key), keys() }`. Define the
  `production_daily` dataset only: its columns, labels, types, steps, which carry a system twin, and
  which are totalled.
- `js/sales-data-row-grid.js` — the generic grid engine driven entirely by a column definition:
  render rows, collect rows from the DOM (dropping blank ones), recompute a `<tfoot>` totals row on
  input. Must not reference any dataset by name.
- `js/sales_data_grid.js` — the page controller: period bar, tab strip, load, autosave, `init()` /
  `destroy()`.

Load order in the route's `js` array: defs → engine → controller.

### 2. Screen

A period bar (Weekly/Monthly radio + a Flatpickr date + prev/next), a Bootstrap `nav-tabs` strip
generated from `get_data_datasets()`, and a tab pane per dataset. Only `production_daily` renders
content in this plan; every other tab renders
`macEmptyState('fa-table', 'Not built yet', 'This dataset arrives in a later release.')`.

**Do not compute period boundaries.** Send the picked date to `get_report_current_period` and use
the `period_start`/`period_end` it returns as the range for `get_data_production_daily`.

**Production grid.** One row per day returned. Columns: Date (plain text, not an input — it is the
row's identity) · Cracked · Packed · Wholes % · Uncracks % · Oil kernel · Cracker dust · Shell fines
· Compost · Shell · Notes. A `<tfoot>` totals row for the kg columns, recomputed on every input.

For `cracked_kg` and `sk_packed_kg`, style the cell by state using tokens from
`design-tokens.css` — no raw hex:
- unedited and matching system → default
- edited (differs from `_system`) → an "edited" accent
- drifted (`_system` ≠ `_live`) → a "drift" accent plus a small note under the input reading
  `System now says <formatted live>`

A row whose `data_quality_flags` is non-empty shows a `MacStatus.pill` with the flags as its title —
these mark rows the historical backfill could not fully trust. **Do not hide or auto-correct them.**

### 3. Saving

**Debounced autosave, one bulk array call per save** — the job-card model, not the oil-bulk-add loop.
One shared timer for the tab (900 ms, matching `AUTO_SAVE_DELAY_MS` in the existing modals), so a
burst of edits across rows collapses into one call. Show a small inline status
(`Saving… / Saved / Save failed`) rather than a toast per save.

`flushAutoSave()` must be awaited before: switching tab, changing the period, and leaving the route.
For the last of these, extend `appRouter.js`'s `promptOnFormExit` with a sales-data branch in the
same shape as the existing `stock-management-kernel` one — **no confirmation dialog**, just flush
the pending save before the DOM it reads is torn down.

### 4. Re-seed and drift

A "Refresh from factory" button, gated `data-action-perm="reports.data.edit"`, calling
`reseed_data_production_daily` for the visible period, then reloading. Confirm first via `Swal`,
stating plainly that it updates the factory column only and **will not change any figure the user
has entered**.

A "Drift" count badge from `get_data_production_daily_drift`, opening a read-only list of the days
whose factory figure has moved.

### 5. Wiring

- `WebPortal/js/appRouteConfig.json`: `sales-data-grid` → `path: "sales-data"`, the html/js/css above.
- `WebPortal/js/appRouter.js`: matching `'sales-data-grid'` case calling a global
  `initializeSalesDataGrid()`.
- `WebPortal/index.html`: sidebar `<li class="nav-item d-none" data-route="sales-data-grid">` inside
  `businessCollapse`, **directly below the existing Sales & Production Reports item**, with
  `<i class="fas fa-table me-2">` (`fa-file-invoice` is already used by the report list).
- `WebPortal/js/data-functions.js`: wrappers `getDataDatasets`, `getDataProductionDaily`,
  `upsertDataProductionDailyRows`, `deleteDataProductionDailyRow`, `reseedDataProductionDaily`,
  `getDataProductionDailyDrift`. Reads take an explicit `cacheKey` prefixed `sales_data_` with
  `cacheTtl: this.cache.ttl.dynamic` and honour `forceRefresh`; writes pass `useCache: false` and
  call `clearCachePattern('sales_data_')` afterwards.
- A migration seeding `features` (`sales-data-grid`) and `actions` (`reports.data.edit`), modelled on
  `migrations/20260817110000_report_builder_rbac.sql`, granted to `super_user`, `admin`,
  `Sales Exec`, `Palladium Manager` **only** — do not loop over every role and do not touch
  `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` (`CLAUDE.md:34-39` records
  that pattern as the cause of this repo's permission drift). `role_features.value` and
  `role_actions.value` are **`text`**, so the literal is `'true'`. Pick a timestamp later than every
  file in `migrations/` — check `ls migrations/ | sort | tail -3` at write time.
  **You cannot apply it** — the fleet has no database credentials. Author the file only.

## Security invariants

- **Never pass database or user text through `.html()`, `innerHTML`, or string concatenation into
  markup.** Build the element, set `.text()`. Covers notes, edit reasons, `edited_by_name`, dataset
  labels and quality flags. Numbers only after `Number()` conversion.
- Validate any uuid from a `data-*` attribute with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before use.
- Never use a payload value as an object property key without rejecting `__proto__` and
  `constructor`. Prefer a `Map`.
- `JSON.parse` only in `try/catch`. No `eval`, no `new Function`, no string-form `setTimeout`.

## Verification — all runnable in the checkout: no browser, no login, no network

1. `npm run test:fleet` passes (`routing:verify && username:verify && verify-phase2-migrations &&
   ui:verify && migrations:verify && registry:verify`). `ui:verify` is the likely failure for a new
   module.
2. `grep -n "sales-data-grid" WebPortal/js/appRouter.js` returns a match — the hardcoded switch is
   the step most often missed.
3. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
4. **A pure `node` unit check of the grid engine's value helpers**, with no browser and no network.
   `sales-data-column-defs.js` and the formatting helpers must be requireable in isolation. Assert:
   a `null` figure renders as the "no data" text, never `"null"`, `NaN` or `0`; a cell whose
   `_system` differs from `_live` reports drift; a cell equal to its `_system` does not; and the
   totals row sums only the columns marked totalable. Delete the scratch script before finishing.
5. `grep -rn "\.html(" WebPortal/modules/sales-data/js/` — review every hit; none may carry database
   or user text.
6. `grep -rn "toISOString" WebPortal/modules/sales-data/js/` returns nothing.
7. `grep -c "flushAutoSave" WebPortal/modules/sales-data/js/sales_data_grid.js` is at least 4 —
   definition plus the tab-switch, period-change and route-exit call sites.
8. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty.

**No verify step may need a browser, a logged-in session, a screenshot, a database, or the deployed
demo site.** Playwright here targets `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run in the fleet job.

## Out of scope

Every dataset other than `production_daily`; Excel paste; the forecast tabs; making the report's
figures read-only; applying any migration; editing any Playwright spec, `WebPortal/help/*`,
`docs/**`, or `permission-module-map.js`.
