# Resolve the kg-cracked field question: prefer `endqty1`

## Context

`migrations/20260813091000_kernel_cracking_kg_helpers.sql` centralised the cracking-kg expression
into `public.kernel_day_kg(jsonb)` but deliberately changed no behaviour, recording the choice of
field as an open question in `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`. That was a
reasonable call: the previous run had no database access and could only reason from the front-end
code, which genuinely does not show `endqty1` being derived from anything.

**This plan resolves the question.** The evidence below comes from arithmetic in the production
data itself — the thing the previous run could not reach — and it is decisive. The change is one
line in one function, precisely because the refactor already landed.

Read `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md` first. Its §2 argues `endqty1` may mean
"quantity remaining at end of shift" rather than "quantity processed". **§1 and §2 of this plan
answer that argument directly.** Do not re-litigate it from the front-end code — the code is silent
on the question and the data is not.

## 1. Why `endqty1` is the processed quantity — the two proofs

### Proof A: `endqty1` equals `totalqty` whenever both are filled

Over all 120 cracking day-rows in production: both fields are populated on 31 rows, and on **30 of
those 31 they are equal**.

`totalqty` is definitionally *processed output* — the stored `cracking_percentage` is
`totalqty ÷ batch NIS received`, verified numerically on batch `Bn 44 26 42`
(`6900 / 50000 = 13.8%`, `6263 / 50000 = 12.5%`, `5000 / 50000 = 10%`, `5500 / 50000 = 11%`, each
matching the stored `cracking_percentage` exactly).

If `endqty1` meant *quantity remaining at end of shift*, it would essentially never equal that day's
processed quantity. Agreement on 97% of rows where both exist means the two fields measure the same
thing. This alone refutes the "remaining" reading.

### Proof B: the silo carry-over chain

On batch `Bn 44 26 42`:

| date | `startqty1` | `silo1` | `endqty1` |
|---|---|---|---|
| 2026-07-22 | 6000 | 1500 | 4500 |
| 2026-07-23 | 5100 | 1200 | 3900 |
| 2026-07-24 | 1200 | 0 | 1000 |

2026-07-23 closes with `silo1 = 1200`; 2026-07-24 opens with `startqty1 = 1200`. **Carry-over out
equals the next day's opening stock.** So `silo1` is the quantity remaining, which means
`endqty1 = startqty1 − silo1` is the quantity consumed. Were `endqty1` the remainder, it would equal
`silo1` — and it does not, on any row.

The identity `startqty1 − silo1 = endqty1` holds on **41 of 44** testable rows.

### On the objection that `endqty1` is a manual input

Correct, and irrelevant. `ps_crack_endqty1` is a plain `<input type="number">` and no JS derives it —
the operator types it. A manually captured field can still be the authoritative measurement; that
the form does not compute it says nothing about what it means. The investigation doc infers semantics
from the *absence* of code, which is weaker than the arithmetic above.

### On the slot-totals candidate (`total_07 + total_10 + total_13`)

Raised in the investigation doc's §4 as a third option. It is not a candidate for daily throughput:
those three fields are the **minute-test quality samples** (see `get_daily_minute_tests`, which reads
`wholes_07/10/13`, `uncracks_07/10/13`, `total_07/10/13` as sample slots). `recalcCrackingStats()`
falls back to their sum only to populate `totalqty` when the operator left it blank — it is a
gap-filler for the same measure, not a different one. Keep it out of `kernel_day_kg`.

## 2. Honest sizing of the correction — do not repeat the contaminated headline

The investigation doc is **right** that 41.6% must not be quoted, and this plan does not reinstate it.
Batch `Bn 32 26 10` records `endqty1 = 39,853` on 2026-04-23 against a batch of 12,309.3 kg — 3.2× the
whole batch, physically impossible, and one of the three rows where the identity fails
(`54,853 − 1,500 = 53,353 ≠ 39,853`).

Measured on production, excluding every row that is either implausible (`endqty1 > batch NIS`) or
fails the `startqty1 − silo1 = endqty1` identity:

| | kg |
|---|---|
| current (`totalqty`) | 113,634.8 |
| with `endqty1` preferred, bad rows excluded | **154,737.1** |
| **defensible under-count** | **+41,102.3 kg (26.6%)** |

For comparison, including the bad rows gives 194,590.1 / +80,955.3 — roughly half the uplift comes
from data-entry errors. **26.6% is the figure to quote.** The uplift's real source is the 13 rows
where `endqty1` is filled and `totalqty` is blank; excluding the bad ones, those average 3,160 kg/day,
squarely within normal daily cracking range.

The fix is still clearly right, and the correction is still large. It is simply half the size the
first analysis claimed.

## Work

### 1. `migrations/20260813093000_kernel_day_kg_prefer_endqty1.sql`

`CREATE OR REPLACE FUNCTION public.kernel_day_kg(p_elem jsonb)` — identical to the current
definition in `migrations/20260813091000_kernel_cracking_kg_helpers.sql` except that `endqty1`
becomes the **first** coalesce arm:

```sql
  SELECT COALESCE(
      NULLIF(TRIM(p_elem ->> 'endqty1'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'totalqty'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'total_qty'), '')::numeric,
      0)::numeric;
```

Keep the existing signature, `LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public`,
and the trailing `total_qty` arm (it is present on 0 of 120 rows, so it is inert — leaving it in keeps
this diff to a single added line).

Because all three call sites already route through this helper
(`migrations/20260813092000_route_cracking_kg_through_helpers.sql`), this one function is the entire
behavioural change. **Do not re-create `get_dashboard_kernel_stats`,
`get_production_trends_daily`, or `get_kernel_mass_balance`** — they need no edit, and touching them
would obscure the diff.

Replace the `COMMENT ON FUNCTION` with one that states the decision and its basis: `endqty1` is the
kg of nut-in-shell put through the cracker that day; it takes precedence because `totalqty` is left
blank by the form whenever there is silo carry-over; the evidence is the `endqty1 = totalqty`
agreement on 30/31 rows and the `silo1(day N) = startqty1(day N+1)` carry-over chain. Point at the
investigation doc for the full record. The point of the comment is that nobody reverts this to
`totalqty` in six months.

Include the RBAC `DO` block and `NOTIFY pgrst, 'reload schema';` as the previous migration did.

### 2. Rewrite `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`

Change its status from open to resolved, and restructure it as a decision record:

- **The decision** and the two proofs from §1 above, written out with the batch/date/value tables so
  a reader can check them without database access.
- **An explicit correction of the earlier §2.** Keep the observation that the front end never derives
  `endqty1` — it is true and useful — but record that it does not settle the question, and that the
  arithmetic does. Remove the "quantity remaining at end of shift" reading, noting it is refuted by
  `endqty1 ≠ silo1` and by the carry-over chain.
- **Retire the slot-totals candidate** with the reason from §1 (minute-test sample slots, not
  throughput).
- **The corrected sizing:** +41,102.3 kg / **26.6%**, bad rows excluded, as the quotable figure.
  State plainly that the previously reported 41.6% / 194,590.1 kg was contaminated by data-entry
  errors and must not be used. Retain the `Bn 32 26 10` detail.
- **The apply/verify runbook**, keeping the existing read-only diagnostic query (it is good — it
  compares candidates side by side) and adding the bad-row exclusion so the human sees both the raw
  and defensible numbers.
- **What changes for users when this is applied:** "Kg cracked today / this week" tiles, Production
  Trends, the mass balance and the daily digest all step up. Worth warning the people who read those
  tiles before they see it.

### 3. Escalation note for the production team

In the same doc, a short section listing the source-data problems that need human correction, since
the fix cannot resolve them:

- `Bn 32 26 10`, 2026-04-23: `endqty1 = 39,853` against a 12,309.3 kg batch, and
  `startqty1 − silo1 = 53,353 ≠ 39,853`. Needs re-keying.
- 3 identity violations of 44 testable rows.
- **75 of 120 cracking day-rows carry no tonnage at all** in any candidate field. This is the single
  biggest limit on any figure derived from cracking data, including the raw-material runway forecast
  this work is heading toward.
- 5 batches where cumulative cracked exceeds NIS received (45,185.5 kg total excess).
- 15 of 41 complete batches have no cracking rows (172,476 kg unaccounted).

## Guardrails

- **You cannot apply migrations.** No database credential and no network path to a database exists
  here. Author the file; a human applies it with `npm run db:apply`. Do not attempt to connect to
  Postgres and do not treat "unapplied" as failure.
- Forward-only: **do not edit** `20260813091000_kernel_cracking_kg_helpers.sql` or any other applied
  migration. This is a new migration that supersedes the helper body.
- Do not touch any `.js` or `.html` file.
- Do not change `get_kernel_mass_balance`'s `WHERE k.received_date BETWEEN ...` clauses. Its
  date-filter behaviour is a known, separately deferred issue and is explicitly out of scope.
- Do not add a plausibility guard inside `kernel_day_kg` to suppress rows like `Bn 32 26 10`. The
  helper receives only one JSONB element and cannot see the batch's NIS total, so it has no basis to
  judge — and silently dropping recorded production would be worse than reporting it. The bad row is
  a data-correction task, not a code task.

## Acceptance criteria

1. One new migration, `migrations/20260813093000_kernel_day_kg_prefer_endqty1.sql`.
2. `kernel_day_kg`'s coalesce reads `endqty1`, then `totalqty`, then `total_qty`, then `0` — in that
   order.
3. **No other function is re-created**; the three call sites are untouched.
4. The function's `COMMENT` states the decision and cites both proofs.
5. RBAC `DO` block and `NOTIFY pgrst, 'reload schema';` present.
6. `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md` is marked resolved, carries both proofs,
   explicitly retires the 41.6% figure in favour of 26.6%, and keeps the production-team escalation
   list.
7. The string `41.6%` does not appear anywhere as an expected or target figure.
8. `npm run test:fleet` passes. No `.js`, `.html`, or `.sql` file other than the new migration is
   modified.
