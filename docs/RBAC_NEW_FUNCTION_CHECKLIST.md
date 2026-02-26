# RBAC: Adding Permissions for New Functions

Every time you create a new database function you **must** update RBAC in three places. Miss one and users get a 403 `RBAC_PERMISSION_DENIED` error.

---

## ⚠️ Critical: Two Supabase Projects

This project uses **two separate Supabase databases**:

| | MCP Project (dev) | Lambda Project (production) |
|---|---|---|
| Used by | Claude Code MCP tool | Live app / Lambda proxy |
| `roles.id` type | `uuid` | `integer` |
| Role count | 16 | 14 |
| Has `batches` table | ✅ | ❌ (needs migrations run) |

**Migrations applied via the MCP tool do NOT automatically apply to the Lambda project.**
Always run new migrations on BOTH projects. The Lambda project is the one users actually hit.

### How to tell which project you're on

Run this in the Supabase SQL Editor for each project:

```sql
SELECT pg_typeof(id) AS id_type, COUNT(*) AS role_count FROM public.roles LIMIT 1;
-- MCP project:    id_type = uuid,    role_count = 16
-- Lambda project: id_type = integer, role_count = 14
```

---

## How RBAC Works

```
User calls dataFunctions.someFunction()
  → Lambda receives JWT
  → Lambda reads role_id from JWT
  → Lambda queries role_permissions on THE LAMBDA PROJECT:
      SELECT allowed FROM role_permissions
      WHERE role_id = <role_id>
        AND object_type = 'function'
        AND object_name = 'some_function'
        AND operation   = 'EXECUTE'
  → allowed = true  → function runs ✅
  → no row / allowed = false → 403 RBAC_PERMISSION_DENIED ❌
```

---

## The Three Places to Update

### Place 1 — RBAC block in the migration file

Every migration that creates a function ends with a RBAC DO block. **Do not skip this.**

The type of `v_role_id` depends on which project the migration targets:

```sql
-- ── RBAC ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_role_id integer;   -- Lambda project: integer
 -- v_role_id uuid;      -- MCP/dev project: uuid
    v_fn      varchar;
    v_fns     varchar[] := ARRAY[
        'your_new_function_name',
        'another_new_function'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
```

**Before writing the RBAC block**, check which type the target project uses:
```sql
SELECT pg_typeof(id) FROM public.roles LIMIT 1;
```

**Other rules:**
- `ON CONFLICT DO NOTHING` — safe to re-run
- Include ALL functions created in that migration file

### Place 2 — The master grant migration

Open `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` and add the new function name(s) to the `v_functions` array:

```sql
v_functions text[] := ARRAY[
    ...existing functions...,
    'your_new_function_name',   -- ← add here
    'another_new_function'      -- ← and here
];
```

This is the canonical source of truth. Any environment that runs it from scratch gets all permissions.

### Place 3 — Verify on BOTH projects

```sql
SELECT object_name, COUNT(*) AS role_count
FROM public.role_permissions
WHERE object_name IN ('your_new_function_name', 'another_new_function')
  AND operation = 'EXECUTE'
GROUP BY object_name;
-- MCP project:    expect 16 per function
-- Lambda project: expect 14 per function
```

---

## Fixing a 403 RBAC_PERMISSION_DENIED Error

### Step 1 — Identify the missing function

```json
{ "error": "Forbidden", "code": "RBAC_PERMISSION_DENIED",
  "message": "Access denied: operation EXECUTE is not allowed.",
  "role": "9c69485d-..." }
```

Note: the `role` field is the role UUID from the JWT. The Lambda project stores role IDs as integers internally, but the JWT carries the UUID from Supabase Auth — the Lambda maps between them.

### Step 2 — Check if the function exists at all

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'your_function_name';
-- Empty result = function was never created → create it first
-- One row     = function exists → RBAC rows are just missing
```

A missing function looks like a 403 at the RBAC check level (before PostgreSQL even sees the call). Always confirm the function exists before debugging permissions.

### PGRST202 — "Could not find function in schema cache"

This is a **PostgREST schema cache error**, not an RBAC error. It means PostgREST doesn't know about the function yet.

```json
{
  "code": "PGRST202",
  "message": "Could not find the function public.some_function(p_x, p_y) in the schema cache"
}
```

**Causes:**
1. Function was created on the wrong Supabase project (most common — check the two-project section above)
2. PostgREST cache hasn't refreshed yet after the function was just created

**Fix 1 — Force schema cache reload (run in SQL Editor):**
```sql
NOTIFY pgrst, 'reload schema';
```
PostgREST also auto-reloads every ~30 seconds on Supabase.

**Fix 2 — If the function depends on a missing table:**
If you see PGRST202 for a function that references a table that doesn't exist on the Lambda project, run the table-creation migration first, then the function migration, then reload the schema. Order matters — create tables before functions that reference them.

### Step 3 — Check and fix RBAC rows on the Lambda project

```sql
-- Check
SELECT COUNT(*) FROM public.role_permissions
WHERE object_name = 'your_function_name' AND operation = 'EXECUTE';
-- Lambda project: expect 14. If 0: grant it.

-- Fix
DO $$
DECLARE
    v_role_id integer;   -- integer on Lambda project
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'your_function_name', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
```

### Step 4 — Add it to the master migration

Open `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` and add the function name to the array.

### Step 5 — Have users log out and back in

Old JWTs stay valid until expiry even after you fix the DB. **Log out → log in** to force a fresh JWT with updated role info.

---

## Checklist for Every New Function

```
□ Check target project's roles.id type:  SELECT pg_typeof(id) FROM public.roles LIMIT 1;
□ Write function migration with RBAC DO block (correct integer vs uuid, ON CONFLICT DO NOTHING)
□ Run migration on BOTH projects (MCP project AND Lambda project)
□ Verify count:  Lambda=14, MCP=16 per function in role_permissions
□ Add function name(s) to 20260218000001_grant_all_data_functions_to_all_roles.sql
□ After fixing 403: log out and log back in
```

---

## Common Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Wrong `v_role_id` type for the target project | 0 rows inserted silently, still 403 | Check `pg_typeof(id)` on the target project |
| Function doesn't exist (never created) | 403 before the function even runs | Create the function first |
| Ran migration on MCP project only, not Lambda project | 403 in live app, works in MCP | Run on the Lambda project's Supabase SQL Editor |
| Forgot RBAC block in migration | 403 immediately | Add DO block, run manually |
| Old JWT | 403 even after granting | Log out and log back in |
| Added to migration but forgot master migration | Works now, breaks on fresh DB | Update `20260218000001_...` |

---

## Quick Reference — RBAC Block Templates

**For Lambda project (integer role IDs, 14 roles):**
```sql
DO $$
DECLARE
    v_role_id integer;
    v_fn      varchar;
    v_fns     varchar[] := ARRAY['function_one', 'function_two'];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
```

**For MCP/dev project (uuid role IDs, 16 roles):**
```sql
DO $$
DECLARE
    v_role_id uuid;
    v_fn      varchar;
    v_fns     varchar[] := ARRAY['function_one', 'function_two'];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
```

---

## Functions That Need to Be Applied to the Lambda Project

The Lambda project is missing these migrations (run them via the Supabase SQL Editor on the Lambda project):

### New kernel schema (migrations 20260225–20260226)
Run in order:
1. `20260225000000_consolidate_kernel_to_batches_and_kernel.sql` — creates `batches` + `kernel` tables
2. `20260225000001_add_received_date_to_kernel.sql`
3. `20260225000002_create_get_kernel_batches.sql`
4. `20260226000001_create_kernel_detail_and_write_functions.sql`
5. `20260226000002_create_kernel_batch_write_functions.sql`
6. `20260226000003_create_get_kernel_production_history.sql`

### New oil schema (migrations 20260226)
7. `20260226000004_create_oil_table_and_migrate.sql`
8. `20260226000005_create_oil_batch_sps.sql`
9. `20260226000006_replace_oil_with_new_schema.sql`
10. `20260226000007_create_oil_schema_sps.sql`
11. `20260226000008_grant_upsert_batch_rbac_all_roles.sql`
12. `20260226000009_create_upsert_batch.sql`

After running all migrations on the Lambda project, run the master grant:
```
20260218000001_grant_all_data_functions_to_all_roles.sql
```

---

## Functions Confirmed Working on Lambda Project

- `upsert_batch` — created via migration 000009, 14 RBAC rows ✅
