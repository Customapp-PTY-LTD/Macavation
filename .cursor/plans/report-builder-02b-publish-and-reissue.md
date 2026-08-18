# Report builder — publish and re-issue

## Context

A report Pete sends to directors must stop changing. This plan adds the publish action that freezes
one, and the re-issue action that corrects a published one by opening a new version.

**Dependency removed 2026-08-18.** This plan previously waited on `report-builder-02a-pdf-export.md`,
which never merged — that PDF work landed instead as `report-pdf-01-doc-definition-builder.md`
(commit `b5ba848`), so the dependency could never be satisfied and this plan sat Blocked from
2026-08-13. Both of its stated reasons are now already true on `dev`: the editor toolbar exists and
already carries a Download PDF button (commit `8165081`), and `report-pdf-builder.js` is loaded on
the `sales-report-editor` route. Nothing is left to wait for.

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

Rules, matching the existing report wrappers:
- Both are writes: pass `useCache: false`, and after a successful call invalidate both cache
  families via `clearCachePattern('report_instance_')` and `clearCachePattern('report_list_')`.
- Neither needs `preserveEmptyParams`. The three PDF params on `publishReportInstance` are passed as
  `undefined` in this plan so they are stripped — they all have DEFAULTs, so a stripped param is
  correct and the overload still resolves. Storage arrives in a later plan.
- `p_reason` on `supersedeReportInstance` has no DEFAULT and must always be sent; the UI guarantees
  it is non-empty before calling.
- Do not swallow a thrown error into a fake success value.

Both RPCs return `success = 0` with a human-readable `error` rather than throwing. Show it via
`Swal.fire({icon:'error', text: <error>})` and do not invent your own message when the server
supplied one.

## Security invariants

- Never pass database or user-entered text — including `error` strings, the supersede reason and
  `content_sha256` — through `.html()`, `innerHTML` or string concatenation into markup. Use
  `.text()`.
- Validate the report uuid, and the returned `new_report_instance_id`, with
  `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before using either in a
  further call or storing it in `Session`.
- Never use a payload value as an object property key without rejecting `__proto__` and
  `constructor`.

## Deliverable 1 — Publish

A "Publish" button in the editor toolbar, shown only when `status === 'draft'`, gated with
`data-action-perm="reports.report.publish"` (static markup, so the router's one-shot sweep covers
it; the key is seeded by `report-builder-01b-rbac-migration.md`).

Confirm first:

```js
var confirmed = await Swal.fire({
    icon: 'question',
    title: 'Publish this report?',
    text: 'Figures will be locked. Corrections after this create a new version.',
    showCancelButton: true
});
if (!confirmed.isConfirmed) return;
```

Then call `publishReportInstance(reportId, userId)`, passing `undefined` for the three PDF params.
On `success = 1`, reload the report via `getReportInstance` with `forceRefresh` and re-render
read-only. On `success = 0`, show `error`.

After publishing, the editor renders read-only — inputs `disabled`, section toggles hidden — with a
banner showing the published date, the version, and the first 12 characters of `content_sha256`
labelled "content fingerprint". Render the fingerprint with `.text()`.

The read-only rendering itself already exists from `report-builder-01d-report-editor.md`, which
applies it whenever `status !== 'draft'`. Reuse that path rather than adding a second one.

## Deliverable 2 — Re-issue

On a published report, a "Re-issue" button gated with `data-action-perm="reports.report.publish"`.
Prompt for a mandatory reason using the same shape as the override prompt in 01d:

```js
var result = await Swal.fire({
    input: 'text',
    inputLabel: 'Why is this report being re-issued?',
    inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
    showCancelButton: true
});
if (!result.isConfirmed) return;
```

`result.value` is the entered text and `result.isConfirmed` the button state. Then call
`supersedeReportInstance(reportId, result.value, userId)`.

On `success = 1`: validate `new_report_instance_id`, `Session.set('currentReportId', <it>)`, and
re-render the editor on the new draft. **Present it as a continuation, not a blank report** — the
RPC copies sections, figures, overrides and their reasons across, so the new version opens as a
faithful copy of what was issued.

The RPC refuses anything not currently published, returning "Only a published report can be
superseded." — show that message.

## Deliverable 3 — the list screen

In `report_list_grid.js`, show `version` beside the period label when it is greater than 1 (e.g.
"Week of 10 Aug 2026 · v2"), and render the `superseded` status with a muted `MacStatus` pill so the
history stays legible. `listReportInstances` already returns both fields; no RPC change is needed.
**Do not hide superseded rows** — they are the record of what directors received.

Change no more of `report_list_grid.js` than that.

## What this plan must not do

- **Do not add an "unpublish" or "edit published" path.** Every edit RPC refuses a non-draft report,
  and the database trigger refuses a direct write, so any such path would fail at the server anyway.
  Re-issue is the only correction route.
- **Do not delete or hide a published or superseded report.** `delete_report_instance` refuses
  anything that is not a draft.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`.
2. Both wrapper names exist exactly once:
   `grep -c "publishReportInstance" WebPortal/js/data-functions.js` and
   `grep -c "supersedeReportInstance" WebPortal/js/data-functions.js` each return at least `1`, and
   `grep -rn "preserveEmptyParams" WebPortal/js/data-functions.js` still shows it used by only
   `setReportSectionState` and `setReportExecutiveSummary` — these two wrappers must not add it.
3. `grep -rn "useCache: false" WebPortal/js/data-functions.js | grep -ci report` returns `9` — the
   seven writes from 01a plus these two.
4. `grep -rn "\.html(" WebPortal/modules/sales-reports/js/` — review every hit and confirm none
   passes database or user text, including `error` strings and `content_sha256`.
5. `grep -rn "unpublish\|forcePublish\|editPublished" WebPortal/modules/sales-reports/` returns
   nothing.
6. `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
7. `git diff --name-only origin/dev -- "Playwright Tests/"` is empty — no spec file was edited.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job.

## Out of scope

Uploading the PDF to storage, WhatsApp delivery, the targets admin screen, the sales Excel import,
the metric resolvers, chart rendering, any migration, and editing any Playwright spec,
`WebPortal/help/*`, `docs/**`, or `permission-module-map.js`.
