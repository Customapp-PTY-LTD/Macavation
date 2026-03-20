# Protein production batches — apply migration (Supabase MCP)

## What this does

- **`protein_bin_batch`** table: parallel to oil bins; **`batch_weight_kg`** used when sending to stock.
- **`start_protein_bin_batch`**, **`get_protein_bin_batches`**, **`update_protein_bin_batch`**, **`set_protein_bin_batch_raw_ingredient_links`**, **`send_protein_bin_batch_to_stock`**.
- **`send_protein_bin_batch_to_stock`** inserts **`oil_stock_lots`** (finished good, grade `Protein powder`, kg from `batch_weight_kg`).
- RBAC: same pattern as oil — grants copied from roles that have **`update_oil_bin_batch`**.

## Apply via MCP

1. Connect **Supabase MCP** (`user-supabase`).
2. **`apply_migration`** with name `protein_bin_batch` and query = full contents of **`migrations/20260333000001_protein_bin_batch.sql`**.

3. Hard-refresh WebPortal → **Oil Production** → **Protein production (batches)**.

## Frontend

- **`WebPortal/js/data-functions.js`**: `getProteinBinBatches`, `startProteinBinBatch`, `updateProteinBinBatch`, `setProteinBinBatchRawIngredientLinks`, `sendProteinBinBatchToStock`.
- **`WebPortal/modules/oil-production/`**: section below oil bins; **Send to stock** prompts for **batch weight (kg)**.
