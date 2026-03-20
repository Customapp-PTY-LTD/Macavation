# Oil bin `shift_segments` — apply migration (Supabase MCP)

## What this does

- Adds **`shift_segments jsonb`** on **`public.oil_bin_batch`**: structured rows per shift, each with its own **`ingredients`** array (and optional **`raw_ingredient_audit`**).
- **`sync_oil_production_duty_audit`** updates or **appends** a segment when **Person on duty** is saved: same `shift_id` → replace last segment; new `shift_id` → **new row** in that bin’s segment list.
- **`update_oil_bin_batch`** accepts **`p_shift_segments`** so the WebPortal edit modal can save the tables.
- **`get_oil_bin_batches`** returns **`shift_segments`**.
- **`send_oil_bin_batch_to_stock`** copies **`shift_segments`** into **`oil.production_data`** for traceability.

## Apply via MCP

1. Connect the **Supabase MCP** for the same project as WebPortal / Lambda.
2. Use **`apply_migration`** with:
   - **name:** `oil_bin_shift_segments`
   - **query:** paste the full contents of **`migrations/20260331000018_oil_bin_shift_segments.sql`**

Or run the same SQL with **`execute_sql`** (prefer `apply_migration` for DDL).

3. Hard-refresh the WebPortal. Oil Production → **Edit** on an in-production bin should show **Shifts & ingredients** as tables; saving sends **`p_shift_segments`**.

## Frontend

- **`WebPortal/js/data-functions.js`**: `updateOilBinBatch` sends **`p_shift_segments`** when provided.
- **`WebPortal/modules/oil-production/js/oil_production_grid.js`**: edit modal builds/collects segment tables; grid shows a **“N shifts”** badge when multiple segments exist.
