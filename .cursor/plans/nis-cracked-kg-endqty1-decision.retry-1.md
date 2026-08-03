---
retry_of: d5205496-2c4b-4929-bfdf-f689bb638e4e
---

# Advance the kg-cracked field question: record the new evidence, keep the decision open

## Context

`migrations/20260813091000_kernel_cracking_kg_helpers.sql` centralised the cracking-kg expression
into `public.kernel_day_kg(jsonb)` and deliberately changed no behaviour, recording the choice of
field as an open question in `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`. All three call
sites (`get_dashboard_kernel_stats`, `get_production_trends_daily`, `get_kernel_mass_balance`) route
through that helper via `migrations/20260813092000_route_cracking_kg_through_helpers.sql`, and
`get_daily_digest` (migration `20260813090000`) calls `get_dashboard_kernel_stats`, so whenever the
question *is* decided the change really is one line in one function — and it moves the dashboard
tiles, Production Trends, the mass balance and the email/WhatsApp digests all at once.

A new analysis has been run against the production database and reports arithmetic that argues
`endqty1` is the processed quantity. **This plan does not act on that argument and does not flip the
coalesce order.** The reason is not squeamishness: the reported figures cannot be reproduced from
this repo (no database credential, no network path), and the parts of the argument that *can* be
checked here do not survive the check (§2). What this plan does is make the next attempt possible:
it folds the new evidence into the investigation record, honestly labelled, together with the
specific contradictions that must be resolved and the read-only queries a human with database access
must run to resolve them.

**Deliverable: a documentation change only.** Exactly one file is edited:
`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`. No migration is authored, no `.sql`, `.js`
or `.html` file is created or modified.

## 1. The newly reported evidence (record it as reported, not as fact)

The following comes from a production query that cannot be re-run from this repo. Every number below
is **reported and unverified** and must be written into the doc that way, attributed to "an analysis
run against production, not reproducible from this repo":

- Over 120 cracking day-rows: both `endqty1` and `totalqty` populated on 31 rows; equal on 30 of
  those 31.
- `cracking_percentage` on batch `Bn 44 26 42` matches `totalqty ÷ batch NIS received`
  (`6900/50000 = 13.8%`, `6263/50000 = 12.5%`, `5000/50000 = 10%`, `5500/50000 = 11%`).
- The identity `startqty1 − silo1 = endqty1` holds on 41 of 44 testable rows.
- A silo carry-over table on batch `Bn 44 26 42`:

  | date | `startqty1` | `silo1` | `endqty1` |
  |---|---|---|---|
  | 2026-07-22 | 6000 | 1500 | 4500 |
  | 2026-07-23 | 5100 | 1200 | 3900 |
  | 2026-07-24 | 1200 | 0 | 1000 |

- Sizing, reported: `totalqty` alone sums to 113,634.8 kg; `coalesce(endqty1, totalqty)` sums to
  194,590.1 kg raw (+80,955.3); with rows excluded that are implausible (`endqty1 > batch NIS`) or
  that break the identity, 154,737.1 kg (+41,102.3, quoted as 26.6%).
- 13 rows have `endqty1` filled and `totalqty` blank; excluding bad ones they average ~3,160 kg/day.
- `total_qty` is populated on 0 of 120 rows.

## 2. Why this is not yet a decision — the checks that fail in-repo

Write these into the doc as a first-class section, with file:line citations, immediately after §1's
reported evidence. They are the reason the status stays open.

1. **The reported carry-over table breaks its own identity.** Row 3: `1200 − 0 = 1200`, but
   `endqty1 = 1000`. So the table's third row is itself one of the identity failures.
2. **The carry-over chain holds on one of the two transitions shown.** 2026-07-23 closes
   `silo1 = 1200` and 2026-07-24 opens `startqty1 = 1200` (holds); 2026-07-22 closes `silo1 = 1500`
   but 2026-07-23 opens `startqty1 = 5100` (does not hold). One supporting transition is a lead, not
   a proof.
3. **The two proofs assign incompatible meanings to the same field.** Proof A makes `endqty1` equal
   to `totalqty`, and `totalqty` is an *output* measure — `enrichProductionStageCalculations()` sets
   `cracking_percentage = crackOutput / nis` where `crackOutput` is `totalqty` (or the summed slot
   totals) (`WebPortal/modules/modals/modal-production-stages/js/modal_production_stages.js:99-107`),
   i.e. `totalqty` runs at roughly 10–14% of batch NIS. Proof B makes `endqty1` the material
   *consumed* (`startqty1 − silo1`). Both cannot be definitionally true unless cracking yield were
   100%. (Note for accuracy: the reported `endqty1` and `totalqty` values are the same order of
   magnitude, so the objection is not one of scale — it is that the two proofs cannot both define the
   same field.)
4. **"`silo1` is the quantity remaining" is contradicted by the only semantic hint in this repo.**
   `modal_production_stages.js:1248` renders `silo1` as **"Silo Input"**;
   `modal-batch-history/js/modal_batch_history.js:93-95` labels the trio "Start qty" / "End qty" /
   "Silo qty". Nothing in this codebase calls `silo1` a remainder.
5. **The consumer treats cracked kg as an output.** `get_kernel_mass_balance` computes
   `balance = v_cracked − v_packed` and
   `balance_pct = round((v_packed / v_cracked) * 100, 2)`
   (`migrations/20260813092000_route_cracking_kg_through_helpers.sql:292-293`). Preferring an
   input-side field (nut-in-shell put through the cracker) there would silently change what "balance"
   and "balance_pct" mean, on top of moving their values. Any future decision must state explicitly
   whether `endqty1` is an input or an output measure; the reported evidence currently argues both.
6. **The blank-`totalqty` mechanism is still unexplained.** The claim that `totalqty` is blank
   *because* of silo carry-over is the record's existing open question #2 and is not supported by the
   code: `recalcCrackingStats()` (`modal_production_stages.js:490-497`) fills `totalqty` from
   `total_07 + total_10 + total_13` whenever `totalqty` is empty, so a blank `totalqty` implies the
   three slot totals were blank too, which needs its own explanation.
7. **A raw-vs-filtered mismatch would mislead readers.** A migration that prefers `endqty1` cannot
   exclude implausible rows (see Guardrails), so its applied effect is the **raw** figure
   (+80,955.3 reported), of which roughly 34,000 kg comes from the single `Bn 32 26 10` row. Any
   sizing quoted in the record must state the row base it was computed on, and the baseline and the
   candidate must be computed over the **same** row base.

On the slot-totals candidate (`total_07 + total_10 + total_13`): the code shows these are the
minute-test sample slots (`migrations/20260330000003_get_daily_minute_tests_auto_averages.sql` reads
`wholes_07/uncracks_07/total_07` etc. as per-slot samples) and that `recalcCrackingStats()` uses
their sum only to fill a blank `totalqty`. Record that observation, but **keep `kg_slot_totals` in
the diagnostic query** as a comparison column — it costs nothing and it is the code-supported third
candidate the record already lists.

## Work

Edit exactly one file: `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`. Keep its existing
section skeleton and its existing content wherever that content is still true; add and tighten only
what follows.

### 1. Status line

Keep the status **open**. Word it as: *open — evidence expanded, decision still pending human
verification and production-team sign-off*. Keep the existing sentences that no code change in this
repo acts on the hypothesis and that `endqty1` is not summed, referenced or preferred by any shipped
function — both remain true after this plan.

### 2. §1 — add the newly reported evidence

Extend the existing "hypothesis (reported, unverified)" section with the bullets and the carry-over
table from §1 of this plan. Preserve the existing framing verbatim in spirit: reported, unverified,
not reproducible by a reviewer, "a lead to investigate, not a finding to act on". Do not promote any
of it to a heading like "Proof".

### 3. New section — "What fails when the reported evidence is checked against this repo"

Write out all seven items from §2 of this plan, each with its file:line citation. This is the section
that stops the next reader treating the arithmetic as settled.

### 4. §2 — keep and sharpen the in-repo evidence

Keep the existing §2 as-is (the manual `<input type="number">` at
`modal_production_stages.html:48`, the absence of `endqty1` from
`modal_production_stages.js`, `recalcCrackingStats()`, the display-only use in
`modal_batch_history.js:94`, and the `docs/modules/11_Executive_Dashboard_Reporting.md:81,89`
reference). Two edits only:

- Soften the concluding sentence so it says what the code can support: the front end neither derives
  `endqty1` nor labels it, so **the code is silent on its meaning** — which is why the reported
  arithmetic is worth pursuing, and equally why it cannot be closed from code alone. Do not assert
  that "End Qty" means quantity remaining; do not assert that it means quantity processed.
- Add the `silo1` labelling evidence (`modal_production_stages.js:1248` "Silo Input";
  `modal_batch_history.js:95` "Silo qty") as a bullet, since it bears directly on Proof B.

### 5. §3 — keep the bad source row, and generalise it into an escalation list

Keep the `Bn 32 26 10` / 2026-04-23 detail (`endqty1 = 39,853` against a 12,309.3 kg batch;
`54,853 − 1,500 = 53,353 ≠ 39,853`) and keep the existing instruction not to quote 41.6%, 194,590.1
kg or 113,634.8 kg as a target or expected figure. Add the newly reported data-quality items in a
clearly headed **"Source-data problems for the production team (reported, pending verification)"**
list, each paired with the query or check that verifies it:

- 3 identity violations of 44 testable rows.
- 75 of 120 cracking day-rows carry no tonnage at all in any candidate field. Note that this, not the
  field choice, is the single biggest limit on any figure derived from cracking data — including any
  raw-material runway forecast built on it.
- 5 batches where cumulative cracked exceeds NIS received (45,185.5 kg total excess).
- 15 of 41 complete batches with no cracking rows (172,476 kg unaccounted).

Mark the whole list as reported-and-unverified, with the same caveat wording used in §1.

### 6. §4 — extend the diagnostic queries

Keep the existing month-by-month three-candidate query exactly as it is (it is good and already
carries the data-quality counters). Add two read-only queries beneath it.

**(a) Per-row verification of Proof A, Proof B and the carry-over chain** — this is what a human runs
to settle §2 items 1-3:

```sql
WITH cd AS (
  SELECT k.batch_id,
         k.wet_nis_received_kg,
         (CASE WHEN (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'      THEN (e->>'date')::date
               WHEN (e->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(e->>'date','DD/MM/YYYY')
          END)                                          AS d,
         NULLIF(TRIM(e->>'startqty1'),'')::numeric      AS startqty1,
         NULLIF(TRIM(e->>'endqty1'),'')::numeric        AS endqty1,
         NULLIF(TRIM(e->>'silo1'),'')::numeric          AS silo1,
         NULLIF(TRIM(e->>'totalqty'),'')::numeric       AS totalqty
  FROM public.kernel k
  CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(NULLIF(k.cracking_data,'null'::jsonb),'[]'::jsonb)) e
  WHERE k.is_active = true
)
SELECT batch_id, d, startqty1, endqty1, silo1, totalqty,
       (endqty1 IS NOT NULL AND totalqty IS NOT NULL AND endqty1 = totalqty)
                                                        AS a_endqty1_equals_totalqty,
       (startqty1 - COALESCE(silo1,0) = endqty1)         AS b_identity_holds,
       LAG(silo1)     OVER (PARTITION BY batch_id ORDER BY d) AS prev_day_silo1,
       (LAG(silo1)    OVER (PARTITION BY batch_id ORDER BY d) = startqty1)
                                                        AS b_carryover_holds,
       (endqty1 > wet_nis_received_kg)                   AS endqty1_exceeds_batch_nis
FROM cd
WHERE d IS NOT NULL
ORDER BY batch_id, d;
```

State what a human should look for: how many rows satisfy `a_endqty1_equals_totalqty`, how many
satisfy `b_identity_holds`, how many `b_carryover_holds` transitions exist versus fail, and whether
the two identities ever hold on the *same* row (if they routinely do, §2 item 3 needs explaining
before anything changes).

**(b) Sizing on a single, stated row base** — replaces the mixed-base 26.6%:

```sql
WITH cd AS ( /* same CTE as (a) */ )
SELECT count(*)                                                    AS rows_in_base,
       round(SUM(COALESCE(totalqty,0)),1)                          AS kg_current,
       round(SUM(COALESCE(endqty1, totalqty, 0)),1)                 AS kg_endqty1_raw,
       round(SUM(CASE
           WHEN endqty1 IS NOT NULL
            AND (wet_nis_received_kg IS NULL OR endqty1 <= wet_nis_received_kg)
            AND (startqty1 IS NULL OR silo1 IS NULL OR startqty1 - COALESCE(silo1,0) = endqty1)
           THEN endqty1 ELSE COALESCE(totalqty,0) END),1)           AS kg_endqty1_plausible_only
FROM cd
WHERE d IS NOT NULL;
```

Add an explicit warning next to it: `kg_endqty1_raw` is what a migration preferring `endqty1` would
actually produce, because the helper cannot exclude rows (see Guardrails). `kg_endqty1_plausible_only`
is a *what-if* showing how much of the uplift is data-entry error. Any percentage quoted must name
which of these it came from and must use `kg_current` from the same row base as its denominator.
Both queries are read-only (no `INSERT`/`UPDATE`/DDL) and safe against production.

### 7. §5 — keep the open questions, expand them, close none

Keep all five existing open questions. Add:

6. Is `endqty1` an **input** measure (NIS put through the cracker) or an **output** measure (kernel
   produced)? `get_kernel_mass_balance` consumes cracked kg as an output
   (`balance = cracked − packed`, `balance_pct = packed / cracked`). If the answer is "input", then
   preferring it in `kernel_day_kg` is the *wrong* fix and the mass balance needs a separate
   treatment.
7. If `endqty1` wins, what exact `COMMENT ON FUNCTION` text is defensible? It must state only claims
   that survive verification. In particular it must **not** assert "`totalqty` is left blank by the
   form whenever there is silo carry-over" unless open question #2 has been answered — a code comment
   whose purpose is to prevent future reverts must not carry an unverified causal claim.

Keep question #4 (front-end label / help text / validation) and #5 (advance communication of the
`balance_pct` drop) as **prerequisites for a future decision**, explicitly listed as human/product
actions. This plan does not perform them and does not touch the front end.

### 8. §6/§7 — apply order and human notes

Leave §6's apply order (`090000`, `091000`, `092000`) and its "migrations 2 and 3 change no reported
number" note unchanged; this plan adds no migration, so nothing is appended to that list. Keep §7(a)
(re-test the digest after migration 1) and §7(b) (the RBAC-checklist / master-migration doc drift)
unchanged, including its statement that fixing that drift is a separate human-reviewed action.

Add a short note under §7 recording, for whoever eventually flips the field: `docs/modules/
11_Executive_Dashboard_Reporting.md:81,89` documents `totalqty`/`total_qty` as the summed cracking
field, and that document — not the code — is what would need correcting at that point, as a
human-reviewed change, and **not before** the decision is made. Do not edit that file in this run.

Also record, in the same forward-looking note, what a future decision migration should look like when
it comes, so the groundwork is not lost: a new forward-only migration doing
`CREATE OR REPLACE FUNCTION public.kernel_day_kg(p_elem jsonb)` with the same signature and
`LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public`; no re-creation of the three
call sites; and any `role_permissions` re-insert written with an explicit
`WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE ...)` guard rather than
`ON CONFLICT DO NOTHING`, since that table is not known to carry a matching unique constraint.
Describe this as a sketch for a future run, not as work this plan authorises.

## Guardrails

- **You cannot apply migrations, and this plan authors none.** No database credential and no network
  path to a database exists here. Do not attempt to connect to Postgres. Do not create or modify any
  `.sql` file.
- Do not change `public.kernel_day_kg`'s coalesce order, or any other function body, in this run.
- Do not mark the investigation record resolved, and do not instruct a human to apply an `endqty1`
  preference to production.
- Do not present any reported production figure (41.6%, 194,590.1, 113,634.8, 26.6%, 41,102.3,
  154,737.1, 80,955.3) as validated, expected or target. Each must appear only as reported-unverified,
  attributed, and — where a percentage is given — with its row base named.
- Forward-only: **do not edit** `20260813091000_kernel_cracking_kg_helpers.sql`,
  `20260813092000_route_cracking_kg_through_helpers.sql`, or any other applied migration.
- Do not touch any `.js` or `.html` file.
- Do not change `get_kernel_mass_balance`'s `WHERE k.received_date BETWEEN ...` clauses. Its
  date-filter behaviour is a known, separately deferred issue and is explicitly out of scope.
- Do not add a plausibility guard inside `kernel_day_kg`. The helper receives one JSONB element and
  cannot see the batch's NIS total, so it has no basis to judge; silently dropping recorded production
  would be worse than reporting it. Bad rows are a data-correction task, not a code task. Record this
  reasoning in the doc so a future run does not try it.
- Do not edit `docs/modules/11_Executive_Dashboard_Reporting.md`,
  `docs/RBAC_NEW_FUNCTION_CHECKLIST.md`, or
  `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql`. Where those documents look
  stale, the doc being wrong is a separate human-reviewed correction, noted but not performed here.

## Out of scope

- Changing which field `kernel_day_kg` prefers.
- Any front-end label, help text or validation for "End Qty" / "Silo Qty" (prerequisite for a future
  decision, tracked as open question #4).
- The `get_kernel_mass_balance` `received_date` filter issue.
- Correcting the bad source rows in production data.
- Updating `docs/modules/11_Executive_Dashboard_Reporting.md`.

## Acceptance criteria

1. Exactly one file is modified: `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`. No `.sql`,
   `.js` or `.html` file is created, modified or deleted; no new migration exists.
2. The doc's status remains **open** (wording may note that the evidence has been expanded); it is
   not marked resolved, and it does not instruct anyone to apply an `endqty1` preference.
3. The newly reported production evidence from §1 is recorded, including the carry-over table, and
   every figure is explicitly labelled reported-and-unverified with its source named.
4. A dedicated section records all seven in-repo check failures from §2, each with a file:line
   citation — specifically including: the carry-over table's own identity break on 2026-07-24; the
   one-of-two carry-over transitions; the Proof A / Proof B incompatibility referencing
   `cracking_percentage = crackOutput / nis`; the `silo1` "Silo Input" label at
   `modal_production_stages.js:1248`; the mass balance's output-measure use of cracked kg at
   `migrations/20260813092000_route_cracking_kg_through_helpers.sql:292-293`; the unexplained blank
   `totalqty` versus `recalcCrackingStats()`; and the raw-vs-filtered sizing mismatch.
5. §4 contains the original month-by-month query unchanged plus the two new read-only queries
   (per-row verification, and same-row-base sizing), with the warning that a migration preferring
   `endqty1` would deliver the **raw** uplift, not the filtered one.
6. The source-data escalation list is present, marked reported-pending-verification, and retains the
   `Bn 32 26 10` detail.
7. All five original open questions are retained and none is marked answered; questions 6 (input vs
   output measure) and 7 (defensible `COMMENT` text) are added; questions 4 and 5 are restated as
   prerequisites for a future decision and as human actions, not work done here.
8. No figure is presented anywhere as an expected, target or validated result — including 41.6% and
   26.6%.
9. `npm run test:fleet` passes.
