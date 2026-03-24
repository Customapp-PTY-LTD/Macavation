# Raw ingredient bags — **supplier** on snapshot & UI

## What changed

- **`get_oil_production_raw_ingredients_snapshot()`** now includes **`supplier`** on each row (from **`oil.intake_data->>'supplier'`** / **`supplier_details`**).
- **`sync_oil_production_duty_audit`** copies **`supplier`** into structured **shift segment** ingredient lines.
- **`enrich_raw_ingredient_audit_suppliers(jsonb)`** (internal helper, `REVOKE` from `PUBLIC`) fills missing **`supplier`** on audit rows by looking up **`public.oil`** via **`oil_id`** or **`batch_id`**.
- **`get_oil_batch_ingredients_detail`** runs that enrichment on **`raw_ingredient_audit`** and on nested segment audits so **Stock → Ingredients** shows supplier even for older snapshots.
- **WebPortal**: Oil Production raw-ingredient tables and **Link ingredients** modals show **Supplier**; Stock Management ingredients modal adds a **Supplier** column.

## Apply via MCP

**Migration:** `migrations/20260340000001_raw_ingredient_supplier_snapshot_and_enrich.sql`

1. Connect **Supabase MCP** (`user-supabase`).
2. **`apply_migration`** with **name** `raw_ingredient_supplier_snapshot_and_enrich` and **query** = full file contents.

Or run the SQL in the Supabase SQL Editor (ends with **`NOTIFY pgrst, 'reload schema';`**).

## Data source

Supplier names are stored on the **`oil`** row at intake: **`intake_data.supplier`** and **`intake_data.supplier_details`** (see **`createSupplierIntakeBatch`** / **`updateSupplierIntakeBatch`** in **`WebPortal/js/data-functions.js`**).

## Related

- **docs/MCP_RUN_OIL_BATCH_INGREDIENTS_STOCK.md** — batch ingredients modal RPC.
