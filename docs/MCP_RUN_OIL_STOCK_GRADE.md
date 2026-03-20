# Oil stock **Grade** column (Food grade / Cosmetic) — apply migrations (Supabase MCP)

## Why the column was blank

- **`get_oil_stock_lots`** used to return only `oil_stock_lots.grade`. If that column was never set, the UI showed an empty **Grade** column even when **`oil_bin_batch.oil_stream`** was `food_grade` or `cosmetic`.

## What to apply (order matters)

Run **both** migrations on Supabase, in this order:

| Order | Migration file | Purpose |
|-------|----------------|---------|
| 1 | `migrations/20260336000001_oil_stock_lots_grade_from_oil_stream.sql` | `send_oil_bin_batch_to_stock` sets `oil_stock_lots.grade` from `oil_bin_batch.oil_stream`; backfill `UPDATE` for existing rows. |
| 2 | `migrations/20260337000001_get_oil_stock_lots_coalesce_grade.sql` | **`get_oil_stock_lots`** returns grade as **Food grade** / **Cosmetic** via `COALESCE(lot.grade, …)` from **`oil_bin_batch`** by **`batch_number`** so the grid fills even before every row is backfilled. |

## Apply via MCP

1. Connect **Supabase MCP** (`user-supabase`).
2. **`apply_migration`** for **36001**:
   - **name:** e.g. `oil_stock_lots_grade_from_oil_stream`
   - **query:** full contents of **`migrations/20260336000001_oil_stock_lots_grade_from_oil_stream.sql`**
3. **`apply_migration`** for **37001**:
   - **name:** e.g. `get_oil_stock_lots_coalesce_grade`
   - **query:** full contents of **`migrations/20260337000001_get_oil_stock_lots_coalesce_grade.sql`**

Each file ends with **`NOTIFY pgrst, 'reload schema';`**. If you paste SQL manually without it, run that line once.

## Verify

- Hard-refresh **WebPortal** → **Stock (Oil)** → **Oil** table → **Grade** should show **Food grade** or **Cosmetic** for batches that exist in **`oil_bin_batch`** with **`oil_stream`** set.

### If stock disappeared after the grade migration

PostgreSQL raised **`42804: structure of query does not match function result type`** (computed `grade` was inferred as **`text`** while `RETURNS TABLE` declares **`varchar`**). That caused **`get_oil_stock_lots`** to error and the UI to show no rows.

**Fix:** cast the coalesced grade expression to **`varchar`** (see repo migration `20260337000001_get_oil_stock_lots_coalesce_grade.sql` and applied MCP migration `fix_get_oil_stock_lots_grade_return_varchar` if you already ran the older SQL).

## Frontend (already wired)

- **`stock_management_grid.js`**: `displayOilLotGrade()` for display normalization.

## Related

- **docs/MCP_RUN_OIL_STOCK_REDESIGN.md** — broader oil stock redesign and cross-links.
