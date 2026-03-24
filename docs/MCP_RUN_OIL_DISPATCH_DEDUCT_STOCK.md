# Oil dispatch: deduct stock on send — apply migration (Supabase MCP)

## What this does

- Replaces **`create_oil_dispatch_order`** so creating an **Oil & Protein dispatch** order **deducts `oil_stock_lots`** in the same transaction as inserting **`oil_dispatch_orders`**.
- **Oil lines** (`quantity_litres` > 0): subtracts **litres** from `volume` and **kg** from `kilograms`.
- **Protein lines**: subtracts **kg** only.
- **Full dispatch:** `kilograms` / `volume` → `0`, **`status = 'dispatched'`**.
- **Partial:** reduced balances, **`status` stays `on_hand`**.
- Only lots in **`on_hand`** or **`hold`** can be dispatched; at least one line is required.

**Source file:** `migrations/20260335000001_create_oil_dispatch_order_deduct_stock.sql`

## Apply via MCP

1. Connect **Supabase MCP** (`user-supabase`).
2. **`apply_migration`** with:
   - **name:** `create_oil_dispatch_order_deduct_stock`
   - **query:** full contents of **`migrations/20260335000001_create_oil_dispatch_order_deduct_stock.sql`** (copy from repo).

3. The migration SQL ends with **`NOTIFY pgrst, 'reload schema';`** (included in the file). If you run a subset without it, execute that line once.

4. Hard-refresh **WebPortal** → **Stock (Oil)** → **Send to Dispatch** → confirm lots leave stock and appear under **Oil & Protein Dispatch**.

## Frontend (already wired)

- `WebPortal/js/data-functions.js`: `createOilDispatchOrder` clears `oil_stock_lots` / summary cache.
- `modal_send_to_dispatch_oil.js`: success calls `loadOilLotsAndSummary(true)`.
- `stock_management_grid.js`: `oilLotsAvailableForStockView()` hides non-available rows.

## Related

- **docs/MCP_RUN_OIL_STOCK_REDESIGN.md** — oil stock UI, `release_oil_stock_lots_to_oil_production`, and cross-links.
