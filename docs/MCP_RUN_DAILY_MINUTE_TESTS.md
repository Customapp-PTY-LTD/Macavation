# Run Daily Minute Tests migration via Supabase MCP

Adds **get_daily_minute_tests** so the Executive Dashboard **Daily minute tests** card can show 07h00, 10h00, 13h00 and Averages from Production → Cracking (today’s data, SA timezone).

Run against the **same Supabase project** your app uses.

---

## Option A: Supabase MCP (recommended)

1. In Cursor, ensure the **Supabase MCP** server is connected (e.g. `user-supabase`).
2. Use the MCP **execute_sql** tool and run the SQL from **migrations/20260330000001_get_daily_minute_tests.sql** in **one step**.

If you prefer to copy-paste, use the SQL block below (same as the migration).

**Step – Create get_daily_minute_tests and RBAC:**

```sql
-- Daily minute tests for dashboard: aggregate 07h00, 10h00, 13h00 and Averages from cracking_data
-- for a given date (default: today in SA). Each time slot can come from a different batch.

CREATE OR REPLACE FUNCTION public.get_daily_minute_tests(p_date date DEFAULT NULL)
RETURNS TABLE (
    time_slot text,
    wholes text,
    uncracks text,
    total text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_date date := COALESCE(p_date, (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date);
    v_wholes_07 text;
    v_uncracks_07 text;
    v_total_07 text;
    v_wholes_10 text;
    v_uncracks_10 text;
    v_total_10 text;
    v_wholes_13 text;
    v_uncracks_13 text;
    v_total_13 text;
    v_avg_wholes text;
    v_avg_uncracks text;
    v_avg_total text;
BEGIN
    SELECT
        NULLIF(TRIM(MAX(elem->>'wholes_07')), ''),
        NULLIF(TRIM(MAX(elem->>'uncracks_07')), ''),
        NULLIF(TRIM(MAX(elem->>'total_07')), ''),
        NULLIF(TRIM(MAX(elem->>'wholes_10')), ''),
        NULLIF(TRIM(MAX(elem->>'uncracks_10')), ''),
        NULLIF(TRIM(MAX(elem->>'total_10')), ''),
        NULLIF(TRIM(MAX(elem->>'wholes_13')), ''),
        NULLIF(TRIM(MAX(elem->>'uncracks_13')), ''),
        NULLIF(TRIM(MAX(elem->>'total_13')), ''),
        NULLIF(TRIM(MAX(elem->>'avg_wholes')), ''),
        NULLIF(TRIM(MAX(elem->>'avg_uncracks')), ''),
        NULLIF(TRIM(MAX(elem->>'avg_total')), '')
    INTO
        v_wholes_07, v_uncracks_07, v_total_07,
        v_wholes_10, v_uncracks_10, v_total_10,
        v_wholes_13, v_uncracks_13, v_total_13,
        v_avg_wholes, v_avg_uncracks, v_avg_total
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (
          (CASE
               WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
               WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
               ELSE NULL
           END) = v_date
      );

    time_slot := '07h00'; wholes := COALESCE(v_wholes_07, ''); uncracks := COALESCE(v_uncracks_07, ''); total := COALESCE(v_total_07, ''); RETURN NEXT;
    time_slot := '10h00'; wholes := COALESCE(v_wholes_10, ''); uncracks := COALESCE(v_uncracks_10, ''); total := COALESCE(v_total_10, ''); RETURN NEXT;
    time_slot := '13h00'; wholes := COALESCE(v_wholes_13, ''); uncracks := COALESCE(v_uncracks_13, ''); total := COALESCE(v_total_13, ''); RETURN NEXT;
    time_slot := 'Averages'; wholes := COALESCE(v_avg_wholes, ''); uncracks := COALESCE(v_avg_uncracks, ''); total := COALESCE(v_avg_total, ''); RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_daily_minute_tests(date) IS 'Daily minute tests for dashboard: TIME, WHOLES, UNCRACKS, TOTAL for 07h00, 10h00, 13h00, Averages from cracking_data for given date (default SA today).';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.role_permissions
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'get_daily_minute_tests' AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'get_daily_minute_tests', 'EXECUTE', true);
        END IF;
    END LOOP;
END $$;
```

**Note:** The RBAC block uses `v_role_id uuid` for the **MCP (dev)** project. If you run this on the **production (Lambda)** project, change it to `v_role_id integer` and use the same `IF NOT EXISTS ... INSERT` pattern (see **docs/RBAC_GUIDE.md**).

3. Refresh the Executive Dashboard; the **Daily minute tests** card will show the table (07h00, 10h00, 13h00, Averages).

---

## Add batch column (show which batch each time slot came from)

To show the **batch** next to each minute test time (07h00, 10h00, 13h00, Averages), run the follow-up migration so the dashboard can display which batch those values came from.

1. Use the MCP **execute_sql** tool and run the SQL from **migrations/20260330000002_get_daily_minute_tests_add_batch.sql** in **one step**. (The migration drops the function then recreates it with a `batch` column from `batches.batch_id`.)
2. No RBAC change needed (same function name). See **docs/RBAC_GUIDE.md** and **docs/RBAC_NEW_FUNCTION_CHECKLIST.md** if you run on production.

---

## Auto-populate Averages row

The **Averages** row at the bottom is computed from the 07h00, 10h00, and 13h00 values (average of whichever slots have numeric data). No manual entry needed.

1. Run **migrations/20260330000003_get_daily_minute_tests_auto_averages.sql** via MCP **execute_sql** or the Supabase SQL Editor. This replaces the function so the Averages row is always derived from the three time slots.
2. No RBAC change (same function name).

---

## Option B: Supabase SQL Editor

Run **migrations/20260330000001_get_daily_minute_tests.sql** in the SQL Editor.  
On **production**, if your `roles.id` is `integer`, change the RBAC block to use `v_role_id integer` (see **docs/RBAC_GUIDE.md**).

---

## RBAC (both projects)

- The migration includes an RBAC block that grants `EXECUTE` on `get_daily_minute_tests` to all roles.
- **Master grant:** `get_daily_minute_tests` is already added to **migrations/20260218000001_grant_all_data_functions_to_all_roles.sql**. Run that migration (or the grant block) on any project where you want all roles to have access.
- For full checklist: **docs/RBAC_NEW_FUNCTION_CHECKLIST.md**.

---

## Prerequisites

- Table **kernel** with **cracking_data** (array of day objects with optional `wholes_07`, `uncracks_07`, `total_07`, `wholes_10`, … `avg_wholes`, `avg_uncracks`, `avg_total`).

---

## See also

- **docs/RBAC_GUIDE.md** – Two projects (MCP vs Lambda), master grant, verify counts.
- **docs/RBAC_NEW_FUNCTION_CHECKLIST.md** – Three places to update for new functions.
- **docs/MCP_RUN_DASHBOARD_KERNEL_STATS.md** – Dashboard kernel stats.
- **docs/MCP_RUN_PRODUCTION_TRENDS.md** – Production Trends chart.
