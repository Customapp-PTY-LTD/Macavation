---
depends_on: report-whatsapp-03-send-dialog.md
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 4 — who got this report, and re-sending the ones that failed

## Context

After part 3, an operator can send a published report to selected numbers and see the immediate
result. What they cannot do is come back tomorrow and answer "did Pete ever get the August report?"
— the answer is in `public.report_deliveries`, and nothing renders it.

This plan adds a collapsible **Distribution** panel to the report editor listing every send attempt
for that report, and a re-send for the ones that failed.

It matters more than a nice-to-have: a WhatsApp send can fail for reasons the portal cannot
anticipate — falling outside Meta's 24-hour customer-service window being the likeliest — and part
3's result list disappears the moment the dialog closes. Without this panel, a silent partial
failure is indistinguishable from a clean send.

## Why this waits on part 3

`depends_on: report-whatsapp-03-send-dialog.md`. Two reasons, both real:

1. This plan re-uses the send path part 3 builds (`ReportWhatsappSend`) for the re-send action, and
   listens for the `reportWhatsappSend:completed` event it fires.
2. Both plans edit `WebPortal/modules/sales-reports/html/report_editor.html` and
   `WebPortal/modules/sales-reports/js/report_editor.js`. The fleet may run several plans for this
   repo concurrently, each from its own snapshot, merging at the end — two plans editing the same
   file race, and the loser gets a human-must-resolve conflict. Chaining prevents that.

## Grounding — verified against this checkout and the dev database

**`list_report_deliveries(p_report_instance_id uuid)`** exists and is applied to dev
(`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`, section 5). It returns:

```
success int, error text, id uuid, recipient_id uuid, phone text, display_name text, channel text,
status text, external_message_id text, delivery_error text, sent_by uuid, sent_by_name text,
created_at timestamptz, completed_at timestamptz, link_expires_at timestamptz
```

Two things about that shape, both deliberate and both easy to get wrong:

- The per-row failure text is **`delivery_error`**, not `error`. The leading `error` column carries
  an RPC-level fault (it is non-null only when `success = 0`). Rendering `row.error` would show
  nothing on a failed delivery.
- `status` is one of `'pending'`, `'sent'`, `'failed'` (the table's CHECK constraint). A row is
  written as `'pending'` before the send and updated after
  (`begin_report_delivery` → `complete_report_delivery`), so a row **stuck at `pending`** means the
  send loop died part-way. That is a real state, not a transient one, and the panel must show it as
  such rather than hiding it or rendering it as success. The migration's own comment says exactly
  this: "A recipient that shows 'pending' long after the fact is a visible fault; a missing row is
  not."

**`dataFunctions.listReportDeliveries(reportInstanceId, token, forceRefresh)`** is the wrapper, added
by part 1 in `WebPortal/js/data-functions.js`. It throws on a missing id and caches under
`report_deliveries_<id>`; pass `forceRefresh = true` after a send.

**`MacStatus.pill(status)`** (`WebPortal/js/mac-status.js:61`) already maps all three states:
`sent: 'info'` and `pending: 'warning'` and `failed: 'danger'` (:13-19). Use it rather than adding a
new status vocabulary.

**`macLoadingRow(colspan)`, `macEmptyRow(colspan, text)`, `macEmptyState(icon, title, hint)`**
(`WebPortal/js/ui-states.js:37-39`), all escaping their own arguments per
`report_list_grid.js:11-14`.

**The editor's accordion already exists**: `report_editor.html` renders
`<div class="accordion" id="reportEditorAccordion">`, populated by `report_editor.js`. The panel in
this plan is a **separate card below it**, not an accordion item — the accordion's items are report
sections built from the payload, and injecting a non-section item into it would put distribution
data inside the report's own structure.

**Status gating**: `report_editor.js:160-162` toggles buttons on `payload.status`. Part 3 shows the
send button only for `'published'`.

**`data-action-perm` is inert on dynamic markup** (CLAUDE.md). The re-send buttons are rendered per
row, so they must be gated by calling `hasAction('reports.report.send')` inline at render time
(`WebPortal/js/action-access.js:95`).

## Deliverables

### 1. New file `WebPortal/modules/sales-reports/js/report-whatsapp-history.js`

An IIFE assigning one global, `ReportWhatsappHistory`, with `init()`, `destroy()` and
`load(reportInstanceId, forceRefresh)`. Bindings namespaced `.reportWhatsappHistory`; `init()` calls
`destroy()` first. Follows the four conventions stated at `report_list_grid.js:1-15`.

`load()`:

- Renders `macLoadingRow(6)` into the table body, then calls
  `dataFunctions.listReportDeliveries(id, null, !!forceRefresh)`.
- On an RPC-level failure (a thrown error, or a first row with `success = 0`), renders the failure
  in the panel body itself — a muted line carrying the message — and **does not** open a `Swal`
  dialog. A history panel that cannot load is not worth interrupting the operator over, and part 1's
  wrapper deliberately throws rather than faking an empty list, so "no rows" and "could not load"
  must look different on screen.
- On success, renders one row per delivery: recipient (`display_name` falling back to `phone`),
  number, status pill, when (`completed_at` falling back to `created_at`), who sent it
  (`sent_by_name`, falling back to a muted em-dash — it is null for a delivery whose sender is no
  longer in `users`), and an actions cell.
- A `failed` row shows its `delivery_error` verbatim as a muted second line under the recipient.
  Verbatim matters: that string is the gateway's own text and is the only actionable detail about
  why it failed. Truncate to a reasonable display length with a `title` attribute carrying the full
  text — set via a property/attr call that escapes, never by building the attribute in an HTML
  string.
- A `pending` row shows a muted "never completed — the send did not finish" note, not a blank.
- Empty result → `macEmptyRow(6, 'This report has not been sent to anyone yet.')`.
- The actions cell holds a "Re-send" button **only** when `status !== 'sent'` **and**
  `hasAction('reports.report.send')` is true, evaluated inline at render time.
- A "Re-send all failed" button in the panel header, shown only when at least one row is `failed` or
  `pending` and `hasAction('reports.report.send')` is true.

**Re-send** does not invent a second send path. It calls
`ReportWhatsappSend.resend(reportInstanceId, recipients)` — see deliverable 3 — guarded with
`typeof ReportWhatsappSend !== 'undefined' && ReportWhatsappSend.resend`, in the same style as the
existing `typeof ReportPdfBuilder === 'undefined'` guard at `report_editor.js:1074`. If that guard
fails, show a plain error; do not silently do nothing.

Listens for `reportWhatsappSend:completed` (fired by part 3) on `document`, namespaced, and reloads
itself with `forceRefresh = true` when the event's report id matches the one it is showing.

### 2. `WebPortal/modules/sales-reports/html/report_editor.html`

Add a card below `#reportEditorAccordion`, inside `#reportEditorContent`:

- `id="reportWhatsappHistoryCard"`, `class="card mt-3 d-none"` — `report_editor.js` reveals it.
- A card header with the title "Distribution", a muted count placeholder, and the
  "Re-send all failed" button (`id="reportWhatsappHistoryResendFailedBtn"`, starting `d-none`).
- A `table-responsive` wrapper around a table with six `<th>`s (Recipient, Number, Status, When,
  Sent by, Actions) and an empty `<tbody id="reportWhatsappHistoryBody">`.
- No database value in this static markup.

### 3. `WebPortal/modules/sales-reports/js/report-whatsapp-send.js` — add `resend()`

Part 3 owns this file; this plan adds one exported function to it and changes nothing else in it.

`resend(reportInstanceId, recipients)` where `recipients` is
`[{ recipientId, phone, displayName }]`. It must **reuse part 3's own send routine** rather than
duplicating the PDF-build-and-post sequence: rebuild the PDF via the same injected `getPdfBase64`
the dialog was opened with, post through `dataFunctions.sendReportWhatsapp`, render the results, and
fire `reportWhatsappSend:completed`.

That reuse has a precondition worth checking rather than assuming: `getPdfBase64` is injected into
`open()`, so `resend()` called without the dialog ever having been opened has no way to build a PDF.
**Read part 3's file before writing this** and handle it explicitly — either have `report_editor.js`
supply the provider once at init (preferred, and deliverable 4 does exactly that), or have `resend()`
return a rejected promise with a clear message. Do not let it post an empty `pdfBase64`; the edge
function would reject it with a 400 and the delivery log would fill with confusing failures.

Re-sending produces **new** `report_deliveries` rows. It does not update the old ones — the failed
attempt stays in the log, which is the point of an audit trail. State that in a comment so nobody
later "tidies" it into an update.

### 4. `WebPortal/modules/sales-reports/js/report_editor.js`

Minimal changes:

- Where the payload is applied and buttons toggled (:160-162), also reveal
  `#reportWhatsappHistoryCard` and call `ReportWhatsappHistory.load(state.payload.id, false)` when
  `payload.status` is `'published'` or `'superseded'`. A **superseded** report shows its history —
  it was genuinely sent to those people and that record must not vanish when it is re-issued — but
  part 3 already prevents sending one, so no re-send button appears for it. A `draft` shows no panel
  at all (it can never have deliveries: `begin_report_delivery` is only reached through a send, and
  a send requires `published`).
- Register the shared `getPdfBase64` provider with `ReportWhatsappSend` once at init, so `resend()`
  works without the dialog having been opened first. Use the exact promise-returning `pdfBase64()`
  sketch part 3's plan specifies — the one with `return new Promise(...)` around
  `getBase64`'s callback.
- `destroy()` must also call `ReportWhatsappHistory.destroy()`, guarded by `typeof`.

Do not refactor anything else in this file.

### 5. `WebPortal/js/appRouteConfig.json`

Add `"js/report-whatsapp-history.js"` to the `sales-report-editor` route's `js` array, after
`js/report-whatsapp-send.js` and before `js/report_editor.js`. Nothing else changes.
`npm run registry:verify` checks every path here exists.

## Security invariants to state in the code, not infer

- **Every rendered value is external.** `display_name` originates from CRM rows and WhatsApp profile
  names; `delivery_error` is text from a third-party gateway; `phone` and `external_message_id` come
  from the same path. All of it reaches the DOM through `.text()` or an escaping helper — never
  concatenated into an HTML string, and never into a `title=`/`data-` attribute built as HTML.
- **No value is assigned into a URI sink.** This panel renders no link. In particular it does not
  render a link to the stored PDF: part 2 never returns the signed URL to the browser, and the
  bucket is private with no policy, so there is nothing here that could be turned into a working
  href. Do not add one.
- The re-send control is gated twice: `hasAction('reports.report.send')` inline at render time, and
  the edge function's own 403. Neither replaces the other.

## Verify before finishing

1. `npm run test:fleet` passes, including `ui:verify` (no raw hex outside
   `WebPortal/css/design-tokens.css`) and `registry:verify`. Use existing tokens or Bootstrap
   utilities for the panel; add no new hex.
2. `node --check` on all three changed/added JS files exits 0, and `appRouteConfig.json` still parses.
3. **A pure-Node unit check** in a new `scripts/verify-report-whatsapp-history.mjs`, wired into
   `test:fleet`, following the hermetic pattern of `scripts/verify-report-rendering.mjs` — read that
   file first: it loads a module into a bare `vm` context with `{ window: {}, console }` (:47-50) and
   asserts against literal fixtures. This file, unlike the pure PDF builder, touches `window`/
   `document` at call time, so if it cannot be loaded that way, expose the pure row-shaping helper on
   the global and test that directly rather than weakening the assertions. Assert against literal
   delivery-row fixtures:
   - a `failed` row surfaces `delivery_error`, and a row whose `error` (the RPC column) is set but
     `delivery_error` is null surfaces **nothing** as the failure text — this is the exact
     confusion the two column names exist to prevent
   - a `pending` row is classed as an incomplete send, not a success
   - a row with `display_name: null` falls back to the phone, and one with `sent_by_name: null`
     renders the em-dash placeholder rather than the string "null"
   - `completed_at: null` falls back to `created_at`
4. `grep -n "innerHTML" WebPortal/modules/sales-reports/js/report-whatsapp-history.js` — report every
   hit and confirm none interpolates a payload value.

**What cannot be verified from this checkout, and must not be claimed as verified**: the panel
rendering in a browser, a real re-send reaching a phone, and anything about the gateway's actual
error text. The edge function may also still be undeployed when this merges. Say so.

## Out of scope

Any migration — `report_deliveries` and its RPCs already exist and are applied. The parity harness
(part 5). Changing how a send works (part 3 owns that). Any scheduled or automatic send. Deleting or
editing delivery rows: the log is append-only by design.

## Report

Under 30 lines: files changed, the states the panel distinguishes, verify results, an explicit list
of what remains unverifiable from the checkout, and anything in part 3's merged code that
contradicted this plan's assumptions about `getPdfBase64`.
