# Fix Start oil bin — PostgREST `start_oil_bin_batch` schema cache (Supabase MCP)

## Why this field exists (plain language)

The database column is named `oil_stream` for historical reasons, but in the **UI we call it “Grade”**: **food-grade oil** vs **cosmetic (non-food) oil**. Your factory runs both types; they must be labelled separately for **compliance**, **traceability**, and **stock** (what goes on the certificate vs non-food use). It is not about “a stream of oil” in a physical sense.

---

## What went wrong

PostgREST matches RPC calls using **parameter names sorted alphabetically**. With names `p_oil_stream` and `p_start_date`, the order is **`p_oil_stream` then `p_start_date`**, so the API looks for a function typed **`(varchar, date)`**. The database defined **`(date, varchar)`** (`p_start_date` first, then stream). That mismatch surfaces as:

`Could not find the function public.start_oil_bin_batch(p_oil_stream, p_start_date) in the schema cache`

## Fix

1. **Database:** Rename the second argument to **`p_stream`**. Alphabetically: `p_start_date` &lt; `p_stream` → **`(date, varchar)`**, which matches the real function.
2. **Frontend:** Send **`p_stream`** (not `p_oil_stream`) in the JSON body for `start_oil_bin_batch` — already updated in `WebPortal/js/data-functions.js`.
3. **Reload schema:** `NOTIFY pgrst, 'reload schema';` (included below).

Repo migrations (in order for new environments):

- `migrations/20260331000010_oil_bin_batch_oil_stream_reapply.sql` — uses `p_stream` on the 2-arg function.
- `migrations/20260331000011_start_oil_bin_batch_postgrest_overloads.sql` — single-arg wrappers.
- `migrations/20260331000012_start_oil_bin_postgrest_rename_p_stream.sql` — **run this on an existing DB** that still has `p_oil_stream` on `start_oil_bin_batch`.

---

## Option A: Supabase MCP (recommended)

1. In Cursor, connect the **Supabase MCP** server (e.g. `user-supabase`) for the **same project** as the WebPortal / Lambda.
2. Use the MCP tool **`apply_migration`** with:
   - **name:** `start_oil_bin_postgrest_rename_p_stream`
   - **query:** paste the full contents of `migrations/20260331000012_start_oil_bin_postgrest_rename_p_stream.sql`

Or use **`execute_sql`** with that same SQL if you prefer (DDL is better via `apply_migration` when available).

3. Hard-refresh the WebPortal and try **Start oil bin** again.

---

## Option B: Supabase SQL Editor

Open **SQL Editor**, paste the contents of `migrations/20260331000012_start_oil_bin_postgrest_rename_p_stream.sql`, run once.

---

## Verify

```sql
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'start_oil_bin_batch'
ORDER BY args;
```

You should see overloads including `date, character varying` (the main 2-arg function with `p_start_date`, `p_stream`).

---

## Related

- `update_oil_bin_batch` still uses **`p_oil_stream`**; that function has a different parameter set and was not hitting this ordering issue for the reported error.
- Kernel / NIS MCP docs: `docs/MCP_RUN_KERNEL_BATCH_NAMING.md`, `docs/MCP_RUN_NIS_SEED.md`.
