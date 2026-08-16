# Kernel Sales tab on the Sales & Production Data page

## Goal

Make the **Kernel Sales** tab work. Today it renders "Kernel Sales is not built yet" because the tab
strip is server-driven while the columns are client-side, and only `production_daily` has a column
definition.

Every RPC this tab needs already exists **and is already applied to the dev database**. No migration
is in scope. This plan is client-side only.

## Why this is more than a column definition

`production_daily` is **one row per day** (`UNIQUE (production_date)`). `data_kernel_sales_lines` is
a **ledger**: `id uuid` primary key, many rows per date. Four assumptions in the current engine are
date-keyed and must be generalised — additively, without changing how production behaves:

| Assumption | Where | What the ledger needs |
|---|---|---|
| Row identity is the date | `sales-data-row-grid.js:197` stamps `data-date`; `:280` reads it back | `data-row-id` when the dataset has an id column |
| Only `number` / `text` columns | `sales-data-row-grid.js:210` and `:284` | `select` (fixed options) and `lookup` (options fetched once) |
| Rows can't be added or removed | nothing in the module does this | "Add line" plus a per-row delete |
| Totals only over `totalable` numbers | `renderTotalsRow`, `sales-data-row-grid.js:295` | unchanged, but must total the money columns |

## FIXED contracts — verified against `origin/dev` while drafting

Do not restate these from memory; they are the contract.

**`get_data_kernel_sales_lines(p_date_from date, p_date_to date, p_limit integer, p_offset integer)`**
— `migrations/20260819100000_data_page_sales.sql`. Returns, in this order:
`id, sale_date, customer_id, customer_name, invoice_number, item_code, style_code, description,
cartons, quantity_kg, price_per_kg, vat_excl_zar, vat_zar, vat_incl_zar, data_source,
edited_by_name, edited_at, data_quality_flags, notes, total_count`.
**`p_limit` is capped at 500 server-side** — request 500.
Note it does **not** return `edit_reason`, unlike the production RPC. Do not render one.

**`upsert_data_kernel_sales_lines(p_rows jsonb, p_actor_user_id uuid)`** — same file.
Two traps, both load-bearing:

1. **It is a whole-row upsert, not a patch.** `customer_id`, `invoice_number`, `item_code`,
   `style_code`, `description`, `cartons`, `price_per_kg` and `notes` are assigned as
   `NULLIF(r ->> '<col>', '')` with **no `COALESCE` back to the existing row value**. Any column
   omitted from a payload row is **nulled out in the database**. So every save must send every
   column of that row — exactly what `collectRowPayload` (`sales-data-row-grid.js:276`) already
   does. **Do not add a "send only changed fields" optimisation**; it would silently wipe data.
2. **Rows without an `id` are inserts, and an insert with no `sale_date` is silently skipped** —
   the `INSERT ... SELECT` is filtered by `WHERE NULLIF(r ->> 'id','') IS NULL AND
   NULLIF(r ->> 'sale_date','') IS NOT NULL`, so a new blank line reports success while writing
   nothing. Validate `sale_date` client-side before sending, and keep the row marked dirty if it
   is missing — mirroring how `flushAutoSave` (`sales_data_grid.js:241`) already holds back a
   production row missing Cracked/Packed.

**`delete_data_kernel_sales_line(p_id uuid)`** — same file. Returns `(success integer, error text)`.

**`get_contacts()`** — already wrapped as `dataFunctions.getContacts()`, `data-functions.js:2333`.
It normalises four possible response shapes; reuse the wrapper, do not call the RPC directly.

**`get_kernel_styles(p_include_inactive boolean DEFAULT false)`** —
`migrations/20260817090000_report_builder_foundations.sql`. Returns
`id, style_code, label, packing_field, cartons_field, category, display_order, is_active, notes`.
**There is no client wrapper for it yet** — this plan adds one.

## Deliverables

### 1. `WebPortal/js/data-functions.js` — four wrappers

Add beside the existing data-page wrappers (`getDataProductionDaily` is at `:6146`), following their
established shape exactly: `callFunction`, a `cacheKey`, `this.cache.ttl.dynamic` for row reads,
and `this.clearCachePattern('sales_data_')` after every write.

- `getDataKernelSalesLines(dateFrom, dateTo, limit = 500, offset = 0, token = null, forceRefresh = false)`
- `upsertDataKernelSalesLines(rows, token = null)` — passes `p_rows: Array.isArray(rows) ? rows : [rows]`
  and `p_actor_user_id: this.getCurrentUserId() || null`. **Pass the array itself, never
  `JSON.stringify(rows)`** — PostgREST serialises the body, so a pre-stringified array arrives as a
  jsonb *string* and the RPC rejects it. `upsertDataProductionDailyRows` (`:6163`) is the reference.
- `deleteDataKernelSalesLine(id, token = null)` — validate the id is a non-empty string before
  calling and throw a clean local error otherwise.
- `getKernelStyles(includeInactive = false, token = null, forceRefresh = false)` — cache under
  `this.cache.ttl.static`, like `getContacts`.

### 2. `WebPortal/modules/sales-data/js/sales-data-column-defs.js` — the dataset definition

Add a `kernel_sales_lines` entry to `DATASETS` (`:109`). Keep the file a pure data registry — no
DOM, no `$` at evaluation time — so it still loads under `vm.Script`.

The definition gains two optional keys the engine will read, both absent from `production_daily`
so its behaviour is unchanged:

- `idColumn: 'id'` — presence of this switches the engine to id-keyed rows.
- `allowAddRemove: true`.

Columns, in display order (`dateColumn: 'sale_date'`):

| key | label | type | notes |
|---|---|---|---|
| `sale_date` | Date | `date` | required; the row is not saved without it |
| `customer_id` | Customer | `lookup` | options from `getContacts`; also writes `customer_name` |
| `invoice_number` | Invoice | `text` | |
| `item_code` | Item code | `text` | |
| `style_code` | Style | `lookup` | options from `getKernelStyles`; value `style_code`, label `label` |
| `description` | Description | `text` | |
| `cartons` | Cartons | `number`, step `0.01` | |
| `quantity_kg` | Kg | `number`, step `0.01`, `totalable` | |
| `price_per_kg` | Price/kg | `number`, step `0.0001` | `numeric(12,4)` — **step must be `0.0001`, not `0.01`** |
| `vat_excl_zar` | Excl VAT | `number`, step `0.01`, `totalable` | derived, overridable |
| `vat_zar` | VAT | `number`, step `0.01`, `totalable` | derived, overridable |
| `vat_incl_zar` | Incl VAT | `number`, step `0.01`, `totalable` | derived, overridable |
| `notes` | Notes | `text` | |

`price_per_kg` is `numeric(12,4)`. `parseNullableNumber` already rounds to the scale a column's
`step` implies via `decimalsForStep` (`sales-data-row-grid.js:55`), so `step: '0.0001'` is what
preserves the 4th decimal. A `step` of `0.01` here would silently truncate prices.

**No column has a `_system` twin.** `data_kernel_sales_lines` has no `*_system` columns and
`supports_reseed` is `false` for this dataset, so `hasSystemTwin` must be `false` throughout and the
tab must not show a "Refresh from factory" control.

### 3. `WebPortal/modules/sales-data/js/sales-data-row-grid.js` — engine, additive only

Everything below must leave the production path byte-identical in behaviour. `production_daily` has
no `idColumn`, so every new branch is gated on its presence.

- **`rowKeyOf(def, row)`** — returns `String(row.id)` when `def.idColumn` is set, else the date.
- **`buildRow`** (`:193`) — when `def.idColumn` is set, stamp `data-row-id` on the `<tr>` instead of
  `data-date`. Keep the existing `data-date` branch untouched.
- **`collectRowPayload`** (`:276`) — when `def.idColumn` is set, read `data-row-id` and emit it as
  `id`, omitting `id` entirely for a new unsaved row (an empty string would be sent as `''`, and the
  RPC's `NULLIF(r ->> 'id','')` treats that as an insert — but omitting is clearer and equally
  correct). Continue emitting the date column from its own input.
- **New column type `date`** — an `<input type="date">` bound to the ISO value. Do **not** use
  Flatpickr inside grid cells; the page's Flatpickr instance is configured for the period bar
  (`FLATPICKR_DDMMYYYY`, `sales_data_grid.js:31`) and attaching per-cell pickers to dynamically
  added rows is a lifecycle problem this plan does not need. A native date input already yields
  `yyyy-mm-dd`, which is what the RPC wants.
- **New column types `select` and `lookup`** — both render a `<select>`. `select` takes a static
  `options: [{value, label}]` array from the definition; `lookup` takes options supplied at render
  time by the controller (already fetched). Both must include a leading blank option so a value can
  be cleared.
  **Build every `<option>` with jQuery `.text()` for the label and `.val()` for the value — never
  string-concatenated markup.** Customer names and style labels are database values.
  **Preserve an unmatched value**: 63 of the 277 backfilled rows have a `customer_name` but a null
  `customer_id`. If a row's current value is not among the options, prepend an option carrying that
  row's stored text so it displays and round-trips instead of silently resetting to blank.
- **`recomputeMoney(row)`** — a pure helper, exported and unit-testable:
  `excl = round(quantity_kg × price_per_kg, 2)`, `vat = round(excl × VAT_RATE, 2)`,
  `incl = round(excl + vat, 2)`, with `VAT_RATE = 0.15` as a named module constant.
  Returns `null` (meaning "leave the row alone") if either `quantity_kg` or `price_per_kg` is null.
- **`addBlankRow($tbody, def, editable)`** — appends an empty `<tr>` with no `data-row-id`, defaulting
  `sale_date` to the current From date.
- Export `rowKeyOf`, `recomputeMoney` and `addBlankRow` on `w.SalesDataRowGrid` (`:312`) alongside the
  existing exports. **Do not remove or rename any existing export** — `sales_data_grid.js` calls
  `formatKg`, `parseNullableNumber`, `cellState`, `totalsFor`, `countSeededDrift`, `scalarIsoDate`,
  `shiftIsoDateByOneDay`, `renderRows`, `collectRowPayload` and `renderTotalsRow`.

### 4. `WebPortal/modules/sales-data/js/sales_data_grid.js` — the tab

Model this pane on the production pane in the same file (`buildProductionTableShell` `:137`,
`loadProductionData` `:198`, `flushAutoSave` `:241`, `handleSaveResult` `:287`), and reuse its
helpers rather than reimplementing them: `firstRpcRow` (`:58`), `isQueuedOffline` (`:62`),
`canEdit` (`:66`), `pickerDateToIso` (`:72`).

Read that pane's own header comment first (`sales_data_grid.js:1-21`): it documents two things it
deliberately does *not* copy from `report_list_grid.js` and why. The same reasoning applies here —
in particular, tab switching stays manual so `flushAutoSave()` can complete before a pane is
replaced.

- **Its own date range.** The tab renders a `From` / `To` pair plus an **Apply** button above the
  grid, seeded from `state.start` / `state.end` when the tab is first shown, and thereafter
  independent — changing the page's weekly/monthly period reseeds it, but Pete can widen it to a
  whole financial year. Show a one-line summary above the grid: line count and the Excl / Incl
  totals for the current range. Use `pickerDateToIso` for the dd/mm/yyyy → ISO conversion; **do not
  compute period boundaries client-side** — that rule is stated in the file's header comment and
  still holds.
- **Autosave**, debounced on the same `AUTOSAVE_DEBOUNCE_MS` constant, collecting dirty rows by
  `data-row-id` (and by a per-row DOM reference for new unsaved rows), sending **one array** to
  `upsertDataKernelSalesLines`. A row whose `sale_date` is empty is held back and left dirty, with a
  status message saying so — the same shape as the production pane's Cracked/Packed guard.
- **Money recompute**: when `quantity_kg` or `price_per_kg` changes on a row, call `recomputeMoney`
  and write the three money inputs. **Only on those two fields changing, never on load**, and the
  user may then edit any of the three by hand without it being overwritten. This matters: on dev,
  273 of 277 rows are at standard 15% VAT and 274 of 277 have `excl = qty × price`, but the
  remainder do not — the stored figures are authoritative and must not be "corrected" on render.
- **Add / delete.** An "Add line" button appends a blank row. Each row gets a delete control which,
  for a row with an id, confirms via `Swal` and calls `deleteDataKernelSalesLine`, then reloads; for
  an unsaved new row it just removes the `<tr>`. Both gated on `canEdit()`.
- **Quality flags**: render the existing warning pill (`buildRow` already does this from
  `data_quality_flags`). On dev this tab carries `missing_invoice_number` (15 rows) and
  `suspect_future_date` (8 rows) — they must display, not be filtered out.
- **Wire it into `renderTabContent`** (`:412`) as a `kernel_sales_lines` branch. Every other dataset
  key must keep falling through to the existing "not built yet" empty state.
- **`flushAutoSave` must cover this tab too** — it currently returns early unless
  `state.activeDatasetKey === 'production_daily'` (`:241`). `appRouter` calls it on both `routeTo`
  and `promptOnFormExit`, so leaving that guard in place would silently drop a part-typed sales line
  on navigation.
- Bind every event in the existing `.salesData` namespace (`bindEvents`, `:553`) so the existing
  `destroy()` continues to remove them all.

## Security invariants — state them, don't infer them

- Every database or user value reaches the DOM via `.text()` / `.val()` or an attribute set through
  jQuery. **Never `.html()`, never `innerHTML`, never string concatenation into markup.** This
  includes `<option>` labels, customer names, descriptions, notes and invoice numbers.
  `macEmptyState` / `macEmptyRow` / `MacStatus.pill` escape their own output and stay allowed.
- No database value is written into a URI sink — there is no `img.src`, `href`, `iframe.src` or
  `location` assignment anywhere in this plan. Do not introduce one.
- Writes stay gated on `canEdit()` (`hasAction('reports.data.edit')`, `:66`). The server is the real
  boundary: `role_permissions` already restricts the upsert and delete RPCs to super_user, admin,
  Sales Exec and Palladium Manager.

## Verification — all of it runnable inside the checkout

The agent has **no database credentials, no browser and no authenticated session**. Every step below
is executable offline.

1. `node --check` on each of the four touched files.
2. `npm run test:fleet` — must pass (it runs `routing:verify`, `username:verify`, the phase-2
   migration check, `ui:verify`, `migrations:verify` and `registry:verify`). It passes on `dev`
   today, so any failure is this change's.
3. A headless assertion harness the agent writes to a scratch path, runs with `node`, and pastes the
   output of into its report. It must load `sales-data-column-defs.js` and `sales-data-row-grid.js`
   with `vm.Script` and no DOM (both files are written to allow this) and assert at least:
   - `decimalsForStep('0.0001') === 4`, and `parseNullableNumber('123.4567', 4) === 123.4567` —
     the price precision guard.
   - `recomputeMoney({quantity_kg: 100, price_per_kg: 12.5})` → `{vat_excl_zar: 1250,
     vat_zar: 187.5, vat_incl_zar: 1437.5}`.
   - `recomputeMoney` returns `null` when either input is null.
   - `rowKeyOf` returns the id for `kernel_sales_lines` and the date for `production_daily`.
   - The production definition is **unchanged**: `SalesDataColumnDefs.get('production_daily')` still
     has 10 columns, `cracked_kg` still has `hasSystemTwin: true`, and
     `parseNullableNumber('12.345')` with no second argument still returns `12.35`.
4. `grep -n "innerHTML\|\.html(" WebPortal/modules/sales-data/js/*.js` — every hit must be one of the
   pre-escaped helpers above, and the agent must list them in its report.

**Not in scope as a verify step:** any assertion against the dev database, the deployed site, or a
logged-in session. The July 2026 reconciliation (14 lines, R992,805.90 excl / R1,141,726.79 incl) is
recorded here as context only — **I check that myself after merge.** Do not write those figures into
a code comment as verified fact; the agent cannot confirm them from this checkout.

## Out of scope

Oil & Protein Sales, Oil Export Register and Nut in Shell Intake tabs (same engine, later plans);
Excel paste; any migration; any change to the production tab's behaviour; the report editor.

## One known consequence

`style_code` is null on all 277 backfilled rows and `kernel_style_registry` holds 11 styles, so the
Style dropdown will render populated but every existing row will show blank. That is correct — the
spreadsheet import never carried a style — not a bug to work around.
