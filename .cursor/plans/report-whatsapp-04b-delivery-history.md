---
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 4b — who got this report, and re-sending the failures

## Context

After 03b (merged as `d75be90`) an operator can send a published report to selected numbers and see
the immediate per-recipient result. What they cannot do is come back tomorrow and answer "did Pete
ever get the August report?" The answer is already in `public.report_deliveries` — nothing renders it.

This matters more than a convenience. A WhatsApp send can fail for reasons the portal cannot
anticipate (falling outside Meta's 24-hour customer-service window being the likeliest), and 03b's
results list disappears the moment the dialog closes. Without this panel a silent partial failure is
indistinguishable from a clean send.

**No `depends_on`.** Its prerequisite (03b) is already merged, and nothing else in flight touches
these files. This plan replaces the never-run `report-whatsapp-04-delivery-history.md`, whose
`depends_on` named a plan that ended terminally blocked and which therefore could never run.

## Verify the premise before writing anything

```
grep -n "listReportDeliveries:" WebPortal/js/data-functions.js
grep -n "_normalizeKey\|_pruneSelection\|setPdfProvider\|reportWhatsappSend:completed" WebPortal/modules/sales-reports/js/report-whatsapp-send.js
grep -n "list_report_deliveries" migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql
ls WebPortal/modules/sales-reports/js/
```

The first three must return hits; the last must show `report-whatsapp-send.js` present and no
`report-whatsapp-history.js`. **If any of that differs, stop and report it.**

## Grounding — verified against this checkout and the dev database

### `list_report_deliveries(p_report_instance_id uuid)`

Defined in `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql` section 5,
applied to dev. Returns:

```
success int, error text, id uuid, recipient_id uuid, phone text, display_name text, channel text,
status text, external_message_id text, delivery_error text, sent_by uuid, sent_by_name text,
created_at timestamptz, completed_at timestamptz, link_expires_at timestamptz
```

Three things about that shape, all easy to get wrong:

- **The per-row failure text is `delivery_error`, NOT `error`.** The leading `error` column is the
  RPC-level fault and is non-null only when `success = 0`. Rendering `row.error` shows nothing on a
  failed delivery. This is the single most likely defect in this plan — the two names exist precisely
  so they cannot be confused, and a verify assertion below pins it.
- **`status` is one of `'pending'`, `'sent'`, `'failed'`** (the table's CHECK). A row is written
  `'pending'` by `begin_report_delivery` before the send and updated by `complete_report_delivery`
  after, so a row **stuck at `pending`** means the send loop died part-way. That is a real terminal
  state, not a transient one. The migration's own comment says so: "A recipient that shows 'pending'
  long after the fact is a visible fault; a missing row is not." Render it as a fault, never as
  success and never as blank.
- `sent_by_name` is `NULL` when the sender is no longer in `public.users` (it is a `LEFT JOIN`), and
  `completed_at` is `NULL` for a `pending` row.

Wrapper: `dataFunctions.listReportDeliveries(reportInstanceId, token, forceRefresh)` at
`WebPortal/js/data-functions.js:6402`. It **throws** on a missing id and on RPC failure — it does not
return an empty list. Cache key `report_deliveries_<id>`; pass `forceRefresh = true` after a send.

### The merged 03b module — read it before extending it

`WebPortal/modules/sales-reports/js/report-whatsapp-send.js` (700 lines). Public API at :667-695:
`init`, `destroy`, `open`, `setPdfProvider`, plus five helpers exposed for unit testing —
`_normalizeKey` (:58), `_buildCandidateLists` (:79), `_pruneSelection` (:146),
`_buildSendRecipients` (:162), `_summarizeSend` (:176).

Facts that decide this plan's design:

- `open(options)` (:649) **resets `state.selected = {}`**, then calls `showModal()` then
  `loadSources(false)`.
- `pruneSelection(selected, lists)` (:146) iterates exactly `['saved', 'inbox', 'crm']` and **drops
  any selected key not found in those lists**. This is the crux — see the re-send design below.
- `buildSendRecipients` (:162) emits `{ phone, display_name }` plus `recipient_id` only when present,
  and deliberately sends **the source's original phone string, never the normalised key**.
- `summarizeSend` (:176) reads `sent`/`failed` and never `success`.
- `handleSendResponse` (:562) renders results and at :570 fires
  `$(document).trigger('reportWhatsappSend:completed', [{ reportInstanceId: state.reportInstanceId }])`.
- `pdfProvider` is stored at module scope (:46, set at :686) and `report_editor.js` registers it in
  **`init`** (:1208-1209), not on open, and calls `ReportWhatsappSend.destroy()` at :1219-1220. So a
  send can be initiated without the dialog having been opened first.

### The re-send design — reuse the dialog, do not build a second send path

A headless `resend()` would have to duplicate the PDF-build then post then render sequence, and it
would need `state.filename` and `state.reportInstanceId`, both of which only `open()` sets. So:

**Extend `open()` with an optional `opts.preselect` array** of `{ phone, displayName, recipientId }`,
and have the history panel call `open({ ..., preselect: <the failed rows> })`. The operator then
presses Send. This reuses the entire merged flow, and it keeps a human confirmation in front of a
real WhatsApp message — which is a virtue, not an inconvenience.

**The edge case that must be handled explicitly**: a failed delivery's number may no longer appear in
any of the three sources (the saved recipient was deactivated, the CRM contact deleted, the
conversation archived). `pruneSelection` would silently drop it, and the operator would press Send
with fewer recipients than they chose and no explanation. Handle it by adding a **fourth candidate
group** for preselected numbers that no source produced:

- add a `resend` key to `state.lists`, and add `'resend'` to `pruneSelection`'s group array
- build those candidates from the `preselect` entries themselves, keyed with `normalizeKey(phone)`
- render them under a group heading such as "From this report's earlier sends"
- skip any whose `normalizeKey` is falsy, and count them into the existing skipped tally

**Blast radius on the existing test** — in scope, not for someone else to find:
`scripts/verify-report-whatsapp-picker.mjs` test 5 at :145-163 exercises `_pruneSelection` with a
three-group `lists` object. Adding a fourth group must not break it — confirm it still passes and
**add a case covering the new group**, both a retained `resend` candidate and a dropped absent key.

## Deliverables

### 1. New file `WebPortal/modules/sales-reports/js/report-whatsapp-history.js`

IIFE assigning one global `ReportWhatsappHistory` with `init()`, `destroy()` and
`load(reportInstanceId, forceRefresh)`. Bindings namespaced `.reportWhatsappHistory`; `init()` calls
`destroy()` first. Follow the four conventions stated at
`WebPortal/modules/sales-reports/js/report_list_grid.js:1-15` — real `destroy()`, namespaced
bindings, no double-init, and **every database value escaped on the way to the DOM**.

`load()`:

- Render `macLoadingRow(6)` (`WebPortal/js/ui-states.js:37-39`), then call
  `dataFunctions.listReportDeliveries(id, null, !!forceRefresh)` **inside a try/catch** — it throws.
- On a thrown error, or a first row with `success = 0`, render the failure **inside the panel** as a
  muted line carrying the message. Do **not** open a `Swal` dialog: a history panel that cannot load
  is not worth interrupting the operator over, and "could not load" must look different on screen
  from "no rows".
- On success, one row per delivery: recipient (`display_name` falling back to `phone`), number,
  status pill via `MacStatus.pill(row.status)` (`WebPortal/js/mac-status.js:61`; its map already
  covers `sent` at :27, `pending` at :29 and `failed` at :33), when (`completed_at` falling back to
  `created_at`), sent by (`sent_by_name`, falling back to a muted em-dash — never the string
  "null"), and an actions cell.
- A `failed` row shows its **`delivery_error`** verbatim as a muted second line. Verbatim matters:
  that string is the gateway's own text and is the only actionable detail. Truncate for display with
  the full text in a `title`, set through an escaping call — never by building the attribute inside
  an HTML string.
- A `pending` row shows a muted "never completed — the send did not finish", not a blank.
- No rows → `macEmptyRow(6, 'This report has not been sent to anyone yet.')`.
- The actions cell holds a "Re-send" button only when `status !== 'sent'` **and**
  `hasAction('reports.report.send')` is true, evaluated **inline at render time**
  (`WebPortal/js/action-access.js:95`). CLAUDE.md records that `data-action-perm` is swept once over
  static markup and is inert on markup injected later, so the attribute would do nothing on these
  rows.
- A "Re-send all failed" button in the panel header, shown only when at least one row is `failed` or
  `pending` and `hasAction('reports.report.send')` is true.
- Both re-send controls call `ReportWhatsappSend.open({...})` with `preselect` populated, guarded
  `typeof ReportWhatsappSend !== 'undefined' && ReportWhatsappSend.open`. If the guard fails, show a
  plain error — never silently do nothing.
- Listen on `document`, namespaced, for `reportWhatsappSend:completed` and reload with
  `forceRefresh = true` when the event's `reportInstanceId` matches the one on screen.

**Re-sending creates NEW `report_deliveries` rows.** It does not update the old ones — the failed
attempt stays in the log, which is the entire point of an audit trail. State that in a comment so
nobody later "tidies" it into an update.

### 2. `WebPortal/modules/sales-reports/js/report-whatsapp-send.js` — the `preselect` option only

Add `opts.preselect` handling to `open()`, the fourth `resend` candidate group, and `'resend'` in
`pruneSelection`'s group array, as described above. Change nothing else in this file — in particular
leave `buildSendRecipients`, `summarizeSend` and the send flow alone; they are covered by existing
tests and they work.

### 3. `WebPortal/modules/sales-reports/html/report_editor.html`

A card below `#reportEditorAccordion`, inside `#reportEditorContent`:
`id="reportWhatsappHistoryCard"`, `class="card mt-3 d-none"`; a header with the title
"Distribution", a muted count placeholder, and `id="reportWhatsappHistoryResendFailedBtn"` starting
`d-none`; a `table-responsive` wrapper around a six-column table (Recipient, Number, Status, When,
Sent by, Actions) with an empty `<tbody id="reportWhatsappHistoryBody">`. **No database value in the
static markup.**

### 4. `WebPortal/modules/sales-reports/js/report_editor.js`

Minimal, alongside the existing 03b wiring; do not refactor anything else:

- Where status drives the toolbar buttons (the status block near :160-162 and the send wiring near
  :1120), reveal `#reportWhatsappHistoryCard` and call
  `ReportWhatsappHistory.load(state.payload.id, false)` when `payload.status` is `'published'` **or**
  `'superseded'`. A superseded report keeps its history — it really was sent to those people and that
  record must not vanish when it is re-issued — and 03b already prevents sending one, so no re-send
  control appears for it. A `draft` shows no panel: it can never have deliveries, because
  `begin_report_delivery` is only reached through a send and a send requires `published`.
- `destroy()` must also call `ReportWhatsappHistory.destroy()`, guarded by `typeof`, next to the
  existing `ReportWhatsappSend.destroy()` at :1219-1220.

### 5. `WebPortal/js/appRouteConfig.json`

Add `"js/report-whatsapp-history.js"` to the `sales-report-editor` route's `js` array, after
`js/report-whatsapp-send.js` and before `js/report_editor.js`. Nothing else.
`npm run registry:verify` requires every path here to exist.

## Security invariants to state in the code, not infer

- **Every rendered value is externally supplied.** `display_name` comes from CRM rows and WhatsApp
  profile names; `delivery_error` is text from a third-party gateway; `phone` and
  `external_message_id` arrive by the same route. All of it reaches the DOM via `.text()` or
  `_common.escapeHtml` (`WebPortal/js/common.js:254`) — never raw concatenation, and never an
  HTML-built `title=`/`data-` attribute.
- **No value is assigned into a URI sink.** This panel renders no link. In particular it must not
  link to the stored PDF: the edge function never returns the signed URL to the browser, and the
  bucket is private with no RLS policy, so there is nothing here that could become a working href.
  Do not add one.
- The re-send control is gated twice: `hasAction('reports.report.send')` inline at render time, and
  the edge function's own `has_action` 403. Neither replaces the other.

## Verify before finishing

1. The premise greps above, with output.
2. `npm run test:fleet` passes. It currently runs `routing:verify`, `username:verify`,
   `verify-phase2-migrations.mjs`, `ui:verify`, `migrations:verify`, `registry:verify`,
   `reports:verify`, `report-whatsapp-payload:verify` and `report-whatsapp-picker:verify`. Add no new
   hex — `ui:verify` fails on any raw hex outside `WebPortal/css/design-tokens.css`; use existing
   tokens or Bootstrap utilities.
3. `node --check` on all three changed/added JS files exits 0, and `appRouteConfig.json` still parses.
4. **`report-whatsapp-picker:verify` still passes**, and gains a case for the fourth `resend` group
   in `_pruneSelection` — one retained `resend` candidate, one dropped absent key.
5. **A new pure-Node check**, `scripts/verify-report-whatsapp-history.mjs`, wired into `test:fleet`
   as `report-whatsapp-history:verify`. Follow `scripts/verify-report-whatsapp-picker.mjs` — read it
   first; it is the closest model and already solves loading a `window`-touching module. Expose the
   pure row-shaping helper on the global and assert, against literal fixtures:
   - a `failed` row surfaces **`delivery_error`**; a row with `error` set but `delivery_error` null
     surfaces **no** failure text — the exact confusion the two names exist to prevent
   - a `pending` row is classified as an incomplete send, not a success
   - `display_name: null` falls back to the phone; `sent_by_name: null` renders the em-dash
     placeholder, never "null"
   - `completed_at: null` falls back to `created_at`
   - the preselect builder turns a failed row into a `{ phone, displayName, recipientId }` candidate
     using the **original** phone string, not the normalised key
6. `grep -n "innerHTML\|\.html(" WebPortal/modules/sales-reports/js/report-whatsapp-history.js` —
   report every hit and confirm each is a static string or passes through `escapeHtml`.
7. `grep -n "delivery_error" WebPortal/modules/sales-reports/js/report-whatsapp-history.js` — must
   return hits, and confirm by inspection that no per-row failure text is read from `error` instead.

**Not verifiable from this checkout, and not to be claimed as verified**: the panel rendering in a
browser, a real re-send reaching a phone, and the gateway's actual error text. Say so.

## Out of scope

Any migration — `report_deliveries` and its RPCs are applied. The parity harness (part 5b). Changing
how a send works. Any scheduled or automatic send. Editing or deleting delivery rows: the log is
append-only by design.

## Report

Under 30 lines: the premise-grep output, files changed, the states the panel distinguishes, how the
absent-preselect edge case behaves, verify results including the picker test's status, an explicit
list of what remains unverifiable, and anything in 03b's merged code that contradicted this plan.
