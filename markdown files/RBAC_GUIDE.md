# RBAC Quick Guide

## The Golden Rule
Every new DB function needs **3 things** before it will work in the app:
1. The function must exist in the **production Supabase project**
2. RBAC rows must exist in `role_permissions` for that project
3. Function name must be in the master grant migration file

---

## Two Supabase Projects — Know Which One You're On

| | Dev (MCP) | Production (Lambda / live app) |
|---|---|---|
| Used by | Claude Code MCP | The actual running app |
| `roles.id` type | `uuid` | `integer` |
| Role count | 16 | 14 |

**Migrations run via Claude MCP do NOT apply to the production project.**
To apply to production: paste the SQL into the **production Supabase SQL Editor** and run it there.

Check which project you're in:
```sql
SELECT pg_typeof(id), COUNT(*) FROM public.roles LIMIT 1;
-- uuid  + 16 = dev (MCP)
-- int4  + 14 = production (Lambda)
```

---

## Adding a New Function — Do These 3 Things

### 1. Create the function + grant RBAC (one migration file)

```sql
-- your function here
CREATE OR REPLACE FUNCTION public.my_new_function(...)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ ... $$;

-- RBAC block at the bottom of every migration
DO $$
DECLARE
    v_role_id integer;  -- integer on production | uuid on dev
    v_fn      varchar;
    v_fns     varchar[] := ARRAY['my_new_function'];
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

Run this in the **production Supabase SQL Editor**, then run:
```sql
NOTIFY pgrst, 'reload schema';
```

### 2. Add to the master grant file

Open `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` and add the function name to the array:
```sql
'my_new_function',   -- ← add this line
```

### 3. Verify

```sql
SELECT COUNT(*) FROM public.role_permissions
WHERE object_name = 'my_new_function' AND operation = 'EXECUTE';
-- Production: should be 14
-- Dev: should be 16
```

---

## Error Lookup

### 403 — RBAC_PERMISSION_DENIED
```json
{ "code": "RBAC_PERMISSION_DENIED", "message": "operation EXECUTE is not allowed" }
```
The function **exists** but the role has no permission row.

**Fix:**
```sql
DO $$
DECLARE v_role_id integer;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'my_function_name', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
```
Then **log out and log back in** (old JWT won't see new permissions).

---

### PGRST202 — Function not in schema cache
```json
{ "code": "PGRST202", "message": "Could not find the function public.my_function(...)" }
```
The function **does not exist** on this Supabase project, OR PostgREST hasn't refreshed.

**Fix step 1 — Check if the function exists:**
```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'my_function_name';
```
- Empty = **function missing** → create it (paste the CREATE FUNCTION SQL and run)
- Found = **schema cache stale** → run `NOTIFY pgrst, 'reload schema';`

**Fix step 2 — After creating:** `NOTIFY pgrst, 'reload schema';`

---

### Still 403 after granting?
→ **Log out and log back in.** The JWT caches the role. Old tokens stay valid until expiry.

### Works on dev but not in the live app?
→ You applied the migration to the MCP (dev) project only. Paste and run the same SQL on the **production Supabase SQL Editor**.

---

## Copy-Paste: Grant a Single Function to All Roles (Production)

```sql
-- Replace 'my_function_name' with the actual function name
DO $$
DECLARE v_role_id integer;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'my_function_name', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
```

---

## Checklist

```
□ Function created on the PRODUCTION project (SQL Editor)
□ NOTIFY pgrst, 'reload schema'; run after creating
□ RBAC granted on production (14 rows for the function)
□ Function name added to 20260218000001_grant_all_data_functions_to_all_roles.sql
□ If still 403: log out and log back in
```
