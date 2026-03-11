# Fix "Active Batches" (get_executive_kpis) via Supabase MCP

**Active Batches** = all kernel batches that are **in intake** (status `intake`, `receiving`) or **in kernel production** (status `production`). Batches in QA, complete, or finished stock are excluded.

Run against the **same Supabase project** your app uses.

---

## Option A: Supabase MCP (recommended)

1. In Cursor, ensure the **Supabase MCP** server is connected (e.g. `user-supabase`).
2. Use the MCP **execute_sql** tool and run the SQL from **migrations/20260329000001_active_batches_intake_and_production_only.sql** (or the snippet below).

**Step – Update get_executive_kpis so active_batches = intake + kernel production only:**

```sql
CREATE OR REPLACE FUNCTION public.get_executive_kpis()
RETURNS TABLE (total_production_kg numeric, active_batches bigint, total_sales numeric, quality_pass_rate numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_active_batches bigint;
  v_total_production numeric := 0;
  v_total_sales numeric := 0;
  v_quality_pass_rate numeric := 0;
BEGIN
  -- Active batches = kernel in intake (intake, receiving) or in kernel production (production) only.
  SELECT count(*)::bigint INTO v_active_batches
  FROM public.kernel k
  WHERE k.is_active = true
    AND (k.status IS NULL OR k.status IN ('intake', 'receiving', 'production'));

  -- Total production (kg) from packing_data (unchanged)
  SELECT COALESCE(SUM(COALESCE(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric + NULLIF(TRIM(elem->>'bt_total_qty'), '')::numeric, (SELECT COALESCE(SUM(NULLIF(TRIM(v->>'qty'), '')::numeric), 0) FROM jsonb_each(COALESCE(elem->'sound_kernel', '{}'::jsonb) || COALESCE(elem->'butter_grade', '{}'::jsonb)) AS t(k, v) WHERE v->>'qty' IS NOT NULL AND TRIM(COALESCE(v->>'qty', '')) <> ''), 0)), 0) INTO v_total_production
  FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
  WHERE k.is_active = true AND elem ? 'date' AND (elem->>'date') IS NOT NULL AND TRIM(COALESCE(elem->>'date', '')) <> '';

  RETURN QUERY SELECT v_total_production, v_active_batches, v_total_sales, v_quality_pass_rate;
END;
$func$;

COMMENT ON FUNCTION public.get_executive_kpis() IS 'Executive dashboard KPIs. active_batches = kernel in intake or production only.';
```

3. Refresh the Executive Dashboard; **Active Batches** will show only batches in intake or kernel production.

---

## Option B: Supabase SQL Editor

Run **migrations/20260329000001_active_batches_intake_and_production_only.sql** in the SQL Editor. (Requires get_executive_kpis to already exist with total_production_kg logic; if not, run 20260328000002 first.)

---

## See also

- **docs/MCP_RUN_DASHBOARD_KERNEL_STATS.md** – "Kernel batches in production" card count.
- **docs/MCP_RUN_KERNEL_BATCH_NAMING.md** – Batch naming and kernel_dispatch_orders.
