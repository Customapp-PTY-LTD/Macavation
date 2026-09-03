---
depends_on: exec-dash-01-layout.md
preflight: pass 971260c83501
---

# Executive dashboard 2 of 4 — make the alerts panel the thing you act on

## Why

Alerts are now the first card on the executive dashboard (plan 1 moved them there). What they
render is still a flat list of Bootstrap `.alert` divs with a Resolve button. This plan turns that
into something you can work: severity ordering, counts you can filter by, a resolve that can be
undone, and a button on each alert that takes you to the chart it is talking about.

## Facts about this repo that this plan relies on (verified 2026-09-03)

- The alerts card lives in `WebPortal/modules/dashboard/html/dashboard_unified.html` inside the
  `data-access="executive"` wrapper. Its body is `<div class="card-body" id="execAlertsContainer">`
  (line 362) and its collapse target is `#execAlertsCollapse` (line 361). After plan 1 it is the
  first card in the block and starts open.
- It is filled by `loadExecutiveAlerts` in
  `WebPortal/modules/dashboard/js/executive_dashboard.js:1554`. Read that function before changing
  it — the behaviour below is described from it, not from memory:
  - It calls `dataFunctions.getDashboardAlerts(null, true)`
    (`WebPortal/js/data-functions.js:4235`, DB function `get_dashboard_alerts`).
  - On an empty list it writes `<p class="text-muted small mb-0">No active alerts.</p>`.
  - On failure it writes `<p class="text-muted small mb-0">Unable to load alerts.</p>`.
  - It renders **at most 8** alerts (`alerts.slice(0, 8)`).
  - Per alert it reads `a.severity || a.alert_type`, `a.title || a.alert_title`,
    `a.message || a.alert_message`, and `a.id || a.alert_id`. **Keep every one of those fallbacks.**
    The live rows may use either shape and this plan cannot confirm which from the checkout.
  - It maps severity to a Bootstrap contextual class: `critical` → `danger`, `warning` → `warning`,
    anything else → `info`.
  - The Resolve button is gated by `typeof hasAction === 'function' ? hasAction('alerts.resolve') : true`
    and calls `dataFunctions.resolveDashboardAlert(alertId, note)`
    (`WebPortal/js/data-functions.js:1983`), then re-runs `loadExecutiveAlerts()`.
  - The note currently comes from `window.prompt(...)` (line 1579 — the only occurrence in the file).
- `MacStatus` (`WebPortal/js/mac-status.js`) is the portal's status→colour language. It is **not**
  used by any deliverable in this plan (its `pill()` returns an HTML string, which sits badly with
  the DOM-API rule in deliverable 2). It is named here only so you do not reach for it by reflex.

### `executive_dashboard.js` is a classic script with one top-level `var` — this matters twice

The file is `var _executiveDashboard = function () { … }();` (line 5), and its only global export is
`window.initializeExecutiveDashboard` (line 1783). It is loaded as a **classic script**, not a
module.

- **Never add `module.exports`, `export`, or `import` to this file.** `package.json` has
  `"type": "module"` (line 4), but that governs `.mjs`/Node files, not this browser script. Adding
  an `export` statement makes it throw at parse time and the entire executive dashboard stops
  loading — and no verify step in this plan would catch that.
- Every helper this plan adds must be a **property on the object `_executiveDashboard` returns**, so
  the verify harness in step 7 can reach it as `ctx._executiveDashboard.<name>` after loading the
  file into a `node:vm` context. That is how the repo already tests browser-global JS — see
  `scripts/verify-report-rendering.mjs:45-58`.

### The toast helpers are on `_common`, not globals

`WebPortal/js/common.js:4` opens `var _common = {` and line **489** does `window._common = _common;`.
`showToastMessage(message, type, duration)`, `showSuccessToast`, `showErrorToast`,
`showWarningToast` and `showInfoToast` are **properties of that object**. There is no global
`showErrorToast` — calling it bare throws a `ReferenceError`.

The repo's convention, per `BluePrint/admin_portal_complete_instructions.md` and every call site
(e.g. `WebPortal/js/exception-ui.js:177-183`), is the guarded, qualified form:

```js
if (typeof _common !== 'undefined' && _common.showErrorToast) {
    _common.showErrorToast('…');
}
```

**Use exactly that form wherever this plan calls a toast helper.**

Those helpers are SweetAlert2 `Swal.mixin({ toast: true, showConfirmButton: false })` wrappers:
they take a string and a type and nothing else, and they explicitly suppress the confirm button.
There is no parameter through which an **Undo** control could be passed, and the undo is the whole
point of deliverable 4. That is the reason — and the only reason — this plan builds a small local
toast for the undo case. Say so in a code comment above the new helper so the next reader does not
"simplify" it back to `_common.showToastMessage`.

### The three link targets, and why a naive scroll to them does nothing

This is the part an earlier version of this plan got wrong, and it is the whole risk in
deliverable 3. The three cards exist and keep their ids — `#productionTrendsChart` (line 637),
`#stockHistoryChart` (672), `#runwayForecastChart` (715) — **but all three sit inside
`<div class="collapse" id="execChartsCollapse">` (opens 601, closes 735)**, and there are two
separate ways for that to make a scroll a no-op:

1. **The section can be folded.** Plan 1 adds `show` to that collapse so it starts open, but
   `WebPortal/js/mac-section-collapse.js` leaves the Bootstrap toggle working and persists nothing —
   a user who folds "Trends & forecasts" and then clicks a "Go to" button is scrolling to an element
   with no layout box, and `scrollIntoView` silently does nothing. A null-check on the element does
   **not** catch this: the element is always in the DOM.
2. **The card can be hidden per user.** `applyDashboardVisibility` (`executive_dashboard.js:237-249`)
   sets `el.style.display = 'none'` on the `[data-dashboard-widget]` wrapper when the id is not in
   the user's visible-widget list. The three targets sit in wrappers
   `data-dashboard-widget="execProductionTrends"` (604), `="execStockHistory"` (655) and
   `="execRunwayForecast"` (688), so for a user whose list excludes one, that target is not
   displayed at all and no amount of expanding will reveal it.

Deliverable 3 must handle **both**, not just the null case.

`bootstrap.Collapse.getOrCreateInstance(...)` is already used in this repo at
`WebPortal/js/index.js:54`, so the global is available on the dashboard route and the pattern is
established. Guard it anyway (`typeof bootstrap !== 'undefined' && bootstrap.Collapse`) and fall
back to adding the `show` class directly.

## Deliverables

### 1. Give the alerts card a header strip with counts

In `dashboard_unified.html`, inside the alerts card and above `#execAlertsContainer`, add a static
header strip:

```html
<div class="exec-alert-chips" id="execAlertChips" role="group" aria-label="Filter alerts by severity">
  <button type="button" class="exec-chip exec-chip--critical" data-sev="critical" aria-pressed="false">
    <span data-count="critical">0</span> critical
  </button>
  <button type="button" class="exec-chip exec-chip--warning" data-sev="warning" aria-pressed="false">
    <span data-count="warning">0</span> to watch
  </button>
  <button type="button" class="exec-chip exec-chip--info" data-sev="info" aria-pressed="false">
    <span data-count="info">0</span> note
  </button>
  <span class="exec-alert-hint" id="execAlertHint"></span>
</div>
```

This is static markup, so it is swept by the router — but it holds no permission-gated control, so
do **not** put `data-action-perm` on it. Do **not** put `data-dashboard-widget` on it either.

**Namespacing, because plans 3 and 4 edit the same two files in the same batch.** This plan owns and
defines exactly these names; plans 3 and 4 reuse them and must not redefine them: `#execAlertChips`,
`#execAlertHint`, `#execToastHost` (deliverable 4), the `.exec-chip*` classes, the `.exec-flash`
class, and the helper `execScrollTarget` (deliverable 3). Always scope `[data-count]` lookups to
`#execAlertChips` — plan 3's stat tiles use their own attributes and a document-wide `[data-count]`
query would collide.

### 2. Rewrite `loadExecutiveAlerts` rendering

Keep the fetch, the field fallbacks, the `hasAction('alerts.resolve')` gate and the two existing
text states. Change what is rendered and add the interaction:

- **Sort before slicing.** The current code slices to 8 unsorted. Sort a **copy** critical-first,
  then warning, then everything else, **and only then** `slice(0, 8)`. Order matters: sorting after
  the slice would show the 8 arbitrary rows the DB happened to return first, which defeats the
  point. Do not mutate the array returned by the data layer.
- **Build each row with DOM APIs, not an HTML string.** `BluePrint/javascript-jquery-rules.md` says
  "NEVER use `innerHTML` with untrusted data — use `textContent`", and the three values here
  (`title`, `message`, the id) are operator-entered rows out of the database. Create the row with
  `document.createElement`, set the static classes and icons directly, and put every DB-sourced
  value in with `textContent` / `.dataset`. Do not add an `esc()` helper and keep concatenating —
  that was the previous version of this plan and it is the weaker of the two options the BluePrint
  offers.
- **Each alert** renders as a row carrying `data-sev="<critical|warning|info>"` with:
  - a severity stripe and a Font Awesome icon (`fas fa-triangle-exclamation` for critical,
    `fas fa-circle-exclamation` for warning, `fas fa-circle-info` for info) — **Font Awesome only,
    never `bi bi-`**;
  - an uppercase severity label next to the title, so severity is never carried by colour alone;
  - the title, then the message;
  - a **"Go to" button** when, and only when, deliverable 3's rules say to render one;
  - the existing Resolve button, unchanged in permission behaviour.

**What the chips count — all four states, spelled out.** These numbers sit on the card this plan
calls "the thing you act on", so leaving them ambiguous would let an agent ship a confidently wrong
figure. The rule is:

- The chips count the **rendered rows only** — the ≤8 that survive the sort-then-slice, bucketed by
  the same `critical` / `warning` / `info` mapping used for the stripe. They are a legend for what is
  on screen, not a database total, and the filter in deliverable 5 filters exactly those rows, so
  the two always agree.
- **When the fetch returned more than 8 alerts**, append `showing 8 of <N>` to `#execAlertHint`, so
  the cap is visible rather than implied. `<N>` is `alerts.length` before the slice.
- **On the empty path** (`No active alerts.`): set all three counts to `0` and set
  `#execAlertChips` `hidden = true`. Chips reading "0 critical" above "No active alerts." is noise.
- **On the failure path** (`Unable to load alerts.`): set `#execAlertChips` `hidden = true` as well,
  and do **not** write any number. A `0` next to "Unable to load alerts." asserts there are no
  critical alerts, which is precisely what a failed fetch does not know.
- Unhide `#execAlertChips` again at the start of a successful render with at least one row.

**Reset the filter on every render.** `loadExecutiveAlerts()` re-runs after a resolve, which
rebuilds the rows but leaves the chips as the user left them — a chip reading "pressed, showing
critical only" above a full unfiltered list. At the top of the render, set every chip's
`aria-pressed="false"`, clear `#execAlertHint`, and clear the stored filter state.

### 3. "Go to" buttons, matched conservatively, and actually able to arrive

The alert rows have no field naming a target screen, and this plan cannot invent one. Match on the
alert's own text instead, and render the button **only on a match**:

- text contains `runway` or `nut-in-shell` or `nut in shell` → target `#runwayForecastChart`
- else text contains `stock` → target `#stockHistoryChart`
- else text contains `production` or `cracked` or `packed` → target `#productionTrendsChart`
- else → **no button at all**

Match case-insensitively against `title + ' ' + message`.

**Define one helper, `execScrollTarget`, as a property on the returned `_executiveDashboard`
object.** Its contract is fixed here, because plans 3 and 4 both call it:

```
execScrollTarget(el)
  el : an Element, or null
  returns one of the strings 'ok' | 'missing' | 'hidden'
    'missing' - el is null/undefined, or has no .closest('.card') ancestor
    'hidden'  - el.closest('[data-dashboard-widget]') exists and its style.display === 'none'
                (applyDashboardVisibility hid it for this user)
    'ok'      - otherwise
```

It takes an **Element**, not a selector — callers do their own `document.querySelector`. It reads
state and returns a string; it must not scroll, mutate, or throw. Keeping it pure is what lets
verify step 7 exercise it outside a browser.

Add a second property `execGoToTarget(el)` that does the moving, and call it from the click handler:

1. If `execScrollTarget(el) !== 'ok'`, return immediately.
2. Find `el.closest('.collapse')`. If there is one and it does not have the `show` class, expand it
   first — `bootstrap.Collapse.getOrCreateInstance(collapseEl).show()` guarded by
   `typeof bootstrap !== 'undefined' && bootstrap.Collapse`, falling back to
   `collapseEl.classList.add('show')`. Also set the matching toggle button's `aria-expanded="true"`
   (find it with `[data-bs-target="#<collapse id>"]`) so the chevron and the screen-reader state
   stay truthful.
3. Scroll **after** the expand has finished, otherwise the target's position is measured
   mid-animation — listen once for `shown.bs.collapse` on the collapse element and scroll in that
   handler, with a `setTimeout(..., 400)` fallback in case Bootstrap is absent and the class was
   added directly. If the collapse was already open, scroll immediately.
4. Scroll with `el.closest('.card').scrollIntoView({ behavior: <see below>, block: 'center' })` and
   add `exec-flash` to that card for 1600ms, then remove it.

**When rendering the row**, call `execScrollTarget(document.querySelector(sel))` first and render
the "Go to" button only when it returns `'ok'`. A button that does nothing is worse than no button.

**Reduced motion is a JS decision here, not a CSS one.** A `@media (prefers-reduced-motion)` rule
cannot change a `behavior` value supplied in JS. Read it once:
`var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;`
and pass `behavior: reduce ? 'auto' : 'smooth'`. The CSS media query still disables the `exec-flash`
animation — that part is CSS's job.

### 4. Resolve with an undo, instead of a prompt

Replace the `window.prompt` note with an optimistic resolve:

- On click, remove the row from the DOM and update the counts immediately. Keep a reference to the
  row **and to its next sibling**, so it can be put back in the same position.
- Show a small toast reading `Resolved: <title>` with an **Undo** button, for 6 seconds. The title
  is DB-sourced — set it with `textContent`, never by string concatenation into `innerHTML`.
- If Undo is pressed inside that window, re-insert the row before its saved next sibling (or append
  if it was last) and restore the counts. **Do not call the API at all** in that case.
- If the 6 seconds elapse without an Undo, call
  `dataFunctions.resolveDashboardAlert(alertId, '')` and then re-run `loadExecutiveAlerts()`.
- **Treat two different failures the same way.** `resolveDashboardAlert` can reject, *and* it can
  resolve with a `{ success: false }` payload from the DB function rather than throwing — read it at
  `WebPortal/js/data-functions.js:1983` and handle both. On either, put the row back, restore the
  counts, and show the error with the guarded, qualified call:

  ```js
  if (typeof _common !== 'undefined' && _common.showErrorToast) {
      _common.showErrorToast('Could not resolve that alert. It is still open.');
  }
  ```

  There is no global `showErrorToast` — see the Facts section. Do not leave the row hidden after a
  failed write.

Build the undo toast in this module: **one** fixed-position container with the id `execToastHost`,
appended to `document.body` on first use and reused thereafter (`document.getElementById` first, so
a re-render never creates a second one). Do not add a toast library. See the Facts section for why
`_common`'s helpers cannot serve the undo case.

### 5. Filtering by severity

Clicking a chip filters the list to that severity and sets its `aria-pressed="true"`; clicking it
again clears the filter. While a filter is on, write `showing <severity> only` plus a "Show all"
button into `#execAlertHint`. Filtering hides rows with the `hidden` property (`row.hidden = true`),
never by removing them.

When a filter leaves nothing visible, show `Nothing at this level right now.` — as a **separate
element appended to `#execAlertsContainer`** (create it once, give it the id
`execAlertsFilterEmpty`, and toggle its `hidden` property). Do **not** write it with
`execAlertsContainer.innerHTML = …`: that would destroy the hidden rows the filter is meant to be
preserving, and "Show all" would then restore nothing.

When there are genuinely no alerts at all, keep the existing `No active alerts.` wording.

### 6. CSS

Put every new rule in `WebPortal/modules/dashboard/css/executive_dashboard.css` (already registered
for the dashboard route in `WebPortal/js/appRouteConfig.json` — do not add a file).

- Colours come from `--mac-*` tokens only: `--mac-danger` / `--mac-danger-light` for critical,
  `--mac-warning` / `--mac-warning-light` with `--mac-warning-text` for the warning **text tone**,
  `--mac-info` / `--mac-info-light` for info, `--mac-border`, `--mac-text`, `--mac-text-secondary`,
  `--mac-text-tertiary`, `--mac-radius-*`, `--mac-space-*`, `--mac-shadow-*`.
- **No raw hex. No `linear-gradient(` in any form** (the gate's check is a substring match, so
  `repeating-linear-gradient` is banned too). No `.badge { min-width }`. No bare `td`/`th` padding.
- `.exec-flash` must be a box-shadow or outline animation built from
  `rgba(var(--mac-green-rgb), …)` — not a gradient, and not a raw colour.
- `@media (prefers-reduced-motion: reduce)` disables the `exec-flash` animation. The scroll
  behaviour is handled in JS (deliverable 3) — do not try to do it here.

## Verify before finishing

1. `npm run test:fleet` — must pass. **Do not run `npm ci`**: this repo has no `package-lock.json`
   and zero dependencies. **Do not `npm install` anything** — this plan adds no dependency, and
   verify step 7 is designed so none is needed.
2. `grep -n "getDashboardAlerts\|alert_title\|alert_message\|alert_id\|hasAction('alerts.resolve')" WebPortal/modules/dashboard/js/executive_dashboard.js`
   — every one of these must still be present, proving the fetch, the field fallbacks and the
   permission gate survived the rewrite.
3. `grep -n "window.prompt" WebPortal/modules/dashboard/js/executive_dashboard.js` — must return no
   match inside the alerts code.
4. `grep -rn "bi bi-\|btn-success" WebPortal/modules/dashboard/` — must return no matches.
5. `grep -n "#[0-9a-fA-F]\{3,8\}" WebPortal/modules/dashboard/css/executive_dashboard.css` — must
   return no matches other than `#fff`/`#000`.
6. `grep -in "linear-gradient" WebPortal/modules/dashboard/css/executive_dashboard.css` — must
   return no matches.
7. **Exercise `execScrollTarget` for real, with the harness this repo already uses.** Copy the
   pattern at `scripts/verify-report-rendering.mjs:45-58`: load the browser script into a
   `node:vm` context with stub globals and read the helper off the context. Write this to a temp
   file outside the repo and run it with `node`:

   ```js
   import fs from 'node:fs';
   import vm from 'node:vm';
   const P = 'WebPortal/modules/dashboard/js/executive_dashboard.js';
   const ctx = { window: {}, document: { getElementById: () => null }, console };
   vm.createContext(ctx);
   new vm.Script(fs.readFileSync(P, 'utf8'), { filename: P }).runInContext(ctx);
   const f = ctx._executiveDashboard.execScrollTarget;
   if (typeof f !== 'function') throw new Error('execScrollTarget not exposed on _executiveDashboard');
   // hand-built stubs - closest() returns whatever the test says it should
   const card = { tagName: 'DIV' };
   const mk = (widget) => ({ closest: (s) => s === '.card' ? card : (s === '[data-dashboard-widget]' ? widget : null) });
   console.log('null            ->', f(null));                                    // missing
   console.log('no card         ->', f({ closest: () => null }));                 // missing
   console.log('widget hidden   ->', f(mk({ style: { display: 'none' } })));      // hidden
   console.log('widget visible  ->', f(mk({ style: { display: '' } })));          // ok
   console.log('no widget       ->', f(mk(null)));                                // ok
   ```

   All five lines must print the value in the comment. **Delete the temp file before you finish.**

   Three things this step forbids, because each is a plausible wrong turn: do **not** `npm install`
   a DOM library; do **not** add `module.exports` or `export` to `executive_dashboard.js` (it is a
   classic script — that throws at load and takes the whole dashboard down); and do **not** use
   `eval` (`BluePrint/javascript-jquery-rules.md` bans it). Attaching the helper to the object
   `_executiveDashboard` returns is all that is required, and the `vm` context reaches it as a
   top-level `var`.
8. `grep -n "matchMedia" WebPortal/modules/dashboard/js/executive_dashboard.js` — must match, proving
   the reduced-motion branch is in JS where it can affect `scrollIntoView`.
9. `grep -n "showErrorToast" WebPortal/modules/dashboard/js/executive_dashboard.js` — every hit must
   be `_common.showErrorToast` guarded by `typeof _common !== 'undefined'`. Paste the lines into
   your report.
10. `git diff HEAD --name-only` — must list only
    `WebPortal/modules/dashboard/html/dashboard_unified.html`,
    `WebPortal/modules/dashboard/js/executive_dashboard.js` and
    `WebPortal/modules/dashboard/css/executive_dashboard.css`. Use `HEAD` so the check still works
    if you have staged your changes.

## Blast radius on existing tests

`ui:verify` is the one in `test:fleet` that will react to this plan, because it scans
`WebPortal/**/*.css` for hex, gradients and legacy vars, and `WebPortal/**/*.{html,js}` for
Bootstrap Icons, `btn-success` and legacy vars. Its pre-existing violations were cleared on
2026-08-04, so it is currently green and any failure it reports is genuinely yours. Fix the code,
never the script — and do not edit `package.json`.

## Out of scope

The stat tiles (plan 3) and the batch pipeline (plan 4). A drawer listing the batches behind an
alert is deliberately **not** in this plan: it needs a per-stage batch list whose shape is not
confirmed from this checkout.
