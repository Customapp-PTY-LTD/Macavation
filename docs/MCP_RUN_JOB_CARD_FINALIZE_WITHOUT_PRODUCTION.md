# Run job card “skip production → release ready” (`upsert_kernel_job_card` 4-arg) via Supabase MCP

Kernel Production **Job card** modal includes a checkbox: **Skip production & end sample — … mark batch release ready**. When the user confirms and saves, the app calls `upsert_kernel_job_card` with `p_finalize_without_production: true`. The database then:

- Saves `job_card_data` and sets `jobcard_approved` (and `production_finished_at` if not already set).
- Sets `status` to `qa` when it is not already `complete`, `dispatch`, or `qa`.
- If `qa_data` is empty, sets a minimal JSON object with `job_card_only_release_ready: true` and `recorded_at` so `has_qa` is true and the grid shows **Release ready**.

Apply on **every** database your Lambda/API uses (see **docs/RBAC_NEW_FUNCTION_CHECKLIST.md**).

---

## 1. Migration

Run **`migrations/20260404150001_upsert_kernel_job_card_finalize_without_production.sql`** in Supabase SQL Editor or via MCP **execute_sql**.

---

## 2. RBAC

The migration’s `DO $$ … INSERT INTO role_permissions … upsert_kernel_job_card` block should refresh **EXECUTE** for all roles. If you still see access errors, use the same **ensure** pattern as other functions (insert from `public.roles`, `ON CONFLICT DO NOTHING`).

---

## 3. Smoke test

```sql
-- Replace with a real test kernel id in a safe environment.
SELECT public.upsert_kernel_job_card(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '{}'::jsonb,
  true,
  true
);
-- Expect success false if id missing; with a valid id expect success true and finalized_without_production true.
```

---

## 4. UI

After the migration is applied, open **Kernel Production → Actions → Job Card**, complete the form, tick the shortcut checkbox, choose **Save & finalize**, then **Jobcard approved**. The batch should move to the **Release ready** column and **Release to stock** should be available when other rules allow.
