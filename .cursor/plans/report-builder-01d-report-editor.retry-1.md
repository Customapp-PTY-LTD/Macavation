---
retry_of: 9654c1aa-de1e-4040-89aa-c66bfa0e7b35
---

# Report builder — the report editor and the override flow

## Context

Last of four small plans replacing `report-builder-01-list-and-editor.md`, which was blocked twice
for being too large. This one builds the editor screen the report list opens into: section toggles,
commentary, the executive summary, and the metric rows where Pete enters figures.

**This plan carries no `depends_on`: everything it builds on is already merged into `dev`.** The
report list module, the eleven RPC wrappers and the repointed `sales-forecasting-grid` route are all
in the base branch. Confirm before starting — `WebPortal/modules/sales-reports/js/report_list_grid.js`
and `WebPortal/modules/sales-reports/html/report_list.html` exist, and
`WebPortal/js/data-functions.js` defines `getReportInstance` (`:5961`). If any is missing, stop and
report rather than creating it here.

**The single most important thing this plan fixes is that the editor route does not exist yet.**
`sales-report-editor` appears in neither `WebPortal/js/appRouteConfig.json` nor the hardcoded
`moduleInitializers` map inside `initializeModule()` in `WebPortal/js/appRouter.js`, so
`report_list_grid.js`'s `reportEditorRouteExists()` guard (`:80-83`) returns false and every attempt
to open a report — for **every** role, super_user included — shows an informational dialog.
Registering the route is what makes the feature reachable at all.
(`roleMenuConfig.hasAccess` returns `true` for `super_user`/`admin` at `role-menu-config.js:609`, so
the permissions branch is not what is blocking them.)

The RPCs are defined in `migrations/20260817090000_report_builder_foundations.sql` and
`migrations/20260817100000_report_instances_and_targets.sql`, both in this checkout. **Whether those
migrations have been applied to any database cannot be verified from this checkout — do not state or
assume that they have.**

**Why the override flow is the heart of this screen.** `resolve_report_metric_value` in
`20260817100000` is a deliberate stub returning NULL for every metric (`:353-375`) — read it and
confirm. So every figure arrives as "no system data" and Pete types it in with a reason, while the
report keeps system value, entered value and target side by side so the gap stays visible.
Background is in `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`; **do not copy that
document's counts or percentages into code comments, UI copy or commit messages** — they come from
database queries this run cannot re-execute.

## The payload

`getReportInstance` returns one `jsonb` document, or `null` if the id is unknown
(`20260817100000:717-720`):

```json
{
  "id": "uuid", "template_name": "Macavation Weekly Report",
  "period_type": "weekly", "period_start": "2026-08-10", "period_end": "2026-08-16",
  "period_label": "Week of 10 Aug 2026", "fy": 2027, "fy_month_index": null,
  "version": 1, "status": "draft", "executive_summary": null,
  "generated_at": "…", "published_at": null, "supersede_reason": null,
  "sections": [
    { "section_key": "kernel_production", "label": "Kernel Processing",
      "render_kind": "metric_table", "is_enabled": true,
      "display_order": "000010", "commentary": null,
      "metrics": [
        { "metric_key": "kernel_nis_cracking_kg", "label": "Nut in Shell Cracking",
          "unit": "kg", "division": "kernel", "has_target": true,
          "system_value": null, "target_value": 25000.0, "entered_value": 100758.0,
          "effective_value": 100758.0, "is_overridden": true,
          "override_reason": "…", "overridden_at": "…", "overridden_by_name": "Pete" }
      ],
      "lines": []
    }
  ]
}
```

Two shapes to handle carefully:

- **`display_order` is a zero-padded string** (`LPAD(...,6,'0')`, `20260817100000:751`), not a number.
  Sort it as a string, or `parseInt(..., 10)` before comparing numerically.
- **`period_label` may contain internal blank padding.**
  `migrations/20260817090100_fix_report_period_label_padding.sql` exists because
  `report_period_label` produced `"August    2026 (FYE 2027)"`, and whether that fix has been applied
  to any given database is unknowable from here. Normalise for display only:
  `$el.text(String(label == null ? '' : label).replace(/\s+/g, ' ').trim())`. Never synthesise a
  label locally — the title always comes from the server.

`render_kind` is one of `metric_table`, `line_table`, `tracking_table`. **Only `metric_table`
renders content in this plan.** `line_table` and `tracking_table` sections render their header and
toggle plus the empty state "Populated when this section's data source is connected" — their content
arrives in a later plan, and `lines` is always `[]` for now.

`status` is one of `draft`, `published`, `superseded`
(`report_instances_status_check`, `20260817100000:148`).

## Security invariants

This screen renders and writes user-entered text — override reasons, commentary, the executive
summary. `BluePrint/javascript-jquery-rules.md:225-226` states the rule and
`report_list_grid.js:104-106,138` is the working precedent in this same module.

- **Never pass database or user-entered text through `.html()`, `innerHTML`, or string concatenation
  into markup.** Build the element, then set its text with `.text()`. This covers every override
  reason, commentary, section label, metric label, template name and `overridden_by_name`. Numbers
  may be formatted and concatenated only after `Number()` conversion.
  The one permitted `.html()` use is a shared helper that escapes its own arguments —
  `MacStatus.pill` (escapes at `mac-status.js:50-54,61-64`) and `macEmptyState`
  (escapes at `ui-states.js:12-20,29-35`) — and only with a **static** label string, never with a
  payload value.
- **Validate the report uuid from `Session` or any `data-*` attribute** with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before any RPC call. A
  truthiness check is not validation.
- Never use a payload value (`metric_key`, `section_key`) as an object property key without first
  rejecting `__proto__` and `constructor`. Prefer a `Map` keyed by those strings.
- `JSON.parse` only inside `try/catch`. No `eval`, no `new Function`, no string-form `setTimeout`
  in shipped `WebPortal/` code. (`new Function`/`vm` is allowed **only** inside the throwaway
  verification script described under Verification, which is deleted before finishing.)

## FIXED constraints

1. **Register the route in BOTH `WebPortal/js/appRouteConfig.json` AND the hardcoded
   `moduleInitializers` map inside `initializeModule()` in `WebPortal/js/appRouter.js`.** A route in
   only one silently renders nothing. Follow the shape of the neighbouring entries; the
   `sales-forecasting-grid` entry is at `appRouter.js:433-437` and its registry entry at
   `appRouteConfig.json:640-650` — re-grep rather than trusting these numbers. The new map entry is:

   ```js
   'sales-report-editor': () => {
       if (typeof initializeReportEditor === 'function') {
           initializeReportEditor();
       }
   },
   ```

   The registry entry uses `"path": "sales-reports"` (same module directory as the list) and lists
   `js/report-metric-line.js` **before** `js/report_editor.js`, since the editor calls into it.
   **Every path named in the registry entry must exist on disk when the run finishes** —
   `scripts/verify-registry-paths.mjs` (part of `test:fleet` via `registry:verify`) exits 1 on a
   registry entry naming a missing file. Reuse the existing `css/sales_reports.css`; do not name a
   CSS or HTML file you do not create.
2. **No deep-linking.** Read the report id from `Session.get('currentReportId')`
   (`WebPortal/js/session.js:68-72`; `report_list_grid.js:98` is what sets it).
   `initializeModule` is called as `initializeModule(routeName)` with no params
   (`appRouter.js:252`), so the id cannot arrive as an argument. **A missing or malformed id must
   render an empty state and route back to `sales-forecasting-grid`** rather than throwing.
3. **`data-action-perm` is swept once over static markup only** (`CLAUDE.md:29-32`; the sweep is at
   `appRouter.js:253-256`, 100 ms after load) and is inert on anything rendered afterwards. Metric
   rows are rendered afterwards, so gate them with
   `typeof hasAction === 'function' && hasAction('reports.report.edit')` inline at render time
   (`window.hasAction` is defined at `action-access.js:95`). **Never call it with an empty key** —
   `has('')` returns `true` (`action-access.js:44`). Static buttons in `report_editor.html` may carry
   `data-action-perm` as the list's markup does (`report_list.html:9`).
4. **Module scripts load once per session.** `appRouter.loadJSCode` caches by URL
   (`appRouter.js:789-793`), so the module's `init()` runs again on every revisit while top-level code
   does not. Put all per-visit state resetting inside `init()`, and provide `destroy()` that removes
   namespaced handlers. Model the shape on `report_list_grid.js:434-449` (`init()` calls `destroy()`
   first; every binding namespaced, here `.reportEditor`).
5. **Do not change any file's module format.** Every file under `WebPortal/` is loaded by the browser
   as a **classic script** (`appRouter.js:795-807` creates `<script src=…>`; `index.html:564-594`
   does the same for the shared files). The repo root `package.json:4` declares `"type": "module"`
   and there is **no** `package.json` under `WebPortal/`, so Node classifies these files as ESM even
   though the browser does not. **Never add `import`, `export`, `module.exports` or
   `exports.` to any file under `WebPortal/`, and never add a `package.json` under `WebPortal/`, to
   make a file requireable from a test script.** Doing so is a runtime `SyntaxError` in the browser,
   the module never defines its renderer, and nothing in `test:fleet` checks JS syntax. The
   verification harness below is designed around this and needs no such change.
6. **Expose the renderer on the global object, evaluable with no DOM.**
   `report-metric-line.js` must use the repo's existing browser-safe namespace pattern —
   `(function (w) { 'use strict'; … w.ReportMetricLine = { … }; })(typeof window !== 'undefined' ? window : this);`
   modelled on `WebPortal/js/ui-states.js:9,37-40` and `WebPortal/js/mac-status.js:15,66-67`.
   **Its top level must define functions and assign the namespace only** — no reference to
   `document`, `$`, `jQuery`, `Swal` or `dataFunctions` at evaluation time (those may be used *inside*
   functions). This is what makes the pure-Node check in Verification possible without touching the
   module format.
7. **Use these exact wrapper signatures.** Verified in `WebPortal/js/data-functions.js`; do not
   invent extra arguments. Every one of these wrappers takes an optional trailing `token` that must
   be **omitted** — the wrappers stamp `p_actor_user_id: this.getCurrentUserId()` themselves
   (`:5987`) and `callFunction` resolves the token itself (`:646`). Passing a user id into the `token`
   slot defeats the `if (!authToken) throw` guard at `:648-650`.
   - `getReportInstance(reportInstanceId)` (`:5961`) — plus `getReportInstance(reportInstanceId, null, true)`
     when a forced re-read is wanted after a write.
   - `overrideReportMetricValue(reportInstanceId, metricKey, enteredValue, reason)` (`:5974`) — **four
     arguments**.
   - `clearReportMetricOverride(reportInstanceId, metricKey)` (`:5995`) — two arguments.
   - `setReportSectionState(reportInstanceId, sectionKey, changes)` (`:6007`) — the third argument is a
     **changes object**: `{ is_enabled: true|false }` for a toggle, `{ commentary: '<string>' }` for
     commentary. The wrapper is what maps an absent field to `undefined` (`:6012-6022`); the caller
     never passes `undefined`/`null` param values itself. `commentary` must be a `string` (`''`
     included) or the wrapper throws `'nothing to change.'` (`:6014`).
   - `setReportExecutiveSummary(reportInstanceId, summary)` (`:6032`) — pass `''` to clear.
   - `refreshReportInstance(reportInstanceId)` (`:6049`) — one argument.
8. **No offline-queued success path in this module.** `callFunction` queues a write offline only when
   the RPC name contains `create`/`update`/`delete`/`deactivate` (`:673-676`). None of the six RPCs
   above does, so when offline they fall into the read branch and **throw**
   (`:710-724`). **Do not copy `isQueuedOffline()` from `report_list_grid.js:54-56` into the editor as
   a success path** — an offline save is handled by the same error path as any other failure
   (revert the input, show the error). `report_list_grid.js` uses that helper only because
   `createReportInstance`/`deleteReportInstance` really are queued (`:5953-5954`, `:6063-6064`).
9. **`report_list_grid.js`'s helpers are private.** Its returned object exposes only `init`, `destroy`
   and `load` (`:434-449`); `displayLabel`, `isReportUuid`, `firstRpcRow` and `formatGeneratedAt` are
   not reachable from another file. Define the ones the editor needs locally inside
   `report_editor.js` — do not write `_reportListGrid.displayLabel(...)`.
10. **Do not copy `report_list_grid.js`'s auto-init.** That file ends with
    `$(document).ready(function () { initializeReportListGrid(); });` (`:467-469`), which for a
    router-loaded script fires immediately on injection and double-initialises. The editor is reached
    only through the router, so `report_editor.js` defines the global `initializeReportEditor()` and
    **registers it in the `moduleInitializers` map only** — no `$(document).ready` auto-init at its
    top level. The 5-second `typeof dataFunctions !== 'undefined'` wait loop from
    `report_list_grid.js:452-465` may be reused inside `initializeReportEditor()`.

## Deliverables

### 1. `WebPortal/modules/sales-reports/js/report-metric-line.js`

One reusable renderer for a metric row, used by every `metric_table` section. Columns:
**Description · System · Entered · Target · Achieved % · Status**.

Written per FIXED constraint 6, exposing exactly these three members on `window.ReportMetricLine`
(these names are what deliverable 3 and the Verification section use — keep them identical):

- `formatSystemValue(metric)` → string
- `formatAchievedPct(metric)` → string
- `buildMetricRow(metric, options)` → a jQuery `<tr>`; `options` is `{ editable: <boolean> }`

Behaviour:

- **System cell**: `formatSystemValue` returns the formatted `system_value`, or the literal text
  `"No system data"` when it is `null`/`undefined`. These must look visibly different — `null` means
  the database holds no figure, which is not the same as a real zero, and today every metric is
  `null`. It must never return `"null"`, `"NaN"`, `"Infinity"` or `"0"` for a null input.
- **Number formatting must be locale-independent** so the Node check below is deterministic: use a
  local helper (`Number(v).toFixed(2)` then group the integer part with
  `.replace(/\B(?=(\d{3})+(?!\d))/g, ',')`). **Do not use `toLocaleString`, `Intl.NumberFormat`, or
  `toISOString`.**
- **Entered cell**: `<input type="number" step="any">` seeded from
  `entered_value ?? system_value`, rendered `disabled` when `options.editable` is false.
  `buildMetricRow` must, on that input:
  - set `data-metric-key` to the metric's `metric_key` via `.attr()`;
  - record the seeded value with `$input.data('lastValue', String(seed == null ? '' : seed))`.
    **The key is exactly `'lastValue'`** — deliverable 2's blur handler reads and updates it.
- **Achieved %**: `formatAchievedPct` returns `effective_value / target_value` as a percentage
  string, or the literal `"—"` when `target_value` is `null`, `0`, non-finite, or `effective_value`
  is `null`/non-finite. **Guard the divide** — targets are frequently unset until the targets screen
  exists, so this path is the common one, not the edge case. The result must never render as `NaN`,
  `Infinity` or the string `"null"`.
- **Status cell**: when `is_overridden`, an "Overridden" pill built as
  `MacStatus.pill('warning', 'Overridden')` (static label; `'warning'` is already a tone name, see
  `mac-status.js:44-48`), plus a sibling element whose `override_reason` and `overridden_by_name`
  are set with `.text()`. Otherwise the cell is empty.

### 2. The override flow (in `report_editor.js`)

On blur of the Entered input, prompt for a reason before saving anything — but only when the value
actually changed, and never twice at once:

- **Trigger on change from the last rendered/saved value, not from `system_value`.** `system_value`
  is `null` for every metric today (the stub), so "differs from `system_value`" fires on every blur
  including a tab-through with no edit, which would rewrite `override_reason`/`overridden_at` for
  unchanged figures. Compare `String($input.val()).trim()` against `$input.data('lastValue')` (set by
  `buildMetricRow`, deliverable 1) and return immediately when they are equal.
- **In-flight guard.** Keep a module-level `var pendingOverrides = new Map();` keyed by
  `metric_key`. Return immediately if the key is already present; add before opening the dialog and
  remove in a `finally`. A `Swal` opened from a `blur` handler returns focus to the same input, so
  without this guard the prompt can loop. Reject `__proto__`/`constructor` keys before use (a `Map`
  is used precisely so a payload string is never a property name).
- **Validate before calling.** Parse with `Number()`, require `Number.isFinite`, and require a
  non-empty trimmed reason. The wrapper *throws* on a non-finite value or blank reason
  (`data-functions.js:5980-5981`); client-side validation must make that path unreachable so a
  thrown wrapper error never has to be shown to Pete.

```js
var result = await Swal.fire({
    input: 'text',
    inputLabel: 'Reason for overriding this figure',
    inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
    showCancelButton: true
});
if (!result.isConfirmed) { $input.val($input.data('lastValue')); return; }   // revert, save nothing
await dataFunctions.overrideReportMetricValue(reportId, metricKey, value, result.value);
```

`Swal.fire` resolves to an object: `result.value` is the entered text, `result.isConfirmed` the
button state. Cancelling must restore the input's previous value (`$input.data('lastValue')`) and
call nothing. On a `success = 1` response, update `$input.data('lastValue', String(value))` so the
next blur is a no-op.

**Clearing the input entirely calls `clearReportMetricOverride(reportId, metricKey)`, not
`overrideReportMetricValue` with a null value** — the override RPC rejects a null value by design,
returning "A value is required. Use clear_report_metric_override to revert."
(`20260817100000:556`).

The server enforces the same rule twice over: a whitespace `p_reason` returns `success = 0` with
"A reason is required when overriding a figure." (`:560`), and the
`report_metric_override_needs_reason` CHECK constraint rejects it at the table (`:237`). The prompt
is UX, not the control.

Every one of these RPCs returns `success = 0` with a human-readable `error` rather than throwing —
show it via `Swal.fire({icon:'error', text: <error>})` and do not invent your own message when the
server supplied one. Read the row with a local `firstRpcRow()` helper (the RPCs return a single-row
table; see the same idiom at `report_list_grid.js:50-52`, which is private to that file).

### 3. The editor screen

`html/report_editor.html` and `js/report_editor.js`. `report_editor.js` is an IIFE assigned to
`var _reportEditor` exposing `init` and `destroy`, plus a global `initializeReportEditor()` — the
names FIXED constraints 1, 4 and 10 use. Model the file's shape and header comment on
`report_list_grid.js`, respecting constraints 8, 9 and 10.

Header: the normalised `period_label`, with the raw `period_start`–`period_end` dates beneath it.
**The title is always derived from the payload, never a typed field** — Pete's workbook contained a
sheet titled "November" whose own start and end dates read 1–31 October, and a derived title cannot
drift from the dates it describes.

A Bootstrap `.accordion`, one `.accordion-item` per section in `display_order`. Each header carries
the section label and a `form-check form-switch` bound to `is_enabled`. Each body holds the section's
metric table — rows built with `ReportMetricLine.buildMetricRow(metric, { editable: isEditable })`,
where `isEditable` is `status === 'draft' && typeof hasAction === 'function' && hasAction('reports.report.edit')`
— or the empty state for the two non-metric render kinds, plus a commentary `<textarea>` saving on
blur.

Above the accordion, an executive-summary `<textarea>` saving on blur. It arrives pre-filled:
`create_report_instance` copies the previous period's summary forward so Pete edits rather than
retypes.

**Two save-path subtleties, both consequences of the transport rules added in plan 01a** (see FIXED
constraint 7 for the signatures):

- Toggling a section calls `setReportSectionState(reportId, sectionKey, { is_enabled: <bool> })` —
  with no `commentary` field, so the wrapper sends `p_commentary` as `undefined`, the param is
  stripped and the server's `COALESCE(p_commentary, commentary)` leaves the text alone. Saving
  commentary calls `setReportSectionState(reportId, sectionKey, { commentary: <string> })` for the
  same reason.
- Clearing a commentary or the executive summary sends `''`, which only survives because those two
  wrappers pass `preserveEmptyParams` (`data-functions.js:6025`, `:6042`). Do not re-implement or
  reference that flag here — it belongs to the wrappers.

**Published and superseded reports are read-only.** When `status !== 'draft'`, render inputs
`disabled`, hide the section toggles, and show a banner. Choose the banner text from the payload's
`status` and `published_at` (both present — `20260817100000:733,736`); `published_at` is nullable
(`:139`) and the CHECK at `:150-151` only requires it for `status = 'published'`, so a `superseded`
row may carry a null:
- `status === 'published'` with a non-empty `published_at` → "Published <date> — figures are locked."
- `status === 'superseded'` → "Superseded — figures are locked." (append " Published <date>." only
  when `published_at` is non-empty)
- any other non-draft status, or a missing/empty `published_at` → "Figures are locked." with no date.

Derive `<date>` by string slicing the ISO timestamp at `'T'` (the idiom at
`report_list_grid.js:119-124`). **No `Date` arithmetic and no `toISOString`.**

Every edit RPC already refuses with "Only a draft report can be edited."
(`20260817100000:552,603,647,687`) — this is presentation, not the control, and must not be worked
around. **Do not build a publish or re-issue action here**; both belong to a later plan.

A "Refresh figures" action calls `refreshReportInstance(reportId)`, which is draft-only and preserves
overrides and their reasons while re-reading system values and targets (`:507-519`). Report the
returned `metrics_refreshed` count (`:488`) in the success toast, then re-read the payload with
`getReportInstance(reportId, null, true)`.

New CSS goes into the existing `WebPortal/modules/sales-reports/css/sales_reports.css` (already
listed on the list route). It must use `--mac-*` tokens only: `ui:verify` bans any raw hex other than
white/black in CSS (`scripts/verify-ui-standard.mjs:72-79`), bans `linear-gradient`, bans bare
`td`/`th` padding in module CSS, and bans `min-width` on `.badge`.

### 4. Enable navigation from the list, and split its misleading message

`WebPortal/modules/sales-reports/js/report_list_grid.js` currently funnels both failure modes into
one dialog (`openReportEditor`, `:86-90`):

```js
if (!canOpenReportEditor() || !reportEditorRouteExists()) {
    Swal.fire({ icon: 'info', title: 'Report editing not enabled',
        text: 'Report editing has not been enabled for your role yet. An administrator must apply the report-builder permissions migration, then sign out and back in.' });
```

Those are two unrelated causes and the text only describes one. A super_user hitting the
route-missing branch is told to apply a permissions migration that would change nothing for them
(`role-menu-config.js:609` returns `true` for that role) — this has already caused a real
misdiagnosis. **Split them**, keeping the same fail-closed order:

- `!reportEditorRouteExists()` → title "Report editor not available", text "The report editor has
  not been deployed to this environment yet." No mention of roles or migrations.
- `!canOpenReportEditor()` → keep the existing permissions wording.

Registering the route in deliverable 1 makes the first branch unreachable in a correctly deployed
environment, but keep the branch and its distinct message: it is the honest thing to show if the
route registration is ever rolled back or the module is loaded from a stale cache. The module
already sets this precedent — its invalid-uuid path carries its own message with a comment saying it
"must not be reported as" a permissions state (`:92-96`).

Then confirm both call sites route through `openReportEditor`: the row "Open" action
(`:412-415`) and the post-create path (`:322`). Both already do — verify, do not rewire.
**Change no more of `report_list_grid.js` than the message split.**

### 5. Missing RPCs must not white-screen the module

If a report RPC is absent from the target database, `callFunction` throws. Wrap every call in
`try/catch` and log with `console.warn`. Distinguish the two failure sites:

- **Initial load (`getReportInstance`) fails, or returns `null` (unknown id):** render
  `macEmptyState('fa-file-invoice', 'This report cannot be loaded', 'The report-builder migrations have not been applied to this database.')`
  (for a `null` payload, a wording about the report not being found) instead of leaving a spinner
  running, and offer a route back to `sales-forecasting-grid`.
- **A save/refresh fails after the screen has loaded:** show
  `Swal.fire({ icon: 'error', … })` and revert the affected input to its `lastValue`. **Do not
  replace the loaded screen with an empty state on a failed write** — that would discard figures Pete
  has already typed into other rows.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`
   (`package.json:27`). Two likely failures: `ui:verify` (rules listed in deliverable 3) and
   `registry:verify`, which exits 1 if the new route entry names a file that does not exist
   (`scripts/verify-registry-paths.mjs:113-115,184-186`).
2. `grep -n "sales-report-editor" WebPortal/js/appRouter.js` returns a match — the hardcoded
   `moduleInitializers` entry is the step most often missed.
   `grep -n "js/report-metric-line.js" WebPortal/js/appRouteConfig.json` shows it listed before
   `js/report_editor.js`.
3. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
4. **Classic-script syntax check** (nothing in `test:fleet` checks JS syntax, and `appRouter.js` is
   the file whose corruption breaks the whole portal):

   ```
   node -e "const vm=require('vm'),fs=require('fs');['WebPortal/js/appRouter.js','WebPortal/modules/sales-reports/js/report-metric-line.js','WebPortal/modules/sales-reports/js/report_editor.js'].forEach(function(f){new vm.Script(fs.readFileSync(f,'utf8'),{filename:f});});console.log('classic-script syntax OK');"
   ```

   `vm.Script` parses with the same **classic-script** goal the browser uses for these files. Do not
   substitute `node --check`: the root `package.json:4` declares `"type": "module"` and there is no
   `package.json` under `WebPortal/`, so a path-based check can be parsed under the wrong goal.
5. **A pure `node` unit check of the metric-row helpers, with no browser, no network and no change to
   the shipped file's module format.** Use the harness this repo already uses for exactly this
   problem — read the file's text and evaluate it (`scripts/verify-routing-guarantee.cjs:27-32` and
   `:61-65` do this with `new Function`). Write a throwaway `scripts/tmp-verify-report-metric-line.cjs`:

   ```js
   const assert = require('assert'), fs = require('fs'), vm = require('vm');
   const p = 'WebPortal/modules/sales-reports/js/report-metric-line.js';
   const stub = {};
   new vm.Script(fs.readFileSync(p, 'utf8'), { filename: p })
       .runInNewContext({ window: stub, globalThis: stub });
   const M = stub.ReportMetricLine;
   assert.strictEqual(typeof M.formatSystemValue, 'function');
   assert.strictEqual(typeof M.formatAchievedPct, 'function');
   assert.strictEqual(typeof M.buildMetricRow, 'function');
   ```

   Run it with `node scripts/tmp-verify-report-metric-line.cjs`. This works only if
   `report-metric-line.js` obeys FIXED constraint 6 (namespace assignment, no DOM/jQuery at
   evaluation time). **If it fails, fix the module to satisfy constraint 6 — never by adding
   `export`/`module.exports`, and never by adding a `package.json` under `WebPortal/`.** Assert each
   case:
   - `system_value: null` → `formatSystemValue` is the text "No system data", never `"null"` or `"0"`
   - `target_value: null` → `formatAchievedPct` is `"—"`
   - `target_value: 0` → `formatAchievedPct` is `"—"`, not `Infinity`
   - `effective_value: null, target_value: 25000` → `formatAchievedPct` is `"—"`, not `NaN`
   - `effective_value: 100758, target_value: 25000` → a finite percentage string
   Assert no output contains `NaN`, `Infinity` or `"null"`. **Delete the scratch script before
   finishing** and confirm with `git status --porcelain scripts/`.
6. `grep -rn "export \|export{\|module.exports\|^import \|require(" WebPortal/` returns no hit inside
   `WebPortal/modules/sales-reports/` or `WebPortal/js/appRouter.js` that this run introduced.
7. `grep -rn "\.html(" WebPortal/modules/sales-reports/js/` — review every hit and confirm none
   passes database or user text; reasons, commentary and labels must go through `.text()`. The only
   acceptable hits are self-escaping shared helpers with static labels (`MacStatus.pill`,
   `macEmptyState`, `macLoadingRow`, `macEmptyRow`).
8. `grep -rn "preserveEmptyParams" WebPortal/modules/` returns nothing — the flag belongs to the
   wrappers in `data-functions.js`, not to this module.
9. `grep -rn "toISOString\|toLocaleString\|Intl.NumberFormat" WebPortal/modules/sales-reports/js/`
   returns nothing.
10. `grep -rn "isQueuedOffline" WebPortal/modules/sales-reports/js/report_editor.js` returns
    nothing (FIXED constraint 8).
11. `git status --porcelain "Playwright Tests/"` is empty — no spec file was added or edited. (Use
    this rather than a diff against `origin/dev`, which may not be fetched in the job's checkout.)

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job. Adding new
Playwright specs is acceptable as a deliverable — write them to `test.skip` without their env
credentials, like the existing specs — but running them is not a completion gate. (This plan's
out-of-scope list forbids editing existing specs either way.)

## Out of scope

PDF generation, publish and re-issue, the targets admin screen, the sales Excel import, the metric
resolvers, chart rendering, rendering `line_table` or `tracking_table` content, the RBAC migration,
applying any migration, changing any file's module format or adding a `package.json` under
`WebPortal/`, and editing any Playwright spec, `WebPortal/help/*`, `docs/**`, or
`permission-module-map.js`.
