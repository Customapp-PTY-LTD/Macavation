# Oil stock — **Ingredients** button (`get_oil_batch_ingredients_detail`)

## Supplier names on raw lines

See **docs/MCP_RUN_RAW_INGREDIENT_SUPPLIER.md** — **`supplier`** is included in **`raw_ingredient_audit`** and enriched from **`oil.intake_data`** when missing.

## What it does

- DB function **`get_oil_batch_ingredients_detail(p_batch_number text)`** returns **jsonb** with:
  - **`ingredients_text`** / **`shifts_text`** from **`oil_bin_batch`**, or from **`oil.production_data`** if the batch was only on the **`oil`** row
  - **`shift_segments`** and **`raw_ingredient_audit`** (same merge logic)
- **Stock (Oil)** table: carrot (**Ingredients**) button per row opens a modal (SweetAlert2).

**Migration:** `migrations/20260339000001_get_oil_batch_ingredients_detail.sql`

## Apply via MCP

1. Connect **Supabase MCP** (`user-supabase`).
2. **`apply_migration`** with:
   - **name:** `get_oil_batch_ingredients_detail`
   - **query:** full contents of **`migrations/20260339000001_get_oil_batch_ingredients_detail.sql`**

Or run the SQL in the Supabase SQL Editor (includes RBAC insert + **`NOTIFY pgrst, 'reload schema';`**).

## Frontend

- **`WebPortal/js/data-functions.js`**: `getOilBatchIngredientsDetail(batchNumber, token)`
- **`WebPortal/modules/stock-management/js/stock_management_grid.js`**: `.oil-batch-ingredients-btn` → `showOilBatchIngredientsModal`

## RBAC

- Migration inserts **`EXECUTE`** for **`get_oil_batch_ingredients_detail`** for every role that already has **`get_oil_stock_lots`**.
- **`migrations/20260331000009_grant_kernel_stock_actions_to_all_roles.sql`** also lists this function for new installs.
