# `endqty1` under-count hypothesis — investigation record and runbook

Status: **open, unresolved.** This document records a hypothesis, the evidence in this repo that
contradicts its mechanism, and a read-only diagnostic query for a human to run. **No code change
in this repo acts on the hypothesis.** `endqty1` is not summed, referenced, or preferred by any
function shipped alongside this document.

## 1. The hypothesis (reported, unverified)

An analysis run against the production database — not reachable from this repo/environment, and
therefore **not reproducible by a reviewer of this document** — reported:

- `coalesce(endqty1, totalqty)` summed to **194,590.1 kg**, against `totalqty` alone summing to
  **113,634.8 kg**, over the period examined — a claimed **41.6% under-count** in the figure the
  dashboard, Production Trends chart and daily digest currently report.
- The identity `startqty1 - silo1 = endqty1` held on 41 of 44 testable day-rows.
- `totalqty` was reported blank precisely on days with silo carry-over, with the claim that the
  form derives `endqty1` from `startqty1 - silo1` on those days.

**All of the above numbers are reported and unverified.** They come from a production-only query
this repo cannot re-run. Treat them as a lead to investigate, not as a finding to act on.

## 2. Evidence in this repo that contradicts the stated mechanism

- `WebPortal/modules/modals/modal-production-stages/html/modal_production_stages.html:48` — the
  "End Qty" field (`id="ps_crack_endqty1"`) is a plain manual `<input type="number">`, no
  `readonly`, sitting between "Start Qty" (line 47) and "Silo Qty" (line 49). Nothing marks it as
  derived.
- The string `endqty1` does **not appear anywhere** in
  `WebPortal/modules/modals/modal-production-stages/js/modal_production_stages.js`: no derivation
  from `startqty1 - silo1`, no validation, no recalculation tying it to anything else on the form.
- The only cracking auto-calc in that file, `recalcCrackingStats()` (js:490-497), fills
  **`totalqty`** from `total_07 + total_10 + total_13` when `totalqty` is empty. Nothing in the
  code links a blank `totalqty` to silo carry-over — the far simpler explanation is that the three
  slot totals were also left blank that day.
- `enrichProductionStageCalculations()` (js:98-101) already treats crack output as `totalqty`,
  falling back to the summed slot totals (`total_07+total_10+total_13`) — a code-supported
  alternative candidate the original analysis never considered (see §4, `kg_slot_totals`).
- `docs/modules/11_Executive_Dashboard_Reporting.md:81` and `:89` document `totalqty` (or
  `total_qty`) as the field that is stored and summed for "kg cracked" — the opposite of what the
  hypothesis assumes.
- `endqty1`'s only other appearance in the front end is a display label in
  `WebPortal/modules/modals/modal-batch-history/js/modal_batch_history.js:94` ("End qty") — it is
  shown in a history view, not used in any calculation.

**Conclusion of this section:** nothing in this codebase supports `endqty1` being a derived
throughput figure. "End Qty" is at least as plausibly *quantity remaining at end of shift* as
*quantity processed*. The claim needs operator-level confirmation, not a code inference.

## 3. The bad source row

Batch `Bn 32 26 10` records `endqty1 = 39,853` on 2026-04-23, against a batch whose total NIS
received is 12,309.3 kg — i.e. `endqty1` on that single row is **3.2× the entire batch's intake**,
which is physically impossible. It is also one of the three rows (of 44 testable) where the
`startqty1 - silo1 = endqty1` identity the hypothesis relies on **fails**
(`54,853 − 1,500 = 53,353 ≠ 39,853`).

Roughly 34,000 kg of the reported ~80,955 kg uplift (194,590.1 − 113,634.8) comes from this single
row — **about 42% of the headline 41.6%**. The headline percentage cannot be treated as validated
until this row is corrected or explained by the production team. **Do not quote 41.6%, 194,590.1
kg or 113,634.8 kg as a target or expected figure anywhere** — they are unverified and partly
carried by one row that looks like a data-entry error.

## 4. Read-only diagnostic query

Run this on **dev first, then production**. It compares three candidate definitions of "kg
cracked" side by side per month — current (`totalqty`/`total_qty`), the `endqty1` hypothesis, and
the slot-total variant the front end's own `enrichProductionStageCalculations()` already falls
back to — plus data-quality counters, so the decision in §5 can be made on evidence instead of on
any one candidate.

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

This query is read-only (no `INSERT`/`UPDATE`/`DDL`) and safe to run directly against production
via any read-capable connection.

## 5. Open questions a human must answer before any kg expression changes

1. What does the "End Qty" box mean to the operators who fill it in — throughput processed, or
   quantity remaining at end of shift? This is a business-semantics question; it cannot be settled
   from code.
2. Is `totalqty` genuinely blank specifically on silo carry-over days, and if so, why — given that
   `recalcCrackingStats()` derives `totalqty` from the three shift-slot totals, which would need
   their own separate explanation for being blank on those same days?
3. Which of the three candidate definitions in §4 (`kg_current`, `kg_endqty1_hypothesis`,
   `kg_slot_totals`) is authoritative for management reporting?
4. If `endqty1` wins: what front-end label, help text and validation must ship with it so future
   capture is unambiguous? The front end is out of scope for this plan, so **no such labelling
   exists today** — shipping a data-layer change without it would just move the ambiguity, not
   remove it.
5. Be aware that `get_kernel_mass_balance()`'s `balance_pct = packed / cracked` will drop sharply
   if `cracked` rises while `packed` stays the same. If the kg-cracked definition ever changes,
   this must be **expected and communicated in advance**, not discovered as a surprise regression.

## 6. Apply order and commands

Per `docs/database/DEV_TO_PROD_CHECKLIST.md`, apply in this order:

1. `migrations/20260813090000_fix_get_daily_digest_dashboard_targets.sql`
2. `migrations/20260813091000_kernel_cracking_kg_helpers.sql`
3. `migrations/20260813092000_route_cracking_kg_through_helpers.sql`

For each, apply to dev first:

```bash
npm run db:apply -- migrations/<file>.sql
```

then to production:

```bash
CONFIRM_PROD=YES npm run db:apply-prod -- migrations/<file>.sql
```

`db:apply-prod` refuses to run unless the file is already recorded on the dev ledger. Code
promotion in this repo is `dev` → `demo` → `prod`, but the demo host routes to the **dev**
database, so there is no separate "apply to demo" step.

Notes on ordering:

- **Migration 1 stands alone.** It can be applied on its own, without 2 or 3, and fixes the
  `get_daily_digest()` crash immediately.
- **Migration 2 must precede migration 3** — migration 3's function bodies call the helpers
  migration 2 creates.
- **Migrations 2 and 3 are expected to leave every reported number unchanged.** They only move
  where an expression lives, not what it computes. If any dashboard tile, trend-chart point, or
  mass-balance figure moves after applying them, something was mis-transcribed in this plan and it
  should be rolled forward with a new correcting migration — not silently patched by editing 2 or
  3, which are by then applied migrations.

## 7. Two notes for humans (not actions taken by this plan)

**(a) Re-test the digest after migration 1.** `get_daily_digest()` has been erroring on every call
in production (`column "is_active" does not exist`), so the scheduled email and WhatsApp digests
have likely been failing silently for as long as this bug has existed. After migration 1 is
applied, re-test both `supabase/functions/send-daily-digest` and
`supabase/functions/send-daily-digest-whatsapp` end to end.

**(b) `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` and the "master migration" are out of step with
practice.** `docs/RBAC_NEW_FUNCTION_CHECKLIST.md:93` calls
`migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` "the canonical source of
truth" and instructs adding new function names to its array. This conflicts with the forward-only
rule in `docs/database/DEV_TO_PROD_CHECKLIST.md:61` ("never edit an applied migration file") and
with actual practice: that array is already missing several recent functions (e.g.
`get_stock_soh_history`, `get_daily_digest`, the CRM/WhatsApp functions), and it declares
`v_role_id uuid`, which the checklist itself elsewhere says is the wrong type for this project's
role IDs. This needs a human-reviewed doc correction; it is out of scope for this plan and neither
that file nor the checklist has been edited here.

Separately, `docs/modules/11_Executive_Dashboard_Reporting.md:81,89` documents `totalqty`/
`total_qty` as the summed cracking field. That doc will need updating **if and only if** the
`endqty1` question above is ever decided in favour of changing the summed field — not before, and
not as part of this plan.
