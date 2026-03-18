# Run kernel batch naming (Bn SS YY NN) via Supabase MCP

Kernel batch names use the format **Bn [supplier #] [year] [seq]** with spaces and zero-padding, e.g. `Bn 01 26 01`, `Bn 10 26 02`. Run the following against the **same Supabase project** your app uses.

## Prerequisites

- NIS suppliers seeded (see **docs/MCP_RUN_NIS_SEED.md**) and, if needed, **supplier_number** backfill below.
- Tables `public.contacts`, `public.batches`, `public.kernel` must exist.

---

## Option A: Supabase MCP (recommended)

1. In Cursor, ensure the **Supabase MCP** server is connected (e.g. `user-supabase`).
2. Use the MCP **execute_sql** tool and run the SQL in **two steps**.

**Step 1 – Add supplier_number and backfill NIS suppliers:**

```sql
-- Add supplier_number to contacts (for NIS supplier numbering 1-60)
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS supplier_number integer;

-- Backfill NIS suppliers from notes "Supplier #N"
UPDATE public.contacts
SET supplier_number = (regexp_match(notes, 'Supplier #([0-9]+)'))[1]::integer
WHERE contact_type = 'nis_supplier'
  AND notes IS NOT NULL
  AND notes ~ 'Supplier #[0-9]+'
  AND supplier_number IS NULL;

COMMENT ON COLUMN public.contacts.supplier_number IS 'NIS supplier number (1-60) from Macadamia Kernel Statistics; used for display order and batch naming.';
```

**Step 2 – Create get_next_batch_number and update create_kernel_batch:**

```sql
-- get_next_batch_number(p_supplier_id, p_year) → e.g. 'Bn 01 26 01'
CREATE OR REPLACE FUNCTION public.get_next_batch_number(
    p_supplier_id uuid DEFAULT NULL,
    p_year       int DEFAULT NULL
)
RETURNS varchar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_supplier_no int;
    v_year2       int;
    v_prefix      varchar;
    v_seq         int;
BEGIN
    v_year2 := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int) % 100;

    IF p_supplier_id IS NOT NULL THEN
        SELECT COALESCE(c.supplier_number, 0) INTO v_supplier_no
        FROM public.contacts c
        WHERE c.id = p_supplier_id;
    END IF;
    v_supplier_no := COALESCE(v_supplier_no, 0);

    v_prefix := 'Bn ' || lpad(v_supplier_no::text, 2, '0') || ' ' || lpad(v_year2::text, 2, '0') || ' ';

    IF p_supplier_id IS NOT NULL THEN
        SELECT COUNT(*)::int INTO v_seq
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE k.supplier_id = p_supplier_id
          AND b.batch_id LIKE v_prefix || '%';
    ELSE
        SELECT COUNT(*)::int INTO v_seq
        FROM public.batches b
        WHERE b.batch_id LIKE v_prefix || '%';
    END IF;

    RETURN v_prefix || lpad((v_seq + 1)::text, 2, '0');
END;
$$;

-- create_kernel_batch: null p_batch_number → auto-assign Bn SS YY NN
CREATE OR REPLACE FUNCTION public.create_kernel_batch(
    p_batch_number          varchar DEFAULT NULL,
    p_received_date         date DEFAULT NULL,
    p_wet_nis_received_kg   numeric  DEFAULT NULL,
    p_supplier_id           uuid     DEFAULT NULL,
    p_grower_name           varchar  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_number varchar;
    v_batch_id     uuid;
    v_kernel_id    uuid;
    v_year         int;
BEGIN
    v_batch_number := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF v_batch_number IS NULL THEN
        v_year := EXTRACT(YEAR FROM COALESCE(p_received_date, CURRENT_DATE))::int;
        v_batch_number := public.get_next_batch_number(p_supplier_id, v_year);
    END IF;

    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (v_batch_number, 'kernel', true)
    RETURNING id INTO v_batch_id;

    INSERT INTO public.kernel (
        batch_id, supplier_id, grower_name, status,
        received_date, wet_nis_received_kg, is_active
    )
    VALUES (
        v_batch_id, p_supplier_id, p_grower_name, 'production',
        p_received_date, p_wet_nis_received_kg, true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object('success', true, 'id', v_kernel_id, 'batch_id', v_batch_id, 'batch_number', v_batch_number);
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists');
END;
$$;

-- RBAC
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_next_batch_number', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
```

3. Refresh the app. New kernel batches (Kernel Production “New batch” and Grower Intake “Create kernel batch”) will get names like **Bn 01 26 01**.

---

## Manual batch number override (Grower Intake)

The suggested batch number is based on how many batches already exist in the system for that supplier and year. If a grower has already run batches this year that are **not** in the system (e.g. processed elsewhere), you can override the sequence:

- In **Create kernel batch**, after selecting the grower and date, the **Batch number** field is filled with the suggested value (e.g. `Bn 01 26 01`).
- The field is **editable**: change the last two digits (e.g. `01` → `05`) to match the correct sequence for that grower this year.
- Use **Refresh suggested** to re-fetch the next number from the system if you want to reset to the auto value.

No database migration is required for manual override; the backend accepts any valid `batch_id` you enter.

You can **clear the suggested Bn name and type any batch number** (e.g. legacy or off-system IDs); that exact string is saved. After you edit the batch number field, changing the received date no longer overwrites it—use **Refresh suggested** if you want the Bn suggestion again.

---

## See also (other MCP migrations)

- **docs/MCP_RUN_DASHBOARD_KERNEL_STATS.md** – Fix "Kernel batches in production" dashboard card so the count matches the Kernel Production grid.
- **docs/MCP_RUN_PRODUCTION_TRENDS.md** – Production Trends chart: daily cracked / packed / dispatched (kg).
- **docs/MCP_RUN_EXECUTIVE_KPIS_ACTIVE_BATCHES.md** – Fix "Active Batches" card (get_executive_kpis).
- **docs/MCP_RUN_DASHBOARD_STATS_ALL.md** – Fix most Executive Dashboard stats (production stats + Total Production kg) when tables are missing.

---

## Option B: Supabase SQL Editor

Run the full migration files in order:

1. **supplier_number:** `migrations/20260316000003_add_supplier_number_and_backfill_nis.sql`
2. **Bn naming:** `migrations/20260317000001_batch_naming_bn_supplier_year_seq.sql`

---

## Format reference

| Part   | Meaning              | Example |
|--------|----------------------|--------|
| Bn     | Literal prefix       | Bn     |
| SS     | Supplier number 1–60 | 01, 10, 60 |
| YY     | 2-digit year        | 26     |
| NN     | Sequence that year   | 01, 02 |

Example: **Bn 01 26 01** = batch 1 from supplier #1 (e.g. Amber Macs) in 2026.
