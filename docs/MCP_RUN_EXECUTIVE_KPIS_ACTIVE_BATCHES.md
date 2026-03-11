# Fix "Active Batches" (get_executive_kpis) via Supabase MCP

The **Active Batches** Executive Dashboard card shows 0 when it should show the same count as Kernel Production. This migration creates or updates **get_executive_kpis** so **active_batches** = count of active kernel batches.

Run against the **same Supabase project** your app uses.

---

## Option A: Supabase MCP (recommended)

1. In Cursor, ensure the **Supabase MCP** server is connected (e.g. `user-supabase`).
2. Use the MCP **execute_sql** tool and run the SQL below in **one step**.

**Step – Create/update get_executive_kpis so active_batches matches Kernel Production:**

```sql
DROP FUNCTION IF EXISTS public.get_executive_kpis();

CREATE OR REPLACE FUNCTION public.get_executive_kpis()
RETURNS TABLE (total_production_kg numeric, active_batches bigint, total_sales numeric, quality_pass_rate numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_active_batches bigint;
  v_total_production numeric := 0;
  v_total_sales numeric := 0;
  v_quality_pass_rate numeric := 0;
BEGIN
  SELECT count(*)::bigint INTO v_active_batches FROM public.kernel k WHERE k.is_active = true;
  RETURN QUERY SELECT v_total_production, v_active_batches, v_total_sales, v_quality_pass_rate;
END;
$$;

COMMENT ON FUNCTION public.get_executive_kpis() IS 'Executive dashboard KPIs. active_batches = active kernel count (matches Kernel Production).';

DO $$
DECLARE v_role_id record;
BEGIN
  FOR v_role_id IN SELECT id FROM public.roles LOOP
    INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
    VALUES (v_role_id.id, 'function', 'get_executive_kpis', 'EXECUTE', true)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;
```

3. Refresh the Executive Dashboard; the **Active Batches** card will show the same count as your kernel batches.

---

## Option B: Supabase SQL Editor

Run **migrations/20260327000001_get_executive_kpis_active_batches.sql** in the SQL Editor.

---

## See also

- **docs/MCP_RUN_DASHBOARD_KERNEL_STATS.md** – "Kernel batches in production" card count.
- **docs/MCP_RUN_KERNEL_BATCH_NAMING.md** – Batch naming and kernel_dispatch_orders.
