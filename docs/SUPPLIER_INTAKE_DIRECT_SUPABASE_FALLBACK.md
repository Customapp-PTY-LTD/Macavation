# Supplier Intake: Direct Supabase fallback (fix 403 without changing Lambda/RBAC)

If the Lambda keeps returning **"Access denied: operation EXECUTE is not allowed"** for Supplier Intake and you prefer not to rely on fixing `role_permissions`, you can use the **direct Supabase fallback**:

1. The app will call the Lambda first; if it gets a **403** on `get_supplier_intake_batches` or `create_supplier_intake_batch`, it automatically retries by calling **Supabase RPC directly**.
2. For that to work, Supabase must allow the **anon** role to run these RPCs, and the frontend must have the **Supabase anon key**.

## Step 1: Run the GRANT migration

In your **Supabase** project (the one used by the app), run:

**File:** `migrations/20260212000003_supplier_intake_grant_anon.sql`

Or run this in **SQL Editor**:

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

## Step 2: Set the Supabase anon key in the app

The app needs the **anon (public) key** of your Supabase project so it can call the RPC when the Lambda returns 403.

**Option A – Config (recommended)**  
In **`js/appRouteConfig.json`**, in the environment you use (e.g. `default`), set `SupabaseAnonKey` to your project’s anon key:

- Supabase Dashboard → **Project Settings** → **API** → **Project API keys** → **anon** **public**.

Example (replace with your real key):

```json
"default": {
    "SupabaseUrl": "https://xxxxx.supabase.co",
    "SupabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "LambdaProxyUrl": "..."
}
```

**Option B – Global variable**  
Before the app loads (e.g. in `index.html` or in the console), set:

```js
window.__SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

(Use the same anon key from Supabase → Project Settings → API.)

## Step 3: Use the app as usual

- Open **Supplier Intake** and click **Add new batch of product**.
- Fill the form and click **Save**.
- If the Lambda returns 403, the app will automatically call Supabase for `create_supplier_intake_batch` and the batch will be created.

No need to change Lambda or `role_permissions` for this path.
