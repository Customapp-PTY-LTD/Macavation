---
retry_of: 90a21e3b-fb12-4f01-9845-68b51e654c60
---

# Refresh the Supabase Functions Guide — Macavation Project

## Deliverable

Update **exactly one existing file in place**:

```
docs/markdown-archive/supabase-functions-guide.md
```

That file already exists and already contains this guide (same title, same table of contents). This run rewrites its body so every factual claim in it matches the code in this checkout. Do **not** create a second copy of this guide anywhere (`BluePrint/`, `docs/guides/`, `docs/`), and do not delete or move the file — relocating it out of `docs/markdown-archive/` is a human decision outside this plan.

**This run is documentation-only.** Do not write or apply any migration, do not touch the database or any MCP/Supabase tool, do not edit `WebPortal/js/data-functions.js`, `scripts/`, `supabase/`, or anything under `migrations/`. The guide *describes* those things; this change does not perform them.

## Why the rewrite is needed (verified against this checkout)

Each item below was confirmed by reading the file named. Fold every one into the new text; do not soften or re-assert the old claim.

1. **The Lambda RPC proxy is retired.** `WebPortal/js/data-functions.js` line ~10 (`proxyUrl is retained for legacy callers but nothing fetches through it anymore`), `callFunction` (~line 742: *"Direct-only transport: every RPC goes straight to Supabase PostgREST with the anon key. The AWS Lambda proxy is retired."*) and `callSupabaseRpc` (~line 583, which `POST`s to `cfg.url + '/rest/v1/rpc/' + functionName` with `Authorization: Bearer <anonKey>` because `callFunction` passes `useAnonAuth: true`). The old chain diagram and the sentence *"The Lambda proxy checks this table on every call"* are wrong and must go.
2. **`role_permissions` is not what gates a call on that transport.** `callSupabaseRpc`'s own comment says it *"bypasses Lambda RBAC"*. What actually gates the call is the PostgreSQL `GRANT`. Current migrations do both: see `migrations/20260819090000_data_page_production_daily.sql` (`GRANT EXECUTE ON FUNCTION public.get_data_production_daily(date, date, integer, integer) TO anon, authenticated, service_role;`) and `migrations/20260918100000_daily_digest_nis_runway.sql` (a `role_permissions` `DO` block **and** `GRANT EXECUTE ... TO authenticated, service_role;` **and** `NOTIFY pgrst, 'reload schema';`).
3. **There is no fixed role count.** `migrations/20260709170000_cull_unused_roles_and_obsolete_users.sql` deletes 15 roles and names eight in-use ones. "There are **16 roles** total — after applying, count should be 16" is false and is a live-DB number this guide cannot verify. State no number anywhere; verification compares against `SELECT COUNT(*) FROM public.roles`.
4. **The filename convention is enforced by a test.** `scripts/verify-migration-prefixes.mjs` (run by `npm run migrations:verify`, which is inside `npm run test:fleet`, which gates fleet merges) requires: a 14-digit prefix followed by `_`; the prefix must parse as a real UTC `YYYYMMDDHHMMSS`; no two files may share a prefix; and the top level of `migrations/` may contain nothing but `.sql` files (no subdirectories, no other extensions). Existing violations are grandfathered in `scripts/migration-prefix-baseline.json`, which is read-only — a new file must never be added to it. `YYYYMMDD000NNN` is how some historical files were named, not a convention to teach.
5. **Migrations are applied with the repo's own script, against the linked project — not production by hand.** `package.json` defines `db:apply` → `scripts/apply-migration.mjs`, which calls `assertAllowedProjectRef`, reads the expected ref from `supabase/remote.toml`, and hard-fails unless the CLI is linked to it. `supabase/remote.toml` pins `nmdmddugxclpqrwylyfa` ("Macavation Dev"); `supabase/projects.json` sets `"developmentTarget": "dev"` and keeps production (`sofanhfpxifgdtooefzq`) separate; `package.json` has a distinct `db:apply-prod`. Remove the "MCP tool runs against the live project (`sofanhfpxifgdtooefzq`)" line and the whole `curl https://api.supabase.com/v1/projects/sofanhfpxifgdtooefzq/database/query` block.
6. **Drop the unverifiable secret-history claim.** The sentence asserting that a real PAT was committed here previously and has been revoked cannot be checked from this checkout. Delete it. Keep only the rule that is independently true and enforceable: no key, token or connection string is ever written as a literal into a committed file (`BluePrint/secrets-management-rules.md`); credentials come from the environment, which `npm run db:apply` already relies on.
7. **Reuse the style helpers the repo already has.** `migrations/20260707150000_fix_kernel_soh_remaining_by_style.sql` defines `public.kernel_packing_yield_by_style(p_packing_data jsonb)` and `migrations/20260518160100_fix_remaining_by_style_dispatch_lines.sql` defines `public.get_batch_remaining_by_style(p_batch_id uuid, p_yield_by_style jsonb)`. Worked Example 2's hand-rolled 10-style yield and remaining blocks must be replaced by calls to these two functions, with the note that `get_batch_remaining_by_style` matches dispatch lines on `le ->> 'kernel_id' = p_batch_id` only, while `get_kernel_production_history` (`migrations/20260525100000_...`) additionally tolerates lines that stored `batches.id` in `kernel_id` or carried only `batch_number` — so a new screen must call the helper rather than invent a second, divergent sum.
8. **The `create_kernel_batch` example no longer matches the live function.** The current definition is in `migrations/20260708150000_kernel_batch_archive_and_insert_guards.sql`: all six parameters default (`p_batch_number varchar DEFAULT NULL … p_initial_status varchar DEFAULT 'production'`), a NULL/blank batch number is auto-assigned via `public.get_next_batch_number(p_supplier_id, v_year)`, `public.kernel_batch_number_in_use_active()` rejects a number already used by an active batch, the status is whitelisted to `intake|receiving|production|qa|complete`, the success envelope includes `batch_number`, and the only handler is `WHEN unique_violation`. Either reproduce that faithfully or rename the teaching example to a placeholder name — do not show a different function under a real function's name.
9. **PostgREST strips null/empty params by default.** `buildPostgrestRpcBody` (`WebPortal/js/data-functions.js` ~line 502) drops `null`, `undefined` and `''` unless `preserveNullParams` / `preserveEmptyParams` are passed through `callFunction`. A SQL parameter with **no** `DEFAULT` that a wrapper may send as `null` therefore disappears from the request body and PostgREST answers `PGRST202`. This must be stated wherever the guide tells you to pass `null` for optional params.
10. **Changing a signature creates an overload, it does not replace the function.** `migrations/20260707170000_drop_resurrected_function_overloads.sql` exists solely because replayed old overloads made PostgREST fail with "Could not choose the best candidate function". The guide must tell you to `DROP FUNCTION IF EXISTS public.fn(<full old arg types>);` before `CREATE OR REPLACE` whenever the parameter list or return type changes, and to end such a migration with `NOTIFY pgrst, 'reload schema';`.
11. **Use the JS helpers that already exist, and know their edges.** `unwrapKernelRpcJson(raw, 'fn_name')` (~line 2572) and `extractKernelBatchesRowsFromRaw(raw, 0)` (~line 2662) already normalise response shapes; the ad-hoc three-line `if (Array.isArray(raw)) …` snippet duplicates them. Important edge case the guide must spell out: `unwrapKernelRpcJson` collapses a single-element array to its element, so it is for `RETURNS jsonb` results **only** — using it on a `RETURNS TABLE` read silently turns a one-row list into an object. List reads use the array-returning helper.
12. **Stock-mutating writes go through `_callWithActor`, and its retry must not be generalised.** `_callWithActor` (~line 281) stamps `p_actor_user_id` so `stock_soh_history` records who changed stock, and retries **once without the actor** only on `PGRST202`, because that error is raised during function resolution, before anything executes — so no partial write can be duplicated. The guide must present that retry as specific to `PGRST202` and explicitly warn against copying it to timeouts, 5xx, or any other error, and against reusing it for non-stock writes that have no actor overload.

## Out of scope (do not do these in this run)

- Creating, editing or applying any SQL migration; any database, MCP or Supabase CLI call.
- Editing `WebPortal/js/data-functions.js` or any other application code.
- Correcting `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` (its two-project / `roles.id integer` / 14-vs-16-role claims contradict this checkout), the stale `supabase link --project-ref sofanhfpxifgdtooefzq` comment at the top of `supabase/config.toml`, or the tension between `BluePrint/secrets-management-rules.md` and the literal anon keys committed in `supabase/projects.json`. These are flagged for a human; this plan neither edits them nor cites them as authority.
- Moving the guide out of `docs/markdown-archive/`, adding it to any index, or creating a new guide file.
- Changing `scripts/migration-prefix-baseline.json`, `package.json`, or any test script.

## Acceptance criteria

1. `git status` shows exactly one modified file: `docs/markdown-archive/supabase-functions-guide.md`. No new files, no deletions, nothing under `migrations/`, `WebPortal/`, `scripts/`, `supabase/`.
2. The file contains **none** of: `sbp_`, `api.supabase.com`, `SUPABASE_ACCESS_TOKEN`, `16 roles`, `Lambda proxy`, `YYYYMMDD000NNN` presented as the naming rule.
3. The file **does** contain: `npm run db:apply -- migrations/<file>.sql`; `YYYYMMDDHHMMSS`; `npm run migrations:verify`; `GRANT EXECUTE ON FUNCTION`; `NOTIFY pgrst, 'reload schema'`; `kernel_packing_yield_by_style`; `get_batch_remaining_by_style`; `preserveNullParams`; `_callWithActor`; `unwrapKernelRpcJson`.
4. Every file path, script name, SQL function name and JS identifier the file names exists in this checkout.
5. `npm run test:fleet` passes (it is pure-Node, no network, no browser — safe to run headless; it does not read this doc, so a pass confirms nothing else was disturbed).

---

## File content to write

Write the body below into `docs/markdown-archive/supabase-functions-guide.md`, replacing its current contents.

---

# Supabase Functions Guide — Macavation Project

> Archived guide, re-verified against the repository. Every claim below was checked against code in
> this repo (`migrations/`, `WebPortal/js/data-functions.js`, `package.json`, `supabase/`). Where a
> live database value would be needed to confirm something, this guide tells you the query to run
> instead of asserting a number. Current sources of truth: `supabase/remote.toml` (which project you
> are linked to), `migrations/` (what the functions actually do), `.cursor/rules/supabase-dev-uat.mdc`
> (dev vs production targeting).

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
10. [Permissions — Critical, Read This Carefully](#permissions--critical-read-this-carefully)
11. [Error Handling](#error-handling)
12. [Applying the Migration](#applying-the-migration)
13. [Wiring to data-functions.js](#wiring-to-data-functionsjs)
14. [Complete Worked Examples](#complete-worked-examples)
15. [Common Gotchas](#common-gotchas)

---

## Overview

All DB access goes through `SECURITY DEFINER` RPC functions. The frontend never touches tables directly.

The transport is **direct PostgREST**:

```
Frontend JS
  → dataFunctions.callFunction('fn_name', params)
  → dataFunctions.callSupabaseRpc  →  POST <supabaseUrl>/rest/v1/rpc/fn_name   (anon key)
  → plpgsql function → tables
```

`callFunction` passes `useAnonAuth: true`, so the request is authorised with the project **anon key**
(`WebPortal/js/data-functions.js`, `callSupabaseRpc`). The AWS Lambda RPC proxy is retired —
`proxyUrl` is retained for legacy callers but nothing fetches through it any more. `X-User-Id` is
added to the request when a user id is known; DB triggers use it for `created_by` / `updated_by` and
`audit.audit_log` (`audit.current_actor`).

Every new function requires **four** things:

1. The SQL function in a migration file.
2. A PostgreSQL `GRANT EXECUTE` to the PostgREST roles that must call it — **this is what actually
   lets the call through**.
3. `role_permissions` rows, for consistency with the rest of the schema (see
   [Permissions](#permissions--critical-read-this-carefully) for exactly what that table does and does
   not do today).
4. A wrapper in `WebPortal/js/data-functions.js`.

---

## Migration File Conventions

**Naming — enforced by a test that gates merges.**

```
YYYYMMDDHHMMSS_snake_case_description.sql
```

`scripts/verify-migration-prefixes.mjs` (`npm run migrations:verify`, part of `npm run test:fleet`)
fails the build unless:

1. the filename starts with a **14-digit** prefix followed by `_`;
2. that prefix parses as a **real UTC timestamp** — `20260226000060` is rejected because there is no
   second 60;
3. **no two files share a prefix**;
4. the top level of `migrations/` contains **nothing but `.sql` files** — no subdirectories, no
   `.md`, no `.json`.

A batch of older files use the prefix as an ad-hoc counter (`YYYYMMDD000NNN`) and a few share a
prefix or encode an impossible date. Those are grandfathered in
`scripts/migration-prefix-baseline.json`, which is **read-only**: when the check fails, fix the new
filename — never add a baseline entry.

Use the current UTC timestamp. Example: `20260921143000_add_kernel_packing_note.sql`.

**File structure:**

```sql
-- One-line summary of what this migration does and why.

-- ============================================================
-- 1. Function name / purpose
-- ============================================================
CREATE OR REPLACE FUNCTION public.your_function_name(...)
...

-- ============================================================
-- 2. Permissions
-- ============================================================
GRANT EXECUTE ON FUNCTION public.your_function_name(<arg types>) TO anon, authenticated, service_role;

DO $$ ... $$;   -- role_permissions rows

NOTIFY pgrst, 'reload schema';
```

`CREATE OR REPLACE` keeps the migration re-runnable — but see
[Gotcha 6](#6-changing-a-signature-creates-an-overload-it-does-not-replace-the-function): it only
replaces a function with the **same** argument list and return type.

End any migration that creates, replaces or drops a function with `NOTIFY pgrst, 'reload schema';`
(pattern used by `20260918100000_daily_digest_nis_runway.sql`,
`20260707170000_drop_resurrected_function_overloads.sql` and others).

---

## Function Boilerplate

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

- `public.` schema prefix on the function name.
- `LANGUAGE plpgsql` (small pure helpers may be `LANGUAGE sql STABLE` — see
  `kernel_packing_yield_by_style`).
- `SECURITY DEFINER` — executes as the function owner. **Read this consequence:** a `SECURITY
  DEFINER` function granted to `anon` is callable by anyone who has the project's anon key, which the
  portal ships in the browser. The function body is therefore the only access control there is —
  validate inside it, and grant `anon` only to functions the portal genuinely calls on that path.
- `SET search_path = public` — prevents schema-injection and fixes table resolution.
- Dollar-quote the body with `$$`.

---

## RETURNS Types

### `RETURNS TABLE (...)` — for list/grid queries

PostgREST returns these as a **JSON array of row objects**.

```sql
RETURNS TABLE (
    id                  uuid,
    batch_number        varchar,
    status              varchar,
    yield_by_style      jsonb,
    created_at          timestamptz
)
```

Body uses `RETURN QUERY SELECT ...`; columns match by **position**, not by name.

### `RETURNS jsonb` — for write operations and single-row reads

Always return an envelope:

```sql
RETURN jsonb_build_object('success', true, 'id', v_id);
RETURN jsonb_build_object('success', false, 'error', 'Batch not found');
```

### `RETURNS json` — legacy only

Some older functions use `json`. Use `jsonb` for anything new.

---

## Parameters

**Naming:** always prefix with `p_`.

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

**Defaults — and why they are not optional in practice.**

`WebPortal/js/data-functions.js` builds the request body with `buildPostgrestRpcBody`, which **drops
any param whose value is `null`, `undefined` or `''`** unless the caller passes
`preserveNullParams` / `preserveEmptyParams` through `callFunction`. PostgREST then resolves the
function from the *names actually present in the body*. So:

- **Give every optional parameter a SQL `DEFAULT`.** A no-default parameter that the JS wrapper may
  send as `null` vanishes from the body and you get `PGRST202 Could not find the function … in the
  schema cache` — not a NULL.
- If a parameter genuinely has no default and must be passed as `null` (or must be clearable to
  `''`), the wrapper must opt in: `callFunction(fn, params, token, { preserveNullParams: true })`.
  `upsertDashboardTarget` in `data-functions.js` does exactly this and says why.

Conventions: required params get no default; optional params get `DEFAULT NULL`; pagination is
`p_limit integer DEFAULT 100, p_offset integer DEFAULT 0`; flags are `p_flag boolean DEFAULT false`.

```sql
CREATE OR REPLACE FUNCTION public.get_kernel_batches(
    p_status  varchar  DEFAULT NULL,
    p_search  varchar  DEFAULT NULL,
    p_limit   integer  DEFAULT 100,
    p_offset  integer  DEFAULT 0
)
```

---

## DECLARE Block

Declare everything before `BEGIN`; variable names use `v_`.

```sql
DECLARE
    v_kernel_id    uuid;
    v_batch_uuid   uuid;
    v_count        integer;
    v_result       jsonb;
    v_fn           varchar;
    v_fns          varchar[] := ARRAY['fn_one', 'fn_two'];
BEGIN
```

Common patterns:

```sql
SELECT id INTO v_kernel_id FROM public.kernel WHERE batch_id = v_batch_uuid;

IF v_kernel_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kernel not found');
END IF;

UPDATE public.kernel SET status = 'complete' WHERE id = p_kernel_id;
IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
END IF;
```

---

## Read Functions (RETURNS TABLE)

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
        public.kernel_packing_yield_by_style(k.packing_data) AS yield_by_style,
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

**Key rules:**

- `RETURNS TABLE (...)` order must match the `SELECT` order exactly — PostgreSQL matches by position.
- Cast explicitly where needed: `k.status::varchar`.
- Always filter `k.is_active = true` (soft delete).
- Always join `batches` via `b.id = k.batch_id` for the human-readable batch number.
- Always bound list queries with `LIMIT` (`BluePrint/supabase-database-rules.md`).
- Use `public.kernel_packing_yield_by_style(k.packing_data)` rather than re-typing the ten style
  sums — see [JSONB Patterns](#jsonb-patterns--kernel).

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

    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

---

## Write Functions (RETURNS jsonb)

### Create (insert into multiple tables)

Template — note the name is a **placeholder**; the real `create_kernel_batch` is described below it.

```sql
CREATE OR REPLACE FUNCTION public.create_example_batch(
    p_batch_number        varchar  DEFAULT NULL,
    p_received_date       date     DEFAULT NULL,
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
    IF p_batch_number IS NULL OR trim(p_batch_number) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (p_batch_number, 'kernel', true)
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

    RETURN jsonb_build_object('success', true, 'id', v_kernel_id, 'batch_id', v_batch_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

> **The real `create_kernel_batch` differs** — read
> `migrations/20260708150000_kernel_batch_archive_and_insert_guards.sql` before touching it. There,
> *every* parameter has a default (including `p_initial_status varchar DEFAULT 'production'`), a
> NULL/blank `p_batch_number` is auto-assigned via `public.get_next_batch_number(p_supplier_id,
> v_year)`, `public.kernel_batch_number_in_use_active(v_batch_number)` rejects a number already held
> by an active batch, `p_initial_status` is whitelisted to
> `intake | receiving | production | qa | complete`, the success envelope also carries
> `batch_number`, and the only handler is `WHEN unique_violation`.

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
        v_packing := jsonb_set(v_packing, ARRAY[p_day_index::text], p_packing_data);
    ELSE
        v_packing := v_packing || jsonb_build_array(p_packing_data);
    END IF;

    UPDATE public.kernel
    SET packing_data = v_packing,
        updated_at   = NOW()
    WHERE id = p_kernel_id AND is_active = true;
```

### Writes that move stock

If the write changes stock on hand, it needs an actor-carrying overload so `stock_soh_history`
records who did it (`migrations/20260816090000_stock_soh_history.sql`,
`20260816090100_stock_soh_history_actor_wrappers.sql`). The JS side calls it through
`_callWithActor` — see [Wiring](#wiring-to-data-functionsjs).

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

**Empty string = 0.** Always `NULLIF(e ->> 'field', '')::numeric`.

Style key mapping (SQL field → display label):

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

### Do not re-type the style maths — two helpers already exist

```sql
-- migrations/20260707150000_fix_kernel_soh_remaining_by_style.sql
public.kernel_packing_yield_by_style(p_packing_data jsonb) RETURNS jsonb
-- style label -> packed kg, summed over packing_data, with the NULLIF/'null'::jsonb handling built in

-- migrations/20260518160100_fix_remaining_by_style_dispatch_lines.sql
public.get_batch_remaining_by_style(p_batch_id uuid, p_yield_by_style jsonb) RETURNS jsonb
-- yield minus dispatched kg per style, floored at 0
```

Use them. Every screen that shows yield or remaining stock goes through them
(`get_kernel_runway_summary`, `get_phase2_extended_kpis`, the stock-alert cron); a hand-rolled copy
is how two screens start disagreeing.

**Known matching caveat:** `get_batch_remaining_by_style` counts dispatch lines where
`NULLIF(le ->> 'kernel_id','')::uuid = p_batch_id`. Some historical lines stored `batches.id` in
`kernel_id`, or carried only `batch_number`; `get_kernel_production_history`
(`migrations/20260525100000_...`) tolerates those extra shapes for its history view. Do not fork a
second remaining-stock calculation to "fix" this — reuse the helper so every screen agrees, and treat
broadening the match as its own migration with its own review.

### Reading nested intake_data paths

```sql
k.intake_data #>> '{ziplock_sample,completed_at}'      -- returns text

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
COALESCE(NULLIF(k.packing_data,  'null'::jsonb), '[]'::jsonb)
COALESCE(NULLIF(k.job_card_data, 'null'::jsonb), '{}'::jsonb)
```

### Dispatch orders — reading dispatched quantities

Dispatch quantities live in `kernel_dispatch_orders.lines` (JSONB array), not in
`kernel.dispatch_data`. Each line element:

```json
{ "kernel_id": "uuid", "batch_number": "BATCH-2026-01-001", "style": "SP", "quantity_kg": 50 }
```

Prefer `get_batch_remaining_by_style`. If you must read the raw lines:

```sql
FROM kernel_dispatch_orders o
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id
```

---

## Permissions — Critical, Read This Carefully

There are two layers, and only one of them is enforced on the transport the portal actually uses.

### Layer 1 — the PostgreSQL grant (this is the one that gates the call)

The portal calls PostgREST directly with the anon key, so PostgreSQL's own `EXECUTE` privilege is
what decides whether the call runs:

```sql
GRANT EXECUTE ON FUNCTION public.your_function_name(uuid, varchar, integer)
    TO anon, authenticated, service_role;
```

- The argument-type list is **part of the identity** of the function — write it out in full.
- Grant `anon` when the function is called from the portal UI (that is the key the browser carries).
  Grant only `authenticated, service_role` for things that are not browser-initiated — that is what
  `get_daily_digest` does (`migrations/20260918100000_daily_digest_nis_runway.sql`).
- Because the functions are `SECURITY DEFINER` and the anon key is public, granting `anon` makes a
  function reachable by anyone who can open the site. The function body is the access control.
  Validate inputs and scope inside the function; never rely on the UI hiding a button.
- Pattern to copy: `migrations/20260819090000_data_page_production_daily.sql`.

### Layer 2 — `role_permissions` rows

`role_permissions` is an application-level table (`role_id`, `object_type`, `object_name`,
`operation`, `allowed`) that was enforced by the retired Lambda proxy. It is **not** consulted on the
direct PostgREST path — `callSupabaseRpc` is documented in `data-functions.js` as bypassing Lambda
RBAC. Keep writing the rows, because the admin screens and the rest of the schema still read that
table and every recent migration adds them, but **do not describe them as the thing protecting the
function**.

Facts that still hold for the rows themselves:

1. `roles.id` is **uuid** — declare `v_role_id uuid` (or a `record`, as
   `20260918100000_daily_digest_nis_runway.sql` does).
2. `operation` must be uppercase `'EXECUTE'`.
3. `object_type` is always `'function'`.
4. `object_name` is the bare function name — lowercase, no parentheses, no argument types.
5. **No role count is asserted here.** Roles are added and removed by migration (see
   `20260709170000_cull_unused_roles_and_obsolete_users.sql`, which deleted 15 and left the in-use
   set). Verify against `SELECT COUNT(*) FROM public.roles`, never against a number in a document.

### Single function

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

### Multiple functions

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

Some migrations (e.g. `20260331000004_grant_kernel_dispatch_functions_to_sales_exec_and_other_roles.sql`)
instead insert only for `roles WHERE is_active = true` that are missing the row, supplying
`gen_random_uuid()` for `id` and guarding with `WHERE NOT EXISTS`. Either form is fine; both are
re-runnable.

### Verify after applying (read-only, run against the linked project)

```sql
-- Does the function exist?
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'your_function_name';

-- Does PostgreSQL let the PostgREST roles execute it?
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public' AND routine_name = 'your_function_name';

-- Do the app-layer rows cover every role? (compare the two numbers; do not compare to a literal)
SELECT
    (SELECT COUNT(*) FROM public.roles) AS roles_total,
    COUNT(*) AS permission_rows
FROM public.role_permissions
WHERE object_name = 'your_function_name' AND operation = 'EXECUTE';
```

### Diagnosing a denied or missing call

- `PGRST202 / "Could not find the function … in the schema cache"` → the function does not exist on
  the linked project, **or** the parameter names in the body do not match any overload (a stripped
  null — see [Parameters](#parameters)), **or** PostgREST has not reloaded. Run
  `NOTIFY pgrst, 'reload schema';`.
- `"Could not choose the best candidate function"` → two overloads match; see
  [Gotcha 6](#6-changing-a-signature-creates-an-overload-it-does-not-replace-the-function).
- `permission denied for function …` → the `GRANT EXECUTE` is missing for the role the request
  authenticated as.

---

## Error Handling

### Standard EXCEPTION clause

```sql
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Duplicate: ' || SQLERRM);
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
```

`WHEN OTHERS` turns every failure into `{ success: false }` with HTTP 200 — convenient for the UI,
but it also swallows programming errors. Use it on writes whose callers check `result.success`; leave
it off when you would rather see the real SQL error surface (the live `create_kernel_batch` catches
only `unique_violation`).

### Validation errors (before any DB work)

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

### Nested exception block (catch but continue)

```sql
BEGIN
    EXECUTE format('SELECT * FROM %I WHERE id = $1', v_table_name)
    USING v_id;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not read from %: %', v_table_name, SQLERRM;
END;
```

---

## Applying the Migration

### Use the repo's script

```bash
npm run db:apply -- migrations/20260921143000_your_migration.sql
```

`scripts/apply-migration.mjs` refuses to guess: it asserts the project ref is an allowed one, reads
the expected ref from `supabase/remote.toml`, hard-fails unless the Supabase CLI is linked to exactly
that project, runs the file through `supabase db query --linked --file`, records it in
`supabase_migrations.schema_migrations`, and then runs `audit.attach_all()` so any new table gets its
owner columns and audit triggers.

First time on a machine:

```bash
supabase login
supabase link --project-ref "$(grep -o 'project_ref *= *"[^"]*"' supabase/remote.toml | cut -d'"' -f2)"
```

### Which database you are talking to

- `supabase/remote.toml` is the committed pin for local work and the dev site. It currently names the
  **dev** project, and the file says production is *"only ever targeted deliberately — never as a
  default or fallback."*
- `supabase/projects.json` carries both entries and sets `"developmentTarget": "dev"`.
- Production has its own script: `npm run db:apply-prod`. Do not reach for it casually, and never
  point a dev-branch CLI link at it.
- `npm run db:check-project` is the guardrail to run before committing.
- Note that the comment block at the top of `supabase/config.toml` still names the production ref;
  `supabase/remote.toml` is the file the tooling actually reads.

### Credentials

Never write a personal access token, service-role key, database password or connection string as a
literal into any file in this repo — not in SQL, not in a script, not in a comment "as an example"
(`BluePrint/secrets-management-rules.md`). `npm run db:apply` uses your logged-in CLI session, so
there is no token to paste anywhere. If you ever need a one-off Management API call, export the token
in your shell only, and keep the project ref out of committed scripts by reading it from
`supabase/remote.toml`.

### Verify the function exists after applying

```sql
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'your_function_name';
```

---

## Wiring to data-functions.js

File: `WebPortal/js/data-functions.js`. All functions are methods on the `_dataFunctions` object; add
new ones in the relevant section.

### Read function wrapper (with cache)

```javascript
getKernelBatches: async function (token = null, forceRefresh = false, options = {}) {
    if (forceRefresh) {
        this.clearCachePattern('kernel_batches');
    }
    const params = {
        p_status:  options.status != null  ? options.status  : null,
        p_search:  options.search != null  ? options.search  : null,
        p_limit:   options.limit  != null  ? options.limit   : 100,
        p_offset:  options.offset != null  ? options.offset  : 0
    };
    const cacheKey = 'kernel_batches_list' + (params.p_status ? '_' + params.p_status : '');
    const raw = await this.callFunction('get_kernel_batches', params, token, {
        cacheKey:     cacheKey,
        useCache:     true,
        cacheTtl:     this.cache.ttl.dynamic,
        forceRefresh: forceRefresh
    });
    return this.extractKernelBatchesRowsFromRaw(raw, 0);
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
    return this.unwrapKernelRpcJson(raw, 'get_kernel_batch_detail');
},
```

### Write function wrapper (no cache, invalidate on success)

```javascript
createKernelBatch: async function (batchData, token = null) {
    const params = {
        p_batch_number:        (batchData.batch_number && String(batchData.batch_number).trim()) || null,
        p_received_date:       batchData.received_date       || null,
        p_wet_nis_received_kg: batchData.wet_nis_received_kg != null ? batchData.wet_nis_received_kg : null,
        p_supplier_id:         batchData.supplier_id         || null,
        p_grower_name:         batchData.grower_name         || null
    };
    const result = await this.callFunction('create_kernel_batch', params, token, { useCache: false });
    this.clearCachePattern('kernel_batches');
    return result;
},
```

Remember the null-stripping rule: any of those `null`s simply will not be sent. That is fine here
because every `create_kernel_batch` parameter has a SQL `DEFAULT`. If yours does not, either add the
default in SQL or pass `{ useCache: false, preserveNullParams: true }`.

### Writes that move stock — use `_callWithActor`

```javascript
completeKernelBatch: async function (kernelId, token = null) {
    const raw = await this._callWithActor('complete_kernel_batch', { p_kernel_id: kernelId }, token, { useCache: false });
    this.clearCachePattern('kernel_batch_detail_' + kernelId);
    this.clearCachePattern('kernel_batches');
    return this.unwrapKernelRpcJson(raw, 'complete_kernel_batch') || raw;
},
```

`_callWithActor` adds `p_actor_user_id` so `stock_soh_history` records who made the change, and
selects the actor-carrying overload by parameter name. It retries once **without** the actor on
`PGRST202` and remembers that per function in `_actorOverloadMissing`, because the portal
auto-deploys while migrations are applied by hand — so the stock operation still succeeds on a
database that has not got the overload yet, losing only the attribution.

That retry is safe **only** for `PGRST202`, which PostgREST raises while resolving the function,
before executing anything, so no partial write can be duplicated. Do not widen the match, do not
reuse this retry for timeouts or 5xx (either of which may mean the write landed), and do not copy it
into a wrapper for a function that has no actor overload — call `callFunction` directly there.

### Normalising the response — use the existing helpers

| Result type | Helper | Why |
|---|---|---|
| `RETURNS jsonb` (single object) | `this.unwrapKernelRpcJson(raw, 'fn_name')` | unwraps `{data:…}`, `{fn_name:…}`, and JSON-stringified bodies |
| `RETURNS TABLE` (array of rows) | `this.extractKernelBatchesRowsFromRaw(raw, 0)` or an explicit `Array.isArray` check | always yields an array |

**Do not use `unwrapKernelRpcJson` on a list read.** It collapses a one-element array to its element,
so a `RETURNS TABLE` query that happens to match exactly one row would silently arrive as an object
instead of a one-row array.

The direct PostgREST transport returns the function's value as-is — an array of row objects for
`RETURNS TABLE`, the jsonb value for `RETURNS jsonb`. The helpers are more defensive than that
because older wrapped and PascalCase shapes still turn up in cached and legacy paths; keep using
them rather than assuming the clean shape.

### Calling from a module

```javascript
var batches = await dataFunctions.getKernelBatches(null, true, { status: 'complete' });

var result = await dataFunctions.createKernelBatch({ batch_number: 'BATCH-2026-01-001' });
if (!result || result.success === false) {
    Swal.fire('Error', result ? result.error : 'Unknown error', 'error');
    return;
}
this.loadKernelBatches(true);
```

### Cache key conventions

| Data | Cache key pattern |
|---|---|
| Kernel batch list | `'kernel_batches_list'`, plus `'_' + p_status` when a status filter is set |
| Kernel batch detail | `'kernel_batch_detail_' + kernelId` |
| Production history | `'kernel_production_history_' + kernelId` |

`clearCachePattern('kernel_batches')` clears any key *containing* that string, so it covers the
status-suffixed list keys too. TTLs come from `this.cache.ttl` (`static` 5 min, `dynamic` 1 min,
`dashboard` 30 s).

---

## Complete Worked Examples

### Example 1: Simple write function + permissions

**Scenario:** set `actual_wet_nis_kg` on a kernel batch.

**Migration:** `20260921150000_set_kernel_actual_weight.sql`

```sql
-- Set actual wet NIS weight on a kernel batch.

CREATE OR REPLACE FUNCTION public.set_kernel_actual_weight(
    p_kernel_id         uuid,
    p_actual_wet_nis_kg numeric DEFAULT NULL
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

-- Layer 1: the grant that actually lets the portal call it.
GRANT EXECUTE ON FUNCTION public.set_kernel_actual_weight(uuid, numeric)
    TO anon, authenticated, service_role;

-- Layer 2: app-level rows.
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

NOTIFY pgrst, 'reload schema';
```

**data-functions.js:**

```javascript
setKernelActualWeight: async function (kernelId, actualWeightKg, token = null) {
    const raw = await this.callFunction('set_kernel_actual_weight', {
        p_kernel_id:         kernelId,
        p_actual_wet_nis_kg: actualWeightKg
    }, token, { useCache: false });
    this.clearCachePattern('kernel_batch_detail_' + kernelId);
    this.clearCachePattern('kernel_batches');
    return this.unwrapKernelRpcJson(raw, 'set_kernel_actual_weight') || raw;
},
```

### Example 2: List query with JSONB aggregation

**Scenario:** per-batch packing totals by style, plus remaining after dispatch, for the stock grid.

Both numbers come from the existing helpers — this function only joins and filters.

```sql
-- One row per completed kernel batch: yield from packing_data, remaining after dispatch.

CREATE OR REPLACE FUNCTION public.get_kernel_stock_summary(
    p_limit  integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    kernel_id          uuid,
    batch_number       varchar,
    grower_name        varchar,
    yield_by_style     jsonb,
    remaining_by_style jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id            AS kernel_id,
        b.batch_id      AS batch_number,
        k.grower_name,
        y.yield_by_style,
        public.get_batch_remaining_by_style(k.id, y.yield_by_style) AS remaining_by_style
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    CROSS JOIN LATERAL (
        SELECT public.kernel_packing_yield_by_style(k.packing_data) AS yield_by_style
    ) y
    WHERE k.is_active = true
      AND k.status = 'complete'
    ORDER BY k.received_date DESC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_stock_summary(integer, integer)
    TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
```

`kernel_packing_yield_by_style` already handles the `'null'::jsonb` / empty-string cases, and
`get_batch_remaining_by_style` already floors each style at zero — do not re-implement either.

---

## Common Gotchas

### 1. Empty string numeric cast crashes

```sql
-- WRONG — crashes when the field is ""
(e ->> 'sk_0_qty')::numeric

-- CORRECT
NULLIF(e ->> 'sk_0_qty', '')::numeric
```

### 2. The grant is what gates the call, not `role_permissions`

The portal calls PostgREST directly with the anon key. Forget `GRANT EXECUTE` and you get
`permission denied for function …` no matter how many `role_permissions` rows exist. Write both.

### 3. `roles.id` is uuid, and there is no magic role count

Declare `v_role_id uuid` (or a `record`). Never verify against a number written in a document —
compare against `SELECT COUNT(*) FROM public.roles`.

### 4. `'null'` string vs SQL NULL in JSONB columns

```sql
-- WRONG — does not handle the 'null'::jsonb value
COALESCE(k.packing_data, '[]'::jsonb)

-- CORRECT
COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
```

### 5. `RETURNS TABLE` column order must match the `SELECT` order

PostgreSQL matches by position, not by name. If the function compiles but returns nonsense, check the
ordering first.

### 6. Changing a signature creates an OVERLOAD, it does not replace the function

`CREATE OR REPLACE` only replaces a function with the identical argument list and return type. Add,
remove or retype a parameter and you now have **two** functions — and because the JS layer strips
null params, a subset-shaped call can match both, giving
`"Could not choose the best candidate function"`. Changing the return type fails outright with
`cannot change return type of existing function`.

```sql
DROP FUNCTION IF EXISTS public.your_function_name(uuid, character varying, numeric);  -- full OLD signature
CREATE OR REPLACE FUNCTION public.your_function_name(...) ...;
NOTIFY pgrst, 'reload schema';
```

`migrations/20260707170000_drop_resurrected_function_overloads.sql` exists purely to clean up
overloads that came back from replayed migrations — read it before you leave one behind.

### 7. Always filter `is_active = true`

```sql
WHERE k.is_active = true  -- soft-delete filter, never omit this
```

### 8. Migration not applied = function does not exist

`PGRST202` in the browser usually means the migration was never applied to the project you are
pointed at. Check with `npm run db:check-project`, apply with
`npm run db:apply -- migrations/<file>.sql`, then confirm:

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'your_function_name';
```

### 9. Cache not invalidated = stale data in the UI

After any write, the wrapper must `this.clearCachePattern(...)` the affected keys, or the grid and
modal keep showing the old values until the TTL expires.

### 10. A stripped null looks exactly like a missing function

`buildPostgrestRpcBody` removes `null`, `undefined` and `''` from the request body. A parameter with
no SQL `DEFAULT` then disappears, PostgREST cannot resolve the call, and you get `PGRST202`. Give
optional parameters defaults, or pass `preserveNullParams` / `preserveEmptyParams`.

### 11. Filename rules are a merge gate

A migration whose prefix is not a unique, real 14-digit UTC timestamp — or any non-`.sql` file left
in `migrations/` — fails `npm run migrations:verify` inside `npm run test:fleet` and blocks the
merge. Fix the filename; never extend `scripts/migration-prefix-baseline.json`.
