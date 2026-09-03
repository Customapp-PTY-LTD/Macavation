---
depends_on: exec-dash-03-stat-tiles.md
preflight: pass b875110ffef8
---

# Executive dashboard 4 of 4 — six batch counts become one pipeline bar

## Why

After plan 3 the Kernel operations card still carries six separate count tiles — awaiting test,
release ready, completed this week, in intake, dispatch this week, dispatch pending. Six numbers in
six boxes tell you the counts but not where work is piling up. This plan replaces them with a
single segmented bar whose segment widths are the counts, so a queue is visible at a glance.

## Facts about this repo that this plan relies on (verified 2026-09-03)

- The six tiles live in `WebPortal/modules/dashboard/html/dashboard_unified.html` inside
  `data-access="executive"`, in the Kernel operations card (`#execKernelOpsCollapse`), in the two
  rows after the strip plan 3 built. Their ids are `execStatBatchesAwaitingTest` (line 418),
  `execStatBatchesReleaseReady` (426), `execStatBatchesCompletedWeek` (434),
  `execStatBatchesInIntake` (442), `execStatDispatchWeek` (453) and `execStatDispatchPending` (461).
  Each sits in a `<div class="col-6 col-md-4 col-lg" data-dashboard-widget="…">`.
- They are filled by `loadProductionStats` (`executive_dashboard.js:330`) from
  `dataFunctions.getDashboardProductionStats()` (`WebPortal/js/data-functions.js:2291`, DB function
  `get_dashboard_production_stats`). Read that data function before writing anything — it returns
  exactly these keys, every one coerced with `Number(...) || 0`, and a fully zeroed default object
  on failure: `batches_awaiting_test`, `batches_release_ready`, `batches_completed_week`,
  `batches_in_intake`, `oil_litres_today`, `oil_litres_week`, `oil_sheets_week`,
  `quality_pass_rate`, `quality_tests_week`, `dispatch_orders_week`, `dispatch_pending`,
  `batches_on_hold`.

### `loadProductionStats` has a guard line — keep it

The function opens:

```js
330  loadProductionStats: async () => {
...
333      try {
334          if (typeof dataFunctions === 'undefined' || !dataFunctions.getDashboardProductionStats) return;
335          const s = await dataFunctions.getDashboardProductionStats();
```

So `getDashboardProductionStats` appears **twice** in this file — once in the guard on line 334 and
once in the call on line 335. That is correct and both must stay. **Do not delete the line-334
guard**; it is what stops the dashboard throwing when the data layer has not loaded yet. Verify
step 4 below asserts the count is 2, not 1 — an earlier version of this plan asserted 1, which no
edit it authorised could ever produce, and the likeliest way to satisfy it would have been deleting
that guard.

### `batches_on_hold` — stated precisely, because an earlier version got this wrong

An earlier version of this plan said `batches_on_hold` "is not shown anywhere on the dashboard
today", which reads as if the code ignores it. **The code does not ignore it.** The accurate
position, traced:

- `data-functions.js:2296` lists it in the zeroed default object and `:2317` maps it with
  `Number(row.batches_on_hold) || 0`.
- `executive_dashboard.js:340` already writes it: `$('#execStatBatchesOnHold').text(fmt(s.batches_on_hold));`
- `executive_dashboard.js:350` already resets it on the error path, inside the combined selector.
- **But `grep -n 'execStatBatchesOnHold' WebPortal/modules/dashboard/html/dashboard_unified.html`
  returns nothing.** There is no element with that id, so both of those jQuery calls select an empty
  set and do nothing. The number is fetched, coerced and written into the void.

So what this plan adds is the **markup that makes an already-written value visible** — not a new
writer. Concretely: **do not add another `$('#execStatBatchesOnHold')` line, and do not add a second
fetch.** Build the bar from the same `s` object `loadProductionStats` already has in scope.

(Three sibling ids are in the same state — `execStatOilSheetsWeek`, `execStatQualityPassRate`,
`execStatQualityTestsWeek` are written at lines 342–344 with no element in the markup. They are
**out of scope**; do not add markup for them, and do not remove their writers.)

### Retiring a widget id means editing THREE places — the third is role defaults

`CLAUDE.md` says a dashboard widget id is registered in three places. This plan retires six ids, and
**all three sites must be edited** or verify step 2 cannot pass. All three edits are authorised:

1. **The markup and the writers** — deliverables 1 and 2.
2. **`DASHBOARD_WIDGET_LABELS`** (`executive_dashboard.js:75`) — delete the six keys:
   `execStatBatchesAwaitingTest` (line 81), `execStatBatchesReleaseReady` (82),
   `execStatBatchesCompletedWeek` (83), `execStatBatchesInIntake` (84), `execStatDispatchWeek` (88),
   `execStatDispatchPending` (89). As in plans 1 and 3, `saveCustomizeModal` compares
   `visible.length === Object.keys(DASHBOARD_WIDGET_LABELS).length`, and removing keys shrinks both
   sides together, so the "all selected → store null" behaviour stays correct. Change nothing else
   in `saveCustomizeModal`.
3. **`getDefaultWidgetsForRole`'s hardcoded role arrays** (`executive_dashboard.js:220-226`) — four
   of the six ids appear here, across **three** arrays. This is the site the previous version of
   this plan missed entirely. Remove them, and expect exactly these results:

   | Array | Line | Retired ids to remove | Entries before → after |
   |---|---|---|---|
   | `production` | 220-222 | `execStatBatchesAwaitingTest`, `execStatBatchesReleaseReady`, `execStatBatchesCompletedWeek`, `execStatBatchesInIntake` | **11 → 7** (11, not 13, because plan 3 already removed two) |
   | `qa` | 225 | `execStatBatchesAwaitingTest`, `execStatBatchesReleaseReady` | **4 → 2** |
   | `forecastSales` | 226 | `execStatBatchesCompletedWeek` | **4 → 3** |

   Leave the `oil` array (line 224) untouched — none of the six appears in it.

   **The `qa` case deserves a sentence, because it is the largest behavioural change in this plan.**
   The "qa supervisor" role's default widget set halves, from
   `['execStatBatchesAwaitingTest', 'execStatBatchesReleaseReady', 'execDailyMinuteTests', 'totalProduction']`
   to `['execDailyMinuteTests', 'totalProduction']`. That is intended and correct: the two removed
   entries name tiles that no longer exist after this plan, so keeping them would leave the role
   default pointing at nothing. The pipeline bar that replaces them carries no
   `data-dashboard-widget` (see deliverable 1) and is therefore visible to every role regardless of
   their default set — so a QA supervisor still sees the awaiting-test and release-ready counts,
   in the bar. State the before/after arrays in your report.

`execStatBatchesOnHold` is **not** a key in `DASHBOARD_WIDGET_LABELS` and appears in no role array,
which is consistent with the pipeline bar carrying no `data-dashboard-widget`.

### `execScrollTarget` / `execGoToTarget` come from plan 2 — with a stated fallback

Plan 2 (two links up this plan's dependency chain, so it has already merged when you run) adds two
properties to the object `_executiveDashboard` returns:

```
execScrollTarget(el)   el: Element|null -> 'ok' | 'missing' | 'hidden'   (pure; no scrolling)
execGoToTarget(el)     expands any containing .collapse, then scrolls to el.closest('.card')
                       and flashes it with the .exec-flash class; no-ops unless
                       execScrollTarget(el) === 'ok'
```

**Check for them at runtime rather than assuming**
(`if (typeof scope.execGoToTarget === 'function') { … }`). If the property is not present when you
come to implement — because plan 2 named it differently or has not landed — implement both to the
contract above **in this plan**, under those exact names, rather than inventing a different scroll
helper or calling `scrollIntoView` bare. State in your report which path you took.

The reason a bare `scrollIntoView` is not acceptable: the alerts card sits inside
`<div class="collapse" id="execAlertsCollapse">` (line 361 — plan 1 adds `show`, but the Bootstrap
toggle still works and persists nothing, so a user can fold it), and
`applyDashboardVisibility` (`executive_dashboard.js:237-249`) can set a `[data-dashboard-widget]`
wrapper to `display: none` per user. Scrolling to an element with no layout box silently does
nothing.

### No stage this data does not have

There is **no "cracking" or "drying" count** in that function, and this plan must not invent one.
The pipeline shows the stages the data actually has.

## Deliverables

### 1. Replace the six tiles with one pipeline bar

Delete the two rows holding those six tiles and put a single bar in their place:

```html
<div class="exec-pipe" id="execPipeline" role="group" aria-label="Open batches by stage"></div>
<p class="exec-pipe-note" id="execPipelineNote"></p>
```

This is static markup and holds no permission-gated control, so do not put `data-action-perm` on
it. Do **not** put `data-dashboard-widget` on it either — a new id is in nobody's visible-widget
list and would be hidden from every user permanently (`CLAUDE.md`).

### 2. Render the bar from the existing data

In `loadProductionStats`:

- **Render the zeroed bar first, before the `try`.** The bar must never be empty, and there are two
  paths that would otherwise leave it so: the line-334 early return (`dataFunctions` not loaded
  yet), and a first paint before the fetch resolves. So call your segment builder with the all-zero
  default object as the **first statement of the function**, then overwrite it with real data after
  the fetch returns. This is what makes the "must render six zeroed segments, not an empty bar"
  promise actually hold, and it means you never need to touch the line-334 guard.
- Delete the six `$('#execStatBatches…')` / `$('#execStatDispatch…')` writer lines for the ids whose
  markup you removed, and remove those same six ids from the error-path reset selector at line 350.
  Leave every other writer in that function alone — including the four whose elements are already
  missing.
- **Do not add a second call to `getDashboardProductionStats`.**

Segments, in this order, each labelled with its count and its stage name:

| Segment | Field | Tone |
|---|---|---|
| In intake | `batches_in_intake` | info |
| Awaiting test | `batches_awaiting_test` | warning |
| On hold | `batches_on_hold` | danger |
| Release ready | `batches_release_ready` | success |
| Dispatch pending | `dispatch_pending` | info |
| Completed this week | `batches_completed_week` | neutral |

Rules the data makes necessary:

- Segment width is proportional to its count: `flex: <count>` with a `min-width` in CSS so a
  segment with a small count is still readable and clickable.
- **A stage with a count of 0 still renders**, at minimum width, showing `0`. A missing stage is
  more confusing than an empty one.
- Every count comes from the response as-is. Do not re-coerce, do not sum, do not compute
  percentages of a total — `batches_completed_week` is a weekly throughput count and is not part of
  the same population as the open-stage counts. It is shown for context at the end of the bar and
  **must not** be included in any total or any "of N batches" phrasing.
- Write the note element as: `<n> open batches across five stages.` where `<n>` is the sum of the
  **five open stages only** (intake, awaiting test, on hold, release ready, dispatch pending) —
  completed-this-week excluded, consistent with the rule above. Set it with `textContent`.
- When `batches_on_hold` or `batches_awaiting_test` is greater than zero, give that segment a
  warning/danger tone **and** a Font Awesome icon (`fas fa-triangle-exclamation`, already used at
  `executive_dashboard.js:1384`) so the state is not carried by colour alone. Font Awesome only —
  never `bi bi-`.

The builder must be a pure property on the returned object (e.g.
`execPipelineSegments(stats) -> { segments: [...], note: '…' }`) so verify step 7 can exercise it
without a DOM. **Never add `module.exports` or `export` to `executive_dashboard.js`** — it is a
classic script (`var _executiveDashboard = function () { … }();`, line 5) and an `export` statement
makes it throw at parse time, taking the whole executive dashboard down.

### 3. Keep it keyboard reachable

Each segment is a `<button type="button">`. Clicking or pressing Enter on one brings the alerts card
into view via `execGoToTarget` — see the Facts section for the contract and the fallback — since the
alerts panel is where a piled-up stage gets acted on.

If `execScrollTarget` reports the alerts card is not `'ok'` (not in the DOM, or hidden by
`applyDashboardVisibility`), the segments still render but must not pretend to be actionable: set
`disabled` on them and drop the button affordance in CSS, rather than shipping a control that does
nothing.

Do not build a drawer or a batch list here — a per-stage list of batch records needs a data shape
this checkout does not confirm, and it is deliberately left out.

### 4. CSS

All new rules go in `WebPortal/modules/dashboard/css/executive_dashboard.css`.

- Tone colours from tokens only: `--mac-info`, `--mac-warning` with `--mac-warning-text` for text,
  `--mac-danger`, `--mac-success`, `--mac-border-strong` for neutral, plus `--mac-bg-tertiary`,
  `--mac-text*`, `--mac-radius-*`, `--mac-space-*`. **No raw hex.**
- **No `linear-gradient(` in any form** — the gate's check is a substring match, so
  `repeating-linear-gradient` fails too.
- The bar scrolls horizontally on a narrow screen: put `overflow-x: auto` on `.exec-pipe` so the
  page body never scrolls sideways.
- `font-variant-numeric: tabular-nums` on the counts.
- No `.badge { min-width }` rule, no bare `td`/`th` padding rule.
- Do **not** redefine `.exec-flash`, `.exec-chip*`, `#execToastHost` (plan 2) or `.exec-tile*`
  (plan 3). Prefix everything new here with `exec-pipe`.

## Verify before finishing

1. `npm run test:fleet` — must pass. **Do not run `npm ci`** and **do not `npm install` anything**
   (no `package-lock.json`, zero deps; step 7 needs no dependency).
2. `grep -rn "execStatBatchesAwaitingTest\|execStatBatchesReleaseReady\|execStatBatchesCompletedWeek\|execStatBatchesInIntake\|execStatDispatchWeek\|execStatDispatchPending" WebPortal/`
   — must return **no matches** anywhere in the tree: not in the markup, not in
   `loadProductionStats`, not in its error-path selector, not in `DASHBOARD_WIDGET_LABELS`, and not
   in `getDefaultWidgetsForRole`. Note the `-r`: a non-recursive `grep` on a directory prints
   "Is a directory" and proves nothing.
3. **Label count.** `node -e "const s=require('fs').readFileSync('WebPortal/modules/dashboard/js/executive_dashboard.js','utf8');console.log((s.match(/^\s+exec[A-Za-z]+:\s*'/gm)||[]).length)"`
   — report the number before and after this plan's change; it must drop by exactly **6**.
4. **The fetch guard survived.** `grep -c "getDashboardProductionStats" WebPortal/modules/dashboard/js/executive_dashboard.js`
   must be exactly **2** — the guard on line 334 and the call on line 335. If it reads 1 you have
   deleted the guard; put it back. If it reads 3 you have added a second fetch, which this plan
   forbids.
5. **Role defaults.** Print each array's length before and after and compare against the table in
   the Facts section (`production` 11→7, `qa` 4→2, `forecastSales` 4→3, `oil` unchanged):
   `node -e "const s=require('fs').readFileSync('WebPortal/modules/dashboard/js/executive_dashboard.js','utf8');for(const n of ['production','oil','qa','forecastSales']){const m=s.match(new RegExp('var '+n+' = \\\\[([\\\\s\\\\S]*?)\\\\];'));console.log(n, m?m[1].split(',').length:'?')}"`
6. `grep -n "#[0-9a-fA-F]\{3,8\}" WebPortal/modules/dashboard/css/executive_dashboard.css` — no
   matches beyond `#fff`/`#000`; and `grep -in "linear-gradient"` on the same file — no matches;
   and `grep -rn "bi bi-\|btn-success" WebPortal/modules/dashboard/` — no matches.
7. **The segment builder, as a pure function, in a `node:vm` context.** Copy the harness pattern at
   `scripts/verify-report-rendering.mjs:45-58`. Write this to a temp file outside the repo, run it
   with `node`, and delete it before you finish:

   ```js
   import fs from 'node:fs';
   import vm from 'node:vm';
   const P = 'WebPortal/modules/dashboard/js/executive_dashboard.js';
   const ctx = { window: {}, document: { getElementById: () => null }, console };
   vm.createContext(ctx);
   new vm.Script(fs.readFileSync(P, 'utf8'), { filename: P }).runInContext(ctx);
   const build = ctx._executiveDashboard.execPipelineSegments;
   const zero = { batches_awaiting_test: 0, batches_release_ready: 0, batches_completed_week: 0,
                  batches_in_intake: 0, dispatch_pending: 0, batches_on_hold: 0 };
   const a = build(zero);
   console.log('zero segments ->', a.segments.length, a.segments.map(s => s.count).join(','));
   console.log('zero note     ->', a.note);
   const b = build({ batches_in_intake: 4, batches_awaiting_test: 2, batches_on_hold: 1,
                     batches_release_ready: 5, dispatch_pending: 3, batches_completed_week: 9 });
   console.log('order         ->', b.segments.map(s => s.label).join(' | '));
   console.log('on-hold       ->', JSON.stringify(b.segments.find(s => /hold/i.test(s.label))));
   console.log('note          ->', b.note);
   ```

   Required results: six segments all `0` and the note `0 open batches across five stages.` for the
   zero case; segment order `In intake | Awaiting test | On hold | Release ready | Dispatch pending
   | Completed this week`, the on-hold segment carrying count `1` and the danger tone, and the note
   `15 open batches across five stages.` (4+2+1+5+3 = 15, completed-this-week excluded) for the
   second. Paste every line into your report.
8. `git diff HEAD --name-only` — must list only
   `WebPortal/modules/dashboard/html/dashboard_unified.html`,
   `WebPortal/modules/dashboard/js/executive_dashboard.js` and
   `WebPortal/modules/dashboard/css/executive_dashboard.css`. Use `HEAD` so the check still works
   if you have staged your changes.

## Blast radius on existing tests

`ui:verify` inside `test:fleet` is the one that reacts to this plan; it is currently green (its
pre-existing violations were cleared 2026-08-04), so any violation it reports is yours. Fix the
code, not the verifier, and never edit `package.json`.

## Out of scope

Anything touching Production Trends, Stock on hand history or the Raw material runway forecast.
Any per-batch drill-down list. Adding markup for `execStatOilSheetsWeek`,
`execStatQualityPassRate` or `execStatQualityTestsWeek`. The `oil` role-default array.
