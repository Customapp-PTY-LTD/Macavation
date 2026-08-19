---
notify: henry@customapp.co.za
retry_of: 6e89a0eb-31bb-4d7f-a9ba-77ec86fb8a66
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
grep -n "findCandidateByKey" WebPortal/modules/sales-reports/js/report-whatsapp-send.js
grep -n "list_report_deliveries" migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql
grep -n "pdfFileName" WebPortal/modules/sales-reports/js/report_editor.js
grep -n "state\.reportId" WebPortal/modules/sales-reports/js/report_editor.js
grep -n "payload\.id" WebPortal/modules/sales-reports/js/report_editor.js
grep -n "MAX_RECIPIENTS" supabase/functions/send-report-whatsapp/index.ts
ls WebPortal/modules/sales-reports/js/
```

All of these must return hits **except** `grep -n "payload\.id"`, which must return **nothing** (this
file identifies the report only by `state.reportId`; see the constraint in deliverable 4). `ls` must
show `report-whatsapp-send.js` present and no `report-whatsapp-history.js`. **If any of that differs,
stop and report it.**

## Grounding — verified against this checkout

### `list_report_deliveries(p_report_instance_id uuid)`

Defined in `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:390-443`, applied
to dev. Returns:

```
success int, error text, id uuid, recipient_id uuid, phone text, display_name text, channel text,
status text, external_message_id text, delivery_error text, sent_by uuid, sent_by_name text,
created_at timestamptz, completed_at timestamptz, link_expires_at timestamptz
```

Three things about that shape, all easy to get wrong:

- **The per-row failure text is `delivery_error`, NOT `error`.** The leading `error` column is the
  RPC-level fault and is non-null only when `success = 0` (`:414-417`). Rendering `row.error` shows
  nothing on a failed delivery. This is the single most likely defect in this plan — the two names
  exist precisely so they cannot be confused, and a verify assertion below pins it.
- **`status` is one of `'pending'`, `'sent'`, `'failed'`** (the table's CHECK). A row is written
  `'pending'` by `begin_report_delivery` (`:334-341`) before the send and updated by
  `complete_report_delivery` after, so a row **stuck at `pending`** means the send loop died part-way.
  That is a real terminal state, not a transient one. Render it as a fault, never as success and never
  as blank. **A `pending` row may also mean the message actually reached the phone and only the
  completion write was lost** — `begin_report_delivery` inserts `'pending'`, the gateway call happens,
  then `complete_report_delivery` runs. Re-sending a `pending` row can therefore deliver a second copy
  of a confidential report. State that in a code comment and in the row's own on-screen wording; the
  human Send press in the 03b dialog is the gate that makes it acceptable.
- `sent_by_name` is `NULL` when the sender is no longer in `public.users` (it is a `LEFT JOIN`,
  `:439`), and `completed_at` is `NULL` for a `pending` row.

`report_deliveries.recipient_id` is `uuid NULL REFERENCES public.report_recipients (id) ON DELETE SET
NULL` (`:120`), and `begin_report_delivery` does not check the recipient's `is_active` (`:298-345`).
So a `recipient_id` read back off an old delivery row is either NULL or still a live FK — passing it
straight back into a re-send is safe, and no extra validation is to be invented for it.

Wrapper: `dataFunctions.listReportDeliveries(reportInstanceId, token, forceRefresh)` at
`WebPortal/js/data-functions.js:6402-6413`. It **throws** on a missing id (`:6404`) and on RPC failure
— it does not return an empty list. Cache key `report_deliveries_<id>`; pass `forceRefresh = true`
after a send. `sendReportWhatsapp` already clears `report_deliveries_` in its `finally`
(`:6338`), but the panel must still force-refresh so it never reads a same-tick cache entry.

**Handle both RPC result shapes.** `callFunction` may hand back an array of rows or a single row
object, which is why the merged send module carries `firstRpcRow` (`report-whatsapp-send.js:69-71`).
The history module must normalise with the same idiom — `Array.isArray(raw) ? raw : (raw ? [raw] :
[])` — and must not assume an array.

### The merged 03b module — read it before extending it

`WebPortal/modules/sales-reports/js/report-whatsapp-send.js` (700 lines). Public API at :667-695:
`init`, `destroy`, `open`, `setPdfProvider`, plus five helpers exposed for unit testing —
`_normalizeKey` (:58), `_buildCandidateLists` (:79), `_pruneSelection` (:146),
`_buildSendRecipients` (:162), `_summarizeSend` (:176).

Facts that decide this plan's design:

- `open(options)` (:649) **resets `state.selected = {}`** and `state.lists` (:655), then calls
  `showModal()` then `loadSources(false)`.
- `loadSources` **reassigns `state.lists` at :441**, after the three sources resolve. `init()`
  reassigns it again at :671. Any group built in `open()` before `loadSources()` is wiped at :441.
- `pruneSelection(selected, lists)` (:146-157) iterates exactly `['saved', 'inbox', 'crm']` (:148) and
  **drops any selected key not found in those lists**. Each group is read through
  `Array.isArray(lists[group])`, so a `lists` object missing a group is safe, not a crash.
- `findCandidateByKey` (:229-237) hard-codes `[state.lists.saved, state.lists.inbox,
  state.lists.crm]`. `handleCandidateToggle` (:467-468) only writes into `state.selected` when this
  returns a candidate, so a group missing from this list produces a **checkbox that reads checked
  while the recipient is not selected** — a silent short send. This function MUST be extended.
- `buildSendRecipients` (:162) emits `{ phone, display_name }` plus `recipient_id` only when present,
  and deliberately sends **the source's original phone string, never the normalised key**.
- `ensureRecipientsSaved` (:521-541) calls `dataFunctions.upsertReportRecipient(c.displayName,
  c.phone, c.source, …)` for any selected candidate with no `recipientId` when the operator holds
  `reports.recipient.manage`. That wrapper **throws unless `source` is one of `'whatsapp_chat'`,
  `'crm_contact'`, `'manual'`** (`data-functions.js:6367-6369`). Any new candidate object must
  therefore carry a `source` from that whitelist.
- `summarizeSend` (:176) reads `sent`/`failed` and never `success`.
- `handleSendResponse` (:562) renders results and at :570 fires
  `$(document).trigger('reportWhatsappSend:completed', [{ reportInstanceId: state.reportInstanceId }])`
  — and `state.reportInstanceId` is whatever `open()` was given.
- `MAX_RECIPIENTS = 25` at :32, mirrored server-side (`supabase/functions/send-report-whatsapp/index.ts:61`,
  rejected with 400 at `:259-261`). `handleCandidateToggle` enforces it for human clicks only;
  anything that seeds `state.selected` programmatically must enforce it too.
- `pdfProvider` is stored at module scope (:46, set at :686) and `report_editor.js` registers it in
  **`init`** (:1207-1210), not on open, and calls `ReportWhatsappSend.destroy()` at :1219-1221. So a
  send can be initiated without the dialog having been opened first.
- The module has **no bottom-of-file auto-init**; `init()` is called by `report_editor.init()`. The new
  history module must follow that exactly (see deliverable 1).

### `report_editor.js` — the two facts the re-send path depends on

- **`pdfFileName(payload)` is private inside the `_reportEditor` IIFE** (`:1068-1072`). There is no
  accessor and none is to be added. `handleSendWhatsapp` (`:1122-1130`) is the only caller and passes
  its result as `filename`. `dataFunctions.sendReportWhatsapp` throws unless `filename` is present and
  ends in `.pdf` (`data-functions.js:6277`), and that rejection reaches the operator as
  `report-whatsapp-send.js:597`'s "Could not reach the send endpoint. Please try again." — a message
  that blames the network for a bug. **The history module must therefore never construct a filename
  and never call `ReportWhatsappSend.open` directly.** It asks `report_editor.js` to do it, through an
  injected handler modelled on the merged `setPdfProvider` injection.
- **The report id is `state.reportId`** (assigned in `load()` at `:724`, reassigned on re-issue at
  `:850`, and used at every RPC call site in the file). `payload.id` is read nowhere in this file. Use
  `state.reportId` — it is also the exact value handed to `ReportWhatsappSend.open` at `:1125` and
  therefore the value that comes back on `reportWhatsappSend:completed`, so the panel's own id must be
  the same string or the reload-after-send match silently fails.
- `renderPayload(payload)` (`:667-705`) is the single place a loaded payload reaches the screen; it
  calls `updatePublishControls(payload)` at `:677` and is re-entered by `reloadAndRerender()` and
  `reloadAfterLockChange()`. That is the one place the panel is revealed and loaded from.

### Sending is only ever allowed on a `published` report

The edge function returns 409 for any report whose `status !== 'published'`
(`supabase/functions/send-report-whatsapp/index.ts:319-323`). `updatePublishControls` hides the
toolbar Send button for a non-published report (`report_editor.js:167`), but that says nothing about a
button this plan adds elsewhere. **The re-send controls in the history panel must be gated on the
loaded report's status being `'published'`, explicitly** — the panel itself still renders for a
`superseded` report, because that history really happened and must not vanish.

### The re-send design — reuse the dialog, do not build a second send path

A headless `resend()` would have to duplicate the PDF-build then post then render sequence, and it
would need `state.filename` and `state.reportInstanceId`, both of which only `open()` sets. So:

**Extend `open()` with an optional `opts.preselect` array** of `{ phone, displayName, recipientId }`,
and have `report_editor.js` — not the history module — call `open({ …, preselect: <the failed rows> })`
with the filename it alone can produce. The operator then presses Send. This reuses the entire merged
flow, and it keeps a human confirmation in front of a real WhatsApp message.

**The edge case that must be handled explicitly**: a failed delivery's number may no longer appear in
any of the three sources (the saved recipient was deactivated, the CRM contact deleted, the
conversation archived). `pruneSelection` would silently drop it, and the operator would press Send
with fewer recipients than they chose and no explanation. Handle it by adding a **fourth candidate
group** for preselected numbers that no source produced, wired at every one of the places listed in
deliverable 2 — a group added at only some of them reproduces exactly the silent drop this panel
exists to expose.

**Blast radius on the existing test** — in scope, not for someone else to find:
`scripts/verify-report-whatsapp-picker.mjs` test 5 at `:144-161` exercises `_pruneSelection` with a
three-group `lists` object. Adding a fourth group must not break it (each group is read through
`Array.isArray`, so the absent `resend` key is skipped) — confirm it still passes **without editing
that case**, and add new cases as listed under "Verify before finishing".

## Deliverables

### 1. New file `WebPortal/modules/sales-reports/js/report-whatsapp-history.js`

IIFE assigning one global `ReportWhatsappHistory`. **Exact public API — later deliverables and the new
verify script reference these names and nothing else:**

```
init()
destroy()
setResendHandler(fn)
load(reportInstanceId, forceRefresh, canResend)
_buildHistoryRow(row)        // pure, exposed for the verify script
_buildResendPreselect(rows)  // pure, exposed for the verify script
```

Structural constraints:

- **No DOM/global reference at module-evaluation time.** `$`, `document`, `Swal`, `MacStatus`,
  `hasAction`, `macLoadingRow`, `macEmptyRow` and `dataFunctions` may be referenced only inside
  function bodies, exactly as `report-whatsapp-send.js:14-17` states for itself — the new verify
  script loads this file into a bare `vm` context.
- End the file with `if (typeof window !== 'undefined') { window.ReportWhatsappHistory =
  ReportWhatsappHistory; }` and **no auto-init call**. `init()` is invoked by `report_editor.init()`
  (deliverable 4); a bottom-of-file init would double-bind on a route swap.
- Bindings namespaced `.reportWhatsappHistory`; `init()` calls `destroy()` first; `destroy()` removes
  every binding this file made. Follow the three conventions stated in the header of
  `WebPortal/modules/sales-reports/js/report_list_grid.js:1-15` — real `destroy()`, namespaced
  bindings, no double-init — plus **every database value escaped on the way to the DOM**.
- `setResendHandler(fn)` mirrors `setPdfProvider` (`report-whatsapp-send.js:685-687`): store
  `resendHandler = (typeof fn === 'function') ? fn : null`. Nothing else in this module may reference
  `ReportWhatsappSend`.
- Module state: `reportInstanceId`, `canResend`, `rows`. `load()` sets
  `state.reportInstanceId = String(reportInstanceId || '')` and `state.canResend = !!canResend`.

`load(reportInstanceId, forceRefresh, canResend)`:

- Render `macLoadingRow(6)` (`WebPortal/js/ui-states.js:17-22`, exported at `:37-39`) into
  `#reportWhatsappHistoryBody`, then call
  `dataFunctions.listReportDeliveries(state.reportInstanceId, null, !!forceRefresh)` **inside a
  try/catch (or `.catch`)** — it throws.
- Normalise the result with `Array.isArray(raw) ? raw : (raw ? [raw] : [])` before reading it.
- On a thrown error, or a first row with `success = 0`, render the failure **inside the panel** as a
  muted line carrying the message. Do **not** open a `Swal` dialog: a history panel that cannot load
  is not worth interrupting the operator over, and "could not load" must look different on screen
  from "no rows".
- On success, one row per delivery via `_buildHistoryRow(row)`: recipient (`display_name` falling back
  to `phone`), number, status pill via `MacStatus.pill(row.status)` (`WebPortal/js/mac-status.js:61`;
  its map covers `sent` at `:27`, `pending` at `:29`, `failed` at `:33`), when (`completed_at` falling
  back to `created_at`), sent by (`sent_by_name`, falling back to a muted em-dash — never the string
  "null"), and an actions cell.
- A `failed` row shows its **`delivery_error`** verbatim as a muted second line. Verbatim matters: that
  string is the gateway's own text and is the only actionable detail. Truncate for display with the
  full text in a `title`, set through `.attr('title', value)` or a jQuery attribute object — never by
  building the attribute inside an HTML string.
- A `pending` row shows a muted "never completed — the send did not finish; a re-send may deliver a
  second copy", not a blank.
- No rows → `macEmptyRow(6, 'This report has not been sent to anyone yet.')`.
- Update the header count placeholder with `.text()` only.
- The actions cell holds a "Re-send" button only when **all three** hold: `row.status !== 'sent'`,
  `state.canResend === true`, and `hasAction('reports.report.send')` evaluated **inline at render
  time** (`WebPortal/js/action-access.js:95`), with `typeof hasAction !== 'function'` treated as
  denied. `data-action-perm` is swept once over static markup and is inert on markup injected later
  (stated in `report_editor.js:14-17` and applied there for metric rows), so the attribute would do
  nothing on these rows.
- A "Re-send all failed" button (`#reportWhatsappHistoryResendFailedBtn`) is un-hidden only when at
  least one row is `failed` or `pending` **and** the same `state.canResend` + inline `hasAction` gate
  passes; otherwise it keeps `d-none`.
- Both re-send controls build their preselect list with `_buildResendPreselect(rows)` and then call
  `resendHandler(preselect)`. If `typeof resendHandler !== 'function'` or the call does not return
  `true`, render a plain muted error line in the panel ("This report can no longer be sent." /
  "Re-send is unavailable on this screen.") — never silently do nothing, and never fall back to
  calling `ReportWhatsappSend` directly.
- Listen on `document`, namespaced `.reportWhatsappHistory`, for `reportWhatsappSend:completed` and
  reload with `forceRefresh = true` when the event payload's `reportInstanceId` matches
  `state.reportInstanceId`. Click handlers use delegation from the static container ids so they
  survive re-render.

`_buildResendPreselect(rows)` (pure): from the normalised row array, take every row with
`status !== 'sent'` and a non-empty `phone`, and return `{ phone: row.phone, displayName:
row.display_name, recipientId: row.recipient_id || null }` — **`phone` is the row's original string,
never a normalised key** (the send module normalises, and two normalisers disagreeing is the hazard).
`display_name` may be `null`; pass it through unchanged, the send-side helper falls back to the phone.
For the single-row "Re-send" button, call it with a one-element array.

**Re-sending creates NEW `report_deliveries` rows.** It does not update the old ones — the failed
attempt stays in the log, which is the entire point of an audit trail. State that in a comment so
nobody later "tidies" it into an update.

### 2. `WebPortal/modules/sales-reports/js/report-whatsapp-send.js` — the `preselect` option only

Make **exactly** these nine edits. Anything not listed stays untouched — in particular
`buildSendRecipients`, `summarizeSend`, `handleSend`, `callSendEndpoint` and `ensureRecipientsSaved`
are covered by existing tests and they work.

1. **State initialiser (`:34-44`)** — `lists: { saved: [], inbox: [], crm: [], resend: [] }`, plus new
   fields `preselect: []` and `preselectOverflowCount: 0`.
2. **`pruneSelection` (`:146-157`)** — the group array becomes
   `['saved', 'inbox', 'crm', 'resend']`. Change nothing else in this function; its
   `Array.isArray(lists[group])` guard is what keeps the existing three-group test passing.
3. **New pure helper `buildResendGroup(preselectEntries, lists)`**, placed with the other pure helpers
   (after `buildCandidateLists`), with **no DOM or global reference**. Contract:
   - Returns `{ resend: [candidate…], selectedKeys: [key…], skippedCount: n }`.
   - For each entry: `var key = normalizeKey(entry && entry.phone);` if `!key || key.length < 11`,
     increment `skippedCount` and continue (mirroring `buildCandidateLists:91`). Dedupe by `key`
     within the preselect list.
   - Build a lookup over `['saved','inbox','crm']` from `lists` using the same
     `Array.isArray`-guarded pattern as `pruneSelection`. If `key` is already in that lookup, push
     `key` into `selectedKeys` and **do not** add a `resend` candidate (the source's own candidate is
     the one to select — no duplicate row).
   - Otherwise push `{ key: key, phone: entry.phone, displayName: entry.displayName || entry.phone,
     source: 'manual', recipientId: entry.recipientId || null }` into `resend` and `key` into
     `selectedKeys`. `phone` is the entry's **original** string. `source: 'manual'` is mandatory: it is
     the only whitelist value (`data-functions.js:6367-6369`) that keeps the untouched
     `ensureRecipientsSaved` path from throwing on a resend candidate that has no `recipientId`.
4. **`findCandidateByKey` (`:229-237`)** — search four groups, each with a fallback:
   `[state.lists.saved || [], state.lists.inbox || [], state.lists.crm || [], state.lists.resend || []]`.
   Without this edit an unchecked-then-rechecked resend row shows as ticked while not being sent.
5. **`renderBody` (`:274-312`)** — after the CRM group, append a fourth `renderGroup` **only when
   `state.lists.resend.length`** (so the normal open path grows no empty heading), with the static
   heading `'From this report\'s earlier sends'` and a static note explaining these numbers came from
   an earlier send and are no longer in the lists above. Then, when
   `state.preselectOverflowCount > 0`, append a muted line stating that N pre-selected recipients were
   not ticked because the maximum is `MAX_RECIPIENTS` per send. Keep the existing `skippedCount` line
   as it is.
6. **`loadSources` tail (`:439-445`)** — in this exact order:
   ```
   var built  = buildCandidateLists(results[0], results[1], results[2]);
   var resend = buildResendGroup(state.preselect, built);
   state.lists = { saved: built.saved, inbox: built.inbox, crm: built.crm, resend: resend.resend };
   state.skippedCount = built.skippedCount + resend.skippedCount;
   // seed the preselected keys, respecting the same cap handleCandidateToggle enforces
   state.preselectOverflowCount = 0;
   resend.selectedKeys.forEach(function (key) { … findCandidateByKey(key) … });
   state.selected = pruneSelection(state.selected, state.lists);
   renderBody();
   ```
   Seeding uses `findCandidateByKey(key)` and assigns into `state.selected` only while
   `Object.keys(state.selected).length < MAX_RECIPIENTS`; every key that does not fit increments
   `state.preselectOverflowCount` (its candidate still renders, unticked). Rebuilding the group **here**
   rather than in `open()` is the point: this is the line that used to overwrite `state.lists`.
   Seeding before `pruneSelection` is also the point: prune only refreshes candidate objects, so no
   seeded key is dropped.
7. **`open()` (`:649-665`)** — add
   `state.preselect = Array.isArray(opts.preselect) ? opts.preselect.slice() : [];`,
   `state.preselectOverflowCount = 0;` and make the `state.lists` reset (`:655`) include
   `resend: []`. Everything else in `open()` is unchanged, including the reset of `state.selected` and
   the show-then-load order.
8. **`init()` (`:667-677`)** — the same three resets (`preselect: []`, `preselectOverflowCount = 0`,
   `lists` with `resend: []`), so a route swap cannot leave a stale preselect behind.
9. **Public API (`:689-695`)** — add `_buildResendGroup: buildResendGroup` alongside the existing five
   test-exposed helpers. Do not rename or remove any existing export.

### 3. `WebPortal/modules/sales-reports/html/report_editor.html`

A card below `#reportEditorAccordion` (`:45`), inside `#reportEditorContent` (`:37`):
`id="reportWhatsappHistoryCard"`, `class="card mt-3 d-none"`; a header with the title
"Distribution", a muted count placeholder (`id="reportWhatsappHistoryCount"`, empty), and
`id="reportWhatsappHistoryResendFailedBtn"` starting `d-none`; a `table-responsive` wrapper around a
six-column table (Recipient, Number, Status, When, Sent by, Actions) with an empty
`<tbody id="reportWhatsappHistoryBody">`. **No database value in the static markup.** Use Font Awesome
(`fas`/`far`) icons only and do not use `btn-success` — `ui:verify` fails on Bootstrap Icons and on
`btn-success` in any `.html`/`.js` file (`scripts/verify-ui-standard.mjs:123-139`).

### 4. `WebPortal/modules/sales-reports/js/report_editor.js`

Minimal, alongside the existing 03b wiring; do not refactor anything else. Four edits:

1. **New private function `openSendDialogForResend(preselect)`**, placed beside
   `handleSendWhatsapp` (`:1122-1130`):
   ```
   function openSendDialogForResend(preselect) {
       if (typeof ReportWhatsappSend === 'undefined' || !ReportWhatsappSend.open) return false;
       if (!state.payload || !state.reportId) return false;
       if (state.payload.status !== 'published') return false;   // edge fn returns 409 otherwise
       if (!Array.isArray(preselect) || !preselect.length) return false;
       ReportWhatsappSend.open({
           reportInstanceId: state.reportId,
           filename: pdfFileName(state.payload),
           periodLabel: displayLabel(state.payload.period_label),
           getPdfBase64: pdfBase64,
           preselect: preselect
       });
       return true;
   }
   ```
   It returns a boolean so the history module can show an explicit message instead of doing nothing.
   This is the **only** place a re-send filename is produced; `pdfFileName` stays private and no
   accessor for it is added.
2. **In `init()` (`:1199-1212`)**, immediately after the existing `ReportWhatsappSend` block at
   `:1207-1210`:
   ```
   if (typeof ReportWhatsappHistory !== 'undefined') {
       ReportWhatsappHistory.init();
       ReportWhatsappHistory.setResendHandler(openSendDialogForResend);
   }
   ```
   Both calls are required. `init()` is where the panel's click delegation and its
   `reportWhatsappSend:completed` listener are bound; without it the panel renders with dead buttons
   and never refreshes after a send.
3. **In `renderPayload(payload)`**, immediately after `updatePublishControls(payload)` (`:677`):
   reveal `#reportWhatsappHistoryCard` (`toggleClass('d-none', …)`, never `.show()`/`.css`, matching
   the reason given at `:153-157`) when `payload.status` is `'published'` **or** `'superseded'`, hide
   it otherwise, and when revealed call
   `ReportWhatsappHistory.load(state.reportId, false, payload.status === 'published')`, guarded by
   `typeof ReportWhatsappHistory !== 'undefined'`. Use `state.reportId`, **not** `payload.id` — every
   other id call site in this file uses `state.reportId`, `payload.id` is read nowhere in this file,
   and `state.reportId` is the exact value `ReportWhatsappSend` echoes back on
   `reportWhatsappSend:completed` (`:1125` → `report-whatsapp-send.js:570`), which the panel's reload
   match depends on. `renderPayload` is re-entered by `reloadAndRerender()` and
   `reloadAfterLockChange()`, and both assign `state.reportId` before rendering, so the re-issue path
   loads the new report's history. Passing `false` for `forceRefresh` here is deliberate: the cached
   read is fine, and a send invalidates the cache itself (`data-functions.js:6338`).
   A `superseded` report gets the panel with `canResend = false` — the record must not vanish when a
   report is re-issued, but the edge function would reject the send with 409. A `draft` shows no panel:
   it can never have deliveries, because `begin_report_delivery` is only reached through a send and a
   send requires `published`.
4. **In `destroy()` (`:1214-1222`)**, next to the existing `ReportWhatsappSend.destroy()` at
   `:1219-1221`, add a `typeof`-guarded `ReportWhatsappHistory.destroy()`.

### 5. `WebPortal/js/appRouteConfig.json`

Add `"js/report-whatsapp-history.js"` to the `sales-report-editor` route's `js` array (`:655-660`),
after `js/report-whatsapp-send.js` and before `js/report_editor.js` — `report_editor.init()` calls
`ReportWhatsappHistory.init()`, so the file must already be loaded. Nothing else.
`registry:verify` (`scripts/verify-registry-paths.mjs`) fails on any registry-named path that does not
exist on disk (`:113-114`).

## Security invariants to state in the code, not infer

- **Every rendered value is externally supplied.** `display_name` comes from CRM rows and WhatsApp
  profile names; `delivery_error` is text from a third-party gateway; `phone` and
  `external_message_id` arrive by the same route. All of it reaches the DOM via `.text()`, a jQuery
  attribute object, `_common.escapeHtml` (`WebPortal/js/common.js:254`, exported at `:456`), or
  `MacStatus.pill`/`macEmptyRow`/`macLoadingRow` (which escape their own arguments) — never raw
  concatenation, and never an HTML-built `title=`/`data-` attribute.
- **No value is assigned into a URI sink.** This panel renders no link. In particular it must not
  link to the stored PDF: the edge function never returns the signed URL to the browser
  (`supabase/functions/send-report-whatsapp/index.ts:517-518`) and the bucket is private with no RLS
  policy (`migrations/20260822090100_report_pdf_storage_bucket.sql:8,40,45`), so there is nothing here
  that could become a working href. Do not add one.
- **Deny by default on permissions.** `typeof hasAction !== 'function'` is denied, never allowed —
  same rule the merged send module states at its `:27` and applies at `:317`.
- **The re-send control is gated four ways and none replaces another**: the loaded report's status is
  `'published'` (checked both in `openSendDialogForResend` and via `canResend` at render time),
  `hasAction('reports.report.send')` inline at render time, and the edge function's own `has_action`
  403 plus its 409 on a non-published report.
- **Keys derived from a phone number are used as object keys.** `normalizeKey` returns a `'+'`-prefixed
  string or null, so `__proto__`/`constructor` cannot be produced; do not relax that by keying on a
  raw `display_name` or delivery id.

## Verify before finishing

1. The premise greps above, with output — including the `payload\.id` grep returning nothing.
2. `npm run test:fleet` passes. It currently runs `routing:verify`, `username:verify`,
   `verify-phase2-migrations.mjs`, `ui:verify`, `migrations:verify`, `registry:verify`,
   `reports:verify`, `report-whatsapp-payload:verify` and `report-whatsapp-picker:verify`
   (`package.json:30`); after this plan it also runs `report-whatsapp-history:verify`.
   `ui:verify`'s rules for the `.html`/`.js` files this plan touches are: no Bootstrap Icons, no
   `bootstrap-icons` stylesheet, no `btn-success`, no legacy `--phoenix/--macadamia/…` vars
   (`scripts/verify-ui-standard.mjs:123-139`). Its raw-hex rule applies to `.css` files only
   (`:63-84`) and this plan adds no CSS.
3. `node --check` on all three changed/added JS files exits 0, and `appRouteConfig.json` still parses.
4. **`report-whatsapp-picker:verify` still passes with test 5 (`:144-161`) unedited**, and gains cases
   for the new machinery, all against literal fixtures:
   - `_pruneSelection` with a four-group `lists` object: one retained `resend` candidate, one dropped
     absent key.
   - `_buildResendGroup`: a preselect phone whose normalised key already exists in `saved` yields
     **no** `resend` candidate but does yield that key in `selectedKeys`; a preselect phone in no
     source yields a `resend` candidate whose `phone` is the **original** string, whose `source` is
     `'manual'`, and whose `displayName` falls back to the phone when `displayName` is null; an
     unusable phone (`null`, `'abc'`) is counted in `skippedCount` and appears in neither list; two
     preselect entries for the same number dedupe to one candidate.
5. **A new pure-Node check**, `scripts/verify-report-whatsapp-history.mjs`, wired into `package.json`
   as `report-whatsapp-history:verify` **and appended to the `test:fleet` chain**. Follow
   `scripts/verify-report-whatsapp-picker.mjs` — read it first; it is the closest model and already
   solves loading a `window`-touching module into a bare `vm` (`:46-56`). Assert against literal
   fixtures, using only `_buildHistoryRow` and `_buildResendPreselect`:
   - a `failed` row surfaces **`delivery_error`**; a row with `error` set but `delivery_error` null
     surfaces **no** failure text — the exact confusion the two names exist to prevent
   - a `pending` row is classified as an incomplete send, not a success, and carries the
     may-already-have-arrived wording
   - `display_name: null` falls back to the phone; `sent_by_name: null` renders the em-dash
     placeholder, never "null"
   - `completed_at: null` falls back to `created_at`
   - `_buildResendPreselect` turns `failed` and `pending` rows into
     `{ phone, displayName, recipientId }` entries using the **original** phone string, not a
     normalised key; excludes every `sent` row; excludes a row with an empty/null `phone`; maps a null
     `recipient_id` to `null`
   - the module loads in a bare `vm` context with only `{ window: {}, console }` — i.e. it has no
     evaluation-time DOM/global reference
6. `grep -n "innerHTML\|\.html(" WebPortal/modules/sales-reports/js/report-whatsapp-history.js` —
   report every hit and confirm each is a static string or a self-escaping shared helper.
7. `grep -n "delivery_error" WebPortal/modules/sales-reports/js/report-whatsapp-history.js` — must
   return hits, and confirm by inspection that no per-row failure text is read from `error` instead.
8. `grep -n "ReportWhatsappHistory" WebPortal/modules/sales-reports/js/report_editor.js` — must show
   `init()`, `setResendHandler(`, `load(` and `destroy()`, four call sites, and every identifier must
   match the API listed in deliverable 1 exactly.
9. `grep -n "ReportWhatsappSend" WebPortal/modules/sales-reports/js/report-whatsapp-history.js` — must
   return **nothing**: the history module reaches the send dialog only through `resendHandler`.
10. `grep -n "resend" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` — confirm the group
    appears in all of: the state initialiser, `pruneSelection`'s group array, `findCandidateByKey`,
    `renderBody`, the `loadSources` tail, `open()` and `init()`.

**Not verifiable from this checkout, and not to be claimed as verified**: the panel rendering in a
browser, a real re-send reaching a phone, the gateway's actual error text, and whether any given
database has these migrations applied. Say so.

## Out of scope

Any migration — `report_deliveries` and its RPCs are applied. The parity harness (part 5b). Changing
how a send works (`buildSendRecipients`, `summarizeSend`, `handleSend`, `ensureRecipientsSaved`,
`callSendEndpoint` are untouched). Any accessor for `pdfFileName`. Any scheduled or automatic send.
Editing or deleting delivery rows: the log is append-only by design. Any change to
`scripts/verify-report-whatsapp-picker.mjs`'s existing seven cases.

## Report

Under 30 lines: the premise-grep output, files changed, the states the panel distinguishes, how the
absent-preselect edge case behaves, how the re-send filename is obtained and where the
`published`-only gate sits, what happens when a preselect exceeds 25, verify results including the
picker test's status, an explicit list of what remains unverifiable, and anything in 03b's merged code
that contradicted this plan.
