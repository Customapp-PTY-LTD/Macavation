---
depends_on: phase2-2a-disambiguate-runway-widgets.md
---

# Target comparison on the remaining KPI cards, and a delta that sits on the wrong card

## Context

Two related gaps on the executive dashboard.

**1. One KPI has a target, four do not.** `loadProducedVsTarget`
(`WebPortal/modules/dashboard/js/executive_dashboard.js:1541-1556`) reads the targets table and picks
exactly one metric:

```js
1546:  var prodTarget = rows.find(function (t) { return t.metric_key === 'total_production_kg'; });
```

Sound kernel recovery, oil yield, months of cover and stock accuracy all render a bare number with nothing
to judge it against.

**2. A trend delta is rendering on the wrong card.** `:1579-1580` writes `production_delta_pct` into
`#execProductionDelta`:

```js
1579:  var delta = k.production_delta_pct;
1580:  $('#execProductionDelta').text(delta != null ? (delta >= 0 ? '+' : '') + delta + '% vs last month' : '');
```

and that element lives inside the **Sound kernel recovery** widget
(`dashboard_unified.html:261-266`):

```html
261:  <div class="col-md-3 mb-3" data-dashboard-widget="execSoundRecovery">
264:      <h6 class="text-muted">Sound kernel recovery</h6>
265:      <h3 id="execSoundRecoveryPct">—</h3>
266:      <small class="text-muted" id="execProductionDelta">—</small>
```

So the card reads "Sound kernel recovery / 41% / +12% vs last month" while the +12% actually measures
**production volume**, not recovery. A reader draws exactly the wrong conclusion, and recovery is a ratio —
it can fall while production rises. This is a real reporting defect, not cosmetics.

### Read this before assuming targets will display

`dashboard_targets` is **empty on production**. `upsert_dashboard_target` could not be called successfully
until a recent fix: `buildPostgrestRpcBody` stripped null parameters, so `p_id` (null for every new target)
and `p_effective_from` never reached a 7-argument function with no defaults, and PostgREST overload
resolution failed every time. Creating a target from the Dashboard Targets grid could never have worked.

The consequence for this plan: **every target comparison you add will render its empty state until someone
enters target values.** That is expected, not a bug, and the empty state is therefore a first-class
deliverable rather than an afterthought. Do not seed target values to make the UI look populated — the
numbers are a business input (monthly, per product line) and inventing them would put fabricated figures on
a leadership dashboard.

**`depends_on`:** this plan waits on the runway-widget plan because both edit
`executive_dashboard.js` and `dashboard_unified.html`.

## Scope

**In:** target comparison for sound kernel recovery, oil yield, months of cover and stock accuracy; moving
the production delta to a card where it is true.

**Out:** seeding any target value. **Out:** changing how any KPI is calculated. **Out:** the kernel
consolidated-batch summary widget (not built; separate work). **Out:** the runway forecast chart internals.

## Work

### 1. Generalise the target lookup

`loadProducedVsTarget` (`:1541-1556`) hardcodes one `metric_key`. Refactor it to resolve targets for a small
set of metric keys and render each against its card, keeping the existing `total_production_kg` behaviour
byte-for-byte identical in output.

Read `migrations/20260602110000_dashboard_targets.sql` to get the real `metric_key` vocabulary and the
row shape (including `effective_from`, and how the current period is chosen) rather than inventing key
names. **Use the keys that table already defines.** If a metric this plan needs has no key defined, do
**not** invent one and do **not** author a migration — render its empty state and list the missing key in
the run summary, because adding a metric key is a schema decision.

For each of the four metrics, show the target and a comparison in the same visual grammar the
produced-vs-target card already uses (actual, target, and a progress or variance indicator). Do not invent a
second style.

**Direction matters and is not uniform.** For recovery, yield and months of cover, higher is better. Stock
accuracy is "% of monthly stock-on-hand that was manually adjusted" — an inventory-correction rate, where
**lower is better**. Do not apply a single "above target is good" rule to all four; encode the direction per
metric and state it in a comment.

**Empty state:** when no target row exists for a metric, render the same `—` the dashboard already uses and
**no** comparison indicator. Never show a 0% target, a full progress bar, or "0% of target" — with an empty
table that would put a false judgement on every card.

### 2. Move the production delta to a card where it is true

Two acceptable fixes; pick one and say which:

- **Preferred:** move `#execProductionDelta` out of the `execSoundRecovery` card and into the **Total
  Production** card, whose `#totalProduction` value (`:1428`) is the figure the delta actually describes.
- Or, if a recovery-specific delta exists in the KPI payload, render **that** on the recovery card and move
  `production_delta_pct` to Total Production. **Check the payload before assuming** — read what
  `get_dashboard_*` actually returns (see `migrations/20260708160000_fix_oil_recovery_kpi_calculations.sql:113`
  for where `production_delta_pct` is produced) and do not fabricate a recovery delta client-side by
  dividing this month's recovery by last month's; that number is not in the payload and guessing it would be
  worse than showing nothing.

Whichever you choose, the reset line at `:1582` — which blanks
`#execSoundRecoveryPct, #execOilYieldPct, #execSohKernel, #execSohOil, #execSohRm, #execProductionDelta`
to `—` on failure — must keep covering every id it currently covers, including any you move or add.

If moving the element between cards means it crosses a `data-dashboard-widget` boundary, the delta becomes
subject to the **destination** card's visibility. That is correct and intended; just do not give the delta
its own `data-dashboard-widget` attribute, or it will be hidden for everyone (new ids are in nobody's saved
list).

## Guardrails

- **Do not change any KPI calculation** and do not author or modify a `.sql` file. No migration.
- **Do not seed target values.** Not in a migration, not in JS defaults, not as a placeholder. Fabricated
  targets on a leadership dashboard are worse than blank ones.
- **Do not compute a recovery delta client-side.** If the payload does not carry one, show nothing.
- **Do not add `data-dashboard-widget`** to any new or moved element.
- **Markup must stay within its current `data-access` wrapper** unless the move is between two cards in the
  same wrapper — verify before moving, or the delta appears on the wrong dashboard.
- **Do not touch the runway forecast chart**, its scroll wrapper, pinned-axis canvas, marker plugin, or the
  depletion-rate modal.
- **Do not modify `buildPostgrestRpcBody` or `callFunction`** in `data-functions.js`. The null-parameter
  handling there was recently fixed and is load-bearing for saving targets; this plan only reads.
- Do not introduce raw hex, a `linear-gradient`, Bootstrap Icons, or `btn-success` — `ui:verify` gates all
  four. Use `--mac-*` tokens and Font Awesome.
- Do not re-declare `escapeHtml`; use the shared `_common.escapeHtml`.
- Nothing under `supabase/`; no new npm dependency.

## Acceptance criteria

1. Only `WebPortal/modules/dashboard/js/executive_dashboard.js` and
   `WebPortal/modules/dashboard/html/dashboard_unified.html` change. **No `.sql` file is added or modified**,
   and `git diff --stat` lists no path under `migrations/` or `supabase/`.
2. Target comparison renders for sound kernel recovery, oil yield, months of cover and stock accuracy, using
   `metric_key` values that exist in `migrations/20260602110000_dashboard_targets.sql`. Any metric lacking a
   defined key is listed in the run summary rather than given an invented one.
3. **Grep-checkable:** `metric_key === 'total_production_kg'` is no longer the only target lookup — the
   file references more than one metric key — and the produced-vs-target card's rendered output is unchanged
   for the same input.
4. Stock accuracy is treated as **lower-is-better**, with a comment recording the direction per metric.
5. With `dashboard_targets` empty, every one of the four cards renders `—` and **no** comparison indicator —
   no 0% target, no filled progress bar. Verifiable by reading the empty-state branch.
6. `#execProductionDelta` is no longer inside the `execSoundRecovery` card. **Grep-checkable:** in
   `dashboard_unified.html`, `execProductionDelta` does not appear between the `execSoundRecovery` widget's
   opening `div` and its close.
7. If the recovery card shows a delta at all, it comes from a field the KPI payload actually returns; no
   client-side month-over-month division is introduced.
8. The reset line at `:1582` still blanks every id it did before, plus any moved or added id.
9. No element gains `data-dashboard-widget`; no markup moves between `data-access` wrappers.
10. `buildPostgrestRpcBody` and `callFunction` in `data-functions.js` are untouched — `git diff --stat` does
    not list `data-functions.js`.
11. `npm run ui:verify` passes and `npm run test:fleet` passes.
12. No new npm dependency; nothing under `supabase/`.
