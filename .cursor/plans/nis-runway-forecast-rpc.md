---
depends_on: nis-cracked-kg-undercount-fix
---

# Raw material runway forecast — the RPC

## Context

Procurement needs to know **when the plant runs out of nut-in-shell (NIS) to crack**. There is no
such figure anywhere in the system today. This plan authors the SQL that produces it: one function
returning a daily series of "kg of NIS not yet put into production", actual up to today and
projected forward to the predicted run-out date.

A front-end chart consumes this in a follow-up plan (`nis-runway-forecast-chart`). Nothing in this
plan is user-visible, so it can land safely on its own.

**Uses two helpers that already exist in `migrations/`:** `public.kernel_day_kg(jsonb)` (kg of NIS
cracked on a cracking-data day) and `public.kernel_day_date(jsonb)` (parses the two date formats in
use). Both were created by `migrations/20260813091000_kernel_cracking_kg_helpers.sql` and every
existing call site was routed through them by
`migrations/20260813092000_route_cracking_kg_through_helpers.sql`.

**Call these helpers. Do not re-inline their expressions, and do not modify them.** Which field
`kernel_day_kg` prefers was settled separately in
`migrations/20260813093000_kernel_day_kg_prefer_endqty1.sql` — that decision and its evidence are
recorded in `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md` §0. It is out of scope here and
must not be revisited: this plan is agnostic to it, because it only ever calls the helper.

### Read this before trusting any rate this function produces

`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md` §0.4 records that the cracking capture is
materially unreliable: `endqty1` per-batch totals average **114.7% of NIS received** and reach 366%
(more nut than was received), 75 of 120 day-rows carry no tonnage, and 5 batches over-record by
45,185.5 kg. The product owner has decided to proceed regardless.

That decision is respected here, but it must be **visible in the output, not buried**: the function
reports data-quality warnings (see the warnings list below) so the chart can tell the reader the
projection is indicative. Stock *levels* are far less affected than the *rate* — no in-pool batch
currently computes a negative remainder. Do not add silent corrections, plausibility filters or
smoothing to compensate; report and let the caller decide.

**You cannot apply migrations.** No database credential and no network path to a database exists in
this environment. Author the files only; a human applies them with `npm run db:apply`. Do not try to
connect to Postgres and do not treat "unapplied" as a failure.

## The domain, verified against production

`public.kernel` is one row per batch. Relevant columns: `status` (CHECK: `intake`, `receiving`,
`production`, `qa`, `dispatch`, `complete`), `wet_nis_received_kg`, `actual_wet_nis_kg`,
`received_date`, `production_finished_at`, `is_active`, `cracking_data jsonb` (an **array**, one
element per production day).

Per batch: `nis_kg = coalesce(actual_wet_nis_kg, wet_nis_received_kg, 0)`, and
`cracked_kg = Σ public.kernel_day_kg(elem)` over its cracking-data elements.

The **uncracked pool** is batches with `status IN ('intake','receiving','production')`. Current
production position, which your function must reproduce exactly:

| | batches | NIS kg | cracked kg | remaining |
|---|---|---|---|---|
| `intake` | 1 | 4,634.5 | 0 | 4,634.5 |
| `production` | 5 | 245,110.5 | 47,499.3 | 197,611.2 |
| **pool total** | | | | **202,245.7** |

Rate, over a trailing 90 days: 120,669.3 kg across **27 production days** = **4,469.2
kg/production-day**, i.e. an observed cadence of **2.1 production days/week**. Cracking happens
Mon–Fri only — zero weekend day-rows in all of history. These are the figures the function should
reproduce once `20260813093000` is applied; they are a correctness check on the arithmetic, **not** a
claim that the underlying capture is sound (see the warning above).

`public.kernel_intake_procurement` is the procurement calendar: `scheduled_date`,
`predicted_weight_kg`, `status` (CHECK: `scheduled`, `converted`, `cancelled`), `batch_id`. **It has
0 rows on production**, so the function must degrade gracefully and say so rather than look broken.

## Work

### 1. `migrations/20260813100000_get_nis_runway_forecast.sql`

```sql
CREATE OR REPLACE FUNCTION public.get_nis_runway_forecast(
    p_history_days             integer DEFAULT 365,
    p_rate_window_days         integer DEFAULT 90,
    p_kg_per_production_day    numeric DEFAULT NULL,
    p_production_days_per_week numeric DEFAULT NULL,
    p_max_forecast_days        integer DEFAULT 730,
    p_include_procurement      boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
```

`RETURNS jsonb`, **not `RETURNS TABLE`** — deliberate. The scalars (run-out date, effective rate,
override provenance, warnings) must be computed from the same pool and rate as the series, in one
round trip. It also avoids two known traps in this repo: adding a column to a `RETURNS TABLE`
function needs `DROP FUNCTION` first (see
`migrations/20260707170000_drop_resurrected_function_overloads.sql`), and an OUT parameter colliding
with a column name required the fix in
`migrations/20260713161000_fix_get_stock_soh_history_ambiguous_series.sql`. With no OUT params,
neither can happen.

Timezone: `v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;` — the
convention everywhere in this repo.

Parameter clamps: `p_history_days` → `[7, 1826]`; `p_rate_window_days` → `[14, 730]`;
`p_max_forecast_days` → `[7, 1826]`.

#### Return shape

```jsonc
{
  "meta": {
    "today": "2026-08-03", "timezone": "Africa/Johannesburg",
    "history_start": "...", "history_end": "...",
    "pool_kg": 202245.70,
    "pool_awaiting_production_kg": 4634.50,
    "pool_in_production_remaining_kg": 197611.20,
    "scheduled_procurement_future_kg": 0,
    "scheduled_procurement_overdue_kg": 0,
    "rate_window_days": 90,
    "production_days_in_window": 27,
    "kg_cracked_in_window": 120669.30,
    "kg_per_production_day": 4469.20,
    "kg_per_production_day_calculated": 4469.20,
    "kg_per_production_day_source": "calculated",   // parameter|override|calculated|none
    "production_days_per_week": 2.1,
    "production_days_per_week_observed": 2.1,
    "production_days_per_week_source": "calculated", // parameter|override|calculated|default
    "kg_per_week": 9385.32,
    "run_out_date": "2027-01-04",
    "days_to_run_out": 154,
    "forecast_end": "2027-01-04",
    "forecast_truncated": false,
    "history_has_negative_days": 8,
    "warnings": ["procurement_calendar_empty"]
  },
  "points": [
    { "d": "2026-08-03", "qty_kg": 202245.70, "is_forecast": false,
      "intake_kg": 0, "cracked_kg": 0, "reconciled_kg": 0 }
  ]
}
```

`points` is one continuous **ascending, gap-free daily** array: history `history_start..today`
(`is_forecast=false`), then forecast `today+1..forecast_end` (`is_forecast=true`).

> **Every calendar day must be present, including weekends and idle days.** The chart consumes this
> on a Chart.js *category* axis (no date adapter is available in this project), so the X axis is only
> proportional to time because every day is a row. Emitting event-granularity rows would silently
> make the chart's time axis lie. This is a hard requirement, not a preference.

#### History reconstruction — a three-event ledger

This is the subtle part. Two obvious approaches are both wrong, so do not "simplify" to either:

- *Walk only today's pool batches backwards*: lands on the right number today, but the line
  collapses toward zero a few months back, because the 41 batches that dominated the pool in
  Mar–Jun are now `complete` and excluded. It draws today's six batches retrospectively, not the
  plant's actual historical position.
- *Plant ledger `Σ intake − Σ cracked`*: reads **374,722 kg** today, 85% too high. 172,476 kg of
  consumption on completed batches was never captured as cracking rows — only 26 of 41 complete
  batches have any.

Instead, for every batch with `is_active = true`, emit three signed events and take a running sum
ordered by date:

| event | date | delta |
|---|---|---|
| intake | `least(received_date, v_today)` | `+ nis_kg` |
| cracked | `public.kernel_day_date(elem)`, per element | `− public.kernel_day_kg(elem)` |
| reconciled | `exit_d`, **only for batches not in the pool** | `− (nis_kg − cracked_kg)` |

where `exit_d = GREATEST(` `(production_finished_at AT TIME ZONE 'Africa/Johannesburg')::date,`
`max(public.kernel_day_date(elem)),` `received_date )`. The `GREATEST` guarantees no cracking row is
ever dated after its own batch's reconciliation.

**The reconciliation delta must be signed and must NOT be wrapped in `greatest(..., 0)`.** This is
the single most important line in the function. Unclamped, every exited batch's `+nis` and
`−cracked` cancel exactly against its own residual, which yields the identity:

> `level(today) ≡ Σ over pool batches of (nis_kg − cracked_kg)` = **202,245.7**

so the history series provably terminates on the status-based pool figure with no drift, and the
forecast can anchor to it directly. Clamping the residual at zero gives 157,060.2 — off by 45,186 —
because five complete batches are *over*-cracked by 45,185.5 kg in total (bad source data). A
defensive-looking clamp breaks the whole design here.

Assumptions to encode and document in the function comment:
- `received_date` is the day NIS entered the pool. Currently 100% populated on active batches, none
  future-dated. If NULL, fall back to `(created_at AT TIME ZONE 'Africa/Johannesburg')::date` and
  add warning `received_date_null:<n>`. If future-dated, the `least(..., v_today)` clamp above
  handles it; add `received_date_in_future:<n>`.
- `qa` and `dispatch` count as **exited** (neither status exists in production today).
- `is_active = false` is excluded **everywhere**. Non-negotiable: inactive `intake` rows carry
  ~7.76 million kg of junk NIS that would swamp the chart roughly 38×.
- Cracking is a **plant-level draw**. Per-batch `cracked_kg` is used only to size the reconciliation
  residual — never to clamp or gate a batch's own depletion.

Two artefacts to surface rather than hide:
- The residual write-off lands on a single day, so the history line shows **cliffs on batch
  completion dates**. Return `reconciled_kg` per point so the chart's tooltip can explain them.
- History goes **negative in April 2026** (about −4,319 kg) because of one bad row: batch
  `Bn 32 26 10` records `endqty1 = 39,853` on 2026-04-23 against a 12,309.3 kg batch. Emit
  `qty_kg = greatest(level, 0)` — matching the existing idiom at
  `migrations/20260713160000_get_stock_soh_history.sql:91` — and report the raw count as
  `meta.history_has_negative_days`. Leave `intake_kg` / `cracked_kg` / `reconciled_kg` **unclamped**
  so the underlying day stays auditable.

#### Rate resolution

Per field, first match wins; **an out-of-range value falls through to the next source** and appends
`override_out_of_range:<field>` to `warnings` (do not silently clamp to a bound — a fat-fingered
`50` days/week must be visible, not quietly become 7):

```
kg_per_production_day:        p_kg_per_production_day (>0, <=200000)
                           -> dashboard_targets override (same bounds)
                           -> calculated over the rate window
                           -> 0, source 'none', warning 'no_cracking_history'

production_days_per_week:     p_production_days_per_week (>0, <=7)
                           -> dashboard_targets override (same bounds)
                           -> observed cadence, i.e. round(7.0 * production_days_in_window
                                                           / rate_window_days, 2)
                           -> 5, source 'default'   [only when the window has no production days]
```

`production_days_per_week` **defaults to the observed cadence, not to 5.** Calibrating the kg/day
factor from history while hardcoding the other factor of the same product at 2.4× its observed value
would move the predicted run-out roughly 90 days earlier (2026-10-06 instead of 2027-01-04) in a
chart whose entire purpose is to state that date. Report both the effective and observed values, and
add warning `production_days_per_week_far_above_observed` when the effective value exceeds observed
by more than 50%.

Read overrides with an **inlined `DISTINCT ON`** against `public.dashboard_targets` — mirror the
effective-dated logic in `get_dashboard_targets()` (`WHERE effective_from <= current_date ORDER BY
effective_from DESC`). Do **not** call `get_dashboard_targets()` itself; that would couple this
function to every unrelated metric. Metric keys:

| metric_key | period_type | division |
|---|---|---|
| `nis_crack_rate_kg_per_production_day` | `daily` | `kernel` |
| `nis_production_days_per_week` | `weekly` | `kernel` |

`dashboard_targets.target_value` is `NOT NULL DEFAULT 0`, so treat a missing row and `0`
identically as "no override".

#### Forecast

Fractional production-days-per-week on an ISO Mon→Sun preference order (matches the observed
Mon–Fri pattern):

```sql
CASE WHEN extract(isodow FROM d) <= floor(v_dpw)                             THEN 1::numeric
     WHEN v_dpw > floor(v_dpw) AND extract(isodow FROM d) = ceil(v_dpw)::int THEN v_dpw - floor(v_dpw)
     ELSE 0 END AS prod_weight
```

Consumption on day `d` = `v_rate * prod_weight`, so weekly consumption is exactly `v_rate * v_dpw`
for any `v_dpw` in `(0, 7]`. There is no public-holiday calendar in this schema — do not invent one.

Procurement uplifts (only when `p_include_procurement`):

```sql
SELECT p.scheduled_date AS d, sum(p.predicted_weight_kg)::numeric AS kg
FROM public.kernel_intake_procurement p
WHERE p.status = 'scheduled'
  AND p.scheduled_date > v_today
  AND coalesce(p.predicted_weight_kg, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.kernel k
                  WHERE k.batch_id = p.batch_id AND k.is_active = true)
GROUP BY 1
```

**Join on `p.batch_id = k.batch_id`, never `p.batch_id = k.id`.**
`kernel_intake_procurement.batch_id` is an FK to `public.batches(id)`
(`migrations/20260601090000_kernel_intake_procurement.sql:12`), and so is `kernel.batch_id`.
`get_kernel_mass_balance` gets this right at
`migrations/20260706100000_phase2_implementation_complete.sql:354` — follow it. The `NOT EXISTS` is
belt-and-braces against a row whose `batch_id` was set but whose status update rolled back.

Project the level with window functions over a bounded `generate_series`, and cut at the first
zero crossing:

```sql
v_pool_kg
  + sum(coalesce(uplift.kg, 0))     OVER (ORDER BY fd.d ROWS UNBOUNDED PRECEDING)
  - sum(v_rate * fd.prod_weight)    OVER (ORDER BY fd.d ROWS UNBOUNDED PRECEDING) AS lvl
```

Emit points where `d <= coalesce(first_zero_date, v_today + v_max_forecast_days)`, with
`qty_kg = greatest(lvl, 0)` so the final point is exactly 0. **No division and no loop anywhere in
the forecast path** — a zero rate must produce a flat line, never a `division_by_zero` and never a
hang. Do not use a recursive CTE: because the series is cut at the first zero crossing, the
"plant idles empty then restarts after an intake" case cannot arise inside the emitted range, so the
plain cumulative sum is exact.

**Scheduled future procurement is an uplift only — never part of the level at today.** Counting it
in both places would double it and would make `pool_kg` disagree with the verified 202,245.7.
`meta.scheduled_procurement_future_kg` carries it separately for any caller that wants a
"total nut secured" figure.

#### Edge cases — all must be handled, none may raise

| case | behaviour |
|---|---|
| rate × days/week `<= 0` | flat line for `least(v_max_forecast_days, 90)` days, `run_out_date = null`, warning `zero_crack_rate` |
| no zero crossing in horizon | `run_out_date = null`, `forecast_truncated = true`, warning `forecast_truncated_at_max_days` |
| `pool_kg <= 0` | `run_out_date = v_today`, `days_to_run_out = 0`, warning `pool_empty`, no forecast points |
| procurement calendar empty (today's reality) | all-zero uplift, warning `procurement_calendar_empty` |
| overdue rows still `scheduled` | excluded from history *and* forecast; reported as `meta.scheduled_procurement_overdue_kg` + warning `procurement_overdue`. **Never roll them forward** — that would extend the runway on a delivery that never arrived |
| batches with NIS but no cracking rows | the dominant case (15 of 41 complete, 1 of 1 intake, 2 of 5 production). In-pool ones contribute full NIS, which is correct — one batch alone is 79% of the current pool |
| **cracking capture is unreliable** | count batches where cumulative `cracked_kg > nis_kg` and report as `meta.batches_over_cracked` with the total excess kg; when any exist, add warning `recorded_feed_exceeds_intake`. Also report `cracking_rows_without_tonnage` (day-rows where `kernel_day_kg(elem) = 0`) as a fraction of the total, and add warning `sparse_cracking_capture` when it exceeds half. These two are how the chart tells the reader the rate is indicative — do not omit them, and do not use them to filter or adjust any figure |
| unparseable cracking dates | dropped from the daily ledger but still counted in the batch's `cracked_kg`, so the tonnage lands on `exit_d` rather than vanishing. Report `undated_cracking_kg` |
| no active kernel rows at all | return the flat history grid at 0 plus warning `no_data`, **not** an empty `points` array — the chart needs a series to show an honest empty state |

### 2. `migrations/20260813101000_nis_runway_settings_seed.sql`

No DDL. Two things:

1. `COMMENT ON TABLE public.dashboard_targets` (or column comments) documenting the two `nis_*`
   metric keys, their units, and that they are consumed by `get_nis_runway_forecast` as overrides.
   The existing admin grid at
   `WebPortal/modules/dashboard-targets/js/dashboard-targets_grid.js:102` renders `metric_key` as a
   free-text input, so an admin can already edit these — the comment is what tells them what the
   keys mean.
2. Seed **only** `nis_production_days_per_week = 5` (`period_type` `weekly`, `division` `kernel`),
   `ON CONFLICT DO NOTHING`, as an editable starting assumption for anyone who wants to plan against
   a 5-day week.

> **Do not seed `nis_crack_rate_kg_per_production_day`.** Leaving that row absent is exactly what
> makes the chart self-calibrate from actual production history. Seeding it would freeze the rate at
> whatever number is written today.

Verify the values pass the table's existing CHECK constraints on `period_type` and `division`
(`migrations/20260602110000_dashboard_targets.sql:11,13`) before writing the insert.

No new write RPC is needed — `upsert_dashboard_target()` already exists with write-RBAC scoped to
super_user / admin / General Manager / Production Manager / Oil Plant Manager
(`migrations/20260602110000_dashboard_targets.sql:152-170`).

### 3. `migrations/20260813110000_get_kernel_cracking_data_quality.sql`

`public.get_kernel_cracking_data_quality()` returning `jsonb`, so the source-data problems that
limit this forecast's accuracy stay visible instead of living in a throwaway query. Report at least:
total cracking day-rows; rows carrying no tonnage; `startqty1 - silo1 = endqty1` identity violations;
rows where `endqty1` and `totalqty` disagree; `totalqty`-only and `endqty1`-only counts; unparseable
dates; batches where `cracked_kg > nis_kg` with the total excess; and complete batches with no
cracking rows with their unaccounted kg.

Expected production values at the time of writing, useful as a sanity check: 120 rows total, 45
carrying tonnage, 3 identity violations, 1 mismatch, 1 `totalqty`-only, 13 `endqty1`-only, 0
unparseable dates, 5 over-cracked batches (45,185.5 kg excess), 15 of 41 complete batches with no
cracking rows (172,476 kg unaccounted).

## Repo conventions

- Migrations live in the **repo-root `migrations/`** directory. Forward-only — never edit an applied
  migration.
- Client-callable functions end with, in order: `COMMENT ON FUNCTION`; the `DO $$ ... FOR v_role_id
  IN SELECT id FROM public.roles LOOP ... INSERT INTO public.role_permissions (role_id, object_type,
  object_name, operation, allowed) VALUES (v_role_id.id, 'function', '<fn>', 'EXECUTE', true) ON
  CONFLICT DO NOTHING ... END LOOP; END; $$;` block; `GRANT EXECUTE ... TO authenticated,
  service_role;`; then `NOTIFY pgrst, 'reload schema';`. Exact template at
  `migrations/20260713160000_get_stock_soh_history.sql:204-219`. The `NOTIFY` matters — without it
  PostgREST returns `PGRST202` "Could not find function in schema cache".
- `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`. `SECURITY DEFINER` is
  required because the client calls PostgREST directly with the anon key.
- Do **not** append to `migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` despite
  `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` saying so. It is an applied migration and this repo is
  forward-only; several current functions are absent from it and work fine.
- Study `migrations/20260713160000_get_stock_soh_history.sql` before starting — it is the closest
  existing analogue (reconstructing a daily stock series from ledgers) and the best guide to house
  style.

## Acceptance criteria

Confirmable from the diff alone:

1. Three new files in `migrations/`, named as above, sorting after this plan's dependency.
2. `get_nis_runway_forecast` is `RETURNS jsonb`, `LANGUAGE plpgsql STABLE SECURITY DEFINER SET
   search_path = public`, and takes the six documented parameters with the documented defaults.
3. **The reconciliation residual is not wrapped in `greatest(...,0)`.** Grep the body: the only
   `greatest(` around a level or residual should be the `greatest(lvl, 0)` on the *emitted*
   `qty_kg`. This is the design's load-bearing detail.
4. **No division operator and no `LOOP` / recursive CTE in the forecast path.**
5. Every cracking-kg read goes through `public.kernel_day_kg`; every cracking-date read through
   `public.kernel_day_date`. No re-inlined coalesce or date CASE.
6. `is_active = true` is filtered on every `public.kernel` read.
7. Procurement joins use `p.batch_id = k.batch_id`, never `p.batch_id = k.id`.
8. `points` is documented and implemented as gap-free daily rows covering history *and* forecast.
9. Every edge case in the table above has a visible code path; `warnings` is always an array, never
   null.
10. `20260813101000` seeds `nis_production_days_per_week` only, and **not** the crack-rate row.
11. All three client-callable functions carry COMMENT + RBAC block + GRANT + `NOTIFY`.
12. `npm run test:fleet` passes. No `.js` or `.html` file is touched.
