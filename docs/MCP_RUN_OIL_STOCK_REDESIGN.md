# Oil stock UI + `release_oil_stock_lots_to_oil_production`

## What changed

- **Stock (Oil)** route shows **two tables**: **Oil** (non–protein-powder lines) and **Protein powder**, kernel-style toolbar (Stock / Weekly / Overview), **Select batches → production**, and **Send to Dispatch**.
- **Database**: `release_oil_stock_lots_to_oil_production(p_lot_ids uuid[])` matches each `oil_stock_lots.batch_number` to `public.oil.batch_id` and sets `oil.status = 'production'`.

## Apply migration (Supabase MCP or SQL Editor)

1. Run the SQL file:

   `migrations/20260334000001_oil_stock_release_to_production.sql`

2. Reload PostgREST (included in file: `NOTIFY pgrst, 'reload schema';`).

3. Optional: full installs also pick up grants from `migrations/20260331000009_grant_kernel_stock_actions_to_all_roles.sql` (includes `release_oil_stock_lots_to_oil_production`).

## Frontend

- `data-functions.js`: `releaseOilStockLotsToOilProduction`, `getOilStockLots` unwrap, `getOilDispatchOrders(..., limit)` for weekly out.
- `stock_management_grid.html` / `stock_management_grid.js`: new layout and flows.

## RBAC

If roles other than admin/super need access, add `EXECUTE` on `release_oil_stock_lots_to_oil_production` in `role_permissions` (same pattern as other oil stock functions).

---

## Send to Dispatch: deduct `oil_stock_lots`

When **Send to Dispatch (Oil & Protein)** creates an order, stock must **leave the ledger** and the order **enters dispatch**.

**Apply this migration via Supabase MCP:** see **docs/MCP_RUN_OIL_DISPATCH_DEDUCT_STOCK.md** (`apply_migration` → `create_oil_dispatch_order_deduct_stock`, file `migrations/20260335000001_create_oil_dispatch_order_deduct_stock.sql`).
