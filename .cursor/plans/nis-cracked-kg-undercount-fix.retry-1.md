---
retry_of: f928ab8f-7797-4949-ba05-c0d2caf401b7
---

# Fix the `get_daily_digest()` crash, centralise the "kg cracked" expression without changing it, and write up the `endqty1` under-count hypothesis for human decision

## Context

There are three separate things in play here. Read all three before writing any SQL, because the
first version of this plan conflated them and was rejected for it.

### A. A real, verified live bug: `get_daily_digest()` errors out

`get_daily_digest()` fails on every call with `column "is_active" does not exist`. Verified in this
checkout:

- The live definition is `migrations/20260706100000_phase2_implementation_complete.sql:233-303`
  (the earlier definition at `migrations/20260602160000_scheduled_reports.sql:67-103` is dead).
- Line 282 reads `WHERE metric_key = 'total_production_kg' AND is_active = true`.
- `public.dashboard_targets` is created at `migrations/20260602110000_dashboard_targets.sql:6-18`
  and has **no** `is_active` column; no later migration adds one (`dashboard_targets` appears in
  only two migration files).
- The table is effective-dated; `get_dashboard_targets()` (same file, lines 47-52) selects the
  latest row with `effective_from <= current_date`.

Every scheduled report has therefore been failing silently
(`supabase/functions/send-daily-digest/index.ts:70` and
`supabase/functions/send-daily-digest-whatsapp/index.ts:82` both call this RPC, as does
`WebPortal/js/data-functions.js:1944`). This fix is independently correct and ships in its own
migration, first.

### B. A duplicated expression, to be centralised **with its current meaning unchanged**

The same cracking-kg coalesce and the same date-parsing `CASE` are copy-pasted across four
functions:

| function | live definition | expressions |
|---|---|---|
| `get_dashboard_kernel_stats()` | `migrations/20260343000001_dashboard_kernel_batches_status_production_only.sql` | kg coalesce at lines 33-36 and 55-58; date `CASE` at 45-49 and 67-71 |
| `get_production_trends_daily(integer)` | `migrations/20260326000001_get_production_trends_daily.sql` | `cracked` CTE lines 24-47: date `CASE` in `SELECT` at 26-30, kg `SUM(COALESCE(...))` at 31-35, the same date `CASE` repeated in `GROUP BY` at 42-46 |
| `get_kernel_mass_balance(date, date)` | `migrations/20260706100000_phase2_implementation_complete.sql:310-362` | `v_cracked` at 336-340 |

This plan gives those expressions exactly one home (`public.kernel_day_kg`,
`public.kernel_day_date`) **without altering what they compute**. The helper's coalesce arms are the
current arms, in the current order: `totalqty`, then `total_qty`, then `0`. The point is that when
the question in section C is decided by a human, the change is one line in one function instead of
four hand-edits.

### C. The `endqty1` under-count hypothesis — investigated and documented, NOT implemented

An earlier analysis (run against the production database, which is **not reachable from this
environment**) claimed that `endqty1` is the authoritative kg-cracked field, that the form fills it
as `startqty1 - silo1`, that `totalqty` is blank precisely on silo carry-over days, and that the app
therefore under-reports NIS cracked by 41.6% (113,634.8 kg vs 194,590.1 kg). **This checkout
contradicts the mechanism behind that claim:**

- `ps_crack_endqty1` is a plain manual `<input type="number">` labelled "End Qty" —
  `WebPortal/modules/modals/modal-production-stages/html/modal_production_stages.html:48`, sitting
  between "Start Qty" (line 47) and "Silo Qty" (line 49).
- The string `endqty1` does **not appear** in
  `WebPortal/modules/modals/modal-production-stages/js/modal_production_stages.js` at all: no
  derivation from `startqty1 - silo1`, no validation, no recalculation. Its only other appearance in
  the front end is a display label in `modal-batch-history/js/modal_batch_history.js:94`.
- The only cracking auto-calc is `recalcCrackingStats()` (js:490-497), which fills **`totalqty`**
  from `total_07 + total_10 + total_13` when `totalqty` is empty. So a blank `totalqty` implies the
  slot totals were also blank — nothing in the code links blankness to silo carry-over.
- `enrichProductionStageCalculations()` (js:98-101) already treats crack output as
  `totalqty`, falling back to `total_07 + total_10 + total_13` — a code-supported alternative the
  original analysis never considered.
- The repo's own module doc states the opposite of the hypothesis:
  `docs/modules/11_Executive_Dashboard_Reporting.md:81` and `:89` document `totalqty`
  (or `total_qty`) as the stored and summed cracking figure.
- The analysis is internally inconsistent: it concedes that roughly 34,000 kg of the ~80,955 kg
  uplift comes from one row (batch `Bn 32 26 10`, `endqty1 = 39,853` on 2026-04-23 against a batch
  whose total NIS is 12,309.3 kg — physically impossible, and one of the rows where the
  `startqty1 - silo1 = endqty1` identity fails), while still calling the 41.6% headline sound.

"End Qty" is at least as plausibly *quantity left at end of shift* as *throughput*. Re-pointing the
dashboard tiles, Production Trends, `get_kernel_mass_balance` (where `balance_pct = packed/cracked`
would fall sharply) and the digest at that field is a business-semantics decision about
management-facing production numbers. **This plan does not make it.** It records the hypothesis, the
contradicting evidence, the bad source row and the open questions in a document, and provides a
read-only diagnostic query a human can run on dev and prod. No SQL file produced by this plan may
contain the string `endqty1`.

## Scope

**In scope:** three migration files, plus one investigation/runbook doc. Nothing else.

**Explicitly NOT in scope — do not change these:**
- **Which JSON key any function sums.** No behaviour change to any kg figure. `endqty1` must not
  appear in any `.sql` file you create. The helper keeps the existing arms
  (`totalqty`, `total_qty`, `0`).
- **Removing the `total_qty` coalesce arm.** The claim that this key is present on 0 of 120 rows
  rests solely on a production query that cannot be reproduced here. Keep the arm exactly as it is
  today, in the same position.
- `get_kernel_mass_balance`'s date-filter regression (it filters cracked/packed tonnage by
  `k.received_date`, lines 334/340/346, instead of the cracking date). Known, deliberately deferred
  by the product owner. Leave its `WHERE` clauses byte-identical.
- `get_kernel_runway_summary()`'s dead `'in_finished_stock'` status arm.
- Any front-end file. Any `.html`, any `.js`, any `supabase/functions/**`.
- `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` — an applied migration, and
  migrations here are forward-only (`docs/database/DEV_TO_PROD_CHECKLIST.md:61`: "Never edit an
  applied migration file"). Do not append to it, despite `docs/RBAC_NEW_FUNCTION_CHECKLIST.md:93`
  calling it "the canonical source of truth". That checklist step is stale in practice — recent
  functions (`get_stock_soh_history`, `get_daily_digest`, `get_kernel_mass_balance`, the CRM
  functions) are absent from its array, and both functions this plan touches that are client-callable
  (`get_dashboard_kernel_stats`, `get_production_trends_daily`) are already in it at line 22. The
  per-migration RBAC `DO` block is the live mechanism.
- **Do not edit `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` or
  `docs/modules/11_Executive_Dashboard_Reporting.md`.** Both may need correcting, but that is a
  separate human-reviewed action, not part of this plan. Note the conflict in the new doc (see §4.7)
  and stop there.

**You cannot apply these migrations.** There is no database credential and no network path to any
database in this environment. Author the files only. A human applies them out of band. Do not
attempt to connect to Postgres, do not add a script that would, and do not treat "unapplied" as a
failure.

**Nothing in this repo validates SQL.** `npm run test:fleet` is
`routing:verify && username:verify && node scripts/verify-phase2-migrations.mjs`, and the last is a
bare `existsSync` check on ten unrelated filenames (see the file). It will pass whatever you write.
Your only defence against a transcription error is the verbatim-copy discipline in §2 and §3 —
follow it literally.

## Work

Each of the three migrations must be independently applicable and independently correct. They sort
in the order below and after the current newest migration,
`migrations/20260812100000_crm_whatsapp_module.sql`.

### 1. `migrations/20260813090000_fix_get_daily_digest_dashboard_targets.sql`

`CREATE OR REPLACE FUNCTION public.get_daily_digest()`, copied verbatim from
`migrations/20260706100000_phase2_implementation_complete.sql:233-303` (signature, `RETURNS jsonb`,
`LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`, all `DECLARE`s, the whole
body).

The only change: replace the target lookup at lines 281-283

```sql
SELECT target_value INTO v_target_val FROM public.dashboard_targets
WHERE metric_key = 'total_production_kg' AND is_active = true
ORDER BY updated_at DESC LIMIT 1;
```

with the effective-dated pattern `get_dashboard_targets()` already uses
(`migrations/20260602110000_dashboard_targets.sql:47-52`):

```sql
SELECT target_value INTO v_target_val FROM public.dashboard_targets
WHERE metric_key = 'total_production_kg'
  AND effective_from <= current_date
ORDER BY effective_from DESC, updated_at DESC
LIMIT 1;
```

`SELECT ... INTO` leaves `v_target_val` NULL when no row matches, and the existing
`produced_vs_target` block already guards on `v_target_val IS NOT NULL` — keep that guard, the
digest must still render with a null target.

This migration is **standalone**. It does not depend on migrations 2 or 3, and must not be written
as if it did: PL/pgSQL resolves `public.get_dashboard_kernel_stats()` by name at runtime, so
re-creating the digest does not bind it to any particular version of that function.

End the file with, in this order: `COMMENT ON FUNCTION public.get_daily_digest()` (say what was
fixed and why `effective_from` is the right predicate); the RBAC `DO` block for `get_daily_digest`;
`GRANT EXECUTE ON FUNCTION public.get_daily_digest() TO authenticated, service_role;` (this function
already carries such a grant at `migrations/20260602160000_scheduled_reports.sql:107`, so repeating
it is consistent); then `NOTIFY pgrst, 'reload schema';`.

### 2. `migrations/20260813091000_kernel_cracking_kg_helpers.sql`

Two SQL helpers, so the duplicated expressions have exactly one home.

```sql
CREATE OR REPLACE FUNCTION public.kernel_day_kg(p_elem jsonb)
RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
      NULLIF(TRIM(p_elem ->> 'totalqty'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'total_qty'), '')::numeric,
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
- **The helper bodies above are the exact expressions in the live functions today** (compare
  `kernel_day_kg` against `20260343000001_...sql:31-36` and
  `20260706100000_...sql:337`; compare `kernel_day_date` against `20260343000001_...sql:45-49`).
  Do not add, remove or reorder a coalesce arm. Do not introduce `endqty1`.
- **`STABLE`, not `IMMUTABLE`.** `to_date` and `text::date` depend on the `DateStyle` GUC;
  declaring them `IMMUTABLE` would poison cached plans.
- `SET search_path` on both, matching the rest of the repo's function migrations.
- Add a `COMMENT ON FUNCTION` for each. `kernel_day_kg`'s comment must state plainly that it
  reproduces the historical expression unchanged, that whether `endqty1` should take precedence is
  an **open question pending sign-off from the production team**, and must point at
  `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`. Do not assert in the comment that any
  field is authoritative.
- These two helpers are internal: they are only ever called from `SECURITY DEFINER` functions, never
  from the client, and are not exposed as RPCs. Still, end the file with an RBAC `DO` block naming
  both (idempotent `INSERT ... ON CONFLICT DO NOTHING` per role, same shape as
  `migrations/20260713160000_get_stock_soh_history.sql:207-217`) and a
  `NOTIFY pgrst, 'reload schema';`, so the repo's "every new function gets RBAC rows" habit is not
  broken by a special case. No `GRANT` is required for them.

### 3. `migrations/20260813092000_route_cracking_kg_through_helpers.sql`

`CREATE OR REPLACE` the three functions in section B, routing every cracking-kg and cracking-date
expression through the helpers. All three keep their current signatures, so **no `DROP FUNCTION` is
needed** — do not add one. (`get_kernel_mass_balance`'s source file has a `DROP FUNCTION IF EXISTS`
at line 308; do not copy it.)

Method, and this is the whole risk-control for this migration: **open the named source file, copy
the current body out verbatim, and change only** (a) the cracking-kg `COALESCE(...)` →
`public.kernel_day_kg(elem)`, and (b) the inline date `CASE` → `public.kernel_day_date(elem)`. In
`get_production_trends_daily` the duplicated `GROUP BY` `CASE` (lines 42-46) collapses to
`GROUP BY public.kernel_day_date(elem)`. Nothing else moves: no renamed columns, no reordered
statements, no touched `WHERE` clauses, no reformatting, no changes to the **packed** expressions
(`totals_qty` / `sk_total_qty` + `bt_total_qty` / the `jsonb_each` fallback) or to the `dispatched`
CTE. When you are done, re-read your new body against the source side by side and confirm the only
differences are the substitutions listed here.

Watch for:
- `get_dashboard_kernel_stats` computes `kg_cracked_week` over a **rolling 7 days**
  (`v_week_start := v_today - interval '7 days'`, line 23), not a calendar week. Preserve that.
- Both cracking blocks in `get_dashboard_kernel_stats` keep their guard predicates
  (`elem ? 'date'`, `IS NOT NULL`, `TRIM(...) <> ''`) exactly as written; only the `CASE` inside the
  comparison becomes `public.kernel_day_date(elem)`.
- `get_kernel_mass_balance`: only `v_cracked`'s summed expression (lines 336-340) changes. Its
  `WHERE k.is_active = true AND k.received_date BETWEEN v_from AND v_to` stays byte-identical, as do
  `v_nis`, `v_packed`, `v_proc_sched`, `v_proc_recv` and the `RETURN QUERY`.
- The original `20260343000001` migration has a `COMMENT` but **no RBAC block and no `NOTIFY`**;
  `20260326000001` has an RBAC block but no `NOTIFY`. In this migration give all three functions the
  full tail, in this order per function: `COMMENT ON FUNCTION`; RBAC `DO` block (the loop shape at
  `migrations/20260713160000_get_stock_soh_history.sql:207-217`); `GRANT EXECUTE ON FUNCTION ... TO
  authenticated, service_role;`; and a single `NOTIFY pgrst, 'reload schema';` at the end of the
  file. Note that the `get_stock_soh_history` file itself contains **no** `GRANT` — the grant is the
  broader repo pattern (67 occurrences across 20 migrations), not something that file demonstrates,
  so do not describe it as copied from there.
- Keep `SECURITY DEFINER SET search_path = public` and the existing `LANGUAGE plpgsql` /
  volatility markers on all three.

### 4. `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`

An investigation record and runbook. It must **not** present the `endqty1` hypothesis as settled or
publish a table of "expected production results". Contents, in this order:

1. **The hypothesis, labelled as unverified.** State that an analysis run against the production
   database (not reachable from this repo, so not reproducible by a reviewer) reported
   `coalesce(endqty1, totalqty)` = 194,590.1 kg vs `totalqty` = 113,634.8 kg (a claimed 41.6%
   under-count), that `startqty1 - silo1 = endqty1` held on 41 of 44 testable day-rows, and that
   `totalqty` was said to be blank precisely on silo carry-over days. Mark every one of these
   numbers as **reported, unverified**.
2. **The evidence in this repo that contradicts the stated mechanism**, with file and line
   references: `modal_production_stages.html:48` ("End Qty", plain manual number input, no
   `readonly`, no derivation); `endqty1` absent from `modal_production_stages.js` entirely;
   `recalcCrackingStats()` at js:490-497 filling `totalqty` from `total_07+total_10+total_13`;
   `enrichProductionStageCalculations()` at js:98-101 using `totalqty` then the slot totals as crack
   output; `docs/modules/11_Executive_Dashboard_Reporting.md:81,89` documenting `totalqty` as the
   summed field. Conclude plainly: nothing in this codebase supports `endqty1` being a derived
   throughput figure, and "End Qty" is equally readable as quantity remaining at end of shift.
3. **The bad source row.** Batch `Bn 32 26 10` records `endqty1 = 39,853` on 2026-04-23 against a
   batch whose total NIS is 12,309.3 kg (3.2×, physically impossible), and it is one of the rows
   where the `startqty1 - silo1 = endqty1` identity fails (`54853 - 1500 <> 39853`). Roughly 34,000
   of the ~80,955 kg claimed uplift comes from this single row, i.e. about 42% of the headline. State
   that the headline percentage cannot be treated as validated until this row is corrected or
   explained by the production team, and do not quote it as a target figure anywhere.
4. **The read-only diagnostic query**, for a human to run on dev and then production. It compares
   three candidate definitions side by side — current (`totalqty`/`total_qty`), the `endqty1`
   hypothesis, and the slot-total variant the front end already uses — so the decision can be made
   on evidence rather than on one of them:

```sql
WITH rows AS (
  SELECT
    (CASE WHEN (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'      THEN (e->>'date')::date
          WHEN (e->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(e->>'date','DD/MM/YYYY')
     END)                                                              AS d,
    COALESCE(NULLIF(TRIM(e->>'totalqty'),'')::numeric,
             NULLIF(TRIM(e->>'total_qty'),'')::numeric, 0)             AS kg_current,
    COALESCE(NULLIF(TRIM(e->>'endqty1'),'')::numeric,
             NULLIF(TRIM(e->>'totalqty'),'')::numeric, 0)              AS kg_endqty1_hypothesis,
    COALESCE(NULLIF(TRIM(e->>'totalqty'),'')::numeric,
             NULLIF(NULLIF(TRIM(e->>'total_07'),'')::numeric, NULL)
               + COALESCE(NULLIF(TRIM(e->>'total_10'),'')::numeric,0)
               + COALESCE(NULLIF(TRIM(e->>'total_13'),'')::numeric,0), 0) AS kg_slot_totals,
    (NULLIF(TRIM(e->>'startqty1'),'')::numeric
       - COALESCE(NULLIF(TRIM(e->>'silo1'),'')::numeric,0))            AS kg_start_minus_silo,
    NULLIF(TRIM(e->>'endqty1'),'')::numeric                            AS raw_endqty1,
    k.batch_id, k.wet_nis_received_kg
  FROM public.kernel k
  CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(NULLIF(k.cracking_data,'null'::jsonb),'[]'::jsonb)) e
  WHERE k.is_active = true
)
SELECT to_char(date_trunc('month', d),'YYYY-MM')                       AS month,
       count(*)                                                        AS day_rows,
       count(*) FILTER (WHERE raw_endqty1 IS NULL)                     AS rows_no_endqty1,
       count(*) FILTER (WHERE raw_endqty1 IS NOT NULL
                          AND kg_start_minus_silo IS NOT NULL
                          AND raw_endqty1 <> kg_start_minus_silo)      AS identity_breaks,
       count(*) FILTER (WHERE raw_endqty1 > COALESCE(wet_nis_received_kg, 0)
                          AND wet_nis_received_kg IS NOT NULL)         AS endqty1_exceeds_batch_nis,
       round(sum(kg_current),1)                                        AS kg_current,
       round(sum(kg_endqty1_hypothesis),1)                             AS kg_endqty1_hypothesis,
       round(sum(kg_slot_totals),1)                                    AS kg_slot_totals
FROM rows WHERE d IS NOT NULL
GROUP BY ROLLUP (date_trunc('month', d))
ORDER BY 1 NULLS LAST;
```

5. **The open questions a human must answer before any kg expression changes**, listed explicitly:
   what does the "End Qty" box mean to the operators who fill it in; is `totalqty` genuinely blank on
   silo carry-over days (and if so, why, given `recalcCrackingStats()`); which of the three candidate
   definitions is authoritative; and if `endqty1` wins, what front-end label, help text and
   validation must ship with it so future capture is unambiguous — noting that the front end is out
   of scope here, so no such labelling exists today. Record that `get_kernel_mass_balance`'s
   `balance_pct = packed/cracked` will drop sharply if `cracked` rises while `packed` is unchanged,
   and that this must be expected and communicated, not discovered.
6. **Apply order and commands**, from `docs/database/DEV_TO_PROD_CHECKLIST.md`:
   `20260813090000` → `091000` → `092000`, each applied to dev first with
   `npm run db:apply -- migrations/<file>.sql`, then to production with
   `CONFIRM_PROD=YES npm run db:apply-prod -- migrations/<file>.sql` (which refuses to run unless the
   file is already on the dev ledger). Note that code promotion is `dev` → `demo` → `prod` but the
   demo host routes to the **dev** database, so there is no separate "apply to demo" step. State that
   migration 1 stands alone and can be applied without 2 and 3; that 2 must precede 3; and that 2+3
   are expected to leave every reported number **unchanged** — if any dashboard tile, trend point or
   mass-balance figure moves after applying them, something was mis-transcribed and it should be
   rolled forward with a correcting migration.
7. **Two notes for humans, not actions for this plan.** (a) `get_daily_digest()` errors outright
   today, so the scheduled email and WhatsApp digests must be re-tested after migration 1 is applied.
   (b) `docs/RBAC_NEW_FUNCTION_CHECKLIST.md:93` calls
   `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` "the canonical source of
   truth" and instructs editing it, which conflicts with the forward-only rule at
   `docs/database/DEV_TO_PROD_CHECKLIST.md:61` and with actual practice (that array is missing recent
   functions such as `get_stock_soh_history`, `get_daily_digest` and the CRM functions, and it
   declares `v_role_id uuid`, which the checklist itself says is wrong for the Lambda project). Flag
   it as needing a human-reviewed doc correction. Likewise flag that
   `docs/modules/11_Executive_Dashboard_Reporting.md:81,89` will need updating **if and only if** the
   `endqty1` question is ever decided in favour of changing the summed field.

## Repo conventions

- Migrations live in the **repo-root `migrations/`** directory. Forward-only: never edit an applied
  migration file (`docs/database/DEV_TO_PROD_CHECKLIST.md:61`).
- Every migration that creates or replaces a **client-callable** function ends with, in this order: a
  `COMMENT ON FUNCTION`; a `DO $$ ... FOR v_role_id IN SELECT id FROM public.roles LOOP ... INSERT
  INTO public.role_permissions (role_id, object_type, object_name, operation, allowed) VALUES
  (v_role_id.id, 'function', '<fn>', 'EXECUTE', true) ON CONFLICT DO NOTHING ... END LOOP; END; $$;`
  block; a `GRANT EXECUTE ON FUNCTION ... TO authenticated, service_role;`; then
  `NOTIFY pgrst, 'reload schema';`. Copy the `COMMENT` / RBAC `DO` / `NOTIFY` shape from
  `migrations/20260713160000_get_stock_soh_history.sql:204-219` — that file has no `GRANT`, so take
  the grant wording from a migration that does, e.g.
  `migrations/20260602160000_scheduled_reports.sql:107`.
- Re-created functions keep `SECURITY DEFINER SET search_path = public`.
- SQL is plain `.sql` applied by the Supabase CLI wrappers in `scripts/`. No ORM, no schema-diff
  tooling, no automated SQL validation in CI.

## Acceptance criteria

A reviewer must be able to confirm all of this from the diff alone:

1. Exactly three new files in `migrations/`, named as in §1-§3, sorting after
   `20260812100000_crm_whatsapp_module.sql`, plus one new file
   `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`. No other file is added, edited or deleted.
2. **The string `endqty1` appears in no `.sql` file in the diff.** It appears only inside the
   diagnostic query and the narrative of the new markdown doc.
3. **No numeric behaviour change from migrations 2 and 3.** `public.kernel_day_kg`'s body is
   `COALESCE(NULLIF(TRIM(... 'totalqty'),'')::numeric, NULLIF(TRIM(... 'total_qty'),'')::numeric, 0)`
   — same arms, same order as `20260343000001_...sql:31-36` — and `public.kernel_day_date`'s `CASE`
   matches `20260343000001_...sql:45-49`. The `total_qty` arm is still present in the helper.
4. Both helpers are `STABLE` (not `IMMUTABLE`), carry `SET search_path`, and carry a
   `COMMENT ON FUNCTION`; `kernel_day_kg`'s comment states the `endqty1` question is open and
   unresolved and points at the new doc.
5. Every cracking-kg and cracking-date expression in the three re-created bodies goes through
   `public.kernel_day_kg` / `public.kernel_day_date`; no inline cracking `COALESCE` or date `CASE`
   remains in them; `get_production_trends_daily`'s `GROUP BY` is
   `GROUP BY public.kernel_day_date(elem)`.
6. Apart from those substitutions, the three bodies are verbatim reproductions of their live
   definitions: packed/dispatched expressions, guard predicates, `v_week_start := v_today - interval
   '7 days'`, `SECURITY DEFINER SET search_path = public` and all `WHERE` clauses unchanged. In
   particular `get_kernel_mass_balance`'s `WHERE k.is_active = true AND k.received_date BETWEEN
   v_from AND v_to` clauses are untouched.
7. `get_dashboard_kernel_stats` now carries a `COMMENT`, an RBAC `DO` block, a `GRANT` and a
   `NOTIFY` (it previously had only the comment); `get_production_trends_daily` and
   `get_kernel_mass_balance` carry the same tail.
8. `get_daily_digest()` contains no reference to `dashboard_targets.is_active`, uses the
   `effective_from <= current_date` / `ORDER BY effective_from DESC, updated_at DESC LIMIT 1` pattern,
   and still returns a payload when no target row exists. Its migration is standalone and contains no
   comment claiming a dependency on `get_dashboard_kernel_stats`.
9. No `DROP FUNCTION` anywhere in the three migrations.
10. `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md` contains all seven items of §4, labels the
    194,590.1 / 113,634.8 / 41.6% figures as reported-and-unverified, contains no
    "expected production result" table presented as fact, and states the bad-row caveat and the open
    questions.
11. `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql`,
    `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` and `docs/modules/11_Executive_Dashboard_Reporting.md` are
    unmodified.
12. No `.js`, `.html`, `.ts` or `package.json` file is touched.
13. `npm run test:fleet` passes. Understand that this proves only that ten unrelated migration files
    still exist — it does not parse or execute any SQL you wrote, so criteria 2-9 are the real check.
