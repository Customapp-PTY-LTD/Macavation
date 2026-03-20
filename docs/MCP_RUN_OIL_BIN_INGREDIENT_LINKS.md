# Oil bin ingredient links — apply migration (Supabase MCP)

## Problem

Calling `update_oil_bin_batch` with `p_raw_ingredient_audit` fails if that overload was never applied:

`Could not find the function public.update_oil_bin_batch(..., p_raw_ingredient_audit, ...) in the schema cache`

## Fix

A **dedicated** function is used instead:

- **`set_oil_bin_batch_raw_ingredient_links(p_oil_bin_batch_id uuid, p_raw_ingredient_audit jsonb, p_ingredients text)`**

## Apply via MCP

1. Connect the **Supabase MCP** for the same project as WebPortal / Lambda.
2. Run **`migrations/20260332000002_set_oil_bin_batch_raw_ingredient_links.sql`** (creates the RPC).
3. Run **`migrations/20260332000003_grant_set_oil_bin_ingredient_links_from_update_oil_bin.sql`** (RBAC: grants **EXECUTE** to every role that already has **`update_oil_bin_batch`** — no separate “all roles” block).

   Or use **`apply_migration`** for each file in order.

4. Hard-refresh the WebPortal. **Oil Production → Ingredients** should save without PostgREST or **403** (Lambda RBAC) errors.

## Frontend

- **`WebPortal/js/data-functions.js`**: `setOilBinBatchRawIngredientLinks(...)` calls `set_oil_bin_batch_raw_ingredient_links`.
- **`update_oil_bin_batch`** is **not** called with `raw_ingredient_audit` (avoids signature mismatch).

## Optional older migration

`migrations/20260332000001_update_oil_bin_batch_raw_ingredient_audit.sql` extended `update_oil_bin_batch` with `p_raw_ingredient_audit`. You do **not** need to apply it if you use **`20260332000002`** only.
