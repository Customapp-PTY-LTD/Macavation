# Supplier Intake – Save working (3 steps)

When you see *"Supplier Intake direct save is not configured"*, *"Access denied: operation EXECUTE is not allowed"*, or *"Could not find the function public.create_supplier_intake_batch ... in the schema cache"*, follow these steps so **Save** works.

---

## Step 1: Create the table and functions in Supabase (required first)

If you see **"Could not find the function ... in the schema cache"**, the `supplier_intake_batches` table and RPCs don’t exist yet in this project.

1. Open **Supabase Dashboard** → your project → **SQL Editor** → **New query**.
2. Run the **whole** of **`migrations/20260212000001_supplier_intake_batches.sql`** (creates the table, `get_supplier_intake_batches`, and `create_supplier_intake_batch`).
3. Then run **`migrations/20260212000003_supplier_intake_grant_anon.sql`** (grants EXECUTE to anon/authenticated).

If the table already exists, you can skip to Step 2.

---

## Step 2: Add your Supabase anon key

1. Open **Supabase Dashboard** → your project (the one in `appRouteConfig.json`: `sofanhfpxifgdtooefzq.supabase.co`).
2. Go to **Project Settings** (gear) → **API**.
3. Under **Project API keys**, copy the **anon** **public** key (long string starting with `eyJ...`).
4. In your repo, open **`js/appRouteConfig.json`**.
5. In the environment you use (e.g. `default`), set:
   ```json
   "SupabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
   ```
   Paste your real key between the quotes (replace the empty `""` that’s there now).
6. Save the file.

---

## Step 3: Run the GRANT SQL in Supabase (if not done in Step 1)

1. In the **same** Supabase project: **SQL Editor** → **New query**.
2. Paste the contents of **`migrations/20260212000003_supplier_intake_grant_anon.sql`** (or the SQL below).
3. Click **Run**.

```sql
GRANT EXECUTE ON FUNCTION public.get_supplier_intake_batches(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_intake_batches(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_supplier_intake_batch(
    varchar, date, varchar, uuid, text,
    varchar, varchar, varchar, varchar, varchar, varchar, text,
    varchar, text, varchar, integer, numeric, date, date
) TO anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_intake_batch(
    varchar, date, varchar, uuid, text,
    varchar, varchar, varchar, varchar, varchar, varchar, text,
    varchar, text, varchar, integer, numeric, date, date
) TO authenticated;
```

---

After both steps, reload the app and try **Save** again on “New batch of product”. It should succeed.
