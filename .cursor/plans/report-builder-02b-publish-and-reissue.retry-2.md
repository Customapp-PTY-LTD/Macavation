---
retry_of: f1cd2653-df46-4fb3-b64a-8c0337db6ebe
---

# Report builder — publish and re-issue

## Context

A report Pete sends to directors must stop changing. This plan adds the publish action that freezes
one, and the re-issue action that corrects a published one by opening a new version.

**Dependency removed 2026-08-18.** This plan previously waited on `report-builder-02a-pdf-export.md`,
which never merged — that PDF work landed instead as `report-pdf-01-doc-definition-builder.md`
(commit `b5ba848`), so the dependency could never be satisfied and this plan sat Blocked from
2026-08-13. Both of its stated reasons are now already true on `dev`: the editor toolbar exists and
already carries a Download PDF button (`WebPortal/modules/sales-reports/html/report_editor.html:11-19`),
and `report-pdf-builder.js` is loaded on the `sales-report-editor` route (`appRouteConfig.json:657`).
Nothing is left to wait for.

**Why freezing matters here.** Job-card approval rewrites `kernel.packing_data` after the fact in
this business, so a report that recomputed whenever it was opened would silently stop matching the
PDF directors already hold. `publish_report_instance` hashes the payload into `content_sha256`, and
the `report_instance_child_lock` trigger then rejects every write to that report's rows — including a
direct `UPDATE` that bypasses the RPCs. This is already built in
`migrations/20260817100000_report_instances_and_targets.sql`. **The UI presents it; it must not try
to work around it.**

**Whether that migration has been applied to any database cannot be verified from this checkout — do
not state or assume that it has.** Background on the feature is in
`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`; **do not copy that document's counts or
percentages into code comments, UI copy or commit messages.**

## Two new wrappers — this plan adds them

`report-builder-01a-data-functions-transport.md` added eleven report wrappers. It did **not** add
these two, so this plan adds them to `WebPortal/js/data-functions.js`, following the same rules that
plan established:

| Wrapper | RPC | Params (defaults as declared) | Returns |
|---|---|---|---|
| `publishReportInstance` | `publish_report_instance` | `p_report_instance_id` (**no default**), `p_actor_user_id`, `p_pdf_storage_bucket`, `p_pdf_storage_path`, `p_pdf_sha256` (all DEFAULT NULL) | `success (int), error (text), content_sha256 (text)` |
| `supersedeReportInstance` | `supersede_report_instance` | `p_report_instance_id`, `p_reason` (**no defaults**), `p_actor_user_id` (DEFAULT NULL) | `success (int), error (text), new_report_instance_id (uuid)` |

Both signatures verified at `migrations/20260817100000_report_instances_and_targets.sql:804-846`
and `:852-921`.

### Wrapper signatures — the actor id is supplied INSIDE the wrapper, never by the caller

This is the family's shape, not a choice: `createReportInstance` (`data-functions.js:5968-5984`) and
`overrideReportMetricValue` (`:5999-6018`) both set `p_actor_user_id: this.getCurrentUserId() || undefined`
themselves, and every report wrapper takes `token` as its **last positional argument**
(`:5986`, `:6084`). Write the two new wrappers with exactly these signatures:

```js
publishReportInstance: async function (reportInstanceId, token = null) { ... }
supersedeReportInstance: async function (reportInstanceId, reason, token = null) { ... }
```

and build their params as:

```js
// publishReportInstance
const params = {
    p_report_instance_id: id,
    p_actor_user_id: this.getCurrentUserId() || undefined
    // The three PDF params are omitted entirely (storage arrives in a later plan). They all have
    // DEFAULT NULL, so omitting them is correct and the single overload still resolves.
};

// supersedeReportInstance
const params = {
    p_report_instance_id: id,
    p_reason: reasonText,               // no DEFAULT — must always be present and non-empty
    p_actor_user_id: this.getCurrentUserId() || undefined
};
```

- **The UI must never pass a user id.** `userId` does not exist in `report_editor.js`, and a user id
  passed positionally would land in the `token` slot, where `callSupabaseRpc` discards it as a
  non-JWT value (`:592-594`) — publish would then succeed with `published_by` NULL and no error,
  silently losing attribution on the one row whose whole purpose is tamper-evidence. The only
  permitted call forms in the UI are `dataFunctions.publishReportInstance(state.reportId)` and
  `dataFunctions.supersedeReportInstance(state.reportId, <reason>)`.
- Validate locally first, exactly as the sibling wrappers do: trim `reportInstanceId`, and throw
  `new Error('publishReportInstance: reportInstanceId is required.')` /
  `'supersedeReportInstance: reportInstanceId is required.'` /
  `'supersedeReportInstance: reason is required.'` for empty input. Do not send an empty reason.

Rules, matching the existing report wrappers:
- Both are writes: pass `useCache: false`, and after a successful call invalidate both cache
  families via `clearCachePattern('report_instance_')` and `clearCachePattern('report_list_')`.
- **Write the `callFunction` call on ONE line, in the same form as `refreshReportInstance`
  (`data-functions.js:6078`):**
  `const result = await this.callFunction('publish_report_instance', params, token, { useCache: false });`
  This matters for verification step 3 below.
- **Neither wrapper may pass `preserveEmptyParams`.** `undefined` values are stripped by
  `buildPostgrestRpcBody` (`:502-521`), which is what these wrappers want.
- Do not swallow a thrown error into a fake success value.
- Neither RPC name contains `create`/`update`/`delete`/`deactivate`, so neither is ever diverted
  into the offline write-queue (`:673-676`). Do not add offline-queue handling for them, and do not
  write success handling that would treat a `{ success: true, offline: true, queued: true }` object
  as an RPC row.

Both RPCs return `success = 0` with a human-readable `error` rather than throwing. Show it via
`Swal.fire({icon:'error', text: <error>})` and do not invent your own message when the server
supplied one.

## Naming discipline inside the click handlers — MANDATORY, this is what blocked the previous attempt

Each handler holds **two different objects**: the SweetAlert dialog result and the RPC result. They
must have **different identifiers**, and no RPC-reading helper may ever be handed a dialog object.

| Deliverable | SweetAlert dialog binding | RPC result binding |
|---|---|---|
| 1 — Publish | `confirmed` | `rpcResult` |
| 2 — Re-issue | `reasonPrompt` | `rpcResult` |

- `isRpcSuccess()`, `rpcError()` and `firstRpcRow()` (`report_editor.js:47-74`) may be called **only**
  on `rpcResult`. Never on `confirmed` or `reasonPrompt`.
- Why this is not cosmetic: `firstRpcRow` returns any non-array object **verbatim**
  (`report_editor.js:47-49`). Hand it a SweetAlert object and it returns that object, every RPC field
  reads `undefined`, no error is thrown, and a *successful* re-issue would report failure to the user
  **after** the director-facing report has already been superseded and a new version opened. Nothing
  in the verification steps below runs a browser, so only this naming rule prevents it.
- The module already uses exactly this separation: `report_editor.js:802` binds the dialog as
  `result` and `:808` binds the RPC as `rpcResult`. Follow that precedent; do not reuse one name for
  both.

## Security invariants

- Never pass database or user-entered text — including `error` strings, the supersede reason and
  `content_sha256` — through `.html()`, `innerHTML` or string concatenation into markup. Use
  `.text()`.
- Validate the report uuid, and the returned `new_report_instance_id`, with the module's existing
  `isReportUuid()` (`report_editor.js:22`, `:43-45`) before using either in a further call or
  storing it in `Session`.
- Never use a payload value as an object property key without rejecting `__proto__` and
  `constructor` — reuse the module's existing `safeKey()` (`report_editor.js:52-56`).
- **Permission-gated controls are hidden and shown with the `d-none` class ONLY.**
  `actionAccess.apply()` hides a denied `data-action-perm` element by setting the inline style
  `el.style.display = 'none'` (`WebPortal/js/action-access.js:86`), and the sweep runs once per
  route load (`appRouter.js:251-257`). A later jQuery `.show()`, `.css('display', ...)` or
  `element.style.display = ''` on the Publish or Re-issue button CLEARS that gate and re-exposes an
  irreversible action to a role denied `reports.report.publish`. Removing a class can never clear an
  inline style, so `addClass('d-none')` / `removeClass('d-none')` is safe — and it is already this
  module's own idiom (`report_editor.js:100-118`, `report_editor.html:23`, `:25`). Bootstrap 5.3 is
  loaded portal-wide (`WebPortal/index.html:20`), so `.d-none { display: none !important }` exists.
- **`publish_report_instance` performs no permission check of its own** and is granted to
  `anon, authenticated, service_role` (`migrations/20260817100000_report_instances_and_targets.sql:1272-1273`),
  so the DOM gate is the only gate. Defence in depth: both click handlers must re-check the key and
  fail closed before calling anything:

```js
if (typeof hasAction !== 'function' || !hasAction('reports.report.publish')) {
    Swal.fire({ icon: 'warning', title: 'Not permitted', text: 'You do not have permission for this action.' });
    return;
}
```

- **Button grammar:** `ui:verify` fails the build on `btn-success` anywhere under `WebPortal/`
  (`scripts/verify-ui-standard.mjs:133-135`). Publish is `btn-primary`; Re-issue is
  `btn-outline-secondary`. Icons are Font Awesome (`fas`) only — `bi bi-*` is banned by the same
  script (`:127-132`).

## Event wiring — both new handlers

Add both click handlers inside the existing `bindEvents()` (`report_editor.js:997-1048`), as
**delegated, namespaced** bindings in the file's own idiom:

```js
$(document).on('click.reportEditor', '#reportEditorPublishBtn', function () { handlePublish(); });
$(document).on('click.reportEditor', '#reportEditorReissueBtn', function () { handleReissue(); });
```

`destroy()` tears bindings down with `$(document).off('.reportEditor')` (`report_editor.js:1066`), so
an un-namespaced or directly-bound handler would survive a route change and fire against a different
module's DOM. Do not bind anywhere else and do not change `init()`/`destroy()`.

## Deliverable 1 — Publish

Add to the existing toolbar in `WebPortal/modules/sales-reports/html/report_editor.html` (the
`.btn-toolbar` at line 11), as **static markup** so the router's one-shot sweep covers it:

```html
<button type="button" class="btn btn-primary d-none" id="reportEditorPublishBtn"
        data-action-perm="reports.report.publish">
    <i class="fas fa-lock me-1"></i>Publish
</button>
```

It starts with `d-none` so it is invisible until a payload says otherwise. The key
`reports.report.publish` is already seeded by
`migrations/20260817110000_report_builder_rbac.sql:87` (that migration's comment at `:75` saying no
`data-action-perm` references it yet is what this plan changes; do not edit the migration).

Status-driven visibility lives in one helper, called from `renderPayload()`:

```js
// Class toggling only — see the security invariant above. Never .show()/.hide()/.css('display').
function updatePublishControls(payload) {
    var status = payload && payload.status;
    $('#reportEditorPublishBtn').toggleClass('d-none', status !== 'draft');
    $('#reportEditorReissueBtn').toggleClass('d-none', status !== 'published');
}
```

Call `updatePublishControls(payload)` from `renderPayload()` (`report_editor.js:670-707`), alongside
the existing `renderLockedBanner(payload)` call. Deliverable 2 reuses this helper under exactly this
name — do not rename it there.

Confirm before publishing (dialog binding is `confirmed`, per the naming table above):

```js
var confirmed = await Swal.fire({
    icon: 'question',
    title: 'Publish this report?',
    text: 'Figures will be locked. Corrections after this create a new version.',
    showCancelButton: true
});
if (!confirmed.isConfirmed) return;
```

Then call `dataFunctions.publishReportInstance(state.reportId)` — no user id argument — and bind its
result as `rpcResult`:

```js
var rpcResult = await dataFunctions.publishReportInstance(state.reportId);
if (!isRpcSuccess(rpcResult)) {
    Swal.fire({ icon: 'error', title: 'Could not publish', text: rpcError(rpcResult, 'Could not publish this report.') });
    return;
}
await reloadAfterLockChange();
```

Use the module's existing `isRpcSuccess()` / `rpcError()` / `firstRpcRow()` helpers
(`report_editor.js:47-74`) to read `rpcResult` — never `confirmed`. Wrap the call so a thrown error
is caught and reported (`console.warn` plus a `Swal.fire({icon:'error', ...})`), matching
`handleRefreshFigures` (`report_editor.js:901-920`).

**On `success = 1`, do NOT reuse `reloadAndRerender()`.** That helper's catch deliberately logs and
leaves the DOM untouched (`report_editor.js:740-754`), which is correct after a metric save but
wrong here: the report is now locked server-side, and leaving the previous editable draft on screen
invites edits that every edit RPC and the `report_instance_child_lock` trigger will refuse. Add a
dedicated helper and use it for both deliverables:

```js
// Used after publish and after re-issue, where the on-screen report's editability has changed.
// A failed reload must not leave a stale, wrongly-editable screen behind.
function reloadAfterLockChange() {
    if (!state.reportId) return Promise.resolve();
    return dataFunctions.getReportInstance(state.reportId, null, true).then(function (fresh) {
        if (!fresh) {
            showEmptyState('fa-file-invoice', 'Report not found', 'This report could not be found. It may have been deleted.');
            return;
        }
        state.payload = fresh;
        renderPayload(fresh);
    }).catch(function (err) {
        console.warn('[sales-reports] could not reload report after publish/re-issue', err);
        Swal.fire({
            icon: 'warning',
            title: 'Saved, but not reloaded',
            text: 'The change was saved but this screen could not be refreshed. Reopen the report from the list.'
        });
        routeBackToList();
    });
}
```

`showEmptyState` (`:106-113`), `renderPayload` (`:670`) and `routeBackToList` (`:89-93`) already
exist in this file; reuse them under those exact names. `getReportInstance(id, token, forceRefresh)`
is the real signature (`data-functions.js:5986`), so `(state.reportId, null, true)` is correct.

**This helper is used at two call sites and must behave identically at both** — after publish (same
report id, now locked) and after re-issue (a *different* report id, a fresh draft). Its
route-back-on-failure behaviour is correct at both, because in both cases what is on screen no
longer matches the server. It reads `state.reportId` at call time, which is why Deliverable 2
assigns `state.reportId` **before** calling it. Do not add a parameter, do not soften the catch to
`reloadAndRerender()`'s log-only behaviour, and do not call `reloadAndRerender()` from either new
handler.

**Banner.** Extend the existing `renderLockedBanner(payload)` (`report_editor.js:124-143`) — do not
add a second banner element or a second read-only path. It already prints the published date for
`published`/`superseded`; add the version and the fingerprint to the same `.text()` write:

- Append ` Version <n>.` when `Number(payload.version)` is a finite number greater than 0.
- Append ` Content fingerprint <first 12 chars>.` **only when** `payload.content_sha256` is a
  non-empty string — `content_sha256` is NULL on any report that was never published through
  `publish_report_instance` (`get_report_instance` returns the column verbatim, migration `:739`;
  `version` at `:732`), and slicing a null must never reach the DOM as `"null"`.
- The whole banner text continues to reach the DOM through `$banner.text(...)`. Never `.html()`.

**Read-only rendering already exists** in `renderPayload` (`report_editor.js:670-707`) and applies
whenever `status !== 'draft'`: the executive summary is disabled (`:685`), Refresh figures is
disabled (`:687`), metric inputs are built non-editable (`:637`, `:674`) and section toggles are not
rendered at all (`:618`). Reuse that path; do not add a second one and do not change its semantics.

## Deliverable 2 — Re-issue

Add to the same toolbar, also static markup, also starting hidden:

```html
<button type="button" class="btn btn-outline-secondary d-none" id="reportEditorReissueBtn"
        data-action-perm="reports.report.publish">
    <i class="fas fa-rotate-left me-1"></i>Re-issue
</button>
```

Its visibility is driven by the same `updatePublishControls(payload)` helper defined in
Deliverable 1 (shown only when `status === 'published'`), and its click handler starts with the same
fail-closed `hasAction('reports.report.publish')` check.

Prompt for a mandatory reason using the same shape as the override prompt in
`report_editor.js:797-802`. **The dialog binding is `reasonPrompt`** — never `result`, never
`rpcResult`:

```js
var reasonPrompt = await Swal.fire({
    input: 'text',
    inputLabel: 'Why is this report being re-issued?',
    inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
    showCancelButton: true
});
if (!reasonPrompt.isConfirmed) return;
```

`reasonPrompt.value` is the entered text and `reasonPrompt.isConfirmed` the button state. Then call
the RPC and bind its result as `rpcResult`:

```js
var rpcResult = await dataFunctions.supersedeReportInstance(state.reportId, reasonPrompt.value);
```

— no user id argument, and `reasonPrompt` is never passed to `firstRpcRow`/`isRpcSuccess`/`rpcError`.

On `!isRpcSuccess(rpcResult)`, show
`Swal.fire({ icon: 'error', title: 'Could not re-issue', text: rpcError(rpcResult, 'Could not re-issue this report.') })`
and return. Wrap the call so a thrown error is caught, logged with `console.warn` and reported.

On `isRpcSuccess(rpcResult)`:
1. `var newId = (firstRpcRow(rpcResult) || {}).new_report_instance_id;` — read it from **`rpcResult`**,
   then reject it with `isReportUuid(newId)` if it is not a uuid. On rejection, show an error
   (`Swal.fire({ icon: 'error', title: 'Re-issued, but could not open the new version', text: 'The new version was created. Reopen it from the report list.' })`)
   and `routeBackToList()`; do not store it.
2. `if (typeof Session !== 'undefined' && Session.set) Session.set('currentReportId', newId);` **and**
   `state.reportId = newId;`, in that order, before reloading — `reloadAfterLockChange()` reads
   `state.reportId`. The `typeof Session` guard is the module's own idiom
   (`report_editor.js:82`, `report_list_grid.js:105`); do not call `Session.set` unguarded.
3. Call `reloadAfterLockChange()` (the helper from Deliverable 1, same name, no arguments).

**Present it as a continuation, not a blank report** — the RPC copies sections, figures, overrides
and their reasons across (`migrations/20260817100000_report_instances_and_targets.sql:897-917`), so
the new version opens as a faithful copy of what was issued.

The RPC refuses anything not currently published, returning `"Only a published report can be
superseded."` (`:873`) — show that server message via `rpcError(rpcResult, ...)`; do not substitute
your own wording.

## Deliverable 3 — the list screen

In `WebPortal/modules/sales-reports/js/report_list_grid.js`, show `version` beside the period label
when it is greater than 1 (e.g. "Week of 10 Aug 2026 · v2"). Build it in `buildRow` on the existing
period-label cell (`report_list_grid.js:145`) with `.text()` only — no `.html()`, no string
concatenation into markup. `listReportInstances` already returns `version`
(`migrations/20260817100000_report_instances_and_targets.sql:974`); no RPC change is needed.

**Do not add a column.** The table's empty, loading and error rows hard-code seven columns —
`macEmptyRow(7, …)` (`:159`), `macLoadingRow(7, …)` (`:198`) and `colspan="7"` (`:217`) — so an
eighth `<td>` would silently mis-span all three states. The version text goes inside the existing
period-label `<td>` only.

**The superseded pill is already done — add nothing for it.** `buildRow` already renders
`MacStatus.pill(row.status)` (`report_list_grid.js:148`), and `MacStatus.tone()` falls through to
`'neutral'` for any key not in its map, `superseded` included (`WebPortal/js/mac-status.js:44-48`),
so a superseded row already renders as a muted pill today. **Do not add a `superseded` entry to
`mac-status.js` and do not edit that file at all** — it is the portal-wide status language and this
plan has no reason to touch it.

**Do not hide superseded rows** — they are the record of what directors received. Nothing in
`renderRows`/`load` filters by status today (`:155-166`, `:196-209`); keep it that way.

Change no more of `report_list_grid.js` than the version label.

## What this plan must not do

- **Do not add an "unpublish" or "edit published" path.** Every edit RPC refuses a non-draft report,
  and the database trigger refuses a direct write, so any such path would fail at the server anyway.
  Re-issue is the only correction route.
- **Do not delete or hide a published or superseded report.** `delete_report_instance` refuses
  anything that is not a draft.
- **Do not reformat, renumber or otherwise edit any existing wrapper in `data-functions.js`**, and do
  not add `preserveEmptyParams` to any wrapper that does not already have it, for any reason —
  including making a grep count come out to an expected number.
- **Do not edit `package.json`** — in particular not the `test:fleet` script or its `"//test:fleet"`
  documentation comment. The gate is the check on this work, not part of it.
- **Do not edit `WebPortal/js/mac-status.js`, `WebPortal/js/action-access.js`, `appRouter.js` or any
  migration.**

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. In this checkout it is **`package.json:28`**:
   `npm run routing:verify && npm run username:verify && node scripts/verify-phase2-migrations.mjs && npm run ui:verify && npm run migrations:verify && npm run registry:verify && npm run reports:verify`.
   Line 27 is the `"//test:fleet"` documentation comment, not a command. The final
   `reports:verify` (`scripts/verify-report-rendering.mjs`) is a hermetic suite that reads only
   `report-pdf-builder.js` (`:42`, `:46`) — a file this plan does not touch, so it must keep passing
   with no change. Run the whole script as written; do not run a subset and do not edit it.
2. Both wrapper names exist:
   `grep -c "publishReportInstance" WebPortal/js/data-functions.js` and
   `grep -c "supersedeReportInstance" WebPortal/js/data-functions.js` each return at least `1`.
   `grep -n "preserveEmptyParams" WebPortal/js/data-functions.js` shows hits at the transport
   plumbing and its comment (`614`, `749`, `763`) plus the two wrapper-level uses inside
   `setReportSectionState` and `setReportExecutiveSummary` (`6041` comment, `6050`, `6067`) — six
   hits and **nothing else**. The transport hits are shared code and must not be touched; the two
   new wrappers must not add a hit.
3. `grep -n "useCache: false" WebPortal/js/data-functions.js | grep -ci report` returns **8**.
   Arithmetic, re-checked against this tree: it returns **6** today —
   `get_scheduled_reports` (`:1957`, unrelated to this feature but it does contain "report"),
   `create_report_instance` (`:5980`), `override_report_metric_value` (`:6014`),
   `clear_report_metric_override` (`:6026`), `refresh_report_instance` (`:6078`),
   `delete_report_instance` (`:6090`). Two of the 01a writes never match because they put
   `useCache: false,` on its own line with no "report" text on it (`:6049`, `:6066`). Writing the two
   new `callFunction` calls on one line each, as instructed above, takes the count to 8.
   **If this number comes out differently, the fault is in the new code only — fix the two new
   wrappers. Never reformat an existing wrapper and never add a line to make this number move.**
4. `grep -rn "\.html(" WebPortal/modules/sales-reports/js/` returns exactly the pre-existing hits
   below and **no new one**:
   `report_editor.js:9` (comment), `report_editor.js:112` (`macEmptyState`, static arguments);
   `report_list_grid.js:146` and `:148` (`MacStatus.pill`, which escapes its own arguments —
   `mac-status.js:50-64`), `:159` (`macEmptyRow`, static), `:189` (pagination, numeric page values
   only), `:198` (`macLoadingRow`, static), `:217` (`macEmptyState`, static);
   `report-metric-line.js:9` (comment).
   **Do not "fix" any of these.** `:146`/`:148` do pass database values into `.html()` and are safe
   because `MacStatus.pill` self-escapes; editing them is out of scope and forbidden above. The
   check that matters is that no line this plan adds — `error` strings, the supersede reason,
   `version`, `content_sha256` — introduces a new `.html(` hit.
5. `grep -rn "unpublish\|forcePublish\|editPublished" WebPortal/modules/sales-reports/` returns
   nothing.
6. `grep -rn "\.show()\|\.hide()\|css('display'\|style\.display" WebPortal/modules/sales-reports/js/report_editor.js`
   returns nothing — visibility is `d-none` class toggling only. Keep this grep scoped to
   `report_editor.js`: `report_list_grid.js:289`/`:297` legitimately call Bootstrap's
   `Modal.show()`/`hide()`, which are unrelated to permission gating and must not be changed.
7. `grep -n "publishReportInstance\|supersedeReportInstance" WebPortal/modules/sales-reports/js/report_editor.js`
   shows exactly two call sites, and neither passes a user id:
   - `var rpcResult = await dataFunctions.publishReportInstance(state.reportId);`
   - `var rpcResult = await dataFunctions.supersedeReportInstance(state.reportId, reasonPrompt.value);`

   Then confirm the naming discipline, which nothing else here can catch:
   - `grep -n "confirmed\|reasonPrompt" WebPortal/modules/sales-reports/js/report_editor.js` — every
     hit is either the `Swal.fire` binding, an `.isConfirmed` read, or `reasonPrompt.value` passed as
     the reason argument. **No hit passes `confirmed` or `reasonPrompt` to `firstRpcRow(`,
     `isRpcSuccess(` or `rpcError(`.**
   - `grep -n "firstRpcRow(\|isRpcSuccess(\|rpcError(" WebPortal/modules/sales-reports/js/report_editor.js`
     — inside the two new handlers, every argument is `rpcResult`.
8. `grep -rn "btn-success\|bi bi-" WebPortal/modules/sales-reports/` returns nothing (`ui:verify`
   fails the build on either).
9. `git diff --name-only origin/dev -- WebPortal/js/mac-status.js WebPortal/js/action-access.js WebPortal/js/appRouter.js migrations/ package.json`
   is empty.
10. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
    exits 0.
11. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty — no spec file was edited.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job.

## Out of scope

Uploading the PDF to storage, WhatsApp delivery, the targets admin screen, the sales Excel import,
the metric resolvers, chart rendering, any migration, and editing any Playwright spec,
`WebPortal/help/*`, `docs/**`, `permission-module-map.js`, `package.json`,
`WebPortal/js/mac-status.js`, `WebPortal/js/action-access.js` or `WebPortal/js/appRouter.js`.
