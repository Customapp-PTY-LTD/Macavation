# Supabase Functions Guide — Macavation Project

A dev with access to the Supabase MCP and this file should be able to write, apply, and wire up any function from scratch. Nothing is left out.

---

## Table of Contents

1. [Overview](#overview)
2. [Migration File Conventions](#migration-file-conventions)
3. [Function Boilerplate](#function-boilerplate)
4. [RETURNS Types](#returns-types)
5. [Parameters](#parameters)
6. [DECLARE Block](#declare-block)
7. [Read Functions (RETURNS TABLE)](#read-functions-returns-table)
8. [Write Functions (RETURNS jsonb)](#write-functions-returns-jsonb)
9. [JSONB Patterns — Kernel](#jsonb-patterns--kernel)
10. [RBAC — Critical, Read This Carefully](#rbac--critical-read-this-carefully)
11. [Error Handling](#error-handling)
12. [Applying the Migration](#applying-the-migration)
13. [Wiring to data-functions.js](#wiring-to-data-functionsjs)
14. [Complete Worked Examples](#complete-worked-examples)
15. [Common Gotchas](#common-gotchas)

---

## Overview

All DB access goes through SECURITY DEFINER RPC functions. The frontend never touches tables directly. The chain is:

```
Frontend JS → dataFunctions.callFunction('fn_name', params) → Lambda proxy → Supabase RPC → plpgsql function → tables
```

Every new function requires **three things**:
1. The SQL function in a migration file
2. An RBAC grant (in the same migration or a follow-up)
3. A wrapper in `data-functions.js`

---

## Migration File Conventions

**Naming:**
```
YYYYMMDD000NNN_snake_case_description.sql
```

Examples:
```
20260226000002_create_kernel_batch_write_functions.sql
20260226000016_fix_get_kernel_batches_packing_fields.sql
```

- Date is today
- `000NNN` is a sequence number (increment from the last migration in the folder)
- Description is lowercase snake_case, describes what it does

**File structure:**
```sql
-- One-line summary of what this migration does and why.

-- ============================================================
-- 1. Function name / purpose
-- ============================================================
CREATE OR REPLACE FUNCTION public.your_function_name(...)
...

-- ============================================================
-- 2. RBAC
-- ============================================================
DO $$ ... $$;
```

**Always use `CREATE OR REPLACE`** — migrations are idempotent by default.

---

## Function Boilerplate

Every single function in this project follows this exact structure:

```sql
CREATE OR REPLACE FUNCTION public.your_function_name(
    p_param_one   uuid,
    p_param_two   varchar  DEFAULT NULL,
    p_param_three integer  DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_some_var uuid;
BEGIN
    -- body
    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

**Non-negotiables:**
- `public.` schema prefix on the function name
- `LANGUAGE plpgsql`
- `SECURITY DEFINER` — executes as function owner, not caller (required for Lambda to bypass RLS)
- `SET search_path = public` — prevents schema injection attacks and ensures table resolution
- Dollar-quote delimiter `$$` (never single quotes for the body)

---

## RETURNS Types

### `RETURNS TABLE (...)` — for list/grid queries

Use when the frontend needs an array of rows.

```sql
RETURNS TABLE (
    id                  uuid,
    batch_number        varchar,
    status              varchar,
    yield_by_style      jsonb,
    created_at          timestamptz
)
```

Body uses `RETURN QUERY SELECT ...` — columns must match exactly by position and type.

### `RETURNS jsonb` — for write operations and single-row reads

Use for creates, updates, deletes, and modal detail fetches.

Always return a jsonb envelope:
```sql
-- Success
RETURN jsonb_build_object('success', true, 'id', v_id);

-- Error
RETURN jsonb_build_object('success', false, 'error', 'Batch not found');
```

### `RETURNS json` — legacy only

Some older functions use `json` (not `jsonb`). Use `jsonb` for all new functions.

---

## Parameters

**Naming:** always prefix with `p_` (to distinguish from column names).

**Types to use:**
| Value type | SQL type |
|---|---|
| ID (primary key, FK) | `uuid` |
| Short string | `varchar` |
| Long text | `text` |
| Number with decimals | `numeric` |
| Integer | `integer` |
| Date only | `date` |
| Date + time | `timestamptz` |
| True/false | `boolean` |
| JSON object/array | `jsonb` |

**Defaults:**
- Required params: no default
- Optional params: `DEFAULT NULL`
- Pagination: `p_limit integer DEFAULT 100, p_offset integer DEFAULT 0`
- Boolean flags: `p_flag boolean DEFAULT false`

```sql
CREATE OR REPLACE FUNCTION public.get_kernel_batches(
    p_status  varchar  DEFAULT NULL,   -- optional filter
    p_search  varchar  DEFAULT NULL,   -- optional search
    p_limit   integer  DEFAULT 100,
    p_offset  integer  DEFAULT 0
)
```

---

## DECLARE Block

Declare all variables before `BEGIN`. Variable names use `v_` prefix.

```sql
DECLARE
    v_kernel_id    uuid;
    v_batch_uuid   uuid;
    v_count        integer;
    v_result       jsonb;
    v_fn           varchar;
    v_fns          varchar[] := ARRAY['fn_one', 'fn_two'];  -- with default value
BEGIN
```

Common patterns:
```sql
-- UUID from a lookup
SELECT id INTO v_kernel_id FROM public.kernel WHERE batch_id = v_batch_uuid;

-- Check if found
IF v_kernel_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kernel not found');
END IF;

-- NOT FOUND after UPDATE
UPDATE public.kernel SET status = 'complete' WHERE id = p_kernel_id;
IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
END IF;
```

---

## Read Functions (RETURNS TABLE)

Full pattern for a kernel list function:

```sql
CREATE OR REPLACE FUNCTION public.get_kernel_batches(
    p_status  varchar  DEFAULT NULL,
    p_search  varchar  DEFAULT NULL,
    p_limit   integer  DEFAULT 100,
    p_offset  integer  DEFAULT 0
)
RETURNS TABLE (
    id               uuid,
    batch_number     varchar,
    grower_name      varchar,
    status           varchar,
    received_date    date,
    yield_by_style   jsonb,
    created_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id,
        b.batch_id AS batch_number,
        k.grower_name,
        k.status::varchar,
        k.received_date,
        (
            SELECT jsonb_build_object(
                'SP',  COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty', '')::numeric), 0),
                '0',   COALESCE(SUM(NULLIF(e ->> 'sk_0_qty',  '')::numeric), 0)
                -- etc.
            )
            FROM jsonb_array_elements(
                COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
            ) e
        ) AS yield_by_style,
        k.created_at
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.is_active = true
      AND (p_status IS NULL OR k.status = ANY(string_to_array(p_status, ',')))
      AND (p_search IS NULL
           OR b.batch_id ILIKE '%' || p_search || '%'
           OR k.grower_name ILIKE '%' || p_search || '%')
    ORDER BY k.received_date DESC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
```

**Key rules for RETURNS TABLE:**
- Column order in the `RETURNS TABLE (...)` declaration must match the `SELECT` column order exactly
- Cast types explicitly when needed: `k.status::varchar`
- Always filter `k.is_active = true` for kernel rows
- Always join `batches` via `b.id = k.batch_id` to get the human-readable batch number

### Single-row detail (modal) — use RETURNS jsonb

```sql
CREATE OR REPLACE FUNCTION public.get_kernel_batch_detail(
    p_kernel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    SELECT to_jsonb(k) INTO v_result
    FROM (
        SELECT
            k.id, k.batch_id, b.batch_id AS batch_number,
            k.status, k.received_date,
            k.packing_data, k.cracking_data, k.washing_data,
            k.sorting_data, k.job_card_data, k.qa_data
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE k.id = p_kernel_id AND k.is_active = true
        LIMIT 1
    ) k;

    IF v_result IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    RETURN v_result;   -- or: jsonb_build_object('success', true, 'data', v_result)
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

---

## Write Functions (RETURNS jsonb)

### Create (insert into multiple tables)

```sql
CREATE OR REPLACE FUNCTION public.create_kernel_batch(
    p_batch_number        varchar,
    p_received_date       date,
    p_wet_nis_received_kg numeric  DEFAULT NULL,
    p_supplier_id         uuid     DEFAULT NULL,
    p_grower_name         varchar  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id  uuid;
    v_kernel_id uuid;
BEGIN
    -- Validation
    IF p_batch_number IS NULL OR trim(p_batch_number) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    -- Insert parent batch
    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (p_batch_number, 'kernel', true)
    RETURNING id INTO v_batch_id;

    -- Insert kernel row
    INSERT INTO public.kernel (
        batch_id, supplier_id, grower_name, status,
        received_date, wet_nis_received_kg, is_active
    )
    VALUES (
        v_batch_id, p_supplier_id, p_grower_name, 'production',
        p_received_date, p_wet_nis_received_kg, true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object('success', true, 'id', v_kernel_id, 'batch_id', v_batch_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

### Update (with NOT FOUND check)

```sql
CREATE OR REPLACE FUNCTION public.complete_kernel_batch(
    p_kernel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel
    SET status     = 'complete',
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

### Upsert a JSONB column

```sql
CREATE OR REPLACE FUNCTION public.upsert_kernel_job_card(
    p_kernel_id     uuid,
    p_job_card_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel
    SET job_card_data = p_job_card_data,
        updated_at    = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

### Update a JSONB array (append or replace element at index)

```sql
DECLARE
    v_packing  jsonb;
    v_len      integer;
BEGIN
    SELECT packing_data INTO v_packing FROM public.kernel WHERE id = p_kernel_id;
    v_packing := COALESCE(NULLIF(v_packing, 'null'::jsonb), '[]'::jsonb);
    v_len     := jsonb_array_length(v_packing);

    IF p_day_index IS NOT NULL AND p_day_index < v_len THEN
        -- Replace existing element
        v_packing := jsonb_set(v_packing, ARRAY[p_day_index::text], p_packing_data);
    ELSE
        -- Append new element
        v_packing := v_packing || jsonb_build_array(p_packing_data);
    END IF;

    UPDATE public.kernel
    SET packing_data = v_packing,
        updated_at   = NOW()
    WHERE id = p_kernel_id AND is_active = true;
```

---

## JSONB Patterns — Kernel

### The kernel table JSONB columns

| Column | Shape | What it stores |
|---|---|---|
| `intake_data` | `{ ziplock_sample: {...}, five_kg_sample: {...}, receiving_checklist: {...} }` | Intake samples and checklist |
| `cracking_data` | `[{date, runs, ...}, ...]` | Array of cracking day entries |
| `washing_data` | `[{date, ...}, ...]` | Array of washing day entries |
| `sorting_data` | `[{date, ...}, ...]` | Array of sorting day entries |
| `packing_data` | `[{date, sk_sp_qty, sk_0_qty, ...}, ...]` | Array of packing day entries (flat fields) |
| `job_card_data` | `{summary, mass_balance, styles, ...}` | Full job card |
| `qa_data` | `{packing_sample, lab_pdf, ...}` | QA packing sample results |
| `dispatch_data` | legacy, no longer written | — |

### Packing data — flat field names

The `packing_data` array entries use **flat fields**, not nested objects:

```json
{
  "date": "2026-02-28",
  "sk_sp_qty": "0",
  "sk_0_qty": "1",
  "sk_1_qty": "0",
  "sk_1s_qty": "0",
  "sk_4l_qty": "0",
  "sk_5_qty": "1",
  "sk_6_qty": "1",
  "sk_0_cartons": "10",
  "bt_78_qty": "1",
  "bt_high_qty": "",
  "bt_low_qty": "1",
  "totals_qty": "1"
}
```

**Empty string = 0.** Always use `NULLIF(e ->> 'field', '')::numeric` when reading numeric values:

```sql
COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty',  '')::numeric), 0) AS sp,
COALESCE(SUM(NULLIF(e ->> 'sk_0_qty',   '')::numeric), 0) AS s0,
COALESCE(SUM(NULLIF(e ->> 'sk_1_qty',   '')::numeric), 0) AS s1,
COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty',  '')::numeric), 0) AS s1s,
COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty',  '')::numeric), 0) AS s4l,
COALESCE(SUM(NULLIF(e ->> 'sk_5_qty',   '')::numeric), 0) AS s5,
COALESCE(SUM(NULLIF(e ->> 'sk_6_qty',   '')::numeric), 0) AS s6,
COALESCE(SUM(NULLIF(e ->> 'bt_78_qty',  '')::numeric), 0) AS s78,
COALESCE(SUM(NULLIF(e ->> 'bt_high_qty','')::numeric), 0) AS bh,
COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0) AS bl
FROM jsonb_array_elements(
    COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
) e
```

Style key mapping (SQL field → frontend display label):
| SQL field | Label |
|---|---|
| `sk_sp_qty` | `SP` |
| `sk_0_qty` | `0` |
| `sk_1_qty` | `1` |
| `sk_1s_qty` | `1S` |
| `sk_4l_qty` | `4L` |
| `sk_5_qty` | `5` |
| `sk_6_qty` | `6` |
| `bt_78_qty` | `7/8` |
| `bt_high_qty` | `Butter High Oil` |
| `bt_low_qty` | `Butter Low Oil` |

### Reading nested intake_data paths

```sql
-- Get completed_at via path array
k.intake_data #>> '{ziplock_sample,completed_at}'      -- returns text

-- Check if nested object exists and is non-empty
(k.intake_data -> 'receiving_checklist' IS NOT NULL
 AND k.intake_data -> 'receiving_checklist' != '{}'::jsonb
 AND k.intake_data -> 'receiving_checklist' != 'null'::jsonb
)
```

### JSONB operator quick reference

| Operator | Returns | Usage |
|---|---|---|
| `->` | jsonb | `data -> 'key'` |
| `->>` | text | `data ->> 'key'` |
| `#>` | jsonb | `data #> '{a,b}'` |
| `#>>` | text | `data #>> '{a,b}'` |
| `\|\|` | jsonb | merge two objects |

### Safe null handling for JSONB columns

```sql
-- Column might be SQL NULL, JSON null string, or empty array
COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
COALESCE(NULLIF(k.job_card_data, 'null'::jsonb), '{}'::jsonb)
```

### Dispatch orders — reading dispatched quantities

Dispatch quantities now live in `kernel_dispatch_orders.lines` (JSONB array), not in `kernel.dispatch_data`. Each line element:
```json
{ "kernel_id": "uuid", "batch_number": "BATCH-2026-01-001", "style": "SP", "quantity_kg": 50 }
```

Read dispatched by style for a given kernel:
```sql
SELECT
    COALESCE(SUM(CASE WHEN le ->> 'style' = 'SP' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS sp,
    -- ... repeat for each style
FROM kernel_dispatch_orders o
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id
```

---

## RBAC — Critical, Read This Carefully

Every function must be granted to all roles via `role_permissions`. The Lambda proxy checks this table on every call. **If RBAC is missing the call silently returns an auth error.**

### The critical facts

1. `roles.id` is **UUID** — declare `v_role_id uuid` (NOT integer)
2. `operation` MUST be **uppercase `'EXECUTE'`** — lowercase `'execute'` fails silently
3. `object_type` is always `'function'`
4. `object_name` is the function name — lowercase, no parentheses, no argument types
5. There are **16 roles** total — after applying, count should be 16

### Single function RBAC

```sql
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'your_function_name', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
```

### Multiple functions RBAC (same migration)

```sql
DO $$
DECLARE
    v_role_id uuid;
    v_fn      varchar;
    v_fns     varchar[] := ARRAY[
        'create_kernel_batch',
        'complete_kernel_batch',
        'upsert_kernel_job_card'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
```

### Verify RBAC was applied (run via Supabase MCP after migration)

```sql
-- Should return 16 for each function
SELECT object_name, COUNT(*) AS role_count
FROM role_permissions
WHERE object_name IN ('your_function_name')
  AND operation = 'EXECUTE'
GROUP BY object_name;
```

### Diagnosing RBAC failures

If a call returns a permissions error:
```sql
-- Check if RBAC row exists at all
SELECT * FROM role_permissions
WHERE object_name = 'your_function_name'
ORDER BY role_id;

-- Check the operation case (must be EXECUTE not execute)
SELECT object_name, operation, COUNT(*)
FROM role_permissions
WHERE object_name = 'your_function_name'
GROUP BY object_name, operation;

-- If missing, re-run the DO block above
```

---

## Error Handling

### Standard EXCEPTION clause

Every write function should have this:

```sql
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Duplicate: ' || SQLERRM);
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
```

### Validation errors (before doing any DB work)

```sql
IF p_kernel_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'kernel_id is required');
END IF;
IF p_buyer_name IS NULL OR trim(p_buyer_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Buyer name is required');
END IF;
```

### NOT FOUND after UPDATE/DELETE

```sql
UPDATE public.kernel SET ... WHERE id = p_kernel_id AND is_active = true;

IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
END IF;
```

### Nested exception block (when you want to catch but continue)

```sql
BEGIN
    -- risky operation
    EXECUTE format('SELECT * FROM %I WHERE id = $1', v_table_name)
    USING v_id;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not read from %: %', v_table_name, SQLERRM;
    -- continue execution
END;
```

---

## Applying the Migration

### Apply via Supabase MCP tool

Read the file, then execute:
```sql
-- (paste full SQL from migration file)
```

The MCP tool runs against the live project (`sofanhfpxifgdtooefzq`).

### Apply via Management API (if no MCP)

Read the token from your environment — **never paste a `sbp_…` personal access token into a file in
this repo.** Export it in your shell (or keep it in a gitignored `.env` you source), so it never
reaches a commit:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...   # your own PAT; do not commit it

SQL=$(cat migrations/20260226000016_your_migration.sql)
curl -s -X POST "https://api.supabase.com/v1/projects/sofanhfpxifgdtooefzq/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
```

> A real PAT was committed here previously and has been revoked. A token in a repo is compromised the
> moment it lands, even if a later commit removes it — git keeps the old blob. Prefer
> `npm run db:apply -- migrations/<file>.sql`, which reads credentials from your environment.

A response of `[]` means success (DDL statements return empty result sets).

### Verify the function exists after applying

```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'your_function_name';
```

---

## Wiring to data-functions.js

File: `WebPortal/js/data-functions.js`

All functions are methods on the `_dataFunctions` object. Add new ones in the relevant section (Kernel section starts around line 1190).

### Read function wrapper (with cache)

```javascript
getKernelBatches: async function (token = null, forceRefresh = false, options = {}) {
    const params = {
        p_status:  options.status != null  ? options.status  : null,
        p_search:  options.search != null  ? options.search  : null,
        p_limit:   options.limit  != null  ? options.limit   : 100,
        p_offset:  options.offset != null  ? options.offset  : 0
    };
    const raw = await this.callFunction('get_kernel_batches', params, token, {
        cacheKey:     'kernel_batches_list',
        useCache:     true,
        cacheTtl:     this.cache.ttl.dynamic,
        forceRefresh: forceRefresh
    });
    // Handle multiple response shapes from Lambda
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.data)) return raw.data;
    if (raw && Array.isArray(raw.get_kernel_batches)) return raw.get_kernel_batches;
    return [];
},
```

### Single-row detail wrapper

```javascript
getKernelBatchDetail: async function (kernelId, token = null, forceRefresh = false) {
    const raw = await this.callFunction('get_kernel_batch_detail', { p_kernel_id: kernelId }, token, {
        cacheKey:     'kernel_batch_detail_' + kernelId,
        useCache:     !forceRefresh,
        cacheTtl:     this.cache.ttl.dynamic,
        forceRefresh: forceRefresh
    });
    if (raw && raw.id) return raw;
    if (raw && Array.isArray(raw.data) && raw.data[0]) return raw.data[0];
    if (Array.isArray(raw) && raw[0]) return raw[0];
    return null;
},
```

### Write function wrapper (no cache, invalidate on success)

```javascript
createKernelBatch: async function (batchData, token = null) {
    const params = {
        p_batch_number:        batchData.batch_number        || null,
        p_received_date:       batchData.received_date       || null,
        p_wet_nis_received_kg: batchData.wet_nis_received_kg != null ? batchData.wet_nis_received_kg : null,
        p_supplier_id:         batchData.supplier_id         || null,
        p_grower_name:         batchData.grower_name         || null
    };
    const result = await this.callFunction('create_kernel_batch', params, token, { useCache: false });
    // Invalidate related caches so the next read is fresh
    this.clearCachePattern('kernel_batches');
    return result;
},
```

### Calling from a module

```javascript
// Read — returns array
var batches = await dataFunctions.getKernelBatches(null, true, { status: 'complete' });

// Write — returns { success, id, ... } or { success: false, error: '...' }
var result = await dataFunctions.createKernelBatch({ batch_number: 'BATCH-2026-01-001', ... });
if (!result || result.success === false) {
    Swal.fire('Error', result ? result.error : 'Unknown error', 'error');
    return;
}
// on success: refresh grid, close modal, etc.
this.clearCachePattern('kernel_batches');
this.loadKernelBatches(true);
```

### Cache key conventions

| Data | Cache key pattern |
|---|---|
| Kernel batch list | `'kernel_batches_list'` |
| Kernel batch detail | `'kernel_batch_detail_' + kernelId` |
| Production history | `'kernel_production_history_' + kernelId` |

`clearCachePattern('kernel_batches')` clears any key containing that string.

---

## Complete Worked Examples

### Example 1: Simple write function + RBAC

**Scenario:** Set the `actual_wet_nis_kg` field on a kernel batch.

**Migration file:** `20260226000017_set_kernel_actual_weight.sql`

```sql
-- Set actual wet NIS weight on a kernel batch.

CREATE OR REPLACE FUNCTION public.set_kernel_actual_weight(
    p_kernel_id         uuid,
    p_actual_wet_nis_kg numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'kernel_id is required');
    END IF;

    UPDATE public.kernel
    SET actual_wet_nis_kg = p_actual_wet_nis_kg,
        updated_at        = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- RBAC
DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'set_kernel_actual_weight', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
```

**data-functions.js:**
```javascript
setKernelActualWeight: async function (kernelId, actualWeightKg, token = null) {
    const result = await this.callFunction('set_kernel_actual_weight', {
        p_kernel_id:         kernelId,
        p_actual_wet_nis_kg: actualWeightKg
    }, token, { useCache: false });
    this.clearCachePattern('kernel_batch_detail_' + kernelId);
    this.clearCachePattern('kernel_batches');
    return result;
},
```

---

### Example 2: List query with JSONB aggregation

**Scenario:** Get per-batch packing totals by style for the stock management grid.

```sql
-- Returns one row per kernel batch with yield summed from packing_data.

CREATE OR REPLACE FUNCTION public.get_kernel_stock_summary()
RETURNS TABLE (
    kernel_id        uuid,
    batch_number     varchar,
    grower_name      varchar,
    yield_by_style   jsonb,
    remaining_by_style jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id AS kernel_id,
        b.batch_id AS batch_number,
        k.grower_name,
        -- yield: sum flat packing_data fields
        (
            SELECT jsonb_build_object(
                'SP',              COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty',  '')::numeric), 0),
                '0',               COALESCE(SUM(NULLIF(e ->> 'sk_0_qty',   '')::numeric), 0),
                '1',               COALESCE(SUM(NULLIF(e ->> 'sk_1_qty',   '')::numeric), 0),
                '1S',              COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty',  '')::numeric), 0),
                '4L',              COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty',  '')::numeric), 0),
                '5',               COALESCE(SUM(NULLIF(e ->> 'sk_5_qty',   '')::numeric), 0),
                '6',               COALESCE(SUM(NULLIF(e ->> 'sk_6_qty',   '')::numeric), 0),
                '7/8',             COALESCE(SUM(NULLIF(e ->> 'bt_78_qty',  '')::numeric), 0),
                'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_qty','')::numeric), 0),
                'Butter Low Oil',  COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0)
            )
            FROM jsonb_array_elements(
                COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
            ) e
        ) AS yield_by_style,
        -- remaining: yield minus dispatched
        (
            SELECT jsonb_build_object(
                'SP',              GREATEST(0, COALESCE(y.sp,  0) - COALESCE(d.sp,  0)),
                '0',               GREATEST(0, COALESCE(y.s0,  0) - COALESCE(d.s0,  0)),
                '1',               GREATEST(0, COALESCE(y.s1,  0) - COALESCE(d.s1,  0)),
                '1S',              GREATEST(0, COALESCE(y.s1s, 0) - COALESCE(d.s1s, 0)),
                '4L',              GREATEST(0, COALESCE(y.s4l, 0) - COALESCE(d.s4l, 0)),
                '5',               GREATEST(0, COALESCE(y.s5,  0) - COALESCE(d.s5,  0)),
                '6',               GREATEST(0, COALESCE(y.s6,  0) - COALESCE(d.s6,  0)),
                '7/8',             GREATEST(0, COALESCE(y.s78, 0) - COALESCE(d.s78, 0)),
                'Butter High Oil', GREATEST(0, COALESCE(y.bh,  0) - COALESCE(d.bh,  0)),
                'Butter Low Oil',  GREATEST(0, COALESCE(y.bl,  0) - COALESCE(d.bl,  0))
            )
            FROM (
                SELECT
                    COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty',  '')::numeric), 0) AS sp,
                    COALESCE(SUM(NULLIF(e ->> 'sk_0_qty',   '')::numeric), 0) AS s0,
                    COALESCE(SUM(NULLIF(e ->> 'sk_1_qty',   '')::numeric), 0) AS s1,
                    COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty',  '')::numeric), 0) AS s1s,
                    COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty',  '')::numeric), 0) AS s4l,
                    COALESCE(SUM(NULLIF(e ->> 'sk_5_qty',   '')::numeric), 0) AS s5,
                    COALESCE(SUM(NULLIF(e ->> 'sk_6_qty',   '')::numeric), 0) AS s6,
                    COALESCE(SUM(NULLIF(e ->> 'bt_78_qty',  '')::numeric), 0) AS s78,
                    COALESCE(SUM(NULLIF(e ->> 'bt_high_qty','')::numeric), 0) AS bh,
                    COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0) AS bl
                FROM jsonb_array_elements(
                    COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
                ) e
            ) y
            CROSS JOIN LATERAL (
                SELECT
                    COALESCE(SUM(CASE WHEN le ->> 'style' = 'SP'              THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS sp,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '0'               THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s0,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '1'               THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s1,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '1S'              THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s1s,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '4L'              THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s4l,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '5'               THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s5,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '6'               THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s6,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '7/8'             THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s78,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter High Oil' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS bh,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter Low Oil'  THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS bl
                FROM kernel_dispatch_orders o
                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
                WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id
            ) d
        ) AS remaining_by_style
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.is_active = true AND k.status = 'complete'
    ORDER BY k.received_date DESC NULLS LAST;
END;
$$;
```

---

## Common Gotchas

### 1. Empty string numeric cast crashes

```sql
-- WRONG — crashes if field is ""
(e ->> 'sk_0_qty')::numeric

-- CORRECT
NULLIF(e ->> 'sk_0_qty', '')::numeric
```

### 2. RBAC operation case

```sql
-- WRONG — Lambda silently rejects
'execute'

-- CORRECT
'EXECUTE'
```

### 3. roles.id is UUID not integer

```sql
-- WRONG
DECLARE v_role_id integer;

-- CORRECT
DECLARE v_role_id uuid;
```

### 4. 'null' string vs SQL NULL in JSONB columns

When a JSONB column was set to the string `'null'` (not SQL NULL), `IS NULL` won't catch it:
```sql
-- WRONG — doesn't handle 'null'::jsonb string
COALESCE(k.packing_data, '[]'::jsonb)

-- CORRECT
COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
```

### 5. RETURNS TABLE column order must match SELECT order

If the function compiles but returns wrong data, check that every column in `RETURNS TABLE (...)` matches the corresponding `SELECT` expression by position — PostgreSQL matches by position, not name.

### 6. Dispatch quantities come from kernel_dispatch_orders.lines, not kernel.dispatch_data

`kernel.dispatch_data` is no longer written to (as of migration 20260226000015). Always read dispatched quantities from:
```sql
FROM kernel_dispatch_orders o
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id
```

### 7. Always filter is_active = true

```sql
WHERE k.is_active = true  -- soft-delete filter, never omit this
```

### 8. Migration not applied = function doesn't exist

If the frontend gets "function does not exist" errors, the migration wasn't applied. Apply it via the MCP tool. Verify with:
```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'your_function_name';
```

### 9. Cache not invalidated = stale data in UI

After any write function, the JS wrapper must call `this.clearCachePattern(...)` for the relevant cache keys. Otherwise the grid/modal will show old data until the TTL expires.

### 10. Lambda response shapes vary

The Lambda proxy sometimes wraps the result, sometimes doesn't. Always handle multiple shapes in the data-functions.js wrapper:
```javascript
if (Array.isArray(raw)) return raw;
if (raw && Array.isArray(raw.data)) return raw.data;
if (raw && Array.isArray(raw.your_function_name)) return raw.your_function_name;
return [];
```
