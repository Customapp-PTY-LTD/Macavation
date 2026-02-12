# Supplier Intake – Save working (2 steps)

When you see *"Supplier Intake direct save is not configured"* or *"Access denied: operation EXECUTE is not allowed"*, do these two things so **Save** works.

---

## Step 1: Add your Supabase anon key

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

## Step 2: Run the GRANT SQL in Supabase

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
