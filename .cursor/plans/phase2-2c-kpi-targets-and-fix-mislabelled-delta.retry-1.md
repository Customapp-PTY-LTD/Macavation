---
depends_on: phase2-2a-disambiguate-runway-widgets.md
retry_of: 14f56be0-3e7d-4bef-8259-0f5168e460d3
---

# Target comparison on two more KPI cards, and a monthly delta that sits on a card where it is true

## Context

Two related gaps on the executive dashboard.

**1. One KPI has a target, nothing else does.** `loadProducedVsTarget`
(`WebPortal/modules/dashboard/js/executive_dashboard.js:1541-1556`) reads the targets table and picks
exactly one metric:

```js
1546:  var prodTarget = rows.find(function (t) { return t.metric_key === 'total_production_kg'; });
```

Sound kernel recovery and oil yield render a bare percentage with nothing to judge it against.

**2. A trend delta is rendering on the wrong card.** `:1579-1580` writes `production_delta_pct` into
`#execProductionDelta`:

```js
1579:  var delta = k.production_delta_pct;
1580:  $('#execProductionDelta').text(delta != null ? (delta >= 0 ? '+' : '') + delta + '% vs last month' : '');
```

and that element lives inside the **Sound kernel recovery** widget
(`dashboard_unified.html:262-267` — note the line numbers, the card block is 262-267):

```html
262:  <div class="col-md-3 mb-3" data-dashboard-widget="execSoundRecovery">
265:      <h6 class="text-muted">Sound kernel recovery</h6>
266:      <h3 id="execSoundRecoveryPct">—</h3>
267:      <small class="text-muted" id="execProductionDelta">—</small>
```

So the card reads "Sound kernel recovery / 41% / +12% vs last month" while the +12% actually measures
**production volume**, not recovery. A reader draws exactly the wrong conclusion, and recovery is a ratio —
it can fall while production rises. This is a real reporting defect, not cosmetics.

### Facts established by reading the code — treat these as binding, do not re-derive them loosely

**A. `#totalProduction` is an ALL-TIME figure and must NOT host the delta.**
`#totalProduction` (`:1428`) is `get_executive_kpis().total_production_kg`, which sums
`kernel.packing_data` with **no date filter at all**
(`migrations/20260329000001_active_batches_intake_and_production_only.sql:27-43`; the header of
`migrations/20260328000002_executive_kpis_total_production_kg.sql:1` says "all time"). `production_delta_pct`
is **this calendar month vs last month** (`migrations/20260708160000_fix_oil_recovery_kpi_calculations.sql:91-114`).
Attaching "+12% vs last month" directly to the all-time total is a *different* false juxtaposition, not a fix.
The payload already carries the correct companions: `production_kg_this_month` and `production_kg_last_month`
(`20260708160000...:111-112`). The delta must sit next to an explicitly-labelled **this-month** figure.

**B. The KPI payload carries NO recovery delta.** `get_phase2_extended_kpis()` returns
`sound_kernel_recovery_pct`, `oil_yield_pct`, SOH figures, `production_kg_this_month`,
`production_kg_last_month`, `production_delta_pct`, `period_start/end`, `nis_in_kg`, `sound_packed_kg`,
`oil_litres`, `oil_rm_consumed_kg` (`20260708160000...:105-121`). There is no recovery delta. Do not
fabricate one client-side.

**C. `metric_key` is free-text, and only two keys are seeded.** `dashboard_targets.metric_key` is
`VARCHAR(100)` with no vocabulary table or FK (`migrations/20260602110000_dashboard_targets.sql:8`). The only
keys seeded by any migration are `quality_pass_rate` and `total_production_kg` (`:139-142`). The runway
feature already uses two further keys that exist only as a client-side convention plus a documentation-only
migration with no DDL and no seed rows (`nis_crack_rate_kg_per_day`, `nis_rate_basis_month` —
`WebPortal/js/data-functions.js:2110-2117`, `migrations/20260813101000_nis_runway_settings_keys.sql`).
So *naming a new key is a client-side convention in this codebase, not a schema change* — and the Dashboard
Targets admin grid already accepts `metric_key` as free text
(`WebPortal/modules/dashboard-targets/js/dashboard-targets_grid.js:102`). This plan therefore **names its
keys explicitly in JS** and **authors no `.sql` file at all**.

**D. Load order defeats the naive refactor.** `init` calls `loadProducedVsTarget()` at `:110` **before**
`loadPhase2ExtendedKpis()` at `:111`, and the phase-2 payload is a local `var k` (`:1571`) that is never
stored on scope. A target comparison rendered from inside `loadProducedVsTarget` would have no actuals and
would print `NaN`/blanks. The render step for the new comparisons must live where the actuals live (see Work
step 1) and must never read a displayed value back out of the DOM.

**E. What we can and cannot say about existing target rows.** Do **not** assert that `dashboard_targets` is
empty in production — that is unverifiable from a checkout and is contradicted by the seed at
`20260602110000...:139-142`. What *is* verifiable and what this plan relies on: **no migration in this repo
seeds a row for either of the two new metric keys**, so until a human enters values in the Dashboard Targets
grid the new comparisons will render their empty state. That is expected, not a bug, and the empty state is a
first-class deliverable. Do **not** seed target values — they are a business input and inventing them would
put fabricated figures on a leadership dashboard.

**`depends_on`:** this plan waits on the runway-widget plan because both edit `executive_dashboard.js` and
`dashboard_unified.html`. That plan is **not present in this checkout**, so nothing in this plan may depend on
the post-change shape of the runway widgets (see Scope: months-of-cover is out).

## Scope

**In:** target comparison for **sound kernel recovery** and **oil yield** (the two metrics that already have
a single-number card and whose actual arrives in the `get_phase2_extended_kpis` payload); rendering
`production_kg_this_month` and moving the production delta so it sits beside a figure it actually describes.

**Out:** seeding any target value. **Out:** changing how any KPI is calculated. **Out:** authoring or editing
any `.sql` file, including a documentation-only one. **Out (deferred, record in run summary):** a target
comparison for **stock accuracy** — it is a bar chart of monthly `pct_adjusted`
(`dashboard_unified.html:766-774`, `loadStockAccuracyChart` `:1515-1539`) with no single number, no
target-bearing markup, and no agreed aggregation (latest month? 6-month mean?); choosing one would be
inventing the metric. **Out (deferred, record in run summary):** a target comparison for **months of cover** —
`#execRunwayMonths` sits in the `execRunway` card (`dashboard_unified.html:248-258`) fed by a different RPC
(`loadRunwaySummary` `:1472-1486`), the label "months of cover" is ambiguous between that finished-stock-cover
card and the NIS runway forecast, and the prerequisite runway plan that restructures these widgets is not in
this checkout. **Out:** the kernel consolidated-batch summary widget. **Out:** the runway forecast chart
internals.

## Work

### 1. Generalise the target lookup and render comparisons for recovery and oil yield

`loadProducedVsTarget` (`:1541-1556`) hardcodes one `metric_key`. Refactor the target lookup into something
that can resolve more than one key, keeping the produced-vs-target card's rendered output **byte-for-byte
identical for the same input** (same ids, same number formatting, same `'Set target in Dashboard Targets'`
caption, same failure path).

**Metric keys — decide these, do not leave them implicit.** Use exactly these strings, declared once in a
named JS constant near the render code with a comment recording why (fact C above):

| card | element for the actual | `metric_key` | direction |
| --- | --- | --- | --- |
| Sound kernel recovery | `#execSoundRecoveryPct` | `sound_kernel_recovery_pct` | higher is better |
| Oil yield | `#execOilYieldPct` | `oil_yield_pct` | higher is better |

The comment must state: `metric_key` is free-text `VARCHAR(100)`
(`migrations/20260602110000_dashboard_targets.sql:8`); these two keys are a client-side convention in the
same spirit as `nis_crack_rate_kg_per_day` / `nis_rate_basis_month`; nothing seeds them, so a human must type
the exact string in the Dashboard Targets grid for a target to appear; and the expected row shape is
`period_type` `'monthly'` with `division` `'all'` (match on `metric_key` only — do not filter on
`period_type`/`division`, because `get_dashboard_targets()` already returns the latest effective row per
`metric_key`/`division`/`period_type` and over-filtering would silently drop a validly-entered target).

**List both key strings in the run summary** so a human can decide separately whether to document them in the
table comment (that is a follow-up action for a person; this plan must not author it).

**Where the actuals come from, and the plumbing (fact D).** Render the two comparisons from inside
`loadPhase2ExtendedKpis`, using the same `sanePct`-filtered values that already feed `#execSoundRecoveryPct`
and `#execOilYieldPct` (`:1565-1575`): `rec` for recovery, `yieldPct` for oil yield. If `sanePct` returned
`null`, the card keeps its `—` and shows **no** comparison. Obtain the target rows inside that same step by
`await`ing `dataFunctions.getDashboardTargets()` — it is cached (`data-functions.js:1552-1558`,
`cacheKey: 'dashboard_targets_list'`, static TTL) and returns `{ rows: [], map: {} }` on failure
(`:1575-1578`), so a second call is cheap and cannot throw the render off. Do **not** reorder `init`, do
**not** stash the phase-2 payload and hope `:110` runs after `:111`, and do **not** read values back out of
the DOM.

**Visual grammar.** Use the same grammar the produced-vs-target card already uses
(`dashboard_unified.html:233-247`): an actual/target line, a `progress` bar with a `progress-bar bg-success`
fill, and a small caption. Do not invent a second style. New element ids should follow the existing naming
(e.g. `execSoundRecoveryTarget` / `execSoundRecoveryProgress` / `execSoundRecoveryTargetPct` and the oil-yield
equivalents); pick names and keep them consistent between HTML and JS.

**Direction matters and is not uniform.** Encode direction in a per-metric map (not a single global rule) and
state it in a comment. Both metrics in scope are higher-is-better, so
`pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0` is correct for both. The comment
must record that this codebase also has a **lower-is-better** figure — the stock-accuracy "Monthly % of SOH
adjusted" (`dashboard_unified.html:768`) — that must **not** inherit the higher-is-better rule, and that this
change deliberately ships no lower-is-better branch because that metric is out of scope here.

**Empty state.** When no target row exists for a metric, render the same `—` the dashboard already uses and
**no** comparison indicator: no `0%` target, no filled or zero-width progress bar presented as a judgement,
no "0% of target". Hide/omit the indicator markup rather than showing a neutral-looking zero. Failure of the
targets fetch must behave the same as "no row".

### 2. Put the production delta next to a figure it actually describes

Do this, and say in the run summary that you did:

- Inside the existing `totalProduction` widget card (`dashboard_unified.html:225-232`), add an explicitly
  labelled monthly line, e.g. `This month: <strong id="execProductionThisMonth">—</strong> kg`, and **move**
  the existing `#execProductionDelta` element there so the "+X% vs last month" text sits with that monthly
  figure. Leave `<h3 id="totalProduction">` and its label untouched — it stays the all-time total.
- In `loadPhase2ExtendedKpis`, set `#execProductionThisMonth` from `k.production_kg_this_month`, formatted the
  same way the other kg figures are (`toLocaleString('en-ZA', { maximumFractionDigits: 0 })`), and keep the
  delta line's existing text format. If `production_kg_this_month` is missing/non-numeric, render `—` and
  render no delta.
- Do **not** attach the delta to `#totalProduction` itself, and do **not** relabel the Total Production card
  as monthly — fact A.
- The recovery card shows **no** delta, because the payload carries none (fact B). Do not divide this month's
  recovery by last month's or otherwise derive one client-side.

Visibility: both the source card (`execSoundRecovery`) and the destination (`totalProduction`) are inside the
same `data-access="executive"` wrapper (`dashboard_unified.html:199`), so the move stays in-wrapper. After the
move the delta and the monthly figure inherit the **destination** card's visibility
(`applyDashboardVisibility`, `:178-190` — anything not in a user's saved list is hidden); that is correct and
intended, and `totalProduction` appears in every role default list (`:161-167`). Do **not** give the moved or
new elements their own `data-dashboard-widget` attribute — new keys are in nobody's saved list and would be
hidden for everyone.

The reset line at `:1582` — which blanks
`#execSoundRecoveryPct, #execOilYieldPct, #execSohKernel, #execSohOil, #execSohRm, #execProductionDelta`
to `—` on failure — must keep covering every id it currently covers, **plus** `#execProductionThisMonth` and
the new target/progress/caption ids (for those, the failure state must be the empty state from step 1, not a
misleading zero).

Also note in the run summary, without changing it: the existing produced-vs-target card compares an all-time
actual against a monthly target row. That is a pre-existing inconsistency, out of scope here (changing it
would alter a KPI comparison), and is flagged for a human.

## Guardrails

- **Do not change any KPI calculation** and **do not author or modify any `.sql` file** — not a migration, not
  a comment-only migration, nothing under `migrations/`.
- **Do not seed target values.** Not in a migration, not in JS defaults, not as a placeholder. Fabricated
  targets on a leadership dashboard are worse than blank ones.
- **Do not compute a recovery delta, or any month-over-month figure, client-side.** If the payload does not
  carry it, show nothing.
- **Do not add stock-accuracy or months-of-cover target comparisons.** They are deferred with open questions
  (see Scope); record them in the run summary instead of guessing an aggregation or a host card.
- **Do not add `data-dashboard-widget`** to any new or moved element, and do not add entries to
  `DASHBOARD_WIDGET_LABELS`.
- **Markup must stay within its current `data-access` wrapper.** The only move sanctioned here is
  `execSoundRecovery` → `totalProduction`, both inside `data-access="executive"`.
- **Do not touch the runway forecast chart**, its scroll wrapper, pinned-axis canvas, marker plugin, the
  depletion-rate modal, or the `execRunway` card.
- **Do not modify `buildPostgrestRpcBody` or `callFunction`** in `data-functions.js`. The `preserveNullParams`
  handling there (`data-functions.js:1583-1597`) is load-bearing for saving targets; this plan only reads.
- No Bootstrap Icons and no `btn-success` — `ui:verify` scans `.html`/`.js` for both
  (`scripts/verify-ui-standard.mjs:127-135`). Use Font Awesome (`fas`/`far`). The raw-hex and
  `linear-gradient` rules there apply to `.css` files only and this plan touches no CSS — but still introduce
  no new hex or gradient; use `--mac-*` tokens if any styling is needed. Reusing the existing
  `progress-bar bg-success` class from the produced-vs-target card is fine (`bg-success` is not banned).
- Do not re-declare `escapeHtml`; if HTML-escaping is needed use the shared `_common.escapeHtml`. None of the
  values rendered here are user-authored strings, so escaping should not be necessary at all.
- Nothing under `supabase/`; no new npm dependency.

## Acceptance criteria

1. Only `WebPortal/modules/dashboard/js/executive_dashboard.js` and
   `WebPortal/modules/dashboard/html/dashboard_unified.html` change. **No `.sql` file is added or modified**,
   and `git diff --stat` lists no path under `migrations/` or `supabase/`.
2. Target comparison renders for **sound kernel recovery** and **oil yield**, using exactly the metric keys
   `sound_kernel_recovery_pct` and `oil_yield_pct`, declared in a single named JS constant with the comment
   required in Work step 1. Both key strings appear in the run summary.
3. **Grep-checkable:** `metric_key === 'total_production_kg'` is no longer the only target lookup — the file
   references more than one metric key — and the produced-vs-target card's rendered output is unchanged for
   the same input (same ids, same formatting, same caption, same failure path).
4. A per-metric direction map exists with a comment recording the direction for each metric in scope and
   recording that the stock-accuracy adjustment rate is lower-is-better and is deliberately not implemented
   here. No single global "above target is good" rule is applied.
5. With no target row for a metric, that card renders `—` and **no** comparison indicator — no 0% target, no
   progress bar presented as a judgement. Same behaviour when the targets fetch fails. Verifiable by reading
   the empty-state branch.
6. `#execProductionDelta` is no longer inside the `execSoundRecovery` card. **Grep-checkable:** in
   `dashboard_unified.html`, `execProductionDelta` does not appear between the `execSoundRecovery` widget's
   opening `div` and its close; it appears inside the `totalProduction` widget instead.
7. The delta is rendered adjacent to an explicitly labelled this-month figure sourced from
   `production_kg_this_month`. `<h3 id="totalProduction">` and the "Total Production (kg)" label are
   unchanged, and no code attaches the delta to the all-time total.
8. The recovery card shows no delta. No client-side month-over-month division is introduced anywhere.
9. The comparison values are read from the `get_phase2_extended_kpis` payload in the same function that
   already consumes it; nothing reads a rendered value out of the DOM, and `init`'s call order (`:110`,
   `:111`) is unchanged and not relied upon.
10. The reset line at `:1582` still blanks every id it did before, plus `execProductionThisMonth`; new
    target/progress/caption ids reset to the empty state rather than a zero-valued indicator.
11. No element gains `data-dashboard-widget`; `DASHBOARD_WIDGET_LABELS` is unchanged; no markup moves between
    `data-access` wrappers.
12. Stock-accuracy and months-of-cover comparisons are **not** implemented, and each is listed in the run
    summary with the specific open decision it needs (aggregation for stock accuracy; which "months of cover"
    and post-dependency card structure for months of cover).
13. `buildPostgrestRpcBody` and `callFunction` in `data-functions.js` are untouched — `git diff --stat` does
    not list `data-functions.js`.
14. `npm run ui:verify` passes and `npm run test:fleet` passes.
15. No new npm dependency; nothing under `supabase/`.
