---
preflight: pass 432552c45e2a
---

# Executive dashboard — five stat tiles that carry their own context

## Why

The executive dashboard shows eleven stat tiles across three rows. Each is a label and a number,
and most read as an em dash until their data loads. A number with nothing beside it does not tell
you whether it is good. This plan replaces the first row with five tiles that each carry a
change-against-yesterday chip and a fourteen-day sparkline, and makes a tile click set the metric
on the Production Trends chart already on the page.

The remaining batch-count tiles become a pipeline bar in the plan that follows this one. This plan
leaves them alone.

**This plan supersedes `exec-dash-03-stat-tiles.md`, which never ran.** Its predecessors
(`exec-dash-01-layout.md` and `exec-dash-02-alerts.retry-1.md`) have both merged, so this plan
carries **no `depends_on`** — every line number below is re-verified against the current base
branch (`ea98cc3`), not against the pre-merge file the earlier version cited.

## Facts about this repo that this plan relies on (verified against `dev` at `ea98cc3`, 2026-09-03)

The two files this plan edits were both rewritten substantially by the two merged plans above —
`dashboard_unified.html` is now **764 lines** and `executive_dashboard.js` **2189 lines**. Trust
the line numbers here, and re-grep before editing if anything does not match.

- The tiles live in `WebPortal/modules/dashboard/html/dashboard_unified.html` inside
  `data-access="executive"`, in the "Kernel operations" collapse card
  (`<div class="collapse show" id="execKernelOpsCollapse">`, line **348**). The first row holds five
  tiles: `execStatBatchesInProduction` (line **351**), `execStatKgCrackedToday` (**359**),
  `execStatKgCrackedWeek` (**367**), `execStatKgPackedToday` (**375**), `execStatKgPackedWeek`
  (**383**), each wrapped in a `<div class="col-6 col-md-4 col-lg" data-dashboard-widget="…">`.
- Those five are filled by `loadKernelStats` (`executive_dashboard.js:618`) from
  `dataFunctions.getDashboardKernelStats()` (`WebPortal/js/data-functions.js:1601`, DB function
  `get_dashboard_kernel_stats`). It returns exactly
  `{ batches_in_production, kg_cracked_today, kg_cracked_week, kg_packed_today, kg_packed_week }`,
  all coerced to numbers, with a zeroed default object on failure. The writers are lines 623-627 and
  the `catch` selector that resets all five is line **630**.

### Removing a widget id means editing THREE places, not one

`CLAUDE.md` says a dashboard widget id is registered in three places, and this plan retires two ids
(`execStatKgCrackedWeek`, `execStatKgPackedWeek`). All three sites must be edited or the retirement
is half-done — and verify step 3 cannot pass. **All three edits are authorised by this plan:**

1. **`DASHBOARD_WIDGET_LABELS`** (`executive_dashboard.js:75`) — delete
   `execStatKgCrackedWeek: 'Kg cracked this week',` (line **79**) and
   `execStatKgPackedWeek: 'Kg packed this week',` (line **81**). Otherwise the Customize modal keeps
   offering checkboxes for tiles that no longer exist. `saveCustomizeModal` (line **601**) compares
   `visible.length === Object.keys(DASHBOARD_WIDGET_LABELS).length`; removing keys shrinks both
   sides together, so the "all selected → store null" behaviour stays correct. Change nothing else
   in `saveCustomizeModal`.
2. **`getDefaultWidgetsForRole`'s hardcoded role defaults** (`executive_dashboard.js:534`) — the
   `production` array spans lines **546-549** and currently reads:
   ```js
   var production = ['totalProduction', 'execStatBatchesInProduction', 'execStatKgCrackedToday', 'execStatKgCrackedWeek',
       'execStatKgPackedToday', 'execStatKgPackedWeek', 'execStatBatchesAwaitingTest', 'execStatBatchesReleaseReady',
       'execStatBatchesCompletedWeek', 'execStatBatchesInIntake', 'execDailyMinuteTests', 'execProductionTrends',
       'execRunwayForecast'];
   ```
   Remove the two retired ids from it. **The intended result is that `production` goes from 13
   entries to 11**, so the "production manager" role's default dashboard no longer lists two tiles
   that do not exist. That is the whole behavioural change; state the before and after counts in
   your report. Do not touch `oil` (line 550), `qa` (551) or `forecastSales` (552) — neither retired
   id appears in them.
3. **The markup and the writers** — deliverable 1.

### The daily history arrives NEWEST FIRST — this is the trap in this plan

`dataFunctions.getProductionTrendsDaily(days)` (`WebPortal/js/data-functions.js:2109`, DB function
`get_production_trends_daily`) returns rows shaped
`{ trend_date: string, kg_cracked: number, kg_packed: number, kg_dispatched: number }`.

**The rows are ordered newest first, not oldest first.** The function's SQL body ends
`ORDER BY dates.d DESC` — `migrations/20260818090400_production_trends_monthly_and_desc_order.sql:106`,
and the migration's own header comment (lines 13–14) states the reason: *"Order the daily function
DESC so a truncated response keeps the NEWEST days, never the oldest. The client re-sorts ascending,
so nothing downstream changes."* The existing consumer does exactly that re-sort, in
`renderProductionTrendsChart` (the `localeCompare` at `executive_dashboard.js:900`):

```js
var daily = data.slice().sort(function (a, b) {
    var da = a && a.trend_date ? String(a.trend_date) : '';
    var db = b && b.trend_date ? String(b.trend_date) : '';
    return da.localeCompare(db);
});
```

So **`rows[0]` is today and `rows[rows.length - 1]` is fourteen days ago.** An earlier version of
this plan said the opposite, and it would have produced a two-week-old "dispatched today", arrows
pointing the wrong way, and sparklines drawn backwards — all of it plausible-looking and none of it
caught by any grep. **Sort a copy ascending by `trend_date` before you read any position**, exactly
as the code above does, and never index into the raw response.

Two further things the function's own comments make explicit and this plan must respect:

- `days` is clamped to `Math.max(7, Math.min(1000, …))`.
- The RPC **back-fills one row per calendar day**, so a quiet day arrives as a real row with zeros,
  not as a gap. Days with no production are therefore zeros, not missing.

It returns `[]` on failure rather than throwing.

### `executive_dashboard.js` is a classic script — how to expose helpers

The file is `var _executiveDashboard = function () { … }();` (line **5**). **Never add
`module.exports`, `export` or `import` to it** — it is loaded as a classic script and an `export`
statement makes it throw at parse time, taking the whole executive dashboard down. Expose every new
helper as a **property on the object it returns**, so verify step 7 can reach it as
`ctx._executiveDashboard.<name>` after loading the file into a `node:vm` context. The repo already
tests browser-global JS this way — `scripts/verify-report-rendering.mjs:45-58`.

### The scroll helpers already exist — use them, do not rebuild them

`exec-dash-02-alerts.retry-1.md` has merged, so these are present in the file **now**, not
hypothetically. Read them before calling them:

- **`execScrollTarget: (el) => …`** at `executive_dashboard.js:1887`. Pure; takes an Element or
  null; returns `'missing'` (null, no `.closest`, or no `.card` ancestor), `'hidden'` (its
  `[data-dashboard-widget]` ancestor has `style.display === 'none'`, i.e. `applyDashboardVisibility`
  at line **563** hid it for this user), or `'ok'`.
- **`execGoToTarget: (el) => …`** at `executive_dashboard.js:1898`. No-ops unless
  `execScrollTarget(el) === 'ok'`; expands the containing `.collapse` (via
  `bootstrap.Collapse.getOrCreateInstance`, falling back to adding the `show` class), sets the
  toggle's `aria-expanded="true"`, waits for `shown.bs.collapse` with a 400ms fallback, then
  scrolls `el.closest('.card')` into view and flashes it with `exec-flash` for 1600ms. It already
  honours `prefers-reduced-motion` via `matchMedia`.

**Call `_executiveDashboard.execGoToTarget(el)`. Do not write a second scroll implementation, do
not call `scrollIntoView` directly, and do not re-declare either helper.**

### Hiding things: this module owns a class for it

`execSetHidden(el, isHidden)` at `executive_dashboard.js:1943` toggles the module's own
`exec-hidden` class (`executive_dashboard.css:134`, `display: none !important`). The merged alerts
plan established this as the module's only hiding mechanism — **never `el.hidden`, never a Bootstrap
display utility**. If this plan needs to hide anything, call `execSetHidden`.

### The rest

- Nut-in-shell cover comes from `dataFunctions.getKernelRunwaySummary()`
  (`WebPortal/js/data-functions.js:2092`, DB function `get_kernel_runway_summary`), already used by
  `loadRunwaySummary` (`executive_dashboard.js:2021`) to fill `#execRunwaySohKg` (line 2028),
  `#execRunwayWeeks` (2029), `#execRunwayMonths` (2030) and `#execRunwayDemand` (2031). It reads
  `r.soh_kg`, `r.weeks_cover` and `r.months_cover` — **reuse exactly those field names**. Note its
  existing style: `$('#execRunwayWeeks').text(weeks != null ? weeks + ' wks' : '—')`, and a `catch`
  at 2032-2034 that sets all four to `'—'`.
- The Production Trends metric picker is `<select id="productionTrendsMetric">`
  (`dashboard_unified.html:478`) with option values `kg_cracked`, `kg_packed`, `kg_dispatched`. Its
  existing `change` handler is `executive_dashboard.js:716`, and the redraw it calls is
  `scope.updateProductionTrendsChart()`, defined at `executive_dashboard.js:1070`. Call
  `updateProductionTrendsChart()` — that is the method name; it is confirmed, not a guess.
- The Production Trends card sits inside `<div class="collapse show" id="execChartsCollapse">`
  (line **456**). It starts open, but the Bootstrap toggle still works and persists nothing, so a
  user can fold it — which is exactly why deliverable 5 goes through `execGoToTarget`.

## Deliverables

### 1. Replace the first tile row with a five-tile strip

In `dashboard_unified.html`, replace **only** the first row of the Kernel operations card (the five
tiles at lines 351-390) with a strip of five tiles:

| Tile | Big number | Written by | Chip | Sparkline |
|---|---|---|---|---|
| Cracked today | `kg_cracked_today` | `loadKernelStats` (unchanged) | vs yesterday | 14 days of `kg_cracked` |
| Packed today | `kg_packed_today` | `loadKernelStats` (unchanged) | vs yesterday | 14 days of `kg_packed` |
| Dispatched today | `kg_dispatched` of the latest day | **`loadTileHistory`** (deliverable 4) | vs yesterday | 14 days of `kg_dispatched` |
| Batches in production | `batches_in_production` | `loadKernelStats` (unchanged) | none | none |
| Nut-in-shell cover | `weeks_cover` | **`loadRunwaySummary`** (deliverable 4) | none | none |

"Latest day" means the **last** element of your ascending-sorted copy, which is the **first**
element of the raw response. Do not read `rows[rows.length - 1]` off the raw array.

Keep the existing ids `execStatKgCrackedToday`, `execStatKgPackedToday` and
`execStatBatchesInProduction` on the elements that hold those numbers, so `loadKernelStats` keeps
working unchanged. Give the two new numbers the ids `execStatKgDispatchedToday` and
`execStatNisCover`.

`execStatKgCrackedWeek` and `execStatKgPackedWeek` are retired. Delete their markup, delete the two
lines in `loadKernelStats` that write them (lines **625** and **627**), **and remove both ids from
that function's `catch` selector at line 630** — leave the rest of the function, including its use
of every other field the data function returns, intact. Then do the two registry edits described in
"Removing a widget id means editing THREE places" above.

Preserve `data-dashboard-widget` on the tiles that already carry it and are staying. Do **not** put
`data-dashboard-widget` on the two new tiles: per `CLAUDE.md` an id that is not in
`DASHBOARD_WIDGET_LABELS` and the hardcoded role defaults is hidden from everyone, permanently.

### 2. Sparklines, drawn as inline SVG

Add a `renderSparkline(hostEl, values, colorVar)` property that builds an inline `<svg>` by hand —
a filled area at low opacity, a 1.6px line, and a dot on the last point. `values` arrives
**oldest-first** (deliverable 4 sorts it); the dot therefore belongs on the last element. State that
in a comment.

Do **not** add a charting library for this, and do not reach for `Chart` here. The repo does use
Chart.js for the real charts, but a 14-point sparkline in a stat tile does not need it and this
plan adds no new dependency.

Rules the helper must follow, because they are the cases the data actually produces:

- If `values.length < 2`, render nothing and leave the tile without a sparkline. Do not draw a
  single-point chart.
- If every value is equal (including all-zero, which the back-filled RPC genuinely returns for a
  quiet fortnight), draw a flat line at the vertical middle. Do not divide by a zero range.
- Take the colour from a CSS custom property name passed in (`--mac-success` etc.) via
  `getComputedStyle(document.documentElement).getPropertyValue(name).trim()`, so no colour literal
  appears in the JS or the CSS.

### 3. The change-against-yesterday chip

Compute from the same `getProductionTrendsDaily` rows, not from a second call, and **from the
ascending-sorted copy**:

- "Today" is the **last** row of the sorted copy; "yesterday" is the **second to last**. The RPC
  back-fills every calendar day, so these are adjacent days, and the last row may legitimately be
  zero.
- If there are fewer than two rows, render no chip.
- If yesterday is `0`, render the chip as `no comparison` rather than a percentage — do not divide
  by zero and do not render `Infinity%`.
- Otherwise render `▲ N%` or `▼ N%` rounded to a whole number, where
  `N = Math.round(Math.abs(today - yesterday) / yesterday * 100)`.
- Up is the good direction for all three of these metrics, so `▲` takes the success tone and `▼`
  the danger tone. State that in a comment so it is not re-derived later.

### 4. Fetch once, per load — and wire the two new tiles

Add one `loadTileHistory()` property that calls `getProductionTrendsDaily(14)` a single time,
**sorts a copy of the response ascending by `trend_date`** (see the Facts section — the response is
DESC), and from that one sorted array feeds:

- the three sparklines,
- the three chips,
- **and `#execStatKgDispatchedToday`**, set to the last row's `kg_dispatched`, formatted the same
  way `loadKernelStats` formats its numbers (`toLocaleString('en-ZA', { maximumFractionDigits: 0 })`).

Call it from `init` alongside the existing loaders.

**`#execStatNisCover` is written by `loadRunwaySummary`** (line 2021), not by `loadTileHistory`.
Add one line there setting it from `r.weeks_cover`, following that function's existing style
(`weeks != null ? weeks + ' wks' : '—'`), and add `#execStatNisCover` to the `catch` selector at
line 2033 so it falls back to an em dash like its four siblings. That is the only change this plan
makes to `loadRunwaySummary`.

**Failure behaviour, stated per tile** — an earlier version of this plan promised "every tile keeps
its number", which is impossible for Dispatched today, whose only source is the call that failed:

- If `getProductionTrendsDaily` returns `[]` or throws: `execStatKgCrackedToday`,
  `execStatKgPackedToday` and `execStatBatchesInProduction` keep the numbers `loadKernelStats` gave
  them, and simply show no sparkline and no chip. **`#execStatKgDispatchedToday` shows an em dash
  (`—`)**, matching what every other unavailable number on this dashboard shows.
- If `getKernelRunwaySummary` returns `{}` or throws: `#execStatNisCover` shows an em dash, via the
  existing `catch` and the `weeks != null` guard.
- A tile must never break because history is unavailable.

Extract the sort + the delta into pure properties (`execTileSeries(rows, field)` returning
`{ values, today, yesterday }`, and the delta helper) so verify step 7 can exercise them without a
DOM.

### 5. Clicking a tile drives the Production Trends chart

The three flow tiles become buttons. Clicking one:

- sets `document.getElementById('productionTrendsMetric').value` to `kg_cracked`, `kg_packed` or
  `kg_dispatched`;
- calls `_executiveDashboard.updateProductionTrendsChart()` (confirmed at line 1070);
- brings the Production Trends card into view with
  `_executiveDashboard.execGoToTarget(document.getElementById('productionTrendsChart'))` — the
  merged helper at line 1898, which handles the folded-section and hidden-widget cases and the
  flash. Do not write your own scroll;
- sets `aria-pressed="true"` on itself and `false` on the other two.

If `#productionTrendsMetric` is not in the DOM, do nothing rather than throwing. `execGoToTarget`
already no-ops safely when its target is missing or hidden, so no extra guard is needed around it.

**Do not change Production Trends itself.** Its markup, its controls, its paging, its
hide-weekends switch and its rendering function stay exactly as they are. This plan only sets the
value of a `<select>` that already exists and calls a redraw that already exists.

### 6. CSS

All new rules go in `WebPortal/modules/dashboard/css/executive_dashboard.css` (134 lines today,
already registered for the dashboard route in `WebPortal/js/appRouteConfig.json` — do not add a
file).

- Tokens only — `--mac-success`, `--mac-danger`, `--mac-warning` / `--mac-warning-text`,
  `--mac-info`, `--mac-border`, `--mac-text*`, `--mac-radius-*`, `--mac-space-*`,
  `--mac-shadow-card`, `--mac-text-xs`/`-sm`/`-xl`. **No raw hex.**
- **No `linear-gradient(` in any form** — the gate matches the substring, so
  `repeating-linear-gradient` fails too.
- Use `font-variant-numeric: tabular-nums` on the big numbers so they do not jitter as they update.
- No `.badge { min-width }`, no bare `td`/`th` padding rules.
- **Do not redefine anything the merged alerts plan already owns** in this file: `.exec-alert-*`
  (lines 21-95), `.exec-toast*` (97-118), `@keyframes exec-flash-pulse` / `.exec-flash` (120-125),
  `.exec-chip*` (31-50), `.exec-hidden` (134). Prefix everything new in this plan with `exec-tile`.

## Verify before finishing

1. `npm run test:fleet` — must pass. **Do not run `npm ci`** and **do not `npm install` anything**
   (no `package-lock.json`, zero deps; step 7 needs no dependency).
2. `grep -n "getDashboardKernelStats\|batches_in_production\|kg_cracked_today\|kg_packed_today" WebPortal/modules/dashboard/js/executive_dashboard.js`
   — must still be present, proving `loadKernelStats` still consumes the existing data function.
3. `grep -rn "execStatKgCrackedWeek\|execStatKgPackedWeek" WebPortal/` — must return **no matches**
   anywhere in the tree: not in the markup, not in `loadKernelStats`, not in its `catch` selector,
   not in `DASHBOARD_WIDGET_LABELS`, not in `getDefaultWidgetsForRole`. Note the `-r`: a
   non-recursive `grep` on a directory prints "Is a directory" and proves nothing.
4. **Counts.** Write this to a temp file outside the repo and run it with `node` from the repo root,
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
   ```

   Required: `production` **13 → 11**; `oil`, `qa` and `forecastSales` **unchanged at 4**; widget
   labels **26 → 24**. Paste both runs into your report.
5. `grep -n "#[0-9a-fA-F]\{3,8\}" WebPortal/modules/dashboard/css/executive_dashboard.css` — no
   matches beyond `#fff`/`#000`; and `grep -in "linear-gradient"` on the same file — no matches;
   and `grep -rn "bi bi-\|btn-success" WebPortal/modules/dashboard/` — no matches.
6. **Production Trends' own logic is untouched.** Compare only added and removed lines, not diff
   context, and use `HEAD` so staging does not make it vacuous:
   `git diff HEAD -U0 -- WebPortal/modules/dashboard/js/executive_dashboard.js | grep -E "^[+-]" | grep -v "^[+-][+-]" | grep -n "renderProductionTrendsChart\|productionTrendsRangeKey\|productionTrendsHideWeekends\|productionTrendsPageOffset"`
   — must return **no matches**. (Adding your tile handler near the existing production-trends
   handlers is fine; this form ignores unchanged context lines, so it will not fire on that.)
7. **Ordering and delta, on pure functions, in a `node:vm` context.** Copy the harness pattern at
   `scripts/verify-report-rendering.mjs:45-58`. Write this to a temp file outside the repo, run it
   with `node`, and delete it before you finish:

   ```js
   import fs from 'node:fs';
   import vm from 'node:vm';
   const P = 'WebPortal/modules/dashboard/js/executive_dashboard.js';
   const ctx = { window: {}, document: { getElementById: () => null }, console };
   vm.createContext(ctx);
   new vm.Script(fs.readFileSync(P, 'utf8'), { filename: P }).runInContext(ctx);
   const d = ctx._executiveDashboard;
   // Feed the rows in the DESC order the RPC actually returns - that is the point of this test.
   const rows = [
     { trend_date: '2026-09-03', kg_cracked: 120 },
     { trend_date: '2026-09-02', kg_cracked: 100 },
     { trend_date: '2026-09-01', kg_cracked:  80 }
   ];
   const s = d.execTileSeries(rows, 'kg_cracked');
   console.log('values   ->', s.values);      // must be [80, 100, 120]  ASCENDING
   console.log('today    ->', s.today);       // 120
   console.log('yesterday->', s.yesterday);   // 100
   ```

   If `values` comes back `[120, 100, 80]` the sort is missing and every tile on this strip is
   wrong. Then print your delta helper for these four cases: `(120, 100) → up 20`;
   `(100, 120) → down 17`; `(50, 0) → no comparison`; `(0, 0) → no comparison`.

   Paste every result into your report. Do **not** add `module.exports`/`export` to
   `executive_dashboard.js` to make this work (classic script — it would throw at load); do not use
   `eval`; attach the helpers to the returned object instead.
8. `grep -n "execGoToTarget\|execScrollTarget" WebPortal/modules/dashboard/js/executive_dashboard.js`
   — the definitions must still be single (one `execScrollTarget:` and one `execGoToTarget:`),
   proving you called the merged helpers rather than re-declaring them. Paste the lines.
9. `git diff HEAD --name-only` — must list only
   `WebPortal/modules/dashboard/html/dashboard_unified.html`,
   `WebPortal/modules/dashboard/js/executive_dashboard.js` and
   `WebPortal/modules/dashboard/css/executive_dashboard.css`.

## Blast radius on existing tests

`ui:verify` (inside `test:fleet`) scans this repo's CSS for hex/gradients and its HTML/JS for
Bootstrap Icons, `btn-success` and legacy vars. It is currently green on `dev`, so any failure is
yours to fix in the code. Never edit `package.json` or the verifier scripts.

## Out of scope

The batch pipeline bar (the plan that depends on this one). Anything to do with Production Trends,
Stock on hand history or the Raw material runway forecast beyond setting the metric select and
scrolling to the card. The `oil`, `qa` and `forecastSales` role-default arrays. The alerts panel.
