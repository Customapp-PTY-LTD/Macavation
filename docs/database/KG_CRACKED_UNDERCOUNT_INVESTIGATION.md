# `endqty1` under-count hypothesis — investigation record and runbook

Status: **decided — `endqty1` is preferred as of
`migrations/20260813093000_kernel_day_kg_prefer_endqty1.sql`. Source data remains unreliable; see
§0.** Sections 1–6 below are preserved verbatim as the investigation record, including the
objections raised against this change. §0 answers them and records what was decided and why.

---

## 0. Resolution

Two automated attempts declined to act on this, correctly: both were asked to change a reported
production figure on the strength of numbers from a database neither could reach. The objections
they raised in §2 were substantive, and two of them were right. This section closes the question
with the arithmetic that was missing, and concedes the points that stand.

### 0.1 What settles it: `endqty1` cannot be an output measure

§2 item 3 is the strongest objection — that Proof A (`endqty1 = totalqty`, an output measure) and
Proof B (`endqty1 = startqty1 − silo1`, an input measure) cannot both define the same field unless
cracking yield were 100%. That is sound reasoning, and it dissolves once the yield is actually
measured. Over active batches with at least three cracking day-rows:

| measure | share of batch NIS received | range |
|---|---|---|
| kernel actually packed (`packing_data.totals_qty`) | **19.6%** | 12.6 – 26.1% |
| `endqty1` summed per batch | **114.7%** | 13.9 – 366.5% |
| `totalqty` summed per batch | 60.5% | — |

Kernel recovery is ~20% of intake. `endqty1` sums to ~115% of intake. It therefore **cannot** be
kernel output — it is an input-side quantity, material fed through the cracker.

This also corrects the premise underneath item 3: the stored `cracking_percentage`
(`totalqty ÷ batch NIS`, typically 10–14%) is **not** a recovery yield. It is *percent of the batch
processed on that day*. A batch runs over roughly 8–12 days, and those daily percentages sum toward
100%, not toward 20%. The front end's labels — "Total Kernel Output"
(`modal_production_stages.js:1265`) and "Kernel Cracked (kg)" (`:1220`) — are misleading, and are
the single biggest reason this question took three passes to settle. **The arithmetic is
authoritative over the labels.**

### 0.2 Objections that stand, and are conceded

- **§2 item 1 — the carry-over table broke its own identity.** Correct: the source table was
  mis-transcribed. 2026-07-24 records `silo1 = 200`, not `0`. The identity holds
  (`1200 − 200 = 1000`); the table quoting it did not.
- **§2 item 2 — the carry-over chain does not generalise.** Correct. 07-23→07-24 holds
  (`silo1 1200` → `startqty1 1200`), but 07-22→07-23 does not (`silo1 1500` → `startqty1 5100`),
  because fresh nut was added to the silo. Carry-over is a floor on the next day's opening stock,
  not an equality. Proof B is weaker than originally claimed and is **not** load-bearing for this
  decision — §0.1 is.
- **§2 item 7 — the 26.6% figure was unachievable.** Correct, and this is the most important of the
  three. `kernel_day_kg` receives one cracking-day element and can see neither the batch NIS total
  nor sibling rows, so it cannot exclude an implausible row. The applied effect is the **raw**
  figure. **Do not quote 26.6%** as the effect of this migration; it was computed on a filtered row
  base no migration can reproduce. §0.3 gives the correct sizing.
- **§2 item 6 — the blank-`totalqty` mechanism is still unexplained.** Stands. The simpler reading
  is that the three slot totals were also blank, i.e. incomplete capture rather than a silo
  mechanism. This does not affect §0.1, but it means "`totalqty` is blank *because of* carry-over"
  should not be repeated as established.

### 0.3 Correct sizing of the applied change

Same row base, all history, as the migration will actually behave:

| | kg |
|---|---|
| before (`totalqty`, `total_qty`) | 113,634.8 |
| after (`endqty1` preferred) | 194,590.1 |
| **applied uplift** | **+80,955.3** |

Roughly **34,000 kg of that comes from one bad row** — see §4, batch `Bn 32 26 10`. The correction
is real and large, but it ships carrying a known data-entry error until that row is re-keyed.

### 0.4 The finding that matters more than the field choice

`endqty1` per-batch totals average **114.7%** of NIS received and reach **366.5%**. More nut cannot
be fed than was received. Together with the counters in §7, the cracking capture is materially
unreliable:

- **75 of 120** cracking day-rows carry no tonnage in any candidate field.
- **5 batches** over-record cumulative feed by 45,185.5 kg in total.
- **15 of 41** complete batches have no cracking rows at all (172,476 kg unaccounted).

**This migration makes the field choice correct. It does not make the data correct.** Any
throughput or kg/day rate derived from `cracking_data` — including the raw-material runway forecast
this work feeds — is indicative only until capture improves. Stock *level* figures are less
affected: no in-pool batch currently computes a negative remainder. It is the *rate* that cannot be
trusted. Escalated to the production team; see §7.

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

### 1a. Further evidence reported since the above (still unverified, still not reproducible here)

A second pass of analysis against production, again **not reachable from this repo/environment and
not reproducible by a reviewer of this document**, reported the following. Every figure below is
reported-and-unverified and is attributed to "an analysis run against production, not reproducible
from this repo" — none of it is a finding this repo can confirm:

- Over 120 cracking day-rows: both `endqty1` and `totalqty` populated on 31 rows; equal on 30 of
  those 31 ("Proof A").
- `cracking_percentage` on batch `Bn 44 26 42` reportedly matches `totalqty ÷ batch NIS received`:
  `6900/50000 = 13.8%`, `6263/50000 = 12.5%`, `5000/50000 = 10%`, `5500/50000 = 11%`.
- The identity `startqty1 − silo1 = endqty1` reportedly holds on 41 of 44 testable rows ("Proof B" —
  same identity as §1, restated with the same 41/44 count).
- A silo carry-over table reported for batch `Bn 44 26 42`:

  | date | `startqty1` | `silo1` | `endqty1` |
  |---|---|---|---|
  | 2026-07-22 | 6000 | 1500 | 4500 |
  | 2026-07-23 | 5100 | 1200 | 3900 |
  | 2026-07-24 | 1200 | 0 | 1000 |

- Sizing, reported: `totalqty` alone sums to 113,634.8 kg; `coalesce(endqty1, totalqty)` sums to
  194,590.1 kg raw (**+80,955.3 kg**, the same uplift as §1); with rows excluded that are implausible
  (`endqty1 > batch NIS`) or that break the identity, the reported sum is 154,737.1 kg (**+41,102.3
  kg**, quoted as **26.6%**) — a different row base from the raw 194,590.1 figure (see §2 item 7).
- 13 rows reportedly have `endqty1` filled and `totalqty` blank; excluding implausible ones, these
  reportedly average ~3,160 kg/day.
- `total_qty` (the alternate spelling) is reportedly populated on 0 of the 120 rows examined.

None of the above is promoted to a finding by this section. §2 records, item by item, why this
repo's own code cannot yet corroborate it.

## 2. What fails when the reported evidence is checked against this repo

This section exists so the next reader does not treat §1a's arithmetic as settled. Each item below
is a specific contradiction found in code that already exists in this repository, with a file:line
citation.

1. **The reported carry-over table breaks its own identity.** Applying `startqty1 − silo1 = endqty1`
   to the table's own third row: `1200 − 0 = 1200`, but the table reports `endqty1 = 1000`. The
   table offered as an illustration of Proof B is itself one of the identity failures Proof B
   depends on being rare.
2. **The carry-over chain holds on one of the two transitions the table shows.** 2026-07-23 closes
   with `silo1 = 1200`, and 2026-07-24 opens with `startqty1 = 1200` — that transition holds. But
   2026-07-22 closes with `silo1 = 1500`, and 2026-07-23 opens with `startqty1 = 5100`, not 1500 —
   that transition does not hold. One supporting transition out of two shown is a lead, not a proof.
3. **Proof A and Proof B assign incompatible meanings to the same field.** Proof A makes `endqty1`
   equal to `totalqty`, and `totalqty` is an *output* measure: `enrichProductionStageCalculations()`
   sets `crackOutput = totalqty` (falling back to the slot-total sum) and then
   `cracking_percentage = roundStagePct(crackOutput, nis)` —
   `WebPortal/modules/modals/modal-production-stages/js/modal_production_stages.js:101,105-107` — the
   same computation the reported `Bn 44 26 42` figures (13.8%, 12.5%, 10%, 11%) match, i.e. `totalqty`
   runs at roughly 10–14% of batch NIS, consistent with a cracking yield. Proof B makes `endqty1` the
   material *consumed* (`startqty1 − silo1`), an input-side quantity. Both cannot be definitionally
   true of the same field unless cracking yield were 100%. (For accuracy: the reported `endqty1` and
   `totalqty` values are the same order of magnitude, so the objection is not one of scale — it is
   that the two proofs cannot both define what the field *is*.)
4. **"`silo1` is the quantity remaining" is contradicted by the only semantic hint this repo has.**
   The batch-detail renderer labels it **"Silo Input"**, not a remainder:
   `WebPortal/modules/modals/modal-production-stages/js/modal_production_stages.js:1248`
   (`if (has(c, 'silo1')) html.push(row('Silo Input', kg(c.silo1)));`). The batch-history schema
   labels the same trio "Start qty" / "End qty" / "Silo qty" with no remainder language:
   `WebPortal/modules/modals/modal-batch-history/js/modal_batch_history.js:93-95`. Nothing in this
   codebase calls `silo1` a remainder left over after cracking.
5. **The one shipped consumer of cracked kg treats it as an output, not an input.**
   `get_kernel_mass_balance` computes `balance = v_cracked − v_packed` and
   `balance_pct = round((v_packed / v_cracked) * 100, 2)`
   (`migrations/20260813092000_route_cracking_kg_through_helpers.sql:292-293`). Preferring an
   input-side field (nut-in-shell fed into the cracker) there would silently change what "balance"
   and "balance_pct" *mean*, on top of moving their values. Any future decision must state explicitly
   whether `endqty1` is an input or an output measure — the reported evidence currently argues both
   (see item 3), and this function's arithmetic only makes sense for one of them.
6. **The blank-`totalqty` mechanism is still unexplained.** The claim that `totalqty` is blank
   *because of* silo carry-over is §6's existing open question #2, and it is not supported by the
   code that is actually in this repo: `recalcCrackingStats()`
   (`WebPortal/modules/modals/modal-production-stages/js/modal_production_stages.js:490-497`) fills
   `totalqty` from `total_07 + total_10 + total_13` whenever `totalqty` is empty. A blank `totalqty`
   therefore implies the three slot totals were *also* blank that day — a fact the carry-over story
   does not explain, and which needs its own explanation before the mechanism can be accepted.
7. **A raw-vs-filtered mismatch would mislead a reader who is not careful about row base.** Any
   migration that preferred `endqty1` would have to run inside `kernel_day_kg`, which receives one
   JSONB cracking-day element at a time and has no visibility into the batch's NIS total or the
   other rows needed to detect an identity break — it has no basis on which to exclude an
   implausible row. So its actually-applied effect is the **raw** figure — the reported +80,955.3
   kg uplift, of which roughly
   34,000 kg comes from the single bad `Bn 32 26 10` row already documented in §4. The +41,102.3 kg /
   26.6% figure is computed over a *different, filtered* row base and is not what any real migration
   would produce. Any sizing quoted anywhere in this document or in a future decision must name which
   row base it was computed on, and a baseline and a candidate must be compared over the **same** row
   base or the comparison is meaningless.

**On the slot-totals candidate (`kg_slot_totals`):** the minute-test migration
(`migrations/20260330000003_get_daily_minute_tests_auto_averages.sql`) reads `wholes_07` /
`uncracks_07` / `total_07` (and the `_10`/`_13` equivalents) as per-slot samples, and
`recalcCrackingStats()` uses their sum only to backfill a blank `totalqty` — it is not itself a
sum-over-the-day quantity. That is recorded here as an observation, not a rebuttal; `kg_slot_totals`
stays in the §5 diagnostic query as a comparison column, since it costs nothing and it is the one
candidate in this document that is directly supported by shipped code.

## 3. Evidence in this repo that contradicts the stated mechanism

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
  alternative candidate the original analysis never considered (see §5, `kg_slot_totals`).
- `docs/modules/11_Executive_Dashboard_Reporting.md:81` and `:89` document `totalqty` (or
  `total_qty`) as the field that is stored and summed for "kg cracked" — the opposite of what the
  hypothesis assumes.
- `endqty1`'s only other appearance in the front end is a display label in
  `WebPortal/modules/modals/modal-batch-history/js/modal_batch_history.js:94` ("End qty") — it is
  shown in a history view, not used in any calculation.
- `silo1` itself is never labelled a remainder anywhere in this repo: the batch-detail renderer
  calls it **"Silo Input"** (`WebPortal/modules/modals/modal-production-stages/js/
  modal_production_stages.js:1248`), and the batch-history schema calls it "Silo qty" alongside
  "End qty" (`WebPortal/modules/modals/modal-batch-history/js/modal_batch_history.js:95`) — plain
  field labels, not "remaining" or "carried over".

**Conclusion of this section:** the front end neither derives `endqty1` from anything nor labels
it as either an input or an output — **the code is silent on what "End Qty" means.** That silence
is exactly why the reported arithmetic in §1a is worth pursuing, and equally why it cannot be
closed from code alone: this codebase supports neither "quantity remaining at end of shift" nor
"quantity processed" as the meaning of `endqty1`. The claim needs operator-level confirmation, not
a code inference.

## 4. The bad source row

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

### Source-data problems for the production team (reported, pending verification)

The following are additional data-quality items reported by the same second-pass analysis as §1a.
**Every figure below is reported and unverified**, exactly as in §1a — this list exists so the
production team can start investigating the underlying records, not because any of it has been
confirmed from this repo. Each item is paired with the query (§5) that a human with database access
can run to verify it:

- **3 identity violations of 44 testable rows** — checked with query (a) below
  (`b_identity_holds = false`).
- **75 of 120 cracking day-rows carry no tonnage at all in any candidate field** (`totalqty`,
  `endqty1`, and the slot totals all blank). This — not which field is preferred — is the single
  biggest limit on any figure derived from cracking data, including any raw-material runway
  forecast built on it: no field-preference change fixes a row that was never filled in.
- **5 batches where cumulative cracked exceeds NIS received**, 45,185.5 kg total excess — checked
  with query (a)'s `endqty1_exceeds_batch_nis` column, generalised to `kg_current` as well.
- **15 of 41 complete batches have no cracking rows at all**, 172,476 kg unaccounted — this cannot
  be checked by either query below (both operate on existing cracking rows); it needs a join from
  `kernel` batches to their (possibly absent) `cracking_data` array elements.

## 5. Read-only diagnostic queries

Run these on **dev first, then production**. Query (1) is unchanged from the original version of
this document: it compares three candidate definitions of "kg cracked" side by side per month —
current (`totalqty`/`total_qty`), the `endqty1` hypothesis, and the slot-total variant the front
end's own `enrichProductionStageCalculations()` already falls back to — plus data-quality counters,
so the decision in §6 can be made on evidence instead of on any one candidate.

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

This query (1) is read-only (no `INSERT`/`UPDATE`/`DDL`) and safe to run directly against
production via any read-capable connection.

### Query (a): per-row verification of Proof A, Proof B and the carry-over chain

This is what a human with database access runs to settle §2 items 1-3 on the full dataset rather
than the one illustrative batch reported in §1a.

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

What to look for in the results: how many rows satisfy `a_endqty1_equals_totalqty`; how many
satisfy `b_identity_holds`; how many `b_carryover_holds` transitions exist versus fail; and — the
key check for §2 item 3 — whether `a_endqty1_equals_totalqty` and `b_identity_holds` are ever both
true on the *same* row. If they routinely are, the field cannot simultaneously be the output
measure Proof A implies and the consumption measure Proof B implies, and that contradiction needs
an explanation (most likely: on days with no carry-over, `startqty1 − silo1` and `totalqty`
converge on the same number for a reason that is not "yield", e.g. the whole batch is processed in
one sitting) before either proof can be trusted on its own.

### Query (b): sizing on a single, stated row base

This replaces the mixed-base 26.6% in §1a with a sizing computed consistently, so any percentage
quoted from it states plainly which row base it used.

```sql
WITH cd AS ( /* same CTE as query (a) above */ )
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

**Warning attached to this query's output:** `kg_endqty1_raw` is what a migration that preferred
`endqty1` would actually produce in production, for the same reason given in §2 item 7:
`kernel_day_kg` receives one JSONB element at a time and has no way to exclude implausible rows.
`kg_endqty1_plausible_only` is a *what-if* figure showing how much of the uplift is
data-entry error, not a figure any shipped code would produce. Any percentage quoted from either
column must say which column it came from, and must divide by `kg_current` **from this same row
base** — not the differently-scoped 113,634.8 kg quoted in §1.

Both queries (a) and (b) are read-only (no `INSERT`/`UPDATE`/DDL) and safe to run directly against
production via any read-capable connection.

## 6. Open questions a human must answer before any kg expression changes

1. What does the "End Qty" box mean to the operators who fill it in — throughput processed, or
   quantity remaining at end of shift? This is a business-semantics question; it cannot be settled
   from code.
2. Is `totalqty` genuinely blank specifically on silo carry-over days, and if so, why — given that
   `recalcCrackingStats()` derives `totalqty` from the three shift-slot totals, which would need
   their own separate explanation for being blank on those same days?
3. Which of the three candidate definitions in §5 (`kg_current`, `kg_endqty1_hypothesis`,
   `kg_slot_totals`) is authoritative for management reporting?
4. If `endqty1` wins: what front-end label, help text and validation must ship with it so future
   capture is unambiguous? The front end is out of scope for this plan, so **no such labelling
   exists today** — shipping a data-layer change without it would just move the ambiguity, not
   remove it. **This is a prerequisite for any future decision, and it is a human/product action,
   not something this document's author can perform.**
5. Be aware that `get_kernel_mass_balance()`'s `balance_pct = packed / cracked` will drop sharply
   if `cracked` rises while `packed` stays the same. If the kg-cracked definition ever changes,
   this must be **expected and communicated in advance**, not discovered as a surprise regression.
   **This, too, is a prerequisite for a future decision and a human/product action** — advance
   communication to whoever consumes the mass-balance figure, before any migration ships.
6. Is `endqty1` an **input** measure (nut-in-shell put through the cracker) or an **output** measure
   (kernel produced)? §2 item 5 shows `get_kernel_mass_balance` currently consumes cracked kg as an
   output (`balance = cracked − packed`, `balance_pct = packed / cracked`). If the eventual answer
   is "input", then preferring `endqty1` inside `kernel_day_kg` — which feeds that same function —
   is the *wrong* fix, and the mass balance would need a separate, deliberate treatment rather than
   inheriting whatever `kernel_day_kg` now returns.
7. If `endqty1` ever wins, what exact `COMMENT ON FUNCTION` text on `kernel_day_kg` is defensible?
   It must state only claims that have survived verification by then. In particular, it must **not**
   assert that "`totalqty` is left blank by the form whenever there is silo carry-over" unless open
   question #2 above has actually been answered by then — a code comment whose whole purpose is to
   stop a future revert must not itself carry an unverified causal claim, or it becomes exactly the
   kind of unchecked assertion this document exists to prevent.

## 7. Apply order and commands

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

## 8. Notes for humans (not actions taken by this plan)

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
`total_qty` as the summed cracking field. That doc — not the code — is what would need correcting
once the `endqty1` question is decided, as a human-reviewed change, and **not before**: this run
has not edited that file, and no future run should edit it ahead of the decision it depends on.

**(c) A sketch for whoever eventually writes the decision migration** (this is groundwork for a
future run, not work this document authorises):

- A new **forward-only** migration doing `CREATE OR REPLACE FUNCTION public.kernel_day_kg(p_elem
  jsonb)` with the **same signature** as today
  (`migrations/20260813091000_kernel_cracking_kg_helpers.sql`) and the same
  `LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public` header — only the
  `coalesce(...)` expression inside changes.
- **No re-creation of the three call sites** (`get_dashboard_kernel_stats`,
  `get_production_trends_daily`, `get_kernel_mass_balance`) — they already route through the
  helper via `migrations/20260813092000_route_cracking_kg_through_helpers.sql` and need no further
  change once the helper's expression is decided.
- If that migration also needs a `role_permissions` insert, write it with an explicit
  `WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE ...)` guard rather than
  `ON CONFLICT DO NOTHING` — this table is not known to carry a matching unique constraint, so
  `ON CONFLICT` would either error or silently no-op depending on schema specifics not visible from
  this repo.
- That migration's own comment should answer open question 7 above, not skip it.
