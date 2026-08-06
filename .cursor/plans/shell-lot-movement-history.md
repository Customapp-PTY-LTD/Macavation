# Add a Movement history view to shell waste lots

## Why

The database side of shell lot movement tracking shipped in
`migrations/20260706100000_phase2_implementation_complete.sql` and is fully wired: the table, the
RPC, the RBAC grant and the JavaScript wrapper all exist. Nothing in the portal ever calls it, so
the history is invisible to users. This plan adds only the missing UI.

Phase 2's plan document lists "Movement history view on lot (created -> adjusted -> dispatched)"
as outstanding under Epic 7. This closes it.

## Read these first

- `WebPortal/modules/stock-management/js/stock_management_grid.js` — `renderShellLots` (around
  line 1571) builds the shell table rows and their action menu; the delegated click handlers for
  the existing shell actions sit around lines 339-360. **Copy these patterns exactly.**
- `WebPortal/js/data-functions.js` line 1915 — `getShellStockMovements`, the wrapper you will call.
- `migrations/20260706100000_phase2_implementation_complete.sql` lines 415-429 and 496-501 — the
  table shape and the RPC. Do not change either.

## Fixed contracts — do not invent alternatives

- Call **`dataFunctions.getShellStockMovements(lotId)`**. It already unwraps the PostgREST
  response and returns a plain array. Do not call `callFunction` directly and do not add a new
  wrapper.
- Each row has these columns and no others: `id`, `lot_id`, `movement_type`, `quantity_kg`,
  `reference`, `notes`, `created_at`.
- `movement_type` is one of exactly: `created`, `adjusted`, `dispatched`, `written_off`.
- The new action goes in the **existing `MacTableActions.render` items array** inside
  `renderShellLots`, as the **first** item, labelled **`Movement history`** with icon
  `fas fa-clock-rotate-left`, class **`js-shell-lot-movements`**, and `dataAttrs`
  `{ 'shell-id': shellId }`.
- **No `action-perm` attribute on this item.** Every other action in that menu is a mutation and
  is gated on `stock.shell.manage`; this one only reads, and gating it would hide history from
  read-only users. This is deliberate — do not add a permission attribute.
- The click handler follows the surrounding style exactly:
  `$(document).off('click', '.js-shell-lot-movements').on('click', '.js-shell-lot-movements', ...)`,
  placed next to the existing shell handlers.
- Display it with `Swal.fire`, matching the existing shell modals in the same file.

## What to build

1. Add the `Movement history` action to the shell lot row menu, per the contract above.
2. Add the delegated click handler. It reads `shell-id` from the clicked element, finds the lot in
   `scope.shellLots` for the modal title, and calls the wrapper.
3. Show the result in a modal titled `Movement history — <lot_number>`, as a simple table in date
   order (the RPC already sorts by `created_at`) with these columns:
   - **When** — `created_at`, shown as **date and time** (`YYYY-MM-DD HH:mm`). Note this module's
     existing date helper normalises to date only; movement history needs the time, because several
     movements can happen on one lot in a day. Format it locally in the modal rather than changing
     the shared helper.
   - **Type** — `movement_type`, shown in sentence case (`Written off`, not `written_off`)
   - **Quantity (kg)** — `quantity_kg` to 2 decimal places
   - **Reference** — `reference` or an em dash when null
   - **Notes** — `notes` or an em dash when null
4. Handle the two non-happy paths explicitly:
   - **Empty array** — show `No movements recorded for this lot yet.` inside the modal. Do not
     show an error and do not show an empty table.
   - **The call throws** — show a Swal error reading
     `Could not load movement history. <message>`. The page must keep working. This matters
     because the portal may run against an environment where the migration has not been applied.
5. Escape every value with the module's existing `escapeHtml` before putting it in the DOM.
   `reference` and `notes` are free text typed by users.

## Do not

- Do not change the database, write a migration, or alter the RPC.
- Do not touch the dispatch, edit, delete or add flows.
- Do not add a new module, route or file. This is an edit to
  `stock_management_grid.js` only, plus the help page below.
- Do not add a build step, a dependency or a package.json entry. This repo vendors everything and
  has no dependencies.
- Do not reformat, re-indent or "tidy" surrounding code. Keep the diff to what this plan asks for.

## Help page

**There is no shell waste section in the manual today** — `WebPortal/help/user-manual.html` does not
mention shell waste at all. Do not go looking for one.

Add a short subsection describing the new action inside the existing **Stock (Kernel)** chapter,
anchor `id="stock-kernel"`, since the shell lot controls live on that route. Match the surrounding
tone and markup. Text only — no screenshots.

You may also add a matching topic entry to `WebPortal/help/index.html` if that file lists topics per
chapter. **Do not run `scripts/apply_user_guide_help_links.mjs`** — it rewrites help links across
many files and would bury this change in an unreviewable diff.

## How this will be verified

- `npm run test:fleet` passes.
- The diff touches only `WebPortal/modules/stock-management/js/stock_management_grid.js`,
  `WebPortal/help/user-manual.html` and optionally `WebPortal/help/index.html`.
- The action item, the handler class `js-shell-lot-movements`, the wrapper call, the empty state
  and the error path are all present and readable in the diff.
- No `#hex` colour literals and no Bootstrap Icons (`bi-`) are introduced — this repo's design
  standard bans both in `WebPortal/`, and the checker will be turned on soon.

## Size

Small — one function edit, one handler, one modal, one help paragraph. Well inside a single run.
