# Job card → stock on hand — Supabase MCP

Macavation Web Portal uses Supabase project **`sofanhfpxifgdtooefzq`**  
(`https://sofanhfpxifgdtooefzq.supabase.co` — see `WebPortal/js/appRouteConfig.json`).

**Before running MCP:** confirm `get_project_url` returns **`https://sofanhfpxifgdtooefzq.supabase.co`**.  
If it shows another host (e.g. `iwxmuemrfopajwvqdiae`), migrations will apply to the wrong database.

**Cursor MCP config:** workspace `.cursor/mcp.json` and user `~/.cursor/mcp.json` should use  
`https://mcp.supabase.com/mcp?project_ref=sofanhfpxifgdtooefzq`.  
Reload the Cursor window after changing MCP config, then complete Supabase MCP auth if prompted.

## Kernel stock migrations (apply in order)

Apply these on **`sofanhfpxifgdtooefzq`** via MCP `apply_migration` or SQL editor:

1. `20260517120000_sync_job_card_to_packing_for_stock.sql`
2. `20260518120000_job_card_stock_robust_styles.sql`
3. `20260519120000_job_card_stock_gated_on_approval.sql`
4. `20260520130000_kernel_batch_detail_jobcard_approved.sql`
5. `20260520140000_kernel_jobcard_approval_map.sql`
6. `20260520140100_grant_get_kernel_jobcard_approval_map.sql`
7. `20260521160000_upsert_kernel_job_card_approval_in_jsonb.sql` (and related approve/consolidate migrations if not already applied)
8. `20260521180000_kernel_jobcard_approve_submit_action.sql`
9. `20260522120000_return_kernel_from_stock_resolve_ref.sql`
10. `20260522130000_kernel_stock_create_and_send_back_grants.sql`

Then: `NOTIFY pgrst, 'reload schema';`

## Verify send-back RPC exists

```sql
SELECT proname, pg_get_function_identity_arguments(oid)
FROM pg_proc
WHERE proname = 'return_kernel_from_stock_to_production';
```

PostgREST check (should not be 404):

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "https://sofanhfpxifgdtooefzq.supabase.co/rest/v1/rpc/return_kernel_from_stock_to_production" \
  -H "apikey: <anon-key>" -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"p_batch_number":"nonexistent-test"}'
```

Expect **200** (JSON body with `success: false`), not **404**.

## Verify job-card helpers

```sql
SELECT proname FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'kernel_job_card_has_stock_quantities',
    'sync_kernel_job_card_to_packing_data',
    'get_kernel_jobcard_approval_map'
  );
```
