# Run Batch Journey permanent delete (`delete_kernel_batch_permanent`) via Supabase MCP

Batch Journey exposes **Edit → Delete permanently**, which calls `delete_kernel_batch_permanent(p_kernel_id uuid)`. That **hard-deletes** the kernel journey row and the matching `batches` header (`batch_type = 'kernel'`), clears silo assignment, and removes or trims `kernel_dispatch_orders.lines` that reference that kernel. It is **not** the same as `deactivate_kernel_batch` (soft delete).

Apply the migration on **every** database your Lambda proxy uses (see **docs/RBAC_NEW_FUNCTION_CHECKLIST.md**).

---

## 1. Run the migration SQL

1. **`migrations/20260404120001_delete_kernel_batch_permanent.sql`** — creates the function and initial RBAC.
2. **`migrations/20260404130001_ensure_delete_kernel_batch_permanent_rbac.sql`** — re-applies `GRANT` + `role_permissions` for **every** role (fixes **“Access denied: operation EXECUTE is not allowed”** if the first file’s RBAC block did not apply, e.g. `roles.id` type mismatch).

Use Supabase MCP **execute_sql** (or SQL Editor) and run **both** files on the **Lambda/live** project (and MCP dev if you use it). Step 2 is safe to run alone if the function already exists.

---

## 2. RBAC check

```sql
SELECT object_name, COUNT(*) AS role_count
FROM public.role_permissions
WHERE object_name = 'delete_kernel_batch_permanent'
  AND operation = 'EXECUTE'
GROUP BY object_name;
```

Expect one row per role count for your project (e.g. 16 on MCP uuid-roles, 14 on Lambda integer-roles).

---

## 3. Smoke test

```sql
-- Do not run on production data without a backup; use a disposable test kernel id.
SELECT public.delete_kernel_batch_permanent('00000000-0000-0000-0000-000000000000'::uuid);
-- Expect: success false, "Kernel batch not found"
```

---

## 4. WebPortal

`WebPortal/js/data-functions.js` exposes **`deleteKernelBatchPermanent(kernelId)`** calling `delete_kernel_batch_permanent`. After deploying SQL, hard-refresh the app so the proxy can execute the new function.
