# Fix: "Access denied: operation EXECUTE is not allowed" – Supplier Intake

## What’s going wrong

When you **Save** on "New batch of product", the app calls the backend (Lambda). The Lambda checks your **role** against the **`role_permissions`** table in Supabase. If your role does not have **EXECUTE** on `create_supplier_intake_batch`, it returns **Access denied**.

So the fix is: add (or correct) that permission in the **same Supabase project the Lambda uses**.

---

## Most likely cause: wrong Supabase project

The Lambda connects to **one** Supabase project (set by the **`SUPABASE_URL`** environment variable). It only reads permissions from **that** project.

If you ran the permission SQL in a **different** project (e.g. a personal or test project), the Lambda will **never** see those changes and will keep returning Access denied.

So you must run the SQL in the **exact** project the Lambda uses.

---

## What to do (step by step)

### 1. Find the Supabase project the Lambda uses

- Ask whoever manages the backend, or  
- If you have access to **AWS Lambda**: open the function → **Configuration** → **Environment variables** and note **`SUPABASE_URL`** (e.g. `https://xxxxx.supabase.co`).  
- That URL is the project where permissions **must** be set.

### 2. Open that project in Supabase

- Go to [https://supabase.com/dashboard](https://supabase.com/dashboard) and sign in.  
- Select the project that matches the host in `SUPABASE_URL` (e.g. `xxxxx.supabase.co`).  
- Do **not** use a different project.

### 3. Run this SQL in that project

In that project: **SQL Editor** → **New query**. Paste and run the block below.

This adds EXECUTE for **all roles** on the two supplier intake functions and sets `allowed = true` for any existing rows. It does **not** use `ON CONFLICT`, so it works even if your `role_permissions` table has no unique constraint.

```sql
-- Supplier Intake: fix "Access denied" (run in the SAME Supabase project as Lambda SUPABASE_URL)

-- Add or keep EXECUTE for get_supplier_intake_batches (all roles)
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_supplier_intake_batches', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.object_type = 'function'
      AND rp.object_name = 'get_supplier_intake_batches' AND rp.operation = 'EXECUTE'
);

-- Add or keep EXECUTE for create_supplier_intake_batch (all roles)
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_supplier_intake_batch', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.object_type = 'function'
      AND rp.object_name = 'create_supplier_intake_batch' AND rp.operation = 'EXECUTE'
);

-- Force allowed = true for any existing rows
UPDATE public.role_permissions
SET allowed = true
WHERE object_type = 'function' AND operation = 'EXECUTE'
  AND object_name IN ('get_supplier_intake_batches', 'create_supplier_intake_batch');
```

### 4. Sign out and sign in again

In the app, **sign out** completely, then **sign in** again. Then try **Save** on "New batch of product" once more.

---

## If it still fails

1. **Confirm the project**  
   In Supabase SQL Editor (in the project from step 1), run:

   ```sql
   SELECT r.id, r.role_name, rp.object_name, rp.allowed
   FROM public.role_permissions rp
   JOIN public.roles r ON r.id = rp.role_id
   WHERE rp.object_name IN ('get_supplier_intake_batches', 'create_supplier_intake_batch')
   ORDER BY r.role_name, rp.object_name;
   ```

   You should see rows for each role with `allowed = true`. If you see no rows, the INSERT/UPDATE didn’t run in this project (or the table/columns are different).

2. **Confirm your role**  
   The error response includes a `"role": "<uuid>"`. Check that this UUID is one of the `r.id` values in the query above. If your user’s role isn’t in `roles` or has no rows in `role_permissions` for these two functions, the Lambda will still deny.

3. **Lambda and Supabase**  
   Ensure the Lambda’s **SUPABASE_URL** (and any Supabase keys it uses) point to this same project. See **LAMBDA_ENV_REQUIRED.md** in the repo root.
