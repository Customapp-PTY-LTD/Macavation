---
depends_on: exec-dash-03b-stat-tiles.md
preflight: pass f5368e1c0608
---

# Executive dashboard — six batch counts become one pipeline bar

## Why

After the stat-strip plan the Kernel operations card still carries six separate count tiles —
awaiting test, release ready, completed this week, in intake, dispatch this week, dispatch pending.
Six numbers in six boxes tell you the counts but not where work is piling up. This plan replaces
them with a single segmented bar whose segment widths are the counts, so a queue is visible at a
glance.

**This plan supersedes `exec-dash-04-pipeline.md`, which never ran.** It waits on
`exec-dash-03b-stat-tiles.md` because both edit the same three files. Every line number below is
re-verified against the base branch at `ea98cc3`, **before** the stat-strip plan lands — so
re-grep each anchor rather than trusting the number if the two differ.

## Facts about this repo that this plan relies on (verified against `dev` at `ea98cc3`, 2026-09-03)

The two files this plan edits were rewritten substantially by two earlier merged plans —
`dashboard_unified.html` is now **764 lines** and `executive_dashboard.js` **2189 lines**. The
stat-strip plan this one waits on will shift them again; **the ids below are stable, the line
numbers are not.** Grep for the id, use the line number only as a starting hint.

- The six tiles live in `WebPortal/modules/dashboard/html/dashboard_unified.html` inside
  `data-access="executive"`, in the Kernel operations card
  (`<div class="collapse show" id="execKernelOpsCollapse">`, line **348**), in the two rows after
  the strip. Their ids and current lines: `execStatBatchesAwaitingTest` (**394**),
  `execStatBatchesReleaseReady` (**402**), `execStatBatchesCompletedWeek` (**410**),
  `execStatBatchesInIntake` (**418**), `execStatDispatchWeek` (**429**), `execStatDispatchPending`
  (**437**). Each sits in a `<div class="col-6 col-md-4 col-lg" data-dashboard-widget="…">`.
- They are filled by `loadProductionStats` (`executive_dashboard.js:656`) from
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
656  loadProductionStats: async () => {
...
659      try {
660          if (typeof dataFunctions === 'undefined' || !dataFunctions.getDashboardProductionStats) return;
661          const s = await dataFunctions.getDashboardProductionStats();
```

So `getDashboardProductionStats` appears **twice** in this file — once in the guard on line 660 and
once in the call on line 661. That is correct and both must stay. **Do not delete the guard**; it is
what stops the dashboard throwing when the data layer has not loaded yet. Verify step 4 asserts the
count is 2, not 1 — an earlier version of this plan asserted 1, which no edit it authorised could
ever produce, and the likeliest way to satisfy it would have been deleting that guard.

The writers are lines 662-673 and the `catch` selector that resets all twelve is line **676**.

### `batches_on_hold` — stated precisely, because an earlier version got this wrong

An earlier version of this plan said `batches_on_hold` "is not shown anywhere on the dashboard
today", which reads as if the code ignores it. **The code does not ignore it.** The accurate
position, traced:

- `data-functions.js:2296` lists it in the zeroed default object and `:2317` maps it with
  `Number(row.batches_on_hold) || 0`.
- `executive_dashboard.js:666` already writes it: `$('#execStatBatchesOnHold').text(fmt(s.batches_on_hold));`
- `executive_dashboard.js:676` already resets it on the error path, inside the combined selector.
- **But `grep -n 'execStatBatchesOnHold' WebPortal/modules/dashboard/html/dashboard_unified.html`
  returns nothing.** There is no element with that id, so both of those jQuery calls select an empty
  set and do nothing. The number is fetched, coerced and written into the void.

So what this plan adds is the **markup that makes an already-written value visible** — not a new
writer. Concretely: **do not add another `$('#execStatBatchesOnHold')` line, and do not add a second
fetch.** Build the bar from the same `s` object `loadProductionStats` already has in scope.

(Three sibling ids are in the same state — `execStatOilSheetsWeek`, `execStatQualityPassRate`,
`execStatQualityTestsWeek` are written at lines 669-671 with no element in the markup. They are
**out of scope**; do not add markup for them, and do not remove their writers.)

### Retiring a widget id means editing THREE places — the third is role defaults

`CLAUDE.md` says a dashboard widget id is registered in three places. This plan retires six ids, and
**all three sites must be edited** or verify step 2 cannot pass. All three edits are authorised:

1. **The markup and the writers** — deliverables 1 and 2.
2. **`DASHBOARD_WIDGET_LABELS`** (`executive_dashboard.js:75`) — delete the six keys:
   `execStatBatchesAwaitingTest` (line 82), `execStatBatchesReleaseReady` (83),
   `execStatBatchesCompletedWeek` (84), `execStatBatchesInIntake` (85), `execStatDispatchWeek` (88),
   `execStatDispatchPending` (89). `saveCustomizeModal` (line **601**) compares
   `visible.length === Object.keys(DASHBOARD_WIDGET_LABELS).length`, and removing keys shrinks both
   sides together, so the "all selected → store null" behaviour stays correct. Change nothing else
   in `saveCustomizeModal`.
3. **`getDefaultWidgetsForRole`'s hardcoded role arrays** (`executive_dashboard.js:534`, arrays at
   **546-552**) — four of the six ids appear here, across **three** arrays. This is the site the
   previous version of this plan missed entirely. Remove them, and expect exactly these results:

   | Array | Line | Retired ids to remove | Entries before → after |
   |---|---|---|---|
   | `production` | 546-549 | `execStatBatchesAwaitingTest`, `execStatBatchesReleaseReady`, `execStatBatchesCompletedWeek`, `execStatBatchesInIntake` | **11 → 7** (11, not 13, because the stat-strip plan removes two first) |
   | `qa` | 551 | `execStatBatchesAwaitingTest`, `execStatBatchesReleaseReady` | **4 → 2** |
   | `forecastSales` | 552 | `execStatBatchesCompletedWeek` | **4 → 3** |

   Leave the `oil` array (line 550) untouched — none of the six appears in it.

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

### The scroll helper already exists — use it, do not rebuild it

`exec-dash-02-alerts.retry-1.md` has merged, so these are present in the file **now**:

- **`execScrollTarget: (el) => …`** at `executive_dashboard.js:1887`. Pure; takes an Element or
  null; returns `'missing'`, `'hidden'` (its `[data-dashboard-widget]` ancestor has
  `style.display === 'none'`, i.e. `applyDashboardVisibility` at line **563** hid it) or `'ok'`.
- **`execGoToTarget: (el) => …`** at `executive_dashboard.js:1898`. No-ops unless
  `execScrollTarget(el) === 'ok'`; expands the containing `.collapse`, sets the toggle's
  `aria-expanded="true"`, waits for `shown.bs.collapse` with a 400ms fallback, then scrolls
  `el.closest('.card')` into view and flashes it with `exec-flash`. It already honours
  `prefers-reduced-motion`.

The alerts card this plan scrolls to is `<div class="card-body" id="execAlertsContainer">`
(`dashboard_unified.html:235`), inside `<div class="collapse show" id="execAlertsCollapse">`
(line **222**) — which starts open but can be folded by the user, which is exactly why the helper
exists. **Call `_executiveDashboard.execGoToTarget(el)`. Do not write a second scroll
implementation, do not call `scrollIntoView` directly, and do not re-declare either helper.**

### Hiding things: this module owns a class for it

`execSetHidden(el, isHidden)` at `executive_dashboard.js:1943` toggles the module's own
`exec-hidden` class (`executive_dashboard.css:134`, `display: none !important`). The merged alerts
plan established this as the module's only hiding mechanism — **never `el.hidden`, never a Bootstrap
display utility**. If this plan needs to hide anything, call `execSetHidden`.

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
  paths that would otherwise leave it so: the guard's early return (`dataFunctions` not loaded yet),
  and a first paint before the fetch resolves. So call your segment builder with the all-zero
  default object as the **first statement of the function**, then overwrite it with real data after
  the fetch returns. This is what makes the "must render six zeroed segments, not an empty bar"
  promise actually hold, and it means you never need to touch the guard.
- Delete the six `$('#execStatBatches…')` / `$('#execStatDispatch…')` writer lines for the ids whose
  markup you removed, and remove those same six ids from the error-path reset selector at line 676.
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
  `executive_dashboard.js:127` and `:1709`) so the state is not carried by colour alone. Font
  Awesome only — never `bi bi-`.

The builder must be a pure property on the returned object (e.g.
`execPipelineSegments(stats) -> { segments: [...], note: '…' }`) so verify step 7 can exercise it
without a DOM. **Never add `module.exports` or `export` to `executive_dashboard.js`** — it is a
classic script (`var _executiveDashboard = function () { … }();`, line 5) and an `export` statement
makes it throw at parse time, taking the whole executive dashboard down.

### 3. Keep it keyboard reachable

Each segment is a `<button type="button">`. Clicking or pressing Enter on one brings the alerts card
into view with
`_executiveDashboard.execGoToTarget(document.getElementById('execAlertsContainer'))` — since the
alerts panel is where a piled-up stage gets acted on.

If `_executiveDashboard.execScrollTarget(document.getElementById('execAlertsContainer'))` does not
return `'ok'` at render time (the container is absent, or `applyDashboardVisibility` hid its
wrapper for this user), the segments still render but must not pretend to be actionable: set
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
- **Do not redefine anything an earlier merged plan already owns** in this file: `.exec-alert-*`,
  `.exec-toast*`, `@keyframes exec-flash-pulse` / `.exec-flash`, `.exec-chip*`, `.exec-hidden`, or
  the `.exec-tile*` rules the stat-strip plan adds. Prefix everything new here with `exec-pipe`.

## Verify before finishing

1. `npm run test:fleet` — must pass. **Do not run `npm ci`** and **do not `npm install` anything**
   (no `package-lock.json`, zero deps; step 7 needs no dependency).
2. `grep -rn "execStatBatchesAwaitingTest\|execStatBatchesReleaseReady\|execStatBatchesCompletedWeek\|execStatBatchesInIntake\|execStatDispatchWeek\|execStatDispatchPending" WebPortal/`
   — must return **no matches** anywhere in the tree: not in the markup, not in
   `loadProductionStats`, not in its error-path selector, not in `DASHBOARD_WIDGET_LABELS`, and not
   in `getDefaultWidgetsForRole`. Note the `-r`: a non-recursive `grep` on a directory prints
   "Is a directory" and proves nothing.
3. **Counts.** Write this to a temp file outside the repo and run it with `node` from the repo root,
   before and after your change. Do not try to express it as a shell one-liner — the nested escaping
   is what makes those silently wrong.

   ```js
   const fs = require('fs');
   const s = fs.readFileSync('WebPortal/modules/dashboard/js/executive_dashboard.js', 'utf8');
   for (const name of ['production', 'oil', 'qa', 'forecastSales']) {
     const m = s.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
     console.log('role array', name.padEnd(14), m ? m[1].split(',').length : '?');
   }
   console.log('widget labels', (s.match(/^\s+exec[A-Za-z]+:\s*'/gm) || []).length);
   console.log('getDashboardProductionStats', (s.match(/getDashboardProductionStats/g) || []).length);
   console.log('execStatBatchesOnHold', (s.match(/execStatBatchesOnHold/g) || []).length);
   ```

   Required after your change: `production` **7**, `qa` **2**, `forecastSales` **3**, `oil`
   unchanged at **4**; widget labels down by exactly **6**;
   `getDashboardProductionStats` still **2** (the guard on line 660 and the call on 661 — if it
   reads 1 you deleted the guard, put it back; if 3 you added a second fetch, which is forbidden);
   `execStatBatchesOnHold` still **2** (the writer and the error-path reset — if it reads 3 you
   added a duplicate writer). Paste both runs into your report.
4. `grep -n "#[0-9a-fA-F]\{3,8\}" WebPortal/modules/dashboard/css/executive_dashboard.css` — no
   matches beyond `#fff`/`#000`; and `grep -in "linear-gradient"` on the same file — no matches;
   and `grep -rn "bi bi-\|btn-success" WebPortal/modules/dashboard/` — no matches.
5. `grep -n "execGoToTarget\|execScrollTarget" WebPortal/modules/dashboard/js/executive_dashboard.js`
   — the definitions must still be single (one `execScrollTarget:` and one `execGoToTarget:`),
   proving you called the merged helpers rather than re-declaring them. Paste the lines.
6. `grep -rn "\.hidden = \|d-none" WebPortal/modules/dashboard/js/executive_dashboard.js | grep -i pipe`
   — must return no matches, proving any hiding this plan does goes through `execSetHidden`.
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

`ui:verify` inside `test:fleet` is the one that reacts to this plan; it is currently green on `dev`,
so any violation it reports is yours. Fix the code, not the verifier, and never edit `package.json`.

## Out of scope

Anything touching Production Trends, Stock on hand history or the Raw material runway forecast.
Any per-batch drill-down list. Adding markup for `execStatOilSheetsWeek`,
`execStatQualityPassRate` or `execStatQualityTestsWeek`. The `oil` role-default array. The alerts
panel and the stat strip.
