---
depends_on: exec-dash-01-layout.md
preflight: pass 971260c83501
retry_of: ddbcc13f-0768-4c6f-ad73-e0f128a5443e
---

# Executive dashboard 2 of 4 — make the alerts panel the thing you act on

## Why

Alerts are now the first card on the executive dashboard (plan 1 moved them there). What they
render is still a flat list of Bootstrap `.alert` divs with a Resolve button. This plan turns that
into something you can work: severity ordering, counts you can filter by, a resolve that can be
undone, and a button on each alert that takes you to the chart it is talking about.

A previous attempt at this plan was rejected because the severity filter did not actually hide
anything. Read **"Visibility is a module-owned class, never the `hidden` property"** below before
you write a line of code — that section is the reason this plan exists in its current form.

## Facts about this repo that this plan relies on (re-verified against the current checkout)

- The alerts card lives in `WebPortal/modules/dashboard/html/dashboard_unified.html` inside the
  `data-access="executive"` wrapper. Its collapse target is `#execAlertsCollapse` (line 222,
  `<div class="collapse show" ...>`) and its body is
  `<div class="card-body" id="execAlertsContainer">` (line 223), currently seeded with
  `<p class="text-muted small mb-0">Loading alerts…</p>`. Plan 1 has already landed on this base
  branch: the card is first in the block and starts open.
- It is filled by `loadExecutiveAlerts` in
  `WebPortal/modules/dashboard/js/executive_dashboard.js:1550`. Read that function before changing
  it — the behaviour below is described from it, not from memory:
  - It calls `dataFunctions.getDashboardAlerts(null, true)` (`WebPortal/js/data-functions.js`,
    DB function `get_dashboard_alerts`).
  - On an empty list it writes `<p class="text-muted small mb-0">No active alerts.</p>`.
  - On failure it writes `<p class="text-muted small mb-0">Unable to load alerts.</p>`.
  - It renders **at most 8** alerts (`alerts.slice(0, 8)`, line 1560).
  - Per alert it reads `a.severity || a.alert_type`, `a.title || a.alert_title`,
    `a.message || a.alert_message`, and `a.id || a.alert_id`. **Keep every one of those fallbacks.**
    The live rows may use either shape and this plan cannot confirm which from the checkout.
  - It maps severity to a Bootstrap contextual class: `critical` → `danger`, `warning` → `warning`,
    anything else → `info`.
  - The Resolve button is gated by `typeof hasAction === 'function' ? hasAction('alerts.resolve') : true`
    (line 1559) and calls `dataFunctions.resolveDashboardAlert(alertId, note)`
    (`WebPortal/js/data-functions.js:1983`, RPC `resolve_dashboard_alert`, params `p_alert_id` /
    `p_note` — a single-row scoped write), then re-runs `loadExecutiveAlerts()`.
  - The note currently comes from `window.prompt(...)` (line 1575 — the only occurrence in the file).
- `MacStatus` (`WebPortal/js/mac-status.js`) is the portal's status→colour language. It is **not**
  used by any deliverable in this plan (its `pill()` returns an HTML string, which sits badly with
  the DOM-API rule in deliverable 2). It is named here only so you do not reach for it by reflex.

### Visibility is a module-owned class, never the `hidden` property — this is the blocking fix

The previous attempt stamped each rendered row with Bootstrap's `d-flex` utility and then hid rows
with `row.hidden = true`. Hiding through the `hidden` attribute depends on Bootstrap reboot's
`[hidden] { display: none !important }`; `.d-flex { display: flex !important }` has the same
specificity and is emitted later in `bootstrap.min.css`, so the row never hid. Clicking a chip
flipped `aria-pressed`, wrote "showing critical only" into the hint, and left the list untouched —
and because the filter-empty line was toggled from a JS flag rather than from real layout, the panel
could show "Nothing at this level right now." directly above a full list of visible alerts.

Two verified facts make this non-negotiable rather than a matter of taste:

- `WebPortal/index.html:20` loads `bootstrap@5.3.0` CSS **from a CDN**; Bootstrap is not vendored
  anywhere in this checkout (no `bootstrap*.css` file exists here). Nothing about `[hidden]`, about
  `.d-none` beating `.d-flex`, or about utility ordering can be verified from this repo, so **no
  deliverable may depend on any of it**. `d-none` is a Bootstrap class too and is therefore *not*
  an acceptable substitute here.
- `WebPortal/js/appRouter.js:863-867` creates the module `<link rel="stylesheet">` at route load and
  appends it to the document, i.e. **after** the CDN stylesheet. A rule this module owns therefore
  wins ties in the cascade, and with `!important` it wins outright.

Therefore, for every element this plan shows or hides:

1. Declare **one** rule in the module CSS, at the end of the file:
   `.exec-hidden { display: none !important; }`
2. Toggle it through **one** helper, `execSetHidden(el, isHidden)` (deliverable 2), and nothing else.
3. **Never** set `el.hidden`, `setAttribute('hidden', …)` or `removeAttribute('hidden')` anywhere in
   `executive_dashboard.js`. Verify step 4 greps for these and must find none.
4. **Never** put a Bootstrap display utility (`d-flex`, `d-none`, `d-block`, `d-inline-flex`,
   `d-grid`, `d-inline-block`) on an element this plan toggles. That is: the alert row, the chips
   strip `#execAlertChips`, and the filter-empty line `#execAlertsFilterEmpty`. Give the alert row
   its flex layout from the module CSS (`.exec-alert-row { display: flex; … }` — it already needs
   `gap`, so it was always meant to be a flex container). Bootstrap utilities remain fine on
   *descendant* elements that are never toggled (icon spacing, inner wrappers, buttons).

There are exactly **three** toggle sites in this plan. All three go through `execSetHidden`:
the alert rows (deliverable 5), `#execAlertChips` (deliverable 2), and `#execAlertsFilterEmpty`
(deliverable 5).

### `executive_dashboard.js` is a classic script with one top-level `var` — this matters twice

The file is `var _executiveDashboard = function () { … }();` (line 5, `'use strict'` inside), the
returned object literal starts at line 105, the IIFE closes at line 1751, and its only global export
is `window.initializeExecutiveDashboard` (line 1753). It is loaded as a **classic script**, not a
module.

- **Never add `module.exports`, `export`, or `import` to this file.** The root `package.json` has
  `"type": "module"` (line 4), but that governs `.mjs`/Node files, not this browser script. Adding
  an `export` statement makes it throw at parse time and the entire executive dashboard stops
  loading — and no verify step in this plan would catch that.
- Every helper this plan needs to test must be a **property on the object `_executiveDashboard`
  returns**, so the verify harness in step 8 can reach it as `ctx._executiveDashboard.<name>` after
  loading the file into a `node:vm` context. That is how the repo already tests browser-global JS —
  see `scripts/verify-report-rendering.mjs:45-58`. Loading this file into a vm context needs only
  `window` and `console` stubs plus a `document` stub, because the only top-level statement outside
  the IIFE is the `window.initializeExecutiveDashboard = …` assignment.

### The toast helpers are on `_common`, not globals

`WebPortal/js/common.js:4` opens `var _common = {` and line **489** does `window._common = _common;`.
`showToastMessage(message, type, duration)` (line 21), `showSuccessToast` (46), `showErrorToast`
(51), `showWarningToast` and `showInfoToast` are **properties of that object**. There is no global
`showErrorToast` — calling it bare throws a `ReferenceError`.

The repo's convention, per `BluePrint/admin_portal_complete_instructions.md` and every call site
(e.g. `WebPortal/js/exception-ui.js:177-183`), is the guarded, qualified form:

```js
if (typeof _common !== 'undefined' && _common.showErrorToast) {
    _common.showErrorToast('…');
}
```

**Use exactly that form wherever this plan calls a toast helper.**

Those helpers are SweetAlert2 `Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer })`
wrappers (`common.js:21-43`): they take a string and a type and nothing else, and they explicitly
suppress the confirm button. There is no parameter through which an **Undo** control could be passed,
and the undo is the whole point of deliverable 4. That is the reason — and the only reason — this
plan builds a small local toast for the undo case. Say so in a code comment above the new helper so
the next reader does not "simplify" it back to `_common.showToastMessage`.

### The three link targets, and why a naive scroll to them does nothing

The three chart canvases exist and keep their ids — `#productionTrendsChart` (line 480),
`#stockHistoryChart` (515), `#runwayForecastChart` (558) — each inside a `.card` (e.g. line 448) —
**but all three sit inside `<div class="collapse show" id="execChartsCollapse">` (line 444)**, and
there are two separate ways for that to make a scroll a no-op:

1. **The section can be folded.** It starts open, but `WebPortal/js/mac-section-collapse.js` leaves
   the Bootstrap toggle working and persists nothing — a user who folds "Trends & forecasts" and
   then clicks a "Go to" button is scrolling to an element with no layout box, and `scrollIntoView`
   silently does nothing. A null-check on the element does **not** catch this: the element is always
   in the DOM.
2. **The card can be hidden per user.** `applyDashboardVisibility`
   (`executive_dashboard.js:234-246`) sets `el.style.display = 'none'` on each
   `[data-dashboard-widget]` wrapper whose id is not in the user's visible-widget list. The three
   targets sit in wrappers `data-dashboard-widget="execProductionTrends"` (447),
   `="execStockHistory"` (498) and `="execRunwayForecast"` (531), so for a user whose list excludes
   one, that target is not displayed at all and no amount of expanding will reveal it.

Deliverable 3 must handle **both**, not just the null case.

`bootstrap.Collapse.getOrCreateInstance(...)` is already used in this repo at
`WebPortal/js/index.js:54`, so the global is available on the dashboard route and the pattern is
established. Guard it anyway (`typeof bootstrap !== 'undefined' && bootstrap.Collapse`) and fall
back to adding the `show` class directly.

## Names this plan owns

This plan defines exactly these names; plans 3 and 4 reuse them and must not redefine them. Every
later section of this plan uses these spellings and no others:

- Ids: `#execAlertChips`, `#execAlertHint`, `#execAlertsFilterEmpty`, `#execToastHost`
  (`#execAlertsContainer` already exists in the HTML and keeps its id).
- CSS classes: `.exec-alert-chips`, `.exec-chip`, `.exec-chip--critical|--warning|--info`,
  `.exec-alert-hint`, `.exec-alert-row`, `.exec-alert-row--critical|--warning|--info`,
  `.exec-alert-icon`, `.exec-alert-sev-label`, `.exec-toast-host`, `.exec-toast`, `.exec-flash`,
  **`.exec-hidden`**.
- Properties on the returned `_executiveDashboard` object (exposed so the step-8 harness can reach
  them): `execScrollTarget`, `execGoToTarget`, `execSetHidden`, `execAlertRowClass`.
- Module-internal helpers (free functions inside the IIFE, not exposed): `execAlertSeverityOf`,
  `execAlertSeverityRank`, `execAlertSeverityIcon`, `execMatchAlertGoToSelector`,
  `execBuildAlertRow`, `execAlertChipsCounts`, `execAlertAdjustCount`, `execAlertSetHint`,
  `execAlertRenderFilterHint`, `execAlertsApplyFilter`, `execAlertsBindChipsOnce`,
  `execAlertsBindContainerOnce`, `execEnsureToastHost`, `execShowUndoToast`,
  `execHandleResolveClick`; module-internal state `execAlertsFilterSeverity`,
  `execAlertsHintDefault`, `execAlertsRenderSeq`.

Call the four exposed helpers as `_executiveDashboard.<name>(...)` from inside the module (the `var`
is assigned before any of these run). Always scope `[data-count]` lookups to `#execAlertChips` —
plan 3's stat tiles use their own attributes and a document-wide `[data-count]` query would collide.

## Deliverables

### 1. Give the alerts card a header strip with counts

In `dashboard_unified.html`, inside `#execAlertsCollapse` and immediately above
`#execAlertsContainer`, add a static header strip. It starts hidden with **the module's own class**,
not the `hidden` attribute:

```html
<div class="exec-alert-chips exec-hidden" id="execAlertChips" role="group" aria-label="Filter alerts by severity">
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

The `class` attribute on `#execAlertChips` must be **exactly** `exec-alert-chips exec-hidden` — no
`d-flex`, no `hidden` attribute (verify step 5 checks this literally). The strip is static markup, so
it is swept by the router — but it holds no permission-gated control, so do **not** put
`data-action-perm` on it. Do **not** put `data-dashboard-widget` on it either.

### 2. Rewrite `loadExecutiveAlerts` rendering

Keep the fetch, the field fallbacks, the `hasAction('alerts.resolve')` gate and the two existing
text states. Change what is rendered and add the interaction:

- **Sort before slicing.** The current code slices to 8 unsorted. Sort a **copy** critical-first,
  then warning, then everything else, **and only then** `slice(0, 8)`. Order matters: sorting after
  the slice would show the 8 arbitrary rows the DB happened to return first, which defeats the
  point. Do not mutate the array returned by the data layer.
- **Build each row with DOM APIs, not an HTML string.** `BluePrint/javascript-jquery-rules.md:226`
  says "NEVER use `innerHTML` with untrusted data — use `textContent`", and the three values here
  (`title`, `message`, the id) are operator-entered rows out of the database. Create the row with
  `document.createElement`, set the static classes and icons directly, and put every DB-sourced
  value in with `textContent` / `.dataset`. Do not add an `esc()` helper and keep concatenating —
  that is the weaker of the two options the BluePrint offers.
- **Two small exposed helpers, because verify step 8 exercises them:**

  ```
  execAlertRowClass(sev)
    sev : 'critical' | 'warning' | 'info'
    returns exactly 'exec-alert-row exec-alert-row--' + sev
    - pure, no DOM access, no side effects
    - MUST NOT include any Bootstrap display utility (d-flex/d-none/d-block/...).
      The row gets `display: flex` from .exec-alert-row in the module CSS (deliverable 6).

  execSetHidden(el, isHidden)
    el : an Element, or null/undefined (then it is a no-op and must not throw)
    isHidden : truthy to hide, falsy to show
    does exactly: el.classList.toggle('exec-hidden', !!isHidden)
    - must not touch el.hidden, el.style.display, or any attribute other than class
  ```

  `execBuildAlertRow` must set the row's className from `_executiveDashboard.execAlertRowClass(sev)`
  (verify step 6 greps for both the definition and that call site). Every show/hide anywhere in the
  alerts code goes through `_executiveDashboard.execSetHidden`.
- **Each alert** renders as a row carrying `data-sev="<critical|warning|info>"` with:
  - a severity stripe and a Font Awesome icon (`fas fa-triangle-exclamation` for critical,
    `fas fa-circle-exclamation` for warning, `fas fa-circle-info` for info) — **Font Awesome only,
    never `bi bi-`**;
  - an uppercase severity label next to the title, so severity is never carried by colour alone;
  - the title, then the message;
  - a **"Go to" button** when, and only when, deliverable 3's rules say to render one;
  - the existing Resolve button, unchanged in permission behaviour (keep
    `data-action-perm="alerts.resolve"` on it and keep the `canResolve && id` condition).

**What the chips count — all four states, spelled out.** These numbers sit on the card this plan
calls "the thing you act on", so leaving them ambiguous would let an agent ship a confidently wrong
figure. The rule is:

- The chips count the **rendered rows only** — the ≤8 that survive the sort-then-slice, bucketed by
  the same `critical` / `warning` / `info` mapping used for the stripe. They are a legend for what is
  on screen, not a database total, and the filter in deliverable 5 filters exactly those rows, so
  the two always agree.
- **When the fetch returned more than 8 alerts**, append `showing 8 of <N>` to `#execAlertHint`, so
  the cap is visible rather than implied. `<N>` is `alerts.length` before the slice.
- **On the empty path** (`No active alerts.`): set all three counts to `0` and hide the strip with
  `execSetHidden(chips, true)`. Chips reading "0 critical" above "No active alerts." is noise.
- **On the failure path** (`Unable to load alerts.`): hide the strip with
  `execSetHidden(chips, true)` as well, and do **not** write any number. A `0` next to "Unable to
  load alerts." asserts there are no critical alerts, which is precisely what a failed fetch does
  not know.
- Show the strip again (`execSetHidden(chips, false)`) at the start of a successful render with at
  least one row.

**Reset the filter on every render.** `loadExecutiveAlerts()` re-runs after a resolve, which
rebuilds the rows but would otherwise leave the chips as the user left them — a chip reading
"pressed, showing critical only" above a full unfiltered list. At the top of the render, set every
chip's `aria-pressed="false"`, clear `#execAlertHint`, and set `execAlertsFilterSeverity = null`.

**Bind listeners once, not per render.** `#execAlertChips`, `#execAlertHint` and
`#execAlertsContainer` persist across re-renders, so `addEventListener` inside the render would stack
duplicate handlers. Use delegated listeners bound once (guard with a `dataset` flag) for the chips,
the "Show all" control and the container's Go-to/Resolve buttons.

**Render generation counter.** Declare a module-level `var execAlertsRenderSeq = 0;` and increment it
at the top of every `loadExecutiveAlerts` invocation, before the fetch. Deliverable 4 captures its
value and uses it to detect that a later render has replaced the DOM it was holding on to.

### 3. "Go to" buttons, matched conservatively, and actually able to arrive

The alert rows have no field naming a target screen, and this plan cannot invent one. Match on the
alert's own text instead, and render the button **only on a match**:

- text contains `runway` or `nut-in-shell` or `nut in shell` → target `#runwayForecastChart`
- else text contains `stock` → target `#stockHistoryChart`
- else text contains `production` or `cracked` or `packed` → target `#productionTrendsChart`
- else → **no button at all**

Match case-insensitively against `title + ' ' + message`.

**Define `execScrollTarget` as a property on the returned `_executiveDashboard` object.** Its
contract is fixed here, because plans 3 and 4 both call it:

```
execScrollTarget(el)
  el : an Element, or null
  returns one of the strings 'ok' | 'missing' | 'hidden'
    'missing' - el is null/undefined, has no usable .closest, or has no .closest('.card') ancestor
    'hidden'  - el.closest('[data-dashboard-widget]') exists and its style.display === 'none'
                (applyDashboardVisibility hid it for this user)
    'ok'      - otherwise
```

It takes an **Element**, not a selector — callers do their own `document.querySelector`. It reads
state and returns a string; it must not scroll, mutate, or throw. Keeping it pure is what lets
verify step 8 exercise it outside a browser.

Add a second property `execGoToTarget(el)` that does the moving, and call it from the delegated click
handler:

1. If `_executiveDashboard.execScrollTarget(el) !== 'ok'`, return immediately.
2. Find `el.closest('.collapse')`. If there is one and it does not have the `show` class, expand it
   first — `bootstrap.Collapse.getOrCreateInstance(collapseEl).show()` guarded by
   `typeof bootstrap !== 'undefined' && bootstrap.Collapse`, falling back to
   `collapseEl.classList.add('show')`. Also set the matching toggle button's `aria-expanded="true"`
   (find it with `[data-bs-target="#<collapse id>"]`) so the chevron and the screen-reader state
   stay truthful.
3. Scroll **after** the expand has finished, otherwise the target's position is measured
   mid-animation — listen once for `shown.bs.collapse` on the collapse element and scroll in that
   handler, with a `setTimeout(..., 400)` fallback in case Bootstrap is absent and the class was
   added directly. Guard with a single `expanded` flag so only one of the two paths scrolls, and
   remove the listener when the fallback fires. If the collapse was already open, scroll immediately.
4. Scroll with `el.closest('.card').scrollIntoView({ behavior: <see below>, block: 'center' })` and
   add `exec-flash` to that card for 1600ms, then remove it.

**When rendering the row**, call `_executiveDashboard.execScrollTarget(document.querySelector(sel))`
first and render the "Go to" button only when it returns `'ok'`. A button that does nothing is worse
than no button.

**Reduced motion is a JS decision here, not a CSS one.** A `@media (prefers-reduced-motion)` rule
cannot change a `behavior` value supplied in JS. Read it once:
`var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;`
and pass `behavior: reduce ? 'auto' : 'smooth'`. The CSS media query still disables the `exec-flash`
animation — that part is CSS's job.

### 4. Resolve with an undo, instead of a prompt

Replace the `window.prompt` note with an optimistic resolve. **One timer, one settled flag, one
generation check** — the previous design used two independent 6-second timers and no generation
check, which lost races and could re-insert stale rows:

- On click, remove the row from the DOM and decrement the matching chip count immediately, then
  re-run `execAlertsApplyFilter()` so the filter-empty line stays truthful. Keep a reference to the
  row, **to its parent**, and **to its next sibling**, so it can be put back in the same position.
  Capture `var seq = execAlertsRenderSeq;` at this moment.
- Show a small toast reading `Resolved: <title>` with an **Undo** button, for 6 seconds. The title
  is DB-sourced — set it with `textContent`, never by string concatenation into `innerHTML`.
- **Exactly one `setTimeout`** drives the write. Hold its handle. Guard everything with a single
  `var settled = false;` flag that is set **synchronously** at the top of whichever path runs first:
  - Undo pressed: set `settled = true`, `clearTimeout(writeTimer)`, remove the toast, then restore
    (see below). **Do not call the API at all** in that case.
  - Timer fires: if `settled` is already true, return; otherwise set `settled = true` and issue
    `dataFunctions.resolveDashboardAlert(alertId, '')`, then re-run
    `_executiveDashboard.loadExecutiveAlerts()`.
  This makes an Undo pressed in the last milliseconds of the window impossible to lose.
- **Restore rule (used by Undo and by the failure path).** Only touch the DOM if
  `seq === execAlertsRenderSeq`. If the generation has moved on, a later render has already rebuilt
  the list from the database and the row is either back or genuinely gone: do **not** re-insert the
  saved row and do **not** adjust any count (they belong to the newer render). When the generation
  still matches, insert the row before its saved next sibling if that sibling is still a child of the
  saved parent; otherwise insert it **before `#execAlertsFilterEmpty`** if that element is present
  (never after it, or the row lands below the "Nothing at this level" line); otherwise append.
  Then increment the chip count back and re-run `execAlertsApplyFilter()`.
- **Treat two different failures the same way.** `resolveDashboardAlert`
  (`WebPortal/js/data-functions.js:1983`) returns whatever `callFunction('resolve_dashboard_alert', …)`
  resolves to, so it can reject *and* it can resolve with a `{ success: false }`-shaped payload from
  the DB function rather than throwing — handle both defensively. On either: apply the restore rule
  above, and show the error with the guarded, qualified call:

  ```js
  if (typeof _common !== 'undefined' && _common.showErrorToast) {
      _common.showErrorToast('Could not resolve that alert. It is still open.');
  }
  ```

  There is no global `showErrorToast` — see the Facts section. When the generation has moved on and
  the restore was skipped, still show that error toast and additionally re-run
  `_executiveDashboard.loadExecutiveAlerts()` so the screen matches the database. Never leave the row
  hidden after a failed write.

Build the undo toast in this module: **one** fixed-position container with the id `execToastHost`,
class `exec-toast-host`, `role="status"` and `aria-live="polite"` (so screen-reader users are told
the undo opportunity exists), appended to `document.body` on first use and reused thereafter
(`document.getElementById` first, so a re-render never creates a second one). Individual toasts are
**removed** from the DOM when dismissed, not hidden. Do not add a toast library. See the Facts
section for why `_common`'s helpers cannot serve the undo case, and put that reason in a comment
above the helper.

### 5. Filtering by severity

Clicking a chip filters the list to that severity and sets its `aria-pressed="true"`; clicking it
again clears the filter. While a filter is on, write `showing <severity> only` plus a "Show all"
button into `#execAlertHint`; when the filter is cleared, restore the default hint text
(`execAlertsHintDefault`, i.e. the `showing 8 of <N>` string or empty).

**Filtering hides rows with `_executiveDashboard.execSetHidden(row, true)` — never `row.hidden`,
never by removing them.** This is the defect that blocked the previous attempt; re-read the
"Visibility is a module-owned class" section if you are tempted to shortcut it.

When a filter leaves nothing visible, show `Nothing at this level right now.` — as a **separate
element appended to `#execAlertsContainer`** (create it once per render as the last child, give it
the id `execAlertsFilterEmpty` and the exact className string
`'text-muted small mb-0 mt-2 exec-hidden'`, and toggle it with `execSetHidden`). Do **not** write it
with `execAlertsContainer.innerHTML = …`: that would destroy the hidden rows the filter is meant to
be preserving, and "Show all" would then restore nothing.

When there are genuinely no alerts at all, keep the existing `No active alerts.` wording.

### 6. CSS

Put every new rule in `WebPortal/modules/dashboard/css/executive_dashboard.css` (already registered
for the dashboard route in `WebPortal/js/appRouteConfig.json:40` and `:747` — do not add a file).

- Required, at the **end** of the file:

  ```css
  .exec-hidden { display: none !important; }
  ```

  `!important` is deliberate and is the only place this plan uses it: it is what makes the hide
  immune to any Bootstrap utility that might land on the same element. `!important` in module CSS is
  established here (e.g. `WebPortal/modules/supplier-intake/css/supplier_intake_grid.css:30`) and is
  not flagged by `ui:verify`.
- `.exec-alert-row` declares `display: flex` itself (plus `gap`, border, stripe, padding, margin).
  `.exec-alert-chips` declares `display: flex` itself. Neither element may borrow `d-flex`.
- Colours come from `--mac-*` tokens only: `--mac-danger` / `--mac-danger-light` for critical,
  `--mac-warning` / `--mac-warning-light` with `--mac-warning-text` for the warning **text tone**,
  `--mac-info` / `--mac-info-light` for info, `--mac-border`, `--mac-text`, `--mac-text-secondary`,
  `--mac-text-tertiary`, `--mac-bg-secondary`, `--mac-radius-*`, `--mac-space-*`, `--mac-shadow-*`
  (all confirmed present in `WebPortal/css/design-tokens.css`).
- **No raw hex. No `linear-gradient(` in any form** (the gate's check is a substring match, so
  `repeating-linear-gradient` is banned too). No `.badge { min-width }`. No bare `td`/`th` padding.
- `.exec-flash` must be a box-shadow or outline animation built from
  `rgba(var(--mac-green-rgb), …)` (`design-tokens.css:9`) — not a gradient, and not a raw colour.
- `@media (prefers-reduced-motion: reduce)` disables the `exec-flash` animation. The scroll
  behaviour is handled in JS (deliverable 3) — do not try to do it here.

## Verify before finishing

Every step below is runnable headless with no network and no browser.

1. `npm run test:fleet` — must pass. **Do not run `npm ci`**: the root `package.json` declares no
   dependencies and there is no root `package-lock.json`. **Do not `npm install` anything** — this
   plan adds no dependency, and verify step 8 is designed so none is needed. Do not edit
   `package.json` or any script under `scripts/`.
2. `grep -n "getDashboardAlerts\|alert_title\|alert_message\|alert_id\|hasAction('alerts.resolve')" WebPortal/modules/dashboard/js/executive_dashboard.js`
   — every one of these must still be present, proving the fetch, the field fallbacks and the
   permission gate survived the rewrite.
3. `grep -n "window.prompt" WebPortal/modules/dashboard/js/executive_dashboard.js` — must return no
   match inside the alerts code.
4. **The blocking-defect check.**
   `grep -n "\.hidden\s*=\|setAttribute('hidden'\|removeAttribute('hidden')\|setAttribute(\"hidden\"" WebPortal/modules/dashboard/js/executive_dashboard.js`
   — must return **no matches** (the base file has none; all visibility goes through
   `execSetHidden`). Then
   `grep -n "exec-hidden" WebPortal/modules/dashboard/css/executive_dashboard.css` — must show
   `.exec-hidden { display: none !important; }`.
5. `grep -n "execAlertChips" WebPortal/modules/dashboard/html/dashboard_unified.html` — the opening
   tag must read `class="exec-alert-chips exec-hidden"` with no `hidden` attribute and no `d-flex`.
6. `grep -n "execAlertRowClass\|execSetHidden" WebPortal/modules/dashboard/js/executive_dashboard.js`
   — each name must appear at its definition **and** at call sites (`execAlertRowClass` at least
   once inside the row builder; `execSetHidden` at all three toggle sites: the row filter, the chips
   strip, and `#execAlertsFilterEmpty`). Paste the lines into your report.
7. `grep -rn "bi bi-\|btn-success" WebPortal/modules/dashboard/` — must return no matches.
   `grep -n "#[0-9a-fA-F]\{3,8\}" WebPortal/modules/dashboard/css/executive_dashboard.css` — no
   matches other than `#fff`/`#000`.
   `grep -in "linear-gradient" WebPortal/modules/dashboard/css/executive_dashboard.css` — no matches.
8. **Exercise the pure helpers for real, with the harness this repo already uses.** Copy the
   pattern at `scripts/verify-report-rendering.mjs:45-58`: load the browser script into a
   `node:vm` context with stub globals and read the helpers off the context. Write this to a temp
   file **outside the repo** and run it with `node`. Do not add it to `package.json` or `scripts/`:

   ```js
   import fs from 'node:fs';
   import vm from 'node:vm';
   const P = 'WebPortal/modules/dashboard/js/executive_dashboard.js';
   const ctx = { window: {}, document: { getElementById: () => null }, console };
   vm.createContext(ctx);
   new vm.Script(fs.readFileSync(P, 'utf8'), { filename: P }).runInContext(ctx);
   const api = ctx._executiveDashboard;
   for (const n of ['execScrollTarget', 'execGoToTarget', 'execSetHidden', 'execAlertRowClass']) {
     if (typeof api[n] !== 'function') throw new Error(n + ' not exposed on _executiveDashboard');
   }

   // --- execScrollTarget: hand-built stubs, closest() returns whatever the test says ---
   const f = api.execScrollTarget;
   const card = { tagName: 'DIV' };
   const mk = (widget) => ({ closest: (s) => s === '.card' ? card : (s === '[data-dashboard-widget]' ? widget : null) });
   console.log('null            ->', f(null));                                    // missing
   console.log('no card         ->', f({ closest: () => null }));                 // missing
   console.log('widget hidden   ->', f(mk({ style: { display: 'none' } })));      // hidden
   console.log('widget visible  ->', f(mk({ style: { display: '' } })));          // ok
   console.log('no widget       ->', f(mk(null)));                                // ok

   // --- execAlertRowClass: exact string, and no Bootstrap display utility ---
   const rc = api.execAlertRowClass('critical');
   if (rc !== 'exec-alert-row exec-alert-row--critical') throw new Error('execAlertRowClass: ' + rc);
   for (const sev of ['critical', 'warning', 'info']) {
     if (/\bd-(flex|none|block|grid|inline-flex|inline-block)\b/.test(api.execAlertRowClass(sev))) {
       throw new Error('row class must not carry a Bootstrap display utility: ' + api.execAlertRowClass(sev));
     }
   }
   console.log('rowClass        -> ok');

   // --- execSetHidden: toggles the module class only, tolerates null ---
   const state = {};
   const el = {
     classList: { toggle: (c, on) => { state[c] = on; } },
     set hidden(v) { throw new Error('execSetHidden must not touch el.hidden'); },
     setAttribute: () => { throw new Error('execSetHidden must not set attributes'); }
   };
   api.execSetHidden(el, true);
   if (state['exec-hidden'] !== true) throw new Error('execSetHidden(el, true) did not add exec-hidden');
   api.execSetHidden(el, false);
   if (state['exec-hidden'] !== false) throw new Error('execSetHidden(el, false) did not remove exec-hidden');
   api.execSetHidden(null, true); // must not throw
   console.log('setHidden       -> ok');
   ```

   The five `execScrollTarget` lines must print the value in their comment, and the script must exit
   0. **Delete the temp file before you finish.**

   Three things this step forbids, because each is a plausible wrong turn: do **not** `npm install`
   a DOM library; do **not** add `module.exports` or `export` to `executive_dashboard.js` (it is a
   classic script — that throws at load and takes the whole dashboard down); and do **not** use
   `eval` (`BluePrint/javascript-jquery-rules.md` bans it). Attaching the helpers to the object
   `_executiveDashboard` returns is all that is required, and the `vm` context reaches it as a
   top-level `var`.
9. `grep -n "matchMedia" WebPortal/modules/dashboard/js/executive_dashboard.js` — must match, proving
   the reduced-motion branch is in JS where it can affect `scrollIntoView`.
10. `grep -n "showErrorToast" WebPortal/modules/dashboard/js/executive_dashboard.js` — every hit must
    be `_common.showErrorToast` guarded by `typeof _common !== 'undefined'`. Paste the lines into
    your report.
11. `grep -n "execAlertsRenderSeq\|clearTimeout" WebPortal/modules/dashboard/js/executive_dashboard.js`
    — must show the generation counter being incremented per render and captured by the deferred
    write, and the single write timer being cleared on Undo. Paste the lines into your report.
12. `git diff HEAD --name-only` — must list only
    `WebPortal/modules/dashboard/html/dashboard_unified.html`,
    `WebPortal/modules/dashboard/js/executive_dashboard.js` and
    `WebPortal/modules/dashboard/css/executive_dashboard.css`. Use `HEAD` so the check still works
    if you have staged your changes.

## Blast radius on existing tests

`ui:verify` (`scripts/verify-ui-standard.mjs`, run inside `test:fleet`) is the one that will react to
this plan: it scans `WebPortal/**/*.css` for raw hex, `linear-gradient(`, `.swal2-*` outside the swal
theme, bare `td`/`th` padding and `.badge{min-width}`, and `WebPortal/**/*.{html,js}` for `bi bi-`,
`bootstrap-icons` and `btn-success`. It does **not** flag `!important`. It is currently green, so any
failure it reports is genuinely yours — fix the code, never the script.
`routing:verify`, `registry:verify` and `reports:verify` also run in `test:fleet`: this plan adds no
file, no route entry and does not touch `report-pdf-builder.js`, so they should be unaffected —
confirm they stay green rather than assuming it. Do not edit `package.json`.

## Out of scope

The stat tiles (plan 3) and the batch pipeline (plan 4). A drawer listing the batches behind an
alert is deliberately **not** in this plan: it needs a per-stage batch list whose shape is not
confirmed from this checkout. No SQL, no migration, no new RPC: the only write remains the existing
single-row `resolve_dashboard_alert` call. No changes to `WebPortal/js/common.js`,
`WebPortal/js/data-functions.js`, any script under `scripts/`, or any file outside the three named
above.
