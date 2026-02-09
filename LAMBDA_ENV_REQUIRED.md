# Lambda environment variable required

For **Create kernel batch** and RBAC (e.g. assessor) to work, the Lambda must use the same Supabase project as the app.

**Supabase side (fixed):** The project below has EXECUTE grants for all roles on `get_production_batches`, `create_production_batch_simple`, and `update_production_batch`. No further Supabase changes are needed.

**Admin task:** In **AWS Lambda** → your function → **Configuration** → **Environment variables**, set:

| Name           | Value                                                                 |
|----------------|-----------------------------------------------------------------------|
| `SUPABASE_URL` | `https://tfwrktyynvnjjhcqnlul.supabase.co`                           |

Then **Save** (and redeploy the function if you changed code). The function URL does not change.

If this is wrong or missing, you will see **"Access denied: operation EXECUTE is not allowed"** when creating a batch.
