# Fix: Receiving checklist tick not showing

When you save a receiving checklist but the checkbox never ticks for that batch, follow these steps in order.

---

## Step 1: Fix backend permissions (Supabase)

The app must be allowed to **link** the new checklist to the batch. That uses the `update_production_batch` function. Your role needs EXECUTE permission on it (and on the receiving checklist functions).

1. Open your **Supabase** project (the one the app uses – same as `SUPABASE_URL` in your Lambda/env).
2. Go to **SQL Editor** → **New query**.
3. Copy and paste the SQL below and click **Run**.

```sql
-- Grower Intake: create batch + receiving checklist tick (all roles)
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_production_batches', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'get_production_batches' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_production_batch_simple', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'create_production_batch_simple' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_production_batch', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'update_production_batch' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_receiving_checklist', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'create_receiving_checklist' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_receiving_checklist', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'update_receiving_checklist' AND rp.operation = 'EXECUTE');

UPDATE public.role_permissions
SET allowed = true
WHERE object_type = 'function' AND operation = 'EXECUTE'
  AND object_name IN ('get_production_batches', 'create_production_batch_simple', 'update_production_batch', 'create_receiving_checklist', 'update_receiving_checklist');
```

4. Wait until the query finishes without errors.

---

## Step 2: Sign out and sign in again

So the app (and Lambda) see the new permissions:

1. In the app, sign out.
2. Sign in again.

---

## Step 3: Open the checklist from the batch row (important)

The app only knows **which batch** to link when you open the checklist from that batch’s row.

1. Go to **Kernel → Grower Intake**.
2. In the table **Kernel batches (intake)**, find the batch you want.
3. In the **Stage 1 steps** column, click the **empty box** (☐) next to “Incoming Receiving checklist” for that batch.  
   Do **not** use a separate “Receiving checklist” button at the top of the page.
4. The checklist modal opens. The batch is now “remembered” for linking.

---

## Step 4: Fill and save the checklist

1. Fill in the form (e.g. date received, delivery note ref, vehicle checks, received items if needed).
2. Click **Save Receiving Checklist**.
3. You should see a “Success” message and the modal close.

---

## Step 5: Check that the tick appears

1. The intake table should refresh and the **same batch row** should now show a **green tick in the box** (✓) next to “Checklist” instead of an empty box.
2. If it doesn’t:
   - Press **F5** to refresh the page and look again.
   - Open the browser console (**F12** → **Console**). Look for:
     - **`[Receiving checklist] Linking checklist ... to batch ...`** and **`Batch updated successfully`** → link ran; if the tick still doesn’t show, do a full refresh (F5).
     - **`[Receiving checklist] Link checklist to batch failed`** or a **403** → permissions still blocking; repeat Step 1 on the **same** Supabase project the app uses, then Step 2.

---

## Checklist summary

| Step | What to do |
|------|------------|
| 1 | Run the SQL above in Supabase SQL Editor (same project as the app). |
| 2 | Sign out and sign in. |
| 3 | Open the checklist by clicking the **empty box** next to the batch row (not a top-level button). |
| 4 | Fill the form and click Save. |
| 5 | Confirm the tick appears on that batch; if not, F5 and/or check the console. |

---

## If it still doesn’t work

- Confirm the app’s **Lambda** uses the **same** Supabase project (same URL as in your Supabase dashboard). See `LAMBDA_ENV_REQUIRED.md` for `SUPABASE_URL`.
- In Supabase SQL Editor, run:  
  `SELECT id, batch_number, receiving_checklist_id FROM production_batches WHERE batch_type = 'kernel' ORDER BY received_date DESC LIMIT 5;`  
  After saving a checklist from a batch row, the row for that batch should have a non-null `receiving_checklist_id`. If it stays null, the link step is still failing (permissions or Lambda not forwarding `p_receiving_checklist_id`).
