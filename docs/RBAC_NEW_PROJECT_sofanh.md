# RBAC on project sofanhfpxifgdtooefzq

The app and Lambda use **https://sofanhfpxifgdtooefzq.supabase.co**. To implement RBAC for kernel batch (and fix "operation EXECUTE is not allowed") on that project:

## 1. Run the migration in Supabase

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** and select the project **sofanhfpxifgdtooefzq** (or the one whose URL is `https://sofanhfpxifgdtooefzq.supabase.co`).
2. Go to **SQL Editor**.
3. Open the file **`migrations/20260208000001_rbac_production_batch_sofanh.sql`** in this repo, copy its contents, paste into the SQL Editor, and click **Run**.

**Prerequisites:** The project must already have:
- `public.roles` (with rows for super_user, admin, user, manager, viewer, assessor, student, etc.)
- `public.role_permissions` with a unique constraint on `(role_id, object_type, object_name, operation)`.

If you get a constraint error, your `role_permissions` table may use a different unique constraint. In that case run the three `INSERT ... SELECT` statements **without** the `ON CONFLICT` part (and ignore any duplicate-key errors for rows that already exist).

## 2. Set Lambda environment variable

In **AWS Lambda** → your function → **Configuration** → **Environment variables**, set:

| Name           | Value |
|----------------|--------|
| `SUPABASE_URL` | `https://sofanhfpxifgdtooefzq.supabase.co` |

Then **Save**.

## 3. Sign-in anon key

In **`signin.html`**, set `SUPABASE_ANON_KEY` to the **anon (public) key** of the sofanhfpxifgdtooefzq project (Dashboard → Project Settings → API → anon public).

---

After this, "Create kernel batch" and other production batch actions should work for all roles when the Lambda points at this project.
