# Fix the 42% under-count in every "kg cracked" figure

## Context

Every "kg cracked" number in this application sums `kernel.cracking_data[].totalqty`. That is
wrong. `totalqty` is left **blank by the data-capture form whenever there is silo carry-over**, so
those days contribute zero.

The reliable field is `endqty1`, which the production form fills as `startqty1 - silo1` — the kg of
nut-in-shell actually put through the cracker that day. Verified against the production database:

- The identity `startqty1 - silo1 = endqty1` holds on **41 of 44** testable day-rows.
- Where both `endqty1` and `totalqty` are present they agree on **30 of 31** rows.
- `totalqty` is blank precisely on the days that had silo carry-over.
- Across all history: `coalesce(endqty1, totalqty)` = **194,590.1 kg** vs `totalqty` alone =
  **113,634.8 kg**. **The app under-reports NIS cracked by 41.6%.**
- The `total_qty` (underscore) fallback present in all these functions is **dead code** — the key
  is present on **0 of 120** cracking rows. Remove it.
- `totalqty`-only rows (where `endqty1` is blank) number exactly **1**, so the `totalqty` fallback
  does still earn its place. Keep it, second in the coalesce.

This lands ahead of a new raw-material runway forecast chart that depends on the corrected figure.
It is worth doing on its own: the "Kg cracked today / this week" tiles, Production Trends and the
mass balance are all understating output today.

A second, unrelated live bug is fixed here because it sits on the same code path: `get_daily_digest()`
**fails outright** on production with `column "is_active" does not exist`. It queries
`dashboard_targets.is_active`, which has never existed on that table. Every scheduled report has
been silently failing. It also consumes `get_dashboard_kernel_stats()`, so it must be re-created
after that function is corrected.

## Scope

**In scope:** three migration files, plus one runbook doc. Nothing else.

**Explicitly NOT in scope — do not change these:**
- `get_kernel_mass_balance`'s date-filter regression (it filters cracked/packed tonnage by
  `k.received_date` instead of the cracking date). Known, deliberately deferred by the product
  owner. This plan gives that function the `endqty1` fix **only**; leave its `WHERE` clauses alone.
- `get_kernel_runway_summary()`'s dead `'in_finished_stock'` status arm.
- Any front-end file. Any `.html`, any `.js`.
- `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` — it is an applied
  migration and this repo is forward-only. Do not append to it, despite what
  `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` says. The per-migration RBAC `DO` block is the live
  mechanism.

**You cannot apply these migrations.** There is no database credential and no network path to any
database in this environment. Author the files only. A human applies them out of band with
`npm run db:apply`. Do not attempt to connect to Postgres, do not add a script that would, and do
not treat "unapplied" as a failure.

## Work

### 1. `migrations/20260813090000_kernel_cracking_kg_helpers.sql`

Two SQL helpers, so the duplicated expressions have exactly one home. The copy-paste is how this
bug survived four functions.

```sql
CREATE OR REPLACE FUNCTION public.kernel_day_kg(p_elem jsonb)
RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
      nullif(trim(p_elem ->> 'endqty1'), '')::numeric,
      nullif(trim(p_elem ->> 'totalqty'), '')::numeric,
      0)::numeric;
$$;

CREATE OR REPLACE FUNCTION public.kernel_day_date(p_elem jsonb)
RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$
  SELECT CASE
      WHEN (p_elem ->> 'date') ~ '^\d{4}-\d{2}-\d{2}'      THEN (p_elem ->> 'date')::date
      WHEN (p_elem ->> 'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(p_elem ->> 'date', 'DD/MM/YYYY')
      ELSE NULL
  END;
$$;
```

Non-negotiable details:
- **`STABLE`, not `IMMUTABLE`.** `to_date` and `text::date` depend on the `DateStyle` GUC.
  Declaring them `IMMUTABLE` would be a lie that poisons cached plans.
- `SET search_path` is required to satisfy the Supabase `function_search_path_mutable` advisor.
- Add a `COMMENT ON FUNCTION` for each explaining *why* `endqty1` comes first — cite the silo
  carry-over behaviour, so the next person does not "simplify" it back to `totalqty`.
- **No RBAC `DO` block and no `GRANT` for these two.** They are internal helpers, never called
  from the client. (This is the one deviation from the repo's function-migration template.)

### 2. `migrations/20260813091000_fix_kg_cracked_endqty1_undercount.sql`

`CREATE OR REPLACE` these three, routing every cracking-kg and cracking-date expression through the
new helpers. All three keep their current signatures, so **no `DROP FUNCTION` is needed** — do not
add one.

| function | current definition to copy from |
|---|---|
| `get_dashboard_kernel_stats()` | `migrations/20260343000001_dashboard_kernel_batches_status_production_only.sql` — the `totalqty` expressions are at lines 33-36 (`kg_cracked_today`) and 55-58 (`kg_cracked_week`) |
| `get_production_trends_daily(integer)` | `migrations/20260326000001_get_production_trends_daily.sql` — the `cracked` CTE at lines 24-47; the date CASE is duplicated in both `SELECT` and `GROUP BY` (lines 31-35 and 42-46) and collapses to `GROUP BY public.kernel_day_date(elem)` |
| `get_kernel_mass_balance(date, date)` | `migrations/20260706100000_phase2_implementation_complete.sql:308-362` — the `v_cracked` expression at lines 336-341 |

Method: **read the current body out of the named migration file and reproduce it verbatim, changing
only** (a) the cracking-kg coalesce → `public.kernel_day_kg(elem)`, and (b) the inline date CASE →
`public.kernel_day_date(elem)`. Do not refactor anything else, do not rename columns, do not adjust
`WHERE` clauses. A reviewer must be able to see that the diff changes the kg expression and nothing
more.

Watch for:
- `get_dashboard_kernel_stats` computes `kg_cracked_week` over a **rolling 7 days**
  (`v_week_start := v_today - interval '7 days'`), not a calendar week. Preserve that.
- The original `20260343000001` migration **omitted its RBAC block and its `NOTIFY`**. Add both
  here for `get_dashboard_kernel_stats`, alongside the ones for the other two functions.

### 3. `migrations/20260813092000_fix_get_daily_digest_dashboard_targets.sql`

`CREATE OR REPLACE FUNCTION public.get_daily_digest()`, copied from its current definition at
`migrations/20260706100000_phase2_implementation_complete.sql` (the live one; the earlier
definition at `migrations/20260602160000_scheduled_reports.sql:67-103` is dead).

The only change: the production-target lookup at lines 281-283 reads

```sql
SELECT target_value FROM public.dashboard_targets
WHERE metric_key = 'total_production_kg' AND is_active = true
```

`dashboard_targets` has no `is_active` column — see the `CREATE TABLE` at
`migrations/20260602110000_dashboard_targets.sql:6-18`. Replace the predicate with the same
effective-dated pattern `get_dashboard_targets()` itself uses:

```sql
SELECT target_value FROM public.dashboard_targets
WHERE metric_key = 'total_production_kg'
  AND effective_from <= current_date
ORDER BY effective_from DESC, updated_at DESC
LIMIT 1
```

Keep it tolerant of no row (the digest must still render with a null/zero target).

This migration must sort **after** 20260813091000 so the digest is rebuilt on top of the corrected
`get_dashboard_kernel_stats()`.

### 4. `docs/database/KG_CRACKED_UNDERCOUNT_FIX.md`

A short runbook for the human applying this, containing:

1. Why `endqty1` is authoritative (summarise the Context section — the silo carry-over mechanism is
   the crux and must be written down somewhere permanent).
2. The apply order: `20260813090000` → `091000` → `092000`, each via
   `npm run db:apply -- migrations/<file>.sql` on dev first, then dev → demo → prod per
   `docs/database/DEV_TO_PROD_CHECKLIST.md`.
3. This exact before/after query, to be run on dev and then prod:

```sql
WITH rows AS (
  SELECT
    (CASE WHEN (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'      THEN (e->>'date')::date
          WHEN (e->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(e->>'date','DD/MM/YYYY')
     END)                                                             AS d,
    COALESCE(NULLIF(TRIM(e->>'totalqty'),'')::numeric, 0)             AS kg_before,
    COALESCE(NULLIF(TRIM(e->>'endqty1'),'')::numeric,
             NULLIF(TRIM(e->>'totalqty'),'')::numeric, 0)             AS kg_after
  FROM public.kernel k
  CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(NULLIF(k.cracking_data,'null'::jsonb),'[]'::jsonb)) e
  WHERE k.is_active = true
)
SELECT to_char(date_trunc('month', d),'YYYY-MM')                      AS month,
       count(*)                                                       AS day_rows,
       round(sum(kg_before),1)                                        AS kg_before,
       round(sum(kg_after),1)                                         AS kg_after,
       round(sum(kg_after) - sum(kg_before),1)                        AS delta_kg,
       CASE WHEN sum(kg_after) > 0
            THEN round(100.0*(sum(kg_after)-sum(kg_before))/sum(kg_after),1) END AS pct_undercount
FROM rows WHERE d IS NOT NULL
GROUP BY ROLLUP (date_trunc('month', d))
ORDER BY 1 NULLS LAST;
```

4. The expected production result, so a human can confirm the fix landed correctly:

| month | kg_before | kg_after | delta | under-count |
|---|---|---|---|---|
| 2026-04 | 17,804.3 | 62,164.8 | +44,360.5 | 71.4% |
| 2026-05 | 56,362.0 | 72,314.5 | +15,952.5 | 22.1% |
| 2026-06 | 12,611.5 | 12,611.5 | 0.0 | 0.0% |
| 2026-07 | 26,857.0 | 47,499.3 | +20,642.3 | 43.5% |
| **total** | **113,634.8** | **194,590.1** | **+80,955.3** | **41.6%** |

5. **The April caveat, stated plainly.** April's +71.4% includes roughly 34,000 kg from one bad
   source row: batch `Bn 32 26 10` records `endqty1 = 39,853` on 2026-04-23 against a batch whose
   total NIS is 12,309.3 kg, and that row is also one of the three where the
   `startqty1 - silo1 = endqty1` identity fails (`54853 - 1500 <> 39853`). The fix is directionally
   right and the 41.6% total is sound, but **April over-states until that row is corrected by the
   production team.** Do not let anyone read the April number as real.

6. A note that `get_daily_digest()` currently errors outright, so scheduled reports should be
   re-tested after applying.

## Repo conventions

- Migrations live in the **repo-root `migrations/`** directory. Forward-only: never edit an applied
  migration file.
- Every migration that creates a **client-callable** function ends with, in this order: a
  `COMMENT ON FUNCTION`; a `DO $$ ... FOR v_role_id IN SELECT id FROM public.roles LOOP ... INSERT
  INTO public.role_permissions (role_id, object_type, object_name, operation, allowed) VALUES
  (v_role_id.id, 'function', '<fn>', 'EXECUTE', true) ON CONFLICT DO NOTHING ... END LOOP; END; $$;`
  block; an explicit `GRANT EXECUTE ... TO authenticated, service_role;`; then
  `NOTIFY pgrst, 'reload schema';`. Copy the exact template from
  `migrations/20260713160000_get_stock_soh_history.sql:204-219`.
- Re-created functions keep `SECURITY DEFINER SET search_path = public`.
- SQL is plain `.sql` applied by the Supabase CLI. No ORM, no schema-diff tooling.

## Acceptance criteria

A reviewer must be able to confirm all of this from the diff alone:

1. Three new files in `migrations/`, named exactly as above, sorting after
   `20260812100000_crm_whatsapp_module.sql`.
2. `public.kernel_day_kg` and `public.kernel_day_date` exist, are `STABLE` (not `IMMUTABLE`), and
   carry `SET search_path`.
3. **Zero remaining references to `total_qty`** anywhere in the three re-created function bodies.
4. **Zero remaining inline `totalqty` coalesce expressions** in those three bodies — every one goes
   through `public.kernel_day_kg`.
5. `get_dashboard_kernel_stats` now carries a `COMMENT`, an RBAC `DO` block, a `GRANT` and a
   `NOTIFY` (it previously had only the comment).
6. `get_daily_digest()` contains no reference to `dashboard_targets.is_active`.
7. `get_kernel_mass_balance`'s `WHERE k.received_date BETWEEN v_from AND v_to` clauses are
   **unchanged** — only its kg expression moves to the helper.
8. `docs/database/KG_CRACKED_UNDERCOUNT_FIX.md` exists and contains the before/after query, the
   expected-results table, and the April caveat.
9. `npm run test:fleet` passes.
10. No `.js` or `.html` file is touched.
