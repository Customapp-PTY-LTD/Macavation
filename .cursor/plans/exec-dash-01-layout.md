---
preflight: pass 5af9d29e581f
---

# Executive dashboard 1 of 4 — repair the nesting, reorder the page, drop what cannot work

## Why

The executive dashboard opens with eleven stat tiles (most showing an em dash), keeps its alerts
and its charts inside sections that render **collapsed**, and has three chart cards stranded
outside the role wrapper entirely. Underneath all of that, one section card is missing its closing
tag, so a second card is currently nested inside it. This plan repairs the nesting, does the
structural move, and removes two cards that cannot work. Plans 2, 3 and 4 then rebuild the alerts
panel, the stat strip and the batch pipeline inside the new shape.

**Nothing about Production Trends, Stock on hand history or the Raw material runway forecast
changes.** Their markup, their controls and their JS stay exactly as they are — this plan only
moves the card that wraps them and un-collapses the sections.

## Facts about this repo that this plan relies on (verified against the checkout 2026-09-03)

The application tree is `WebPortal/`. The dashboard markup is
`WebPortal/modules/dashboard/html/dashboard_unified.html`, **803 lines, with no trailing newline**.
(`CLAUDE.md` says "~691 lines" — that figure is stale; trust the file.)

### The nesting defect — read this before touching the markup

**The tag counts balance (272 `<div` opens, 272 `</div>` closes) but the nesting is wrong.** A
count-based check cannot see this, which is why it has gone unnoticed. Traced by walking the file
and tracking div depth:

- The "Trends & forecasts" card opens at line **595** (`<div class="card mb-4
  mac-section-collapse-card">`). Its header closes at 600; its `<div class="collapse"
  id="execChartsCollapse">` opens at **601** and closes at **735**. Line **736 is blank** — the
  card's own `</div>` is missing there.
- Because of that, the card is not closed until line **766**, which swallows the whole "Oil
  production summary" card (opens **737**, closes **765**) as a **child** of the Trends card rather
  than a sibling.
- The proof, and the check to re-run: every other `mac-section-collapse-card` in the file closes at
  **div depth-after-close 2** (they are direct children of a `data-access` wrapper). Cards at
  16, 70, 89, 102, 121, 216, 319, 355, 366, 550 and 595 all close at depth-after 2. The Oil summary
  card at 737 closes at **depth-after 3**. It is the only one, and that is the defect.
- Line **767** (`</div>`, zero indent) closes `data-access="executive"`.
- Line **803** (`            </div>`, twelve-space indent) closes
  `<div class="dashboard-unified module-content">`, which opened on line **2**. Its indentation is
  misleading; it is not a stray tag, and deleting it would genuinely unbalance the file.

**Repair, as deliverable 0 below: relocate the `</div>` currently on line 766 to line 736.** That
is an insert at 736 plus a delete at 766 — the counts stay 272/272, the Trends card closes right
after its collapse, and the Oil summary card becomes its sibling at depth-after 2. Do **not** add a
`</div>` at end of file, and do **not** delete line 803.

### The rest of the structure

- The file holds three dashboards partitioned by `data-access` wrappers, which
  `WebPortal/modules/dashboard/js/dashboard.js` shows and hides by role:
  - `data-access="default"` opens line 5, closes line 168
  - `data-access="pallandium-integrator"` opens line 171, closes line 196
  - `data-access="executive"` opens line 199, closes line **767**
- **Lines 769–802 sit after the executive wrapper closes but still inside `.dashboard-unified`**
  (div depth 1). They are **two** row blocks, not three:
  - `<div class="row">` at line **771**, closing at **790**, holding
    `data-dashboard-widget="execOilTrends"` (772–780) and
    `data-dashboard-widget="execStockAccuracy"` (781–789).
  - `<div class="row mb-4">` at line **792**, closing at **802**, holding
    `data-dashboard-widget="execOilForecast"` (793–801).

  Being outside the executive wrapper, they are not role-filtered like the rest of the page. That
  is the second structural bug this plan fixes.
- The executive JS is `WebPortal/modules/dashboard/js/executive_dashboard.js`. Its `init` awaits the
  chart loaders in sequence: `loadOilTrendsChart()` at line 167, `loadStockAccuracyChart()` at line
  168, `loadOilForecastChart()` at line 172. The loaders are defined at lines 1609, 1636 and 1751,
  and the chart handles are declared around line 904.

### Why the Stock accuracy chart is being removed — the accurate reason

Do **not** repeat the claim that nothing writes stock-accuracy snapshots. That is false, and an
earlier version of this plan was blocked for it. The truth, traced through the code:

- `WebPortal/js/stock-alerts-shared.js:105` defines `captureAccuracySnapshot(totalSoh, adjustedQty,
  adjustmentEvents, productType)`, which calls `dataFunctions.captureStockAccuracySnapshot(...)` at
  line 109 and is exported at line 126.
- Its **only** call site in `WebPortal/` is
  `WebPortal/modules/stock-management/js/stock_management_grid.js:1858`:
  `StockAlertsShared.captureAccuracySnapshot(totalSoh, 0, 0, 'kernel')` — reached from
  `runStockAlertEvaluation('kernel')`, itself called from `loadShellLots()`.
- That call passes `adjustedQty = 0` and `adjustmentEvents = 0` as **hardcoded literals**. So every
  snapshot row is written with `adjusted_qty: 0`, and the `pct_adjusted` value the chart plots
  (`loadStockAccuracyChart`, line 1636, maps `r.pct_adjusted`) is structurally **always zero**.

So the card renders, and it renders a flat row of zero bars, permanently, until that writer is
taught to pass a real adjusted quantity. Removing it from the dashboard is what the product owner
asked for. **Fixing the writer is explicitly out of scope for this plan** — do not change
`stock-alerts-shared.js`, `stock_management_grid.js`, or `dataFunctions.getStockAccuracy` /
`captureStockAccuracySnapshot` in `data-functions.js`. This plan removes a dashboard card; it does
not touch the data layer or the stock screen.

### The widget registry — read this before deleting either card

`executive_dashboard.js` holds `DASHBOARD_WIDGET_LABELS`, and **both cards being removed are keys
in it**: `execStockAccuracy` at line 97 and `execDailyReportDelivery` at line 99. Three
consequences this plan explicitly authorises you to handle:

- You **must** delete those two keys along with the markup, otherwise the Customize modal keeps
  offering checkboxes for widgets that no longer exist.
- `saveCustomizeModal` (around line 281) decides whether to store `null` (meaning "show all") or an
  explicit list by comparing `visible.length === Object.keys(DASHBOARD_WIDGET_LABELS).length`.
  Removing two keys shrinks **both** sides of that comparison together, so the "all selected" case
  still stores `null` and the logic stays correct. Do not otherwise change `saveCustomizeModal`.
- A user whose saved visibility list was stored **before** this change may still contain
  `execStockAccuracy` or `execDailyReportDelivery`. `applyDashboardVisibility` (lines 237–249)
  iterates the DOM elements that carry `data-dashboard-widget` and looks each id up in the stored
  list — it does not iterate the stored list — so a stored id with no matching element is already
  ignored harmlessly. **Confirm that by reading the function, and change nothing there.**

### The Daily report buttons share one handler

`executive_dashboard.js:373` is a **single combined binding**:

```js
$('#execDailyReportBtn, #execOpenScheduledReportsBtn').off('click').on('click', function () { … });
```

`#execDailyReportBtn` lives in the page header and must keep working. `#execOpenScheduledReportsBtn`
lives inside the Daily report delivery card being deleted. **Edit the selector to drop only
`#execOpenScheduledReportsBtn`** — do not delete the binding. Deleting it would silently kill the
header's Daily report navigation.

## Deliverables

### 0. Repair the Trends & forecasts card's nesting — do this FIRST

Relocate the `</div>` on line **766** to line **736** (currently blank). After this, and before any
other edit, the Trends card must open at 595 and close at 736, and the Oil production summary card
must open at 737 and close at 765 as its **sibling**. Div counts stay at 272/272. Run verify step 2
now, before continuing, and again at the end.

Do this as its own step so the reorder in deliverable 4 is moving two sibling cards rather than a
card and its accidental child.

### 1. Bring the stranded cards inside the executive wrapper

In `dashboard_unified.html`:

- **Delete** the whole `execStockAccuracy` column (lines 781–789 as the file stands: the
  `<div class="col-md-6 mb-4" data-dashboard-widget="execStockAccuracy">`, its `<div class="card
  h-100">` and everything through its closing tags), including the `#stockAccuracyEmpty`
  empty-state paragraph if it sits inside that column.
- **Move** the `execOilTrends` column and the `execOilForecast` column inside the
  `data-access="executive"` wrapper, immediately after the "Oil production summary" collapse card
  (the one whose toggle targets `#execOilStatsCollapse`), as **one** `<div class="row">` holding
  both columns.
- **Delete both now-empty row wrappers** (the `<div class="row">` at 771 and the
  `<div class="row mb-4">` at 792) along with the blank lines between them.
- After the move, the file must end with the `</div>` closing `data-access="executive"` followed by
  the `</div>` closing `.dashboard-unified`, with nothing but whitespace between them and nothing
  but whitespace after the second. Verify step 2 asserts exactly this.

Keep `data-dashboard-widget="execOilTrends"` and `data-dashboard-widget="execOilForecast"` exactly
as they are — those ids are already in `DASHBOARD_WIDGET_LABELS`. Do not rename them, and do not
add the attribute to anything new.

### 2. Remove the stock accuracy chart from the JS

In `executive_dashboard.js`:

- Delete `await scope.loadStockAccuracyChart();` (line 168).
- Delete the whole `loadStockAccuracyChart:` property (line 1636 through its closing `},`).
- Delete the `stockAccuracyChart: null,` field (around line 904).
- Delete the `execStockAccuracy:` key from `DASHBOARD_WIDGET_LABELS` (line 97).
- Leave `dataFunctions.getStockAccuracy` in `data-functions.js` untouched.

Then check `setChartEmptyState` is not called with `'stockAccuracyChart'` anywhere that survives.

### 3. Remove the "Daily report delivery" card

Delete the `mac-section-collapse-card` carrying `data-dashboard-widget="execDailyReportDelivery"`
(it opens at line 319, its toggle targets `#execDailyReportCollapse`, and it closes at line 353).
Then:

- Delete the `execDailyReportDelivery:` key from `DASHBOARD_WIDGET_LABELS` (line 99).
- Edit the combined binding at line 373 so its selector is `$('#execDailyReportBtn')` only. **Do not
  delete the binding**, and do not touch `#execDailyReportBtn` itself in the page header.

### 4. Reorder the executive block

Inside `data-access="executive"`, order the top-level cards exactly like this, keeping each card's
own markup intact as you move it:

1. The page header row (`<h1>Executive Dashboard &amp; Reporting</h1>` and its toolbar) — unchanged.
2. **Active alerts** (toggle targets `#execAlertsCollapse`).
3. **Kernel production KPIs** (`#execKernelKpiCollapse`).
4. **Kernel operations** (`#execKernelOpsCollapse`).
5. **Trends & forecasts** (`#execChartsCollapse`) — this card contains Production Trends, Stock on
   hand history and the Raw material runway forecast. Move the card; do not touch what is inside it.
6. **Daily minute tests** (`#execMinuteTestsCollapse`).
7. **Oil production summary** (`#execOilStatsCollapse`), followed by the oil trends + oil forecast
   row from deliverable 1.
8. The two modals (`#execDashboardCustomizeModal`, `#runwayRateModal`) — leave them where they sit
   relative to each other; they are not visible cards.

### 5. Render the sections open

For every `mac-section-collapse-card` inside `data-access="executive"`, change its inner
`<div class="collapse" id="…">` to `<div class="collapse show" id="…">` and set the matching toggle
button's `aria-expanded="false"` to `aria-expanded="true"`. The chevron and the toggle behaviour
stay — a user can still fold a section; it just starts open.

As the file stands, the executive collapses are `#execKernelKpiCollapse` (222),
`#execDailyReportCollapse` (328, **being deleted** by deliverable 3), `#execAlertsCollapse` (361),
`#execKernelOpsCollapse` (372), `#execMinuteTestsCollapse` (556), `#execChartsCollapse` (601) and
`#execOilStatsCollapse` (743) — so **six** should carry `show` when you are done.

Do not change the collapse markup in the `default` or `pallandium-integrator` blocks — they hold
five more `collapse` divs (lines 22, 79, 95, 111, 127) which must stay collapsed.

## Constraints this repo enforces — read before writing any code

- **Do not add `data-dashboard-widget` to any new element.** Per `CLAUDE.md`, anything carrying it
  is hidden unless its id is in the user's visible-widget list; new ids are in nobody's list, role
  defaults are hardcoded, and the Customize modal only offers ids in `DASHBOARD_WIDGET_LABELS`.
  Moving an element that already has one is fine; adding one is not.
- **Do not add `data-action-perm` to markup rendered by JS.** The router sweeps `actionAccess.apply`
  once over static markup in `#content-area`; anything injected later is never swept, so the
  attribute is inert. Call `hasAction()` inline instead.
- **Escape anything from the database before it reaches the DOM.** Per
  `BluePrint/javascript-jquery-rules.md`, prefer `textContent` / jQuery `.text()` over `innerHTML`.
  This plan should add no DB-sourced rendering at all; if you find yourself writing any, use
  `.text()`.
- **CSS rules, enforced by `npm run ui:verify`** (part of the merge gate): no raw hex outside
  `WebPortal/css/design-tokens.css` (`#fff`/`#000` excepted); **no `linear-gradient(` in any form**
  (the check is a substring match, so `repeating-linear-gradient(` fails too); no `btn-success`; no
  Bootstrap Icons (`bi bi-`) — Font Awesome only; `.swal2-*` only in `css/swal-theme.css`. This plan
  should need no new CSS. If it does, put it in
  `WebPortal/modules/dashboard/css/executive_dashboard.css`, already registered for the dashboard
  route in `WebPortal/js/appRouteConfig.json`.
- **Do not add, rename or delete any file** in `WebPortal/`. `npm run registry:verify` checks every
  asset path named in `appRouteConfig.json` exists. (Throwaway scripts under the system temp
  directory are fine — just delete them before you finish.)

## Verify before finishing

All of these are runnable by you, offline. Do **not** run `npm ci` — this repo has no
`package-lock.json` and zero dependencies.

1. `npm run test:fleet` — must pass.

2. **Nesting, not counts.** Write this to a temp file (e.g. `$TMPDIR/nest.js`, outside the repo) and
   run it with `node` from the repo root. It asserts the *shape* of the tree, which is what a count
   check cannot do. Run it after deliverable 0 and again at the end. It must print `OK` and exit 0
   both times.

   ```js
   const fs = require('fs');
   const P = 'WebPortal/modules/dashboard/html/dashboard_unified.html';
   const src = fs.readFileSync(P, 'utf8');
   const lines = src.split(/\r?\n/);
   const VOID = new Set(['br','img','input','hr','meta','link','source','col','area','base']);
   const st = []; let d = 0; const closeOf = {}; const depthAfter = {};
   let fail = 0;
   lines.forEach((t, i) => {
     const ln = i + 1;
     for (const m of t.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g)) {
       const closing = m[1] === '/', tag = m[2].toLowerCase(), self = m[4] === '/';
       if (VOID.has(tag) || self) continue;
       if (closing) {
         const top = st.pop();
         if (!top || top.tag !== tag) { console.log('MISMATCH at line', ln, '</' + tag + '>'); fail++; }
         else if (tag === 'div') closeOf[top.line] = ln;
         if (tag === 'div') d--;
       } else { st.push({ tag, line: ln }); if (tag === 'div') d++; }
     }
     depthAfter[ln] = d;
   });
   if (st.length) { console.log('UNCLOSED', st.map(s => s.tag + '@' + s.line).join(',')); fail++; }
   const lineOf = re => lines.findIndex(l => re.test(l)) + 1;
   const uni  = lineOf(/class="dashboard-unified/);
   const exec = lineOf(/data-access="executive"/);
   const uniClose = closeOf[uni], execClose = closeOf[exec];
   console.log('dashboard-unified', uni, '->', uniClose);
   console.log('executive', exec, '->', execClose);
   // 1. every section card inside the executive wrapper is a DIRECT child of it
   lines.forEach((t, i) => {
     const ln = i + 1;
     if (/mac-section-collapse-card/.test(t) && ln > exec && ln < execClose) {
       const da = depthAfter[closeOf[ln]];
       if (da !== 2) { console.log('CARD NESTED WRONG: open', ln, 'close', closeOf[ln], 'depth-after', da); fail++; }
     }
   });
   // 2. the executive wrapper closes last but one, and dashboard-unified closes last
   if (uniClose <= execClose) { console.log('dashboard-unified must close after executive'); fail++; }
   for (let ln = execClose + 1; ln < uniClose; ln++) {
     if (lines[ln - 1].trim() !== '') { console.log('STRANDED content on line', ln, ':', lines[ln - 1].trim().slice(0, 60)); fail++; }
   }
   for (let ln = uniClose + 1; ln <= lines.length; ln++) {
     if (lines[ln - 1].trim() !== '') { console.log('content AFTER dashboard-unified closes, line', ln); fail++; }
   }
   console.log(fail ? 'FAILED ' + fail : 'OK');
   process.exit(fail ? 1 : 0);
   ```

   Note what each assertion buys you: assertion 1 catches the deliverable-0 defect and any repeat of
   it; assertion 2 is what proves the stranded rows really came inside the wrapper, and it is the
   check the old count-based step could not make.

3. `grep -rn "execStockAccuracy\|stockAccuracyChart\|loadStockAccuracyChart\|execDailyReportDelivery\|execOpenScheduledReportsBtn" WebPortal/modules/dashboard/`
   — must return **no matches**. This includes `DASHBOARD_WIDGET_LABELS`, whose two keys deliverables
   2 and 3 authorise you to delete; if this grep still hits that object, you have not finished.

4. `grep -n "execDailyReportBtn" WebPortal/modules/dashboard/js/executive_dashboard.js` — must still
   match, and the binding must select **only** that id. Paste the line into your report.

5. **Widget count.** `grep -c "data-dashboard-widget" WebPortal/modules/dashboard/html/dashboard_unified.html`
   is **29** before your change and must be **27** after — one fewer for `execStockAccuracy`, one
   fewer for `execDailyReportDelivery`. State both numbers.

6. **Label count.** `node -e "const s=require('fs').readFileSync('WebPortal/modules/dashboard/js/executive_dashboard.js','utf8');console.log((s.match(/^\s+exec[A-Za-z]+:\s*'/gm)||[]).length)"`
   — report the number before and after; it must drop by exactly 2.

7. **Collapse state.** `grep -c 'class="collapse show"' WebPortal/modules/dashboard/html/dashboard_unified.html`
   is **0** before your change and must be exactly **6** after (deliverable 5 names them). And
   `grep -c 'class="collapse"' WebPortal/modules/dashboard/html/dashboard_unified.html` is **12**
   before and must be exactly **5** after — 12 collapses, minus the one inside the deleted Daily
   report card, minus the six that gained `show`, leaving the `default` block's five at lines 22,
   79, 95, 111 and 127. (The two greps do not overlap: `class="collapse show"` does not contain the
   substring `class="collapse"`.) Also confirm no `aria-expanded="false"` remains on a toggle whose
   `data-bs-target` names one of the six. Print all four numbers.

8. **The three preserved charts are byte-identical apart from indentation.** Write this to a temp
   file, run it from the repo root; it must print `OK`.

   ```js
   const { execSync } = require('child_process');
   const fs = require('fs');
   const P = 'WebPortal/modules/dashboard/html/dashboard_unified.html';
   const before = execSync('git show HEAD:' + P, { encoding: 'utf8', maxBuffer: 1 << 26 });
   const after = fs.readFileSync(P, 'utf8');
   // Pull each widget block out by its marker and its matching close, then compare with all
   // leading whitespace stripped - so a re-indent passes and any real edit fails.
   function block(src, id) {
     const lines = src.split(/\r?\n/);
     const start = lines.findIndex(l => l.includes('data-dashboard-widget="' + id + '"'));
     if (start < 0) return null;
     let d = 0; const out = [];
     for (let i = start; i < lines.length; i++) {
       out.push(lines[i].replace(/^\s+/, ''));
       for (const m of lines[i].matchAll(/<(\/?)div\b[^>]*?(\/?)>/g)) {
         if (m[2] === '/') continue;
         d += m[1] === '/' ? -1 : 1;
       }
       if (d === 0) break;
     }
     return out.join('\n');
   }
   let fail = 0;
   for (const id of ['execProductionTrends', 'execStockHistory', 'execRunwayForecast']) {
     const b = block(before, id), a = block(after, id);
     if (a === null) { console.log(id, 'MISSING after the change'); fail++; continue; }
     if (b !== a) {
       console.log(id, 'CHANGED beyond indentation');
       const bl = b.split('\n'), al = a.split('\n');
       for (let i = 0; i < Math.max(bl.length, al.length); i++) {
         if (bl[i] !== al[i]) { console.log('  first diff at block line', i, '\n  -', bl[i], '\n  +', al[i]); break; }
       }
       fail++;
     }
   }
   console.log(fail ? 'FAILED ' + fail : 'OK');
   process.exit(fail ? 1 : 0);
   ```

9. `git diff --name-only` — must list **only**
   `WebPortal/modules/dashboard/html/dashboard_unified.html` and
   `WebPortal/modules/dashboard/js/executive_dashboard.js`. If `stock-alerts-shared.js`,
   `stock_management_grid.js` or `data-functions.js` appear, you have gone out of scope; revert them.

## Blast radius on existing tests

`npm run test:fleet` runs `routing:verify`, `username:verify`, `verify-phase2-migrations.mjs`,
`ui:verify`, `migrations:verify`, `registry:verify`, `reports:verify`, four
`report-whatsapp-*:verify` scripts and `wa-plumbing:verify`. None asserts on dashboard markup
structure, and this plan adds no CSS, so none of them should change result. If one fails, fixing it
in the code is in scope. Never edit `package.json` or a verifier script.

## Out of scope

Alerts rendering, the stat tiles, the batch pipeline (plans 2, 3, 4 — they edit the same two files,
which is why they are chained behind this one). Fixing the stock-accuracy writer so it records a
real adjusted quantity. Anything in `WebPortal/modules/stock-management/`.
