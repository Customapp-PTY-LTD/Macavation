# Job card → stock on hand (`sync_job_card_to_packing_for_stock`) — Supabase MCP

Macavation Web Portal uses Supabase project **`iwxmuemrfopajwvqdiae`**  
(`https://iwxmuemrfopajwvqdiae.supabase.co` — see `WebPortal/js/appRouteConfig.json`).

**Before running MCP:** confirm `get_project_url` returns **`https://iwxmuemrfopajwvqdiae.supabase.co`**.  
If it shows another host (e.g. `dekfgwvpmuhgjymbewnt`), the migration will apply to the wrong database and stock will still follow packing only.

**Cursor MCP config:** workspace `.cursor/mcp.json` and user `~/.cursor/mcp.json` should use  
`https://mcp.supabase.com/mcp?project_ref=iwxmuemrfopajwvqdiae`.  
If Supabase MCP shows “needs authentication”, complete `mcp_auth` in Cursor, then reload the window.

## Migration

Apply **`migrations/20260517120000_sync_job_card_to_packing_for_stock.sql`** on the Macavation project:

1. Cursor → Supabase MCP (`user-supabase`) linked to **Macavation** (`iwxmuemrfopajwvqdiae`).
2. `apply_migration` with **name** `sync_job_card_to_packing_for_stock` and **query** = full file contents (large — split with `execute_sql` if the tool truncates).
3. Run `NOTIFY pgrst, 'reload schema';` once after all chunks succeed.

## Verify (SQL editor on Macavation project)

```sql
SELECT proname FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'kernel_job_card_has_stock_quantities',
    'sync_kernel_job_card_to_packing_data',
    'kernel_yield_cartons_from_job_card'
  );

SELECT public.kernel_job_card_has_stock_quantities(
  '{"sound_kernel_styles":[{"style":"1","cartons":99,"weight_kg":100}]}'::jsonb
);
-- expect true
```

## Behaviour after apply

- **Save job card** (`upsert_kernel_job_card`) copies style lines into `packing_data` when the job card has cartons or kg on at least one style row.
- **Release to stock** (`complete_kernel_batch`) re-syncs `packing_data` from the stored job card and requires style quantities.
- **Stock grid** (`get_kernel_batches` with `status = complete`) uses job card yields when `kernel_job_card_has_stock_quantities(job_card_data)` is true.

## Smoke test in the portal

1. Hard-refresh the Web Portal.
2. Open a batch in QA → Job card → change a style line (cartons or kg) → **Jobcard approved**.
3. **Release to stock** → **Stock (Kernel)** → confirm per-style on hand matches the job card (not old packing-stage totals).

Existing **complete** batches with wrong stock: open the job card, correct style lines, save once (re-syncs packing).
