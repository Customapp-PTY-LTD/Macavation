# Send a dispatch order line back to stock

## Context

Kernel Dispatch → **Edit** on a basket opens "Edit dispatch order" (`#kernelDispatchEditModal`). It
shows the buyer, delivery date, best before, and a table of lines — Batch, Style, Cartons — with a
number input on each line and a single **Save changes** button.

**There is no way to take a line off the order.** An operator who put the wrong batch, or the wrong
style, into a basket can only edit the carton figure. Setting it to `0` leaves a dead 0-carton line
on the order and on the dispatch sheet; there is no remove.

This plan adds a **Send back to stock** action to each line of that table.

Note what is *already* possible and is deliberately not what this plan builds: **reducing** the
carton number and saving already returns the difference to stock, because stock on hand is derived
(see below). A partial return therefore needs no new feature. The gap is removing the line
*entirely*, which is what "send it back to stock" means to the operator.

## The one fact that shapes this whole plan: stock on hand is derived, not stored

There is **no kernel stock table**. `get_kernel_batches` computes, per batch and style:

```
remaining_by_style_cartons = yield cartons − SUM(cartons on every kernel_dispatch_orders line)
```

(`migrations/20260305000003_remaining_cartons_minus_dispatch.sql`, and the root-cause notes at the
top of `migrations/20260730120000_fix_kernel_dispatch_stock_and_empty_basket.sql`, which record that
the subtraction happens regardless of `dispatched_at` — creating the order is what drops stock.)

So **removing the line object from `kernel_dispatch_orders.lines` IS the send-back.** There is
nothing to credit, no second table to keep in step, no adjustment row to write. This plan writes
**no SQL** — see the next section.

## What is already in place — the database work is done

`public.return_kernel_dispatch_line_to_stock` was written, applied and tested against dev/UAT
(`nmdmddugxclpqrwylyfa`, which demo shares) **before this plan was submitted**. The migration file
is `migrations/20260824120000_return_kernel_dispatch_line_to_stock.sql` and is already in the
branch you are working from. **Do not author, edit, re-apply or duplicate it.**

Two overloads exist, and both are granted `EXECUTE` to `anon`, `authenticated` and `service_role`,
with a `role_permissions` row for all 8 roles:

```
return_kernel_dispatch_line_to_stock(p_order_id uuid, p_line_index integer,
                                     p_expected_kernel_id text DEFAULT NULL,
                                     p_expected_style     text DEFAULT NULL) RETURNS jsonb

return_kernel_dispatch_line_to_stock(p_order_id uuid, p_line_index integer,
                                     p_actor_user_id uuid,                    -- required, no default
                                     p_expected_kernel_id text DEFAULT NULL,
                                     p_expected_style     text DEFAULT NULL) RETURNS jsonb
```

**FIXED CONTRACT — success:**

```json
{ "success": true, "order_cancelled": false, "remaining_lines": 1,
  "batch_number": "Bn 49 26 16", "style": "4L", "cartons": 10, "quantity_kg": 113.4,
  "message": "Sent back to stock." }
```

**FIXED CONTRACT — failure:** `{ "success": false, "error": "<sentence fit to show a user>" }`.
The function never throws; it returns `success: false`. Every `error` string it produces is already
written in plain English for an operator, so **surface `error` as-is** rather than substituting your
own wording.

Behaviour proven on dev by a rolled-back transaction test (all 12 assertions passed):

- Order of 10 × `4L` cut batch `Bn 49 26 16` stock from 213 → 203 cartons; sending that line back
  restored it to **exactly 213**.
- Removing the **last** line sets `status = 'cancelled'` and returns `order_cancelled: true`. It
  does *not* delete the order row.
- A `dispatched` order is refused; a `cancelled` order is refused; an out-of-range
  `p_line_index` is refused; a `p_expected_kernel_id` / `p_expected_style` that does not match the
  line at that index is refused.
- The `stock_soh_history` audit row is written automatically by the existing
  `stock_history_kernel_dispatch` trigger, as a **positive** carton delta naming the user.

### Two consequences you must build for

1. **`p_line_index` is the array index into `lines`.** Line objects have no id — they are
   `{kernel_id, batch_number, style, cartons, quantity_kg}` — and nothing stops two lines sharing
   `(kernel_id, style)`. The index is the only exact address, which is why the expected-kernel_id /
   expected-style guard exists. **Always send both guard values**; they are what turns a stale
   window into a clean refusal instead of the wrong line being returned.

2. **Removing the last line cancels the order**, and a cancelled order must stop appearing on the
   dispatch board. It currently would not — deliverable 4.

## Grounding — verified against this checkout

**`WebPortal/modules/modals/modal-kernel-dispatch-edit/js/modal_kernel_dispatch_edit.js:111-125`**
renders the line rows, in `lines` array order, so **the row's position IS `p_line_index`**:

```js
lines.forEach(function (line) {
    ...
    var tr = document.createElement('tr');
    tr.setAttribute('data-kernel-id', line.kernel_id || '');
    tr.setAttribute('data-style', line.style || '');
    tr.setAttribute('data-batch-number', line.batch_number || '');
    tr.innerHTML = '<td>' + bn + '</td><td>' + stl + '</td><td class="text-end">' +
        '<input type="number" class="form-control form-control-sm text-end js-kernel-dispatch-edit-cartons" min="0" step="1" value="' + ct + '">' +
        '</td>';
    tbody.appendChild(tr);
});
```

Note the existing row already carries `data-kernel-id` and `data-style` via `setAttribute` — the two
guard values are on the row already. `forEach` does not currently take the index; it will need to.

**`submit()` at line 176** builds its payload by iterating `#kernelDispatchEditLinesBody tr` and
reading `.js-kernel-dispatch-edit-cartons` **within each row**, so adding a fourth `<td>` to the row
does not disturb it. Confirm that by reading the loop rather than assuming it.

**`show()` at line 87** loads via `dataFunctions.getKernelDispatchOrder(orderId)` and refuses a
dispatched order at lines 99-103:

```js
var st = (order.status || '').toLowerCase();
if (st === 'dispatched') {
    if (typeof Swal !== 'undefined') Swal.fire('Info', 'This order has already been dispatched and cannot be edited.', 'info');
    return;
}
```

**`WebPortal/modules/kernel-dispatch/js/kernel_dispatch_grid.js:155`** is the single place the grid's
order array is assigned — both `render()` and `renderKanban()` read it:

```js
scope.orders = await dataFunctions.getKernelDispatchOrders(null, forceRefresh, filters) || [];
```

**`kernel_dispatch_grid.js:206`** splits the board on `dispatched` only, so any other status lands in
the awaiting-dispatch table with Edit and Dispatch buttons:

```js
var pending = scope.orders.filter(function (o) { return o.status !== 'dispatched'; });
```

`renderKanban()` at line 289 does the same thing (`o.status === 'dispatched' ? 'dispatched' : 'confirmed'`).
**`get_kernel_dispatch_orders` has no status filter** — verified against the live dev definition — so
the fix belongs in the client at line 155, once, covering both views.

**`confirmRevertDispatchOrder` at `kernel_dispatch_grid.js:169-197`** is the confirm-then-RPC pattern
to model: `Swal.fire({ icon: 'warning', showCancelButton: true, confirmButtonText: …, focusCancel: true })`,
a `window.confirm` fallback when `Swal` is undefined, `.then` on success + `loadOrders(true)`,
`.catch` → `Swal.fire('Error', …)`.

**`_callWithActor` at `WebPortal/js/data-functions.js:281`** adds `p_actor_user_id` from
`getCurrentUserId()` and — importantly — **already falls back** to the plain call and logs a warning
when the actor overload is missing (`PGRST202` / "Could not find the function"). Use it, and inherit
that behaviour rather than reimplementing it. `createKernelDispatchOrder:5111` is the existing caller
to model.

**`hasAction`** is `window.hasAction = function (key) { return actionAccess.has(key); }`
(`WebPortal/js/action-access.js:95`). Per `CLAUDE.md`, `data-action-perm` is swept **once over static
markup** and is therefore **inert on dynamically rendered rows** — these rows are built in JS, so the
gate must be an inline `hasAction()` call at render time.

**The permission key already exists.** `actions` holds `kernel.dispatch.edit` ("Edit dispatch order"),
granted to 2 roles. This action lives *inside* the edit modal, so **reuse `kernel.dispatch.edit`**.
Do **not** invent a new action key: a new key needs a database row and a re-login before it resolves
for anyone, so a new key would ship the button switched off for every user including `super_user`.

## Deliverables

### 1. `returnKernelDispatchLineToStock` in `WebPortal/js/data-functions.js`

Place it beside `updateKernelDispatchOrder` (line 5135). Model it on `createKernelDispatchOrder:5111`.

```js
returnKernelDispatchLineToStock: async function (payload, token = null) { … }
```

- Params sent: `p_order_id`, `p_line_index`, `p_expected_kernel_id`, `p_expected_style`.
- Call through **`this._callWithActor('return_kernel_dispatch_line_to_stock', params, token, { useCache: false })`**
  so the audit row names the user.
- `p_line_index` must go over the wire as a **number**, not a string.
- Send `p_expected_kernel_id` / `p_expected_style` as `null` when absent, never `undefined`.
- **Clear two cache patterns, not one:**
  `this.clearCachePattern('kernel_dispatch_orders_list')` **and**
  `this.clearCachePattern('kernel_batches')`. The second is what makes the returned cartons show up
  on Stock (Kernel) — omitting it is the likeliest way to ship this looking broken.
- Return the unwrapped result, matching how `updateKernelDispatchOrder`'s caller already handles
  `result.data` (`modal_kernel_dispatch_edit.js:210-212`).

### 2. A fourth column in `modal-kernel-dispatch-edit/html/modal_kernel_dispatch_edit.html`

Add one `<th>` after the Cartons header (line 30 area). Give it a narrow fixed width and an
accessible-but-blank label — the column holds a per-row button, so a visible heading is noise:
`<th class="text-end" style="width:11rem"><span class="visually-hidden">Line actions</span></th>`.

Do **not** change the existing three headers. `colspan="3"` on the no-lines row at
`modal_kernel_dispatch_edit.js:127` must become `colspan="4"` to match.

### 3. The per-line button and its handler — `modal_kernel_dispatch_edit.js`

**Render (in the `forEach` at line 111):**

- Take the index: `lines.forEach(function (line, idx) { … })` and set
  `tr.setAttribute('data-line-index', String(idx));`
- Append a fourth `<td>` containing a button
  `class="btn btn-sm btn-outline-secondary js-kernel-dispatch-send-back"` with a
  `fas fa-rotate-left` icon and the label **Send back to stock**.
- **Gate it inline:** render the button only when
  `typeof hasAction === 'function' && hasAction('kernel.dispatch.edit')`. When it is not allowed,
  emit an empty `<td>` — keep the cell so the column count stays 4.
- The button's HTML must contain **no database-derived value**. The index is a number you generated;
  the guard values are already on the row via `setAttribute`. This keeps the concatenated
  `innerHTML` free of untrusted text (`BluePrint/javascript-jquery-rules.md`).

**Bind** in `init()`, alongside the existing `$('#kernelDispatchEditSaveBtn')` binding at line 81,
namespaced the same way — delegate from the modal so it survives re-renders:

```js
$modal.off('click.kdispatchSendBack').on('click.kdispatchSendBack', '.js-kernel-dispatch-send-back', function (e) { … });
```

**On click:**

1. Read `data-line-index` (parse to a number), `data-kernel-id`, `data-style`, `data-batch-number`
   from the closest `tr`, and the order id from `#kernelDispatchEditOrderId`.
2. Confirm with `Swal` — `icon: 'warning'`, `showCancelButton: true`,
   `confirmButtonText: 'Yes, send back to stock'`, `focusCancel: true`, and a `window.confirm`
   fallback, exactly as `confirmRevertDispatchOrder` does. The message must state **both** things
   the operator needs to know before saying yes:
   - the cartons go back on hand for that batch and style (name the batch, style and carton figure
     — pass them through `.text`/`escapeHtml`, never raw into `html:`);
   - **any unsaved changes to buyer, dates or carton figures in this window will be discarded**,
     because the window reloads from the database afterwards. This is not a nicety — the send-back
     writes immediately, and the reload is what keeps the remaining rows' indices honest.
3. Disable the clicked button while the call is in flight so a double-click cannot fire twice.
4. Call `dataFunctions.returnKernelDispatchLineToStock({...})`. Guard for the wrapper being absent
   the way `submit()` does at lines 198-201 ("Refresh the page after the latest deployment").
5. **On `success === true`:**
   - `Swal` success toast using the RPC's own `message`.
   - If **`order_cancelled === true`** → hide `#kernelDispatchEditModal` and call
     `_kernelDispatchGrid.loadOrders(true)`. Do **not** re-render the table: the order is gone from
     the board.
   - Else → **reload the modal's contents from the database** by re-running the same load path
     (`_modal_kernel_dispatch_edit.show(orderId)`), so the surviving rows get correct
     `data-line-index` values. Never just delete the `<tr>` from the DOM — every row after it would
     keep a stale index and the next send-back would remove the wrong line. Also call
     `_kernelDispatchGrid.loadOrders(true)` so the board's line count and total kg follow.
6. **On `success === false`** → `Swal.fire('Error', result.error, 'error')`, passing `error` as
   `text:`, never `html:`. Then reload the modal from the database: every refusal this function
   returns means the caller's view of the order is out of date.

**Also add a `cancelled` guard to `show()`** beside the existing `dispatched` guard at lines 99-103,
with a message of its own ("This order was cancelled when its last line went back to stock."). It is
defensive — deliverable 4 stops the grid offering Edit on one — but a cancelled order must never
render as editable.

### 4. Keep cancelled orders off the dispatch board — `kernel_dispatch_grid.js`

At line 155, filter them out **where `scope.orders` is assigned**, so `render()` and `renderKanban()`
are both covered by one change:

```js
var rows = await dataFunctions.getKernelDispatchOrders(null, forceRefresh, filters) || [];
scope.orders = rows.filter(function (o) { return String(o && o.status || '').toLowerCase() !== 'cancelled'; });
```

Do not instead patch line 206 — that would fix the table and leave the kanban view showing cancelled
baskets as "confirmed".

### 5. Help text — `WebPortal/help/index.html`

The `#modal-kernel-dispatch-edit` section (line 523) is generic boilerplate. Add one step to its
`<ol class="guide-page-steps">` describing the new action in plain English: that **Send back to
stock** takes a line off the order and returns its cartons to Stock (Kernel), that it applies
immediately rather than on Save, and that sending back the only line cancels the order. Do not touch
the screenshot `<figure>` or any other section.

## Graceful degradation — this merges before prod has the migration

`dev` auto-deploys on merge, and the migration above is applied on **dev/UAT only**. Applying it to
prod is a human step scheduled after sign-off. So on prod, for a while, the RPC will not exist.

- `_callWithActor` already handles the *actor overload* being missing. It does **not** handle the
  whole function being missing — that surfaces as a thrown `PGRST202` / "Could not find the function"
  error from `callFunction`.
- Therefore the click handler's `.catch` must detect that case — test the message for
  `/PGRST202|Could not find the function|schema cache/i`, matching the precedent at
  `kernel_dispatch_grid.js:158-162` — and show a plain, non-alarming message such as *"Sending a line
  back to stock isn't available on this environment yet."* rather than a raw PostgREST error.
- Everything else on the screen must keep working exactly as it does today when the RPC is absent.
  Nothing in this plan may change the existing Save path's behaviour.

## Blast radius — check these, do not assume

- **`submit()` must be untouched in behaviour.** It reads cartons per-row; a fourth `<td>` is
  invisible to it. Read the loop at line 176 and confirm, then leave it alone. In particular do not
  make Save able to post an empty `lines` array — `update_kernel_dispatch_order` rejects that by
  design, and the send-back RPC is the only supported way to empty an order.
- **Column count.** Header row, data rows and the no-lines `colspan` must all read 4.
- **`_modal_kernel_dispatch_edit.show()` re-entry.** It is already called on every Edit click and
  re-inits the flatpickr pickers via `shown.bs.modal`; calling it while the modal is open is how this
  plan reloads. Verify the pickers are destroyed and rebuilt cleanly (`destroyPickers()`, lines
  51-60) rather than stacking a second calendar.
- **`MacTableActions` / `KanbanHelper`** are untouched — no new grid row action is being added.
- **Do not add a new `actions` row, feature row, or `role_permissions` row.** All database state this
  feature needs is applied already; adding more is how the RBAC layers drift (`CLAUDE.md`).

## Security invariants — state and obey

- Every database or user-entered value reaches the DOM through `.text()` or `_common.escapeHtml`
  with a **static** label — never `.html()`, `innerHTML` or string concatenation
  (`BluePrint/javascript-jquery-rules.md`). That covers the batch number and style in the confirm
  dialog and any `error` string from the RPC: pass them as `text:`, never `html:`.
- The row's guard values stay on `data-` attributes set with `setAttribute`, as the existing code
  already does. Do not interpolate them into an HTML string.

## Verification before finishing

All hermetic — no database, no browser, no deployed environment:

1. `npm run test:fleet` exits 0.
2. `node --check` passes on `WebPortal/js/data-functions.js`,
   `WebPortal/modules/modals/modal-kernel-dispatch-edit/js/modal_kernel_dispatch_edit.js` and
   `WebPortal/modules/kernel-dispatch/js/kernel_dispatch_grid.js`.
3. `grep -n "return_kernel_dispatch_line_to_stock" WebPortal/js/data-functions.js` shows the RPC name
   passed to **`_callWithActor`**, not to `callFunction`.
4. `grep -n "clearCachePattern" WebPortal/js/data-functions.js` shows **both**
   `kernel_dispatch_orders_list` and `kernel_batches` cleared inside the new wrapper.
5. `grep -c "<th" WebPortal/modules/modals/modal-kernel-dispatch-edit/html/modal_kernel_dispatch_edit.html`
   returns 4, and `grep -n "colspan" …/js/modal_kernel_dispatch_edit.js` shows `colspan="4"` with no
   remaining `colspan="3"`.
6. `grep -n "data-line-index" …/js/modal_kernel_dispatch_edit.js` shows it **set** in the render loop
   and **read** in the click handler.
7. `grep -n "hasAction('kernel.dispatch.edit')" …/js/modal_kernel_dispatch_edit.js` returns a match —
   proving the button is gated inline and on the existing key.
8. `grep -rn "kernel.dispatch.send_back\|kernel.dispatch.return" WebPortal/` returns **nothing** —
   proving no new action key was invented.
9. `grep -n "cancelled" WebPortal/modules/kernel-dispatch/js/kernel_dispatch_grid.js` shows the
   filter at the `scope.orders` assignment (~line 155), and `grep -n "!== 'dispatched'"` shows line
   206 unchanged.
10. `git status --porcelain migrations/` is **empty** — this plan authors no migration and must not
    modify the applied one.
11. `grep -n "PGRST202\|Could not find the function" …/js/modal_kernel_dispatch_edit.js` shows the
    missing-RPC branch required by the degradation section.

## Out of scope

- **Any migration.** `return_kernel_dispatch_line_to_stock` is applied on dev/UAT already; applying
  it to prod is a human step outside this plan. Write no SQL.
- **Partial returns.** Reducing the carton figure and saving already does that.
- **A multi-select "send back these 3 lines".** One line per click, each with its own confirm.
- **Surfacing cancelled orders anywhere.** They drop off the board; the movement is recorded in
  `stock_soh_history` and already visible on the stock edit history screen. A "Cancelled baskets"
  view is its own piece of work.
- **The oil dispatch equivalent** (`modal-oil-dispatch-form`). Oil stock is stored in
  `oil_stock_lots`, not derived, so it needs a different database function and its own plan.
- **Re-taking the help screenshot.** Text only.
