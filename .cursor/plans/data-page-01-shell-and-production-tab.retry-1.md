---
retry_of: a840f54b-db01-4e5e-a24f-3ac93bfa69c7
---

# Sales & Production Data page — shell, period selector, and the production tab

## Context

Pete (Sales Exec) runs Macavation from Excel. A report builder is already merged and live on `dev`.
The decision has now been made that **all of Pete's data lives on a standing page — his spreadsheets,
in the app — and the report becomes commentary over figures read from it.**

The backend is built and merged. Every RPC this plan calls exists in
`migrations/20260819090000_data_page_production_daily.sql` or
`migrations/20260817090000_report_builder_foundations.sql`. **Whether those migrations have been
applied to any given database cannot be verified from this checkout — do not state or assume that
they have, and do not state how many rows any database holds.** The screen must degrade gracefully
when they have not.

Assume the target table may already hold a large volume of real, human-corrected history. A wrong
write here is not recoverable from this UI, which is why the save rules below are mandatory and not
suggestions.

This plan builds **the page shell and one tab**. The remaining tabs are a later plan and are out of
scope — build the shell so adding a tab is a column definition, not new rendering code.

## Verified repo facts — trust these, do not re-derive

- **No framework, no build step.** jQuery + Bootstrap 5.3, libraries via CDN in
  `WebPortal/index.html`. `WebPortal/` is the only deployed tree. **Ignore `.claude/worktrees/**` —
  stale copies whose line numbers differ from the live tree.**
- A route needs an entry in **both** `WebPortal/js/appRouteConfig.json` **and** the hardcoded
  `moduleInitializers` map inside `initializeModule()` in `WebPortal/js/appRouter.js` (the
  `'sales-forecasting-grid'` entry is at line 433 and calls a **global function**,
  `initializeReportListGrid()`, not a module object). A route in only one file silently renders
  nothing.
- **No deep-linking** — the router never reads the URL. Use `Session.set/get`
  (`WebPortal/js/session.js:68,74`).
- `data-action-perm` is swept **once** over static markup ~100 ms after route load
  (`appRouter.js:253-256`); it is inert on anything rendered later. For dynamic rows use
  `typeof hasAction === 'function' && hasAction('<key>')` inline (`action-access.js:95`).
  **`hasAction('')` returns `true`** (`action-access.js:44`) — never call it with an empty key.
  `actionAccess.apply` only hides/disables markup; it is not a server-side guarantee.
- **The module skeleton to copy is `WebPortal/modules/sales-reports/js/report_list_grid.js`.** Its
  own doc-comment records that it deliberately fixes three defects in `users_grid.js`: events
  namespaced and removed in `destroy()`; `init()` calls `destroy()` first; every database value
  reaches the DOM via `.text()` or a self-escaping helper. Copy all three.
- **The row-grid pattern to copy is the kernel job card**:
  `modal_kernel_job_card.js` plus `kernel_job_card_stock.js:82-98` (`collectStyleRowsFromDom` walks
  every `<tr>`, parses numbers, drops blank rows, and the whole array is saved in **one** RPC).
  Totals recompute on every keystroke via a delegated `input` handler
  (`modal_kernel_job_card.js:264-267`).
  **Copy its one-RPC-array shape and its recompute-on-input shape, but NOT its bindings:** those
  handlers are unnamespaced `$(document).on(...)` and survive a route swap. Every handler in this
  module is namespaced `.salesData` and removed in `destroy()`.
- **Do NOT copy `modal_oil_bulk_add_stock.js`'s save loop** — one RPC per row, so N rows is N round
  trips and a mid-loop failure leaves earlier rows committed.
- **Bulk save convention**: one RPC taking a jsonb array. **Pass the array itself — never
  `JSON.stringify` it** (`data-functions.js:6116-6118` explains why; the server also rejects a
  pre-stringified array at `20260819090000_data_page_production_daily.sql:368-373`).
- **Numbers**: `parseLocaleNumber()` (`kernel_job_card_stock.js:11-21`) **returns `0` for a blank or
  unparseable value.** That fallback is correct for a totals row and **wrong for every nullable
  column on this screen** — see Deliverable 3 for the null-preserving parser that must be used
  instead when building a save payload. kg inputs are `type="number" step="0.01"`. Rounding is
  `Math.round(x*100)/100`. For display reuse the locale-independent `formatNumber()` approach in
  `report-metric-line.js:21-29` (no `toLocaleString` / `Intl`, so it is identical across browsers
  and inside a Node test).
- **Period boundaries resolve on the SERVER** — see the period contract below. Date conversion
  between the picker's `dd/mm/yyyy` and ISO is string-splitting only
  (`report_list_grid.js:58-65`) — **no `toISOString()`**, which shifts across a day boundary for a
  South African user.
- **Flatpickr idiom**: a local `var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false,
  disableMobile: true };` per file, lazily initialised and guarded by `el._flatpickr`
  (`report_list_grid.js:23,232-236`).
- **There is no `beforeunload` anywhere in this app.** The established substitutes are debounced
  autosave plus a `localStorage` draft (`modal_production_stages.js:1774-1795`, `AUTO_SAVE_DELAY_MS
  = 900` at `:211`), and `appRouter.js`'s `promptOnFormExit` (defined at `:584`, called only from
  the delegated `a[route]` click handler at `:87`). **`_appRouter.routeTo` (`:561-583`) does not
  call `promptOnFormExit`,** and in-app code navigates that way (`report_list_grid.js:106`). Both
  are extension points; see Deliverable 3.
- **Missing-RPC convention**: wrap every call so a missing RPC renders `macEmptyState(...)` rather
  than white-screening (`report_list_grid.js:211-221` and three more places). Shared helpers:
  `macLoadingRow`/`macEmptyRow`/`macEmptyState` (`ui-states.js:17-40`), `MacStatus.pill`,
  `MacTableActions`.
- **`MacStatus.pill(status, labelOverride)` accepts no title/tooltip argument** — it returns
  `<span class="mac-pill mac-pill-<tone>">label</span>` (`mac-status.js:61-64`). To attach a
  tooltip, wrap the returned string with `$(...)` and set `.attr('title', text)`; never build the
  attribute by concatenation.
- Sidebar visibility is driven purely by `Session.get('featureKeys')`
  (`menu-filter.js:43-98`); `role-menu-config.js` needs no edit for a new route.
- `npm run ui:verify` gates: no raw hex outside `WebPortal/css/design-tokens.css` (use `--mac-*`
  tokens), Font Awesome icons only, `btn-primary` not `btn-success`, no `linear-gradient`, no
  `.swal2-*` outside `css/swal-theme.css`, no bare `td`/`th` padding in module CSS, no `min-width`
  on `.badge`. `npm run registry:verify` fails on any path in `appRouteConfig.json` missing on disk
  (resolved as `WebPortal/<basePath>/<route.path>/<asset>`, `basePath` is `"modules"`).
- `package.json` sets **`"type": "module"`** and there are no dependencies (`npm ci` fails here).
  A `WebPortal/**/*.js` file therefore **cannot be `require()`d** — the Node check in Verification
  must evaluate it with `vm.Script`, the approach recorded in `report-metric-line.js:1-11`.

## The period contract — verified, follow exactly

- `public.get_report_current_period(p_period_type text)`
  (`migrations/20260817090000_report_builder_foundations.sql:144-166`) takes **only** the period
  type and resolves the period containing **`CURRENT_DATE`**. **It cannot be given a date. Never
  pass it `p_date`, `p_period_date` or anything else** — PostgREST resolves an overload from the
  exact parameter-name set and an extra key produces "Could not find the function … in the schema
  cache", which is indistinguishable from an unapplied migration.
- For an arbitrary picked date, the server functions to call are, both existing and both granted to
  `anon` (`:746-747`):
  - `public.report_normalise_period_start(p_period_type text, p_date date)` (`:92-102`) → the
    Monday (weekly) or the 1st (monthly) of the period containing `p_date`; `NULL` for an unknown
    period type.
  - `public.report_period_end(p_period_type text, p_period_start date)` (`:108-119`) → the
    inclusive last day.
- Both are scalar-returning, so `callFunction` may hand back a **bare JSON string**
  (`data-functions.js:632-639`) rather than a row array. Normalise defensively and keep every shape
  working — see `scalarIsoDate` in Deliverable 1.
- Both have **no parameter DEFAULTs**, so never call them with `null` or `''`: a stripped param
  becomes a "function not found" (`data-functions.js:745-751`). Validate the ISO date with
  `/^\d{4}-\d{2}-\d{2}$/` before calling.
- **Never compute a period boundary in JavaScript.** The single permitted client-side date
  computation in this plan is `shiftIsoDateByOneDay` (Deliverable 1), used only to produce a date
  *inside* the adjacent period, which the server then snaps to a boundary.

## RPC contracts — these exist; call them exactly

Reached via `dataFunctions.callFunction(name, params)`. Parameter names must match, `p_` prefix
included.

| RPC | Params | Returns |
|---|---|---|
| `get_data_datasets` | none | rows: `dataset_key, label, description, table_name, period_column, period_kind, report_section_key, supports_reseed, display_order` |
| `get_report_current_period` | `p_period_type` (`'weekly'`\|`'monthly'`, **no default, no date argument**) | one row: `period_type, period_start, period_end, fy, fy_month_index, period_label` |
| `report_normalise_period_start` | `p_period_type`, `p_date` (both required) | scalar date (period start) |
| `report_period_end` | `p_period_type`, `p_period_start` (both required) | scalar date (inclusive period end) |
| `get_data_production_daily` | `p_date_from`, `p_date_to`, `p_limit` (100), `p_offset` (0) | rows incl. `id, production_date, cracked_kg_system, cracked_kg, cracked_kg_live, sk_packed_kg_system, sk_packed_kg, sk_packed_kg_live, wholes_pct, uncracks_pct, oil_kernel_kg, cracker_dust_kg, shell_fines_kg, compost_kg, shell_kg, data_source, edited_by_name, edited_at, edit_reason, data_quality_flags, notes, total_count`. `p_limit` capped at 400 |
| `upsert_data_production_daily_rows` | `p_rows` (jsonb array), `p_actor_user_id` | `success (int), error (text), rows_written (int)` |
| `delete_data_production_daily_row` | `p_production_date` | `success, error` |
| `reseed_data_production_daily` | `p_date_from`, `p_date_to`, `p_actor_user_id` | `success, error, rows_reseeded`; rejects a range > 400 days |
| `get_data_production_daily_drift` | `p_date_from`, `p_date_to`, `p_limit`, `p_offset` | rows: `production_date, field_name, stored_system, live_system, effective_value, delta, total_count`; `p_limit` capped at 200 |

Write RPCs return `success = 0` with a readable `error` rather than throwing — test
`Number(row.success) === 1`, and on 0 show the server's text via
`Swal.fire({icon:'error', text: <error>})`. Do not invent a message when the server supplied one.

**An offline write returns `{ success: true, offline: true, queued: true }` and was NOT written**
(`data-functions.js:691-709,794-799`). Detect it exactly as `report_list_grid.js:54-56` does and
treat it as "not saved yet": leave the row dirty and show `Save pending — offline`.

### `upsert_data_production_daily_rows` semantics — read this before writing the save path

Its `ON CONFLICT … DO UPDATE` (`20260819090000_data_page_production_daily.sql:396-411`) sets **every**
editable column from `EXCLUDED`, unconditionally:

- An omitted or empty `wholes_pct, uncracks_pct, oil_kernel_kg, cracker_dust_kg, shell_fines_kg,
  compost_kg, shell_kg, notes` key becomes **`NULL`** (`NULLIF(… , '')`).
- An omitted or empty `cracked_kg` / `sk_packed_kg` becomes **`0`** (`COALESCE(…, 0)`); both columns
  are `NOT NULL DEFAULT 0` (`:94,98`).
- Every row in the array gets `edited_by`, `edited_at = now()` and **`data_source = 'manual'`**
  (`:411`), destroying that row's `'system_seeded'` / `'backfill'` provenance.
- `edit_reason` is the **only** exception: it is `COALESCE(EXCLUDED.edit_reason, t.edit_reason)`
  (`:407`), so a null/omitted `edit_reason` preserves the stored one.

Therefore: **partial row objects are forbidden, and untouched rows must never be in the payload.**

## The three-value model this screen exists to show

Each seedable figure has three numbers, and the grid must keep them distinguishable:

- **`<field>_system`** — the factory figure as at the last seed. **Nullable: `NULL` means never
  seeded** (`:139-141`).
- **`<field>_live`** — the factory figure recomputed *now*, returned by the read RPC. The live
  helpers `COALESCE(SUM(...), 0)`, so live is a number, never null (`:184-190,208-218`).
- **`<field>`** — the effective, report-facing figure. This is the only one the user edits, and
  re-seeding never overwrites it (`:266-271`).

**Cell states — exactly four, and `NULL` system is its own state:**

1. `_system` is `NULL` → **not seeded**. Neutral styling, a muted `Not seeded` note, **no "edited"
   accent, no "drift" accent, no "System now says" note**. A never-seeded row is not evidence that
   the user edited anything and not evidence that the factory changed its mind.
2. `_system` non-null, effective equals `_system`, `_system` equals `_live` → default styling.
3. `_system` non-null and effective differs from `_system` → **edited** accent
   (`var(--mac-info-light)`).
4. `_system` non-null and `_system` differs from `_live` → **drift** accent
   (`var(--mac-warning-light)`, text `var(--mac-warning-text)`) plus a small note under the input
   reading `System now says <formatted live>`. States 3 and 4 can both apply; render both.

All three comparisons are numeric at 2 dp via `sameKg` (Deliverable 1) — never string equality, and
never `==` against `null`.

**Drift badge.** `get_data_production_daily_drift` uses `IS DISTINCT FROM` (`:480,486`), so a
never-seeded day (`stored_system IS NULL`) is returned as drift for both fields. **The badge must
count only returned rows whose `stored_system` is non-null**, and the drift list must show only
those rows. **Do not use the RPC's `total_count` as the badge number** — it includes the
never-seeded rows. Call it with `p_limit: 200` for the visible period: a monthly period is at most
31 days × 2 fields = 62 rows, inside the server's 200 cap, so the filtered count is complete for the
period on screen.

Byproduct columns (`wholes_pct` … `shell_kg`) have **no** system twin — the factory cannot supply
them. Render them as ordinary inputs with no seeded/drift treatment.

## Deliverables

### 1. `WebPortal/modules/sales-data/`

- `html/sales_data_grid.html`, `css/sales_data_grid.css`
- `js/sales-data-column-defs.js` — a pure data registry, **no DOM and no `$`/`document` reference at
  eval time** (same convention as `report-metric-line.js`), exporting
  `window.SalesDataColumnDefs = { get: function (datasetKey) {...}, keys: function () {...} }`.
  Define the `production_daily` dataset only: its columns, labels, types, steps, `hasSystemTwin`,
  `nullable` and `totalable` flags. `get()` must reject `__proto__` / `constructor` / `prototype`
  and return `null` for an unknown key.
- `js/sales-data-row-grid.js` — the generic grid engine driven entirely by a column definition. It
  must not reference any dataset by name, and must not touch `document`/`$` at eval time so it can
  be evaluated with `vm.Script`. It exports **exactly these names** on
  `window.SalesDataRowGrid`, and the rest of this plan and the Node check refer to them by these
  names only:
  - `formatKg(value)` — `formatNumber`-style, locale-independent; returns the no-data text
    `'\u2014'` for `null`/`undefined`/non-finite. Never `"null"`, `NaN` or `0`.
  - `parseNullableNumber(value)` — `null` for `''`/whitespace/`null`/`undefined`; `null` for an
    unparseable string; otherwise `Math.round(n*100)/100`. **It must never fall back to `0`.**
  - `parseTotalNumber(value)` — the `0`-defaulting parse, used **only** for the totals row.
  - `sameKg(a, b)` — both null → `true`; exactly one null → `false`; otherwise equal at 2 dp.
  - `cellState({ system, live, effective })` — returns
    `{ seeded: bool, edited: bool, drifted: bool }` per the four states above; when `system` is
    null, all three are `false`.
  - `totalsFor(def, rows)` — sums only columns whose definition is `totalable`, using
    `parseTotalNumber`.
  - `countSeededDrift(driftRows)` — number of rows whose `stored_system` is non-null.
  - `scalarIsoDate(result)` — accepts a bare string, a one-element array of objects, or a plain
    object, returns the first `yyyy-mm-dd` value found or `null` if none matches
    `/^\d{4}-\d{2}-\d{2}$/`. Keep all three shapes handled.
  - `shiftIsoDateByOneDay(iso, delta)` — `delta` must be exactly `1` or `-1`, else return `null`.
    Implemented with `Date.UTC(y, m-1, d)` plus `getUTCFullYear/getUTCMonth/getUTCDate` and manual
    zero-padding **only**. No `toISOString()`, no `new Date('<string>')`, no local-time getters.
    Returns `null` for any input not matching `/^\d{4}-\d{2}-\d{2}$/`.
  - Row rendering, DOM collection and totals rendering functions (browser-only, called from the
    controller).
- `js/sales_data_grid.js` — the page controller, an IIFE assigned to `var _salesDataGrid`, exposing
  `init()`, `destroy()`, `flushAutoSave()` and `hasPendingEdits()`, plus a global
  `function initializeSalesDataGrid() { _salesDataGrid.init(); }`. `init()` calls `destroy()` first.
  All handlers namespaced `.salesData` and removed in `destroy()`.

Load order in the route's `js` array: defs → engine → controller.

### 2. Screen

A period bar (Weekly/Monthly radio + a Flatpickr date + prev/next), a Bootstrap `nav-tabs` strip
generated from `get_data_datasets()`, and a tab pane per dataset. Only `production_daily` renders
content in this plan; every other tab renders
`macEmptyState('fa-table', 'Not built yet', 'This dataset arrives in a later release.')`.

**Period resolution — the only permitted mechanism:**

1. **Initial load and any period-type change with an empty picker:** reuse the existing wrapper
   `dataFunctions.getReportCurrentPeriod(periodType)` (`data-functions.js:5938-5949`). Do **not**
   write a second wrapper for that RPC. Take `period_start`, `period_end`, `period_label` from its
   row (`firstRpcRow`-style normalisation as in `report_list_grid.js:50-52`) and set the picker to
   `period_start` by string split.
2. **A user-picked date:** ISO-ise the `dd/mm/yyyy` value by string split
   (`report_list_grid.js:58-65`), then
   `start = scalarIsoDate(await dataFunctions.getReportPeriodStart(periodType, iso))` and
   `end = scalarIsoDate(await dataFunctions.getReportPeriodEnd(periodType, start))`.
3. **Prev:** `candidate = SalesDataRowGrid.shiftIsoDateByOneDay(currentStart, -1)`, then step 2 from
   `candidate`. **Next:** `candidate = SalesDataRowGrid.shiftIsoDateByOneDay(currentEnd, 1)`, then
   step 2. The boundary always comes back from the server; the client only ever moves one day.
4. If `start` or `end` is `null` — the helper returned nothing, or the RPC failed — **do not guess a
   range and do not compute one in JS.** Render
   `macEmptyState('fa-table', 'Period could not be resolved', 'The report-builder migrations have not been applied to this database.')`
   in the production pane, `console.warn` the RPC name and the error, leave the grid empty, and keep
   the "Refresh from factory" button disabled. A period-resolution failure and a
   production-data failure must log distinguishable messages so a genuine deployment gap is not
   confused with a call-shape bug.
5. Only with a resolved `start`/`end` may `get_data_production_daily` and
   `reseed_data_production_daily` be called, and they must be given exactly those two values.

The resolved `{ periodType, start, end, label }` is the single source of truth for the loaded range;
store it in module state and in `Session` (no deep-linking). Show `period_label` when the RPC
supplied one, via `.text()`.

**Production grid.** One row per day returned (days with no stored row simply do not appear).
Columns: Date (plain text, not an input — it is the row's identity) · Cracked · Packed · Wholes % ·
Uncracks % · Oil kernel · Cracker dust · Shell fines · Compost · Shell · Notes. A `<tfoot>` totals
row for the kg columns via `totalsFor`, recomputed on every `input` event by a delegated,
namespaced handler.

Cell styling for `cracked_kg` and `sk_packed_kg` follows the four states above using
`design-tokens.css` tokens (`--mac-info-light`, `--mac-warning-light`, `--mac-warning-text`) — no
raw hex, no new hex in module CSS.

A row whose `data_quality_flags` (a `text[]`, so a JS array) is non-empty shows a pill built as
`$(MacStatus.pill('warning', 'Check')).attr('title', flags.map(String).join(', '))` — the flags text
reaches the DOM only as an attribute set through jQuery, never through `.html()` or concatenation.
These mark rows the historical backfill could not fully trust. **Do not hide or auto-correct them.**

**Edit gating.** Every input is rendered `disabled` unless
`typeof hasAction === 'function' && hasAction('reports.data.edit')` (non-empty key, evaluated inline
at render time because the router's sweep is inert on dynamic rows). The save path re-checks the
same key before calling the write RPC. This is a UI gate only — the RPCs are granted to `anon`
(`20260819090000_…:543-550`), so do not describe it as server-enforced.

### 3. Saving

**Debounced autosave, one bulk array call per save** — the job-card model, not the oil-bulk-add loop.
One shared timer for the tab (900 ms, matching `AUTO_SAVE_DELAY_MS`), so a burst of edits across
rows collapses into one call. Show a small inline status (`Saving… / Saved / Save failed /
Save pending — offline`) rather than a toast per save.

**Payload rules — all mandatory, because the server overwrites every column it is given:**

- **Dirty-row filter.** Maintain `state.dirtyDates`, a `Set` of ISO `production_date` strings. A row
  is added only from a real `input`/`change` event on one of *its* inputs, and the row's `<tr>` also
  carries `data-dirty="1"`. **Only rows in `state.dirtyDates` may appear in `p_rows`.** Never send a
  row the user has not edited — doing so stamps `edited_by`/`edited_at` and rewrites
  `data_source = 'manual'` on rows with real provenance.
- **Whole-row payload.** For each dirty row, send an object with `production_date` plus **all ten**
  editable keys read from that row's own inputs: `cracked_kg, sk_packed_kg, wholes_pct,
  uncracks_pct, oil_kernel_kg, cracker_dust_kg, shell_fines_kg, compost_kg, shell_kg, notes`. Never
  send a subset. `edit_reason` may be sent only when the user typed one (the server preserves the
  stored value on null, `:407`).
- **Nullable columns use `parseNullableNumber`, never `parseLocaleNumber`.** A cleared byproduct
  input must serialise as `null` (an intentional clear on a row the user edited), not `0`.
  `parseLocaleNumber`'s `0` fallback is used **only** inside `parseTotalNumber` for the `<tfoot>`.
- **Blank cracked/packed holds the row back.** If a dirty row's `cracked_kg` or `sk_packed_kg` input
  is blank or unparseable, exclude that row from the payload, mark the cell invalid with an inline
  message (`Cracked and Packed cannot be blank`), and leave the row dirty. The other dirty rows
  still save. Never let a blank reach the server, because it becomes `0`.
- `notes` and `edit_reason` are sent as trimmed strings or `null`; they are user text and reach the
  DOM only via `.text()`.
- Pass the array itself as `p_rows` — no `JSON.stringify`. Pass the acting user id as
  `p_actor_user_id`.
- On `Number(success) === 1`: clear the saved rows' dirty flags, then reload the period with
  `forceRefresh` so the now-`'manual'` `data_source`, `edited_by_name` and `edited_at` displayed are
  truthful. On `success = 0`: keep the rows dirty and show the server's `error`. On an
  offline-queued response: keep the rows dirty, status `Save pending — offline`.

**`flushAutoSave()`** must: clear the pending timer, **synchronously** build the payload from the
DOM, and then return a Promise for the RPC (or a resolved Promise when there is nothing dirty). The
synchronous collection is what makes it safe at a call site that cannot await.

It must be reached from **every** exit path:

1. Tab switch — `await _salesDataGrid.flushAutoSave()` before swapping panes.
2. Period change (radio, picker, prev, next) — `await _salesDataGrid.flushAutoSave()` before
   resolving the new period.
3. `appRouter.js`'s `promptOnFormExit` (`:584`) — add, **before** the existing
   `isLeavingStockKernel` check and without returning early, a guarded
   `if (_appRouter.currentRoute === 'sales-data-grid' && typeof _salesDataGrid !== 'undefined' && _salesDataGrid.flushAutoSave) { try { await _salesDataGrid.flushAutoSave(); } catch (e) { console.warn(e); } }`.
   **No confirmation dialog** — just flush. The existing stock-kernel branch, the iframe branch and
   the final `doNavigate()` must all still run unchanged.
4. `appRouter.js`'s `routeTo` (`:561`) — `promptOnFormExit` is **not** reached from here, and in-app
   code navigates this way (`report_list_grid.js:106`). Add the same guarded flush as the **first**
   statement of `routeTo`, called **without** `await` and wrapped in `try/catch`: the DOM read has
   already happened synchronously by the time `loadContent` replaces the markup. **Do not make
   `routeTo` `async`, do not change its parameters, and do not change its return value** — callers
   ignore it and several are not in async functions.

**Do not touch `appRouter.js`'s `getEnvironment` function, its body, or its indentation.**
`routing:verify` extracts it by the regex `/getEnvironment: \(\) => \{([\s\S]*?)\n        \},/`
(`scripts/verify-routing-guarantee.cjs:29`) and fails the whole fleet gate if that shape changes.

### 4. Re-seed and drift

A "Refresh from factory" button, in the **static** markup of `sales_data_grid.html` (so the router's
one-time `data-action-perm` sweep applies), gated `data-action-perm="reports.data.edit"`, and
re-checked in JS with `hasAction('reports.data.edit')` before the call. It calls
`reseed_data_production_daily` with the resolved `start`/`end`, awaits `flushAutoSave()` first, then
reloads with `forceRefresh`. It stays disabled while no period is resolved.

Confirm first via `Swal`, stating plainly that it refreshes the factory column only, **will not
change any figure the user has entered** (`:266-271`), and **will create rows for days in the range
that have none** (`:254-265`).

A "Drift" count badge from `get_data_production_daily_drift` for the visible period
(`p_limit: 200`), whose number is `SalesDataRowGrid.countSeededDrift(rows)` — never the RPC's
`total_count`. It opens a read-only list of those same non-null-`stored_system` rows: date, field,
stored system, live system, delta, each via `.text()` after `formatKg`. No `min-width` on the badge.

### 5. Wiring

- `WebPortal/js/appRouteConfig.json`: `sales-data-grid` → `path: "sales-data"`, the html/js/css
  above, `js` in the order defs → engine → controller. Keep the file valid JSON.
- `WebPortal/js/appRouter.js`: a matching `'sales-data-grid'` entry in the `moduleInitializers` map
  calling the global `initializeSalesDataGrid()` if it is a function, in the same shape as the
  `'sales-forecasting-grid'` entry at `:433`.
- `WebPortal/index.html`: sidebar `<li class="nav-item d-none" data-route="sales-data-grid">` inside
  `businessCollapse`, **directly below the existing Sales & Production Reports item** (`:274-278`),
  with `<i class="fas fa-table me-2">` (`fa-file-invoice` is already used by the report list). The
  item stays hidden until the RBAC migration below is applied and the user signs out and in again
  (`menu-filter.js` reads `Session.get('featureKeys')`, cached at login) — that is expected, not a
  bug to work around.
- `WebPortal/js/data-functions.js`: wrappers `getDataDatasets`, `getDataProductionDaily`,
  `upsertDataProductionDailyRows`, `deleteDataProductionDailyRow` (wrapper only; no delete UI in
  this plan), `reseedDataProductionDaily`, `getDataProductionDailyDrift`, plus the two period
  helpers **named exactly**:
  - `getReportPeriodStart(periodType, isoDate, token = null, forceRefresh = false)` →
    `callFunction('report_normalise_period_start', { p_period_type, p_date })`
  - `getReportPeriodEnd(periodType, isoPeriodStart, token = null, forceRefresh = false)` →
    `callFunction('report_period_end', { p_period_type, p_period_start })`

  Both throw a clear local error if the period type is blank or the date does not match
  `/^\d{4}-\d{2}-\d{2}$/`, so a no-DEFAULT param can never be stripped to a "function not found".
  Reads take an explicit `cacheKey` prefixed `sales_data_` with `cacheTtl: this.cache.ttl.dynamic`
  and honour `forceRefresh`; writes pass `useCache: false` and call
  `clearCachePattern('sales_data_')` afterwards. **Do not add a wrapper for
  `get_report_current_period` — reuse the existing `getReportCurrentPeriod`.**
- A migration seeding `features` (`sales-data-grid`) and `actions` (`reports.data.edit`), modelled on
  `migrations/20260817110000_report_builder_rbac.sql` (features/actions seeds only, no function
  grants, `NOTIFY pgrst, 'reload schema';` at the end), granted to `super_user`, `admin`,
  `Sales Exec`, `Palladium Manager` **only** — do not loop over every role and do not touch
  `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` (`CLAUDE.md:34-39` records
  that pattern as the cause of this repo's permission drift). `role_features.value` and
  `role_actions.value` are **`text`**, so the literal is `'true'`. `actions.module` has no default
  and must be supplied. The filename prefix must be **14 digits that parse as a real UTC timestamp**
  (`scripts/verify-migration-prefixes.mjs` rules 1-3), unique, and later than every existing file —
  the highest currently present is `20260819120000`, so e.g. `20260820090000` works. Check
  `ls migrations/ | sort | tail -3` at write time.
  **You cannot apply it** — the fleet has no database credentials. Author the file only.

## Security invariants

- **Never pass database or user text through `.html()`, `innerHTML`, or string concatenation into
  markup.** Build the element, set `.text()`, or set an attribute with `.attr()`. Covers notes, edit
  reasons, `edited_by_name`, dataset labels, period labels and quality flags. Numbers only after
  `Number()` conversion.
- Validate any uuid from a `data-*` attribute with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before use. Validate any date
  from a `data-*` attribute with `/^\d{4}-\d{2}-\d{2}$/` before it reaches an RPC.
- Never use a payload value as an object property key without rejecting `__proto__`, `constructor`
  and `prototype`. Prefer a `Map` or a `Set` (`state.dirtyDates` is a `Set`).
- `JSON.parse` only in `try/catch`. No `eval`, no `new Function`, no string-form `setTimeout`.
- Write paths are gated in the client by `hasAction('reports.data.edit')` with a non-empty key; the
  server grants these RPCs to `anon`, so never present the client gate as server enforcement.

## Verification — all runnable in the checkout: no browser, no login, no network

1. `npm run test:fleet` passes (`routing:verify && username:verify && verify-phase2-migrations &&
   ui:verify && migrations:verify && registry:verify`). `ui:verify` is the likely failure for a new
   module; `routing:verify` is the one the `appRouter.js` edits could break.
2. `grep -n "sales-data-grid" WebPortal/js/appRouter.js` returns a match — the `moduleInitializers`
   entry is the step most often missed.
3. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
4. **A pure `node` check of the engine's value helpers**, no browser and no network. Because
   `package.json` is `"type": "module"`, write a scratch `scripts/tmp-verify-sales-data.cjs` that
   reads `sales-data-column-defs.js` and `sales-data-row-grid.js` and evaluates each with
   `new vm.Script(src).runInNewContext(ctx)` where `ctx` is a bare object used as `window` (the
   pattern recorded in `report-metric-line.js:1-11`) — do **not** `require()` them. Assert:
   - `formatKg(null)` is `'\u2014'`; never `"null"`, `"NaN"` or `"0"`.
   - `parseNullableNumber('')`, `parseNullableNumber(null)` and `parseNullableNumber('abc')` are all
     `null` — **not `0`**; `parseNullableNumber('1 234,5')` is a number.
   - `parseTotalNumber('')` is `0` (the totals-only fallback).
   - `sameKg(null, null)` is `true`; `sameKg(null, 0)` is `false`; `sameKg(1.004, 1.0)` is `true`.
   - `cellState({system: null, live: 12, effective: 12})` is
     `{seeded: false, edited: false, drifted: false}`; `cellState({system: 10, live: 12,
     effective: 10})` has `drifted: true, edited: false`; `cellState({system: 10, live: 10,
     effective: 11})` has `edited: true, drifted: false`.
   - `totalsFor` sums only the columns marked totalable.
   - `countSeededDrift([{stored_system: null}, {stored_system: 5}])` is `1`.
   - `scalarIsoDate('2026-08-03')`, `scalarIsoDate([{report_normalise_period_start: '2026-08-03'}])`
     and `scalarIsoDate({report_period_end: '2026-08-09'})` all return the ISO string;
     `scalarIsoDate(null)` and `scalarIsoDate('not a date')` return `null`.
   - `shiftIsoDateByOneDay('2026-03-01', -1)` is `'2026-02-28'`;
     `shiftIsoDateByOneDay('2028-02-28', 1)` is `'2028-02-29'`;
     `shiftIsoDateByOneDay('2026-12-31', 1)` is `'2027-01-01'`;
     `shiftIsoDateByOneDay('2026-08-03', 2)` and `shiftIsoDateByOneDay('03/08/2026', 1)` are `null`.
   - `SalesDataColumnDefs.get('__proto__')` is `null`.
   Delete the scratch script before finishing.
5. `grep -rn "\.html(" WebPortal/modules/sales-data/js/` — review every hit; none may carry database
   or user text.
6. `grep -rn "toISOString\|toLocaleString\|Intl\." WebPortal/modules/sales-data/js/` returns
   nothing, and `grep -rn "new Date(" WebPortal/modules/sales-data/js/` shows only the
   `new Date(Date.UTC(...))` line inside `shiftIsoDateByOneDay`.
7. `grep -n "flushAutoSave" WebPortal/modules/sales-data/js/sales_data_grid.js` shows the definition
   plus the tab-switch and period-change call sites (at least 3 hits), **and**
   `grep -c "flushAutoSave" WebPortal/js/appRouter.js` is at least 2 — one in `promptOnFormExit`,
   one as the first statement of `routeTo`.
8. `grep -n "_salesDataGrid\|initializeSalesDataGrid\|SalesDataRowGrid\|SalesDataColumnDefs" -r
   WebPortal/js/ WebPortal/modules/sales-data/js/` — every identifier referenced is defined
   somewhere in the diff under exactly that spelling.
9. `grep -n "getEnvironment" WebPortal/js/appRouter.js` and `git diff WebPortal/js/appRouter.js` —
   confirm the `getEnvironment` block is byte-identical to the base branch.
10. `grep -rn "p_date\b" WebPortal/js/data-functions.js | grep -n "current_period"` returns nothing —
    `get_report_current_period` is never given a date parameter.
11. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty.

**No verify step may need a browser, a logged-in session, a screenshot, a database, or the deployed
demo site.** Playwright here targets `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run in the fleet job.

## Out of scope

Every dataset other than `production_daily`; Excel paste; the forecast tabs; making the report's
figures read-only; applying any migration; changing any RPC in
`migrations/20260819090000_data_page_production_daily.sql` or
`migrations/20260817090000_report_builder_foundations.sql` (including adding a
date-taking overload of `get_report_current_period`); editing `role-menu-config.js`, any Playwright
spec, `WebPortal/help/*`, `docs/**`, or `permission-module-map.js`.
