---
notify: henry@customapp.co.za
retry_of: 49a9a251-8d45-42fa-a88d-a833f1cbea8f
---

# Report WhatsApp distribution, part 3b — the "Send via WhatsApp" dialog

## Why this replaces the earlier part 3

An earlier part 3 was blocked, then amended into a version scoped down against a checkout that did
not yet contain this feature's database foundation. That amendment's hard constraints — "do not
reference the action keys `reports.report.send` or `reports.recipient.manage`, they do not exist",
"there is no saved-recipient store in this repo", "`report_normalize_wa_phone` does not exist" —
were all **true when written** and are all **false now**. The foundation merged in `b3e6b66`
(PR #47), and the transport layer and edge function merged in `353056f` and `cc62758`.

A later attempt at this plan was itself blocked at diff review: the dialog it produced could never
open, because it showed the modal only through the jQuery plugin API (`$modal.modal('show')`), which
does not exist under the Bootstrap 5 bundle this portal loads. The button would have merged as a
visible, permission-gated control that did nothing. **Section "Opening and closing the modal" below
is the hard constraint that must not be violated again.**

**This plan is pushed alone**, with no `depends_on` and with nothing depending on it yet, because
it is the largest UI surface in this batch and its predecessors were blocked. Parts 4 and 5 follow
once this merges, written against this plan's *merged code* rather than its prose.

## Verify the premise before writing anything

Run these and put the output in your report. Do not skip this: the whole reason this plan exists is
that a previous version acted on a premise the checkout did not support.

```
grep -n "listReportRecipients:\|upsertReportRecipient:\|setReportRecipientActive:\|listReportDeliveries:\|sendReportWhatsapp:" WebPortal/js/data-functions.js
ls supabase/functions/send-report-whatsapp/
grep -rn "reports\.report\.send\|reports\.recipient\.manage" migrations/
grep -n "report_normalize_wa_phone" migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql
ls WebPortal/modules/sales-reports/js/
grep -n "bootstrap@\|jquery-" WebPortal/index.html
```

The first must return five hits, the next three must return hits, the fifth must show that no
`report-whatsapp-send.js` exists yet, and the sixth must show jQuery 3.7.1 plus the Bootstrap **5.x**
bundle. **If any of that differs, stop and report it.**

## Opening and closing the modal — the constraint this plan was blocked on

`WebPortal/index.html:552-553` loads **jQuery 3.7.1 and `bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js`
only**. Bootstrap 5 removed the jQuery plugin bridge, and nothing in this repo registers one — a
repo-wide grep for `$.fn.modal =` / `jQuery.fn.modal =` returns nothing. Therefore
`$('#someModal').modal('show')` is **dead code in this portal**: the call either throws or is skipped
by a `$.fn.modal` guard, and no dialog appears.

Mandatory shape for both show and hide (matching `report_list_grid.js:299-312`, which is in this same
module, and `modal_crm_contact.js:73-74`):

```js
function showModal() {
    var modalEl = document.getElementById('reportWhatsappSendModal');
    if (!modalEl) return;
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } else if (typeof $ !== 'undefined' && $.fn.modal) {
        $(modalEl).modal('show');           // legacy fallback only; unreachable under BS5
    }
}

function hideModal() {
    var modalEl = document.getElementById('reportWhatsappSendModal');
    if (!modalEl) return;
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        var inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
    } else if (typeof $ !== 'undefined' && $.fn.modal) {
        $(modalEl).modal('hide');
    }
}
```

Rules:

- The `bootstrap.Modal` branch is **primary**. The jQuery branch may only ever be a trailing
  `else if`. Shipping the jQuery branch alone is the exact defect that blocked this plan.
- `open()` must call `showModal()` — and it must do so **before or independently of** the source
  load, so a slow or failing RPC can never leave the operator staring at nothing.
- `bootstrap` and `document` may be referenced **only inside function bodies**, never at module
  evaluation time (see "Unit-testability" below).
- Cancel and the header close button keep working through `data-bs-dismiss="modal"`, which is native
  Bootstrap 5 data-API and needs no JS.

## Grounding — verified against this checkout

### The five wrappers, all merged and available

`WebPortal/js/data-functions.js`: `sendReportWhatsapp` :6269, `listReportRecipients` :6344,
`upsertReportRecipient` :6361, `setReportRecipientActive` :6386, `listReportDeliveries` :6402.
Read each one before calling it. **Use these exact signatures — do not guess:**

- `sendReportWhatsapp(payload, token = null)` where `payload` is
  `{ reportInstanceId, pdfBase64, filename, recipients }`.
- `listReportRecipients(includeInactive = false, token = null, forceRefresh = false)` — so a forced
  re-list is `listReportRecipients(false, null, true)`.
- `upsertReportRecipient(displayName, phone, source = 'manual', options = {}, token = null)` where
  `options` is `{ contactId, conversationId, notes }`.

Three behaviours matter here:

- **`sendReportWhatsapp` THROWS** on a missing `reportInstanceId`, `pdfBase64`, a `.pdf`-suffixed
  `filename`, or a non-empty `recipients` array with a non-empty `phone` on every entry. It
  **returns** `{ success: false, error }` for a missing session, a non-OK HTTP response and any
  fetch exception. **So wrap the call in try/catch AND check the returned object** — one alone is not
  enough.
- **`listReportRecipients` already returns `phone` normalised** to `+27…` form: the RPC selects
  `public.report_normalize_wa_phone(r.phone)` (migration :185), not the raw column. Do not normalise
  it again.
- **`upsertReportRecipient` de-duplicates server-side** on the normalised number and reactivates an
  existing row instead of inserting a duplicate. So it can return the id of a row you did not know
  existed. That is intended — do not add a client-side existence check.

### The edge function is merged, so its contract is readable, not guessable

`supabase/functions/send-report-whatsapp/index.ts` (528 lines). **Read it.** Its real responses,
which this dialog must present meaningfully rather than collapsing into "failed":

| Status | `error` string | What the operator needs to be told |
| --- | --- | --- |
| 401 | `Authentication required.` / `Invalid or expired session. Please sign in again.` | Sign in again |
| 403 | `You do not have permission to send reports.` | Not their role |
| 409 | `Only a published report can be sent.` | Should be unreachable — this dialog only opens on a published report |
| 404 | `Report not found.` | The report was deleted under them |
| 400 | `recipients must not exceed 25 entries.` etc. | A client-side cap should prevent this |
| 503 | `WhatsApp not yet connected — …` | Secrets not set on this project |
| 502 | `Failed to store the report PDF.` / `Failed to create a delivery link…` | Storage problem, retryable |

`MAX_RECIPIENTS = 25` at :61 — mirror that cap client-side so the server's 400 is unreachable in
normal use, and say so in the UI when the cap is hit.

**Each recipient object is read at `index.ts:380-389` as `{ phone, display_name, recipient_id }`.**
`recipient_id` is passed straight through to `begin_report_delivery` as `p_recipient_id` (:396). If
it is omitted, `report_deliveries.recipient_id` is NULL and the delivery log can never be joined
back to a saved recipient — which is exactly the data part 4 is planned against. **Sending
`recipient_id` for every recipient that has one is a requirement of this plan, not an optimisation.**

On success it returns **200** with
`{ success: true, sent, failed, pdf_storage_path, link_expires_at, results }`, where each `results`
row is `{ phone, display_name, status, external_message_id, error }` and **`status` is only `'sent'`
or `'failed'`** (the TS type at :200-206). There is no `'skipped'` — a delivery-log failure is
recorded as `'failed'` with its own error text. It returns 200 **even when every send failed**;
`success: true` describes the request, not the outcome. **Do not read `success: true` as "it was
delivered."** Read `sent` / `failed` and the per-row statuses.

**Deployment status, stated honestly:** the function is committed in this checkout; whether it is
deployed to any project cannot be verified from here. So the dialog must handle a `404` /
`HTTP 404` from an undeployed endpoint as a plain, visible failure. **Do not fake success, do not
swallow it, and do not assert in a comment that the function is live.**

### Recipient sources — three, all with different failure contracts

1. **Saved recipients** — `listReportRecipients(false, null, forceRefresh)`. Rows:
   `{ success, error, id, display_name, phone, source, contact_id, conversation_id, is_active, notes, last_sent_at, created_at }`
   (migration :162-175). Throws on RPC failure (it does not return an empty list), so a `try/catch`
   is required. The row's `id` is the `recipient_id` the edge function wants.
2. **Shared WhatsApp inbox** — `chatListWhatsappConversations(userId)` at :5761. **Returns `null`** —
   not an error, not `[]` — when the RPC is absent from the database (`_whatsappInboxAvailable === false`).
   Rows come from `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:331-344`:
   `success`, `error`, `conversation_id`, `external_phone`, `profile_name`, `other_party_name`, …
   `other_party_name` falls back company → contact → profile → formatted phone → `'Unknown number'`
   (same file, :371-377), so it is never blank — use it as the label. The RPC can also return a
   single row with `success = 0`; **skip any row whose `success` is `0`.**
3. **CRM contacts** — `getContactsForMessaging()` at :5723. From
   `migrations/20260812100000_crm_whatsapp_module.sql:516-540`. Rows:
   `{ id, contact_type, company_name, primary_contact_name, primary_contact_phone, primary_contact_mobile }`.
   **It returns `[]` in BOTH the no-rows path and the catch path (:5729-5733) — it can never return
   `null`.**

   So: do **not** write a `null` branch for the CRM source and do **not** show it a
   "source unavailable" note. The `null`-means-unavailable contract is **specific to
   `chatListWhatsappConversations`**. Conflating the two is what got an earlier version of this plan
   blocked. There are no secondary-contact fields on this RPC even though the columns exist on
   `public.contacts` — do not invent them.

### The near-duplicate to model on — and the defects not to copy

`WebPortal/modules/crm-whatsapp/js/crm_whatsapp_contacts_tab.js` (670 lines) is the closest existing
thing in this repo and **must be read before writing**. It already does the two-source load this
dialog extends: `getContactsForMessaging()` at :173 and `chatListWhatsappConversations(currentUserId)`
at :216-217, behind an `if (dataFunctions.chatListWhatsappConversations)` existence guard. It escapes
every interpolated value through a local `escapeHtml` (:28-30) delegating to
`_common.escapeHtml` (`WebPortal/js/common.js:254`), which is a legitimate escaping route in this
repo.

**Three defects in it must NOT be copied:**

1. It has no `destroy()` at all (grep returns nothing).
2. Its bindings are not consistently namespaced/torn down.
3. **It opens and closes its modal through the dead jQuery plugin only** —
   `$('#newContactChatModal').modal('show')` at :125 and `.modal('hide')` at :197. Under the
   Bootstrap 5.3.0 bundle this portal loads, those calls do nothing. Copying that line is what
   blocked the previous attempt at this plan. Use the `bootstrap.Modal` form above instead.

So:

- Model the **data loading and escaping** on `crm_whatsapp_contacts_tab.js`.
- Model the **lifecycle hygiene** on `report_list_grid.js:1-15`: a real `destroy()`, every binding
  namespaced, `init()` calling `destroy()` first so a second invocation cannot double-bind.
- Model the **modal show/hide** on `report_list_grid.js:293-312`.

Do not copy the contacts tab wholesale, and rename every id copied from a reference file to the
`reportWhatsappSend*` prefix — no id from `report_list.html` or the contacts tab may survive into
this markup.

### `data-action-perm` is inert on dynamic markup

`WebPortal/js/appRouter.js:250-257` calls `actionAccess.apply(root)` **once**, ~100ms after module
load, over `#content-area`. Markup injected later is never swept. `actionAccess.apply`
(`WebPortal/js/action-access.js:65-89`) hides a denied element by setting inline
`el.style.display = 'none'`, which a later `toggleClass('d-none', …)` cannot clear. So:

- The **static** toolbar button in `report_editor.html` may carry
  `data-action-perm="reports.report.send"`, as the Publish button already carries
  `data-action-perm="reports.report.publish"` (`report_editor.html:20-21`). It lives inside the
  module HTML injected into `#content-area`, so it *is* swept.
- Every control **inside the dialog** is rendered at open time and must be gated by calling
  `hasAction('reports.recipient.manage')` inline at render time
  (`WebPortal/js/action-access.js:95` defines `window.hasAction`). Treat a missing `hasAction`
  (`typeof hasAction !== 'function'`) as **denied**, never as allowed.

Both action keys exist and are granted to `super_user`, `admin`, `Sales Exec` and
`Palladium Manager` by `migrations/20260822090200_report_whatsapp_send_rbac.sql`. Whether any
migration has been applied to a given database cannot be verified from this checkout — do not claim
it has.

### The report editor's existing shape

`WebPortal/modules/sales-reports/js/report_editor.js`: `state.payload` holds the
`get_report_instance` payload; `state.reportId` holds the instance id (:719); status drives the
Publish/Re-issue buttons at :160-162; `displayLabel()` at :39; `pdfFileName(payload)` at :1063
already produces a name that satisfies the edge function's filename allowlist; `ensurePdfMake()` at
:1054 lazy-loads pdfmake 0.2.10 + `vfs_fonts`; `handleDownloadPdf()` at :1069 shows the working
build sequence, including the `typeof ReportPdfBuilder === 'undefined'` guard at :1074. Bindings are
namespaced `.reportEditor` and removed in `destroy()`.

The dialog pattern for this feature is an **inline Bootstrap modal in the module's own HTML file** —
`WebPortal/modules/sales-reports/html/report_list.html:73-113` already does this for the New Report
dialog. Do **not** add a `modals/` route entry to `appRouteConfig.json`; those entries
(e.g. `crm-contact-modal`) are full-route navigations that replace `#content-area`, which is the
wrong mechanism for a dialog opened over the editor.

### Status pills

`MacStatus.pill(status)` (`WebPortal/js/mac-status.js:61-64`) escapes its own label. Its `TONE_MAP`
maps `sent` → `info` (:27) and `failed` → `danger` (:33); both are covered, and the exact tone is
whatever the map says — do not restyle it.

## Deliverables

### 1. New file `WebPortal/modules/sales-reports/js/report-whatsapp-send.js`

IIFE assigning one global, `ReportWhatsappSend`, with `init()`, `destroy()`, `open(options)` and
`setPdfProvider(fn)`. Bindings namespaced `.reportWhatsappSend`; `init()` calls `destroy()` first.

**Global exposure (required for the unit check):** assign the IIFE result to a bare
`var ReportWhatsappSend = …` **and** additionally, at the end of the file,
`if (typeof window !== 'undefined') { window.ReportWhatsappSend = ReportWhatsappSend; }`. Nothing at
module evaluation time may touch `$`, `document`, `bootstrap`, `Swal`, `MacStatus` or
`dataFunctions` — every such reference lives inside a function body, so the file loads in a bare
`vm` context.

`open(options)` takes `{ reportInstanceId, filename, periodLabel, getPdfBase64 }` where
`getPdfBase64` returns a `Promise<string>`. It is **injected**, not implemented here, so this file
carries no pdfmake reference — the loader and doc-definition call already live in `report_editor.js`.
Also expose `setPdfProvider(fn)` storing the same provider at module scope, so part 4 can trigger a
send without the dialog having been opened. (Part 4 is not in this plan; the hook is, because adding
it later would mean editing this file again.)

Behaviour:

1. **Show the modal first** via the `showModal()` shape mandated above (`bootstrap.Modal.getOrCreateInstance(...).show()`
   primary), render a loading state, then load all three sources concurrently with `Promise.all`,
   **each individually guarded** so one failing source cannot blank the dialog:
   - saved: `listReportRecipients(false, null, forceRefresh)` in a try/catch → on throw, show a muted
     "Saved recipients could not be loaded" line in that group only.
   - inbox: `chatListWhatsappConversations(dataFunctions.getCurrentUserId())` → `null` means
     unavailable; show a muted one-line note. Skip rows with `success === 0`.
   - CRM: `getContactsForMessaging()` → `[]` means "No CRM contacts found." **No null branch.**
2. Render three groups — "Saved recipients", "From WhatsApp inbox", "From CRM contacts" — each row a
   checkbox with a label and the number.
3. **De-duplicate across groups on a normalised comparison key.** A saved recipient wins; the other
   groups' copy of that number is not rendered. The key must mirror
   `public.report_normalize_wa_phone`
   (`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:46-66`) **exactly**:

   ```
   strip every non-digit
   if the result is empty            -> return null
   if it starts with '0'             -> replace that leading '0' with '27'
   else if it does not start with '27'
        and its length <= 11          -> prefix '27'
   return '+' + digits
   ```

   Note the `'+'` prefix and the `null` on empty. This is **not** the same as
   `public.chat_normalize_phone`
   (`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92`), which returns bare digits
   with no `'+'`. Both exist; only the first is right here, because it is what the saved-recipient
   list's `phone` values already went through.

   Expose this helper on the global as `ReportWhatsappSend._normalizeKey` so it is unit-testable. Add
   a comment naming it as one of the copies `scripts/verify-report-whatsapp-parity.mjs` will police
   in a later plan.

   **Send each number exactly as its source gave it** — never the normalised form. The server
   normalises, and two normalisers that disagree is the whole hazard here.
4. Skip any candidate whose key is `null` or shorter than 11 characters (matching
   `upsert_report_recipient`'s own `length(v_phone) < 11` rejection at migration :224), and report
   the count in a muted line. **The counter aggregates all three sources, so its wording must not
   blame one of them.** Use source-neutral wording, e.g. `"3 entries were hidden — no usable
   WhatsApp number."` A CRM contact with an empty `primary_contact_mobile` is common and must never
   render as a selectable row with a blank number. An inbox row dropped for `success === 0` is a
   "no access" signal, **not** a missing number — it must not increment this counter.
5. An "Add a number" sub-form (name + number), rendered **only when
   `hasAction('reports.recipient.manage')` is true**, checked inline at render time. On submit call
   `upsertReportRecipient(name, phone, 'manual')`, then re-list with
   `listReportRecipients(false, null, true)`. The RPC returns `TABLE(success int, error text, id uuid)`
   (migration :210) — read the first row through a small `firstRpcRow(raw)` helper that copes with
   an array or a bare object. Surface a `success = 0` row's own `error` verbatim — the RPC returns
   "A display name is required." and "A valid phone number is required.", which are better messages
   than anything invented here.
6. Footer with the selected count; Send disabled at zero selected or while a send is in flight. Cap
   selection at **25** to match `MAX_RECIPIENTS`, and say so when the cap is hit.
7. **Selection must never outlive visibility.** `state.selected` survives a re-render, but a
   candidate is only re-checked if its group renders again. If a source degrades between renders
   (the inbox flips to its `null` note after the operator selected from it, or `listReportRecipients`
   throws on the post-add refresh), a selection could stay counted — and be sent — with no visible
   checkbox. So after **every** render pass, run a pure helper
   `ReportWhatsappSend._pruneSelection(selected, lists)` that drops any selected key not present in
   the freshly rendered `lists.saved` / `lists.inbox` / `lists.crm`, refreshes the stored candidate
   object for keys that survive (so a newly-saved row's `recipientId` is picked up), and returns the
   pruned map. Update the footer from the pruned map. A confidential report must never be sent to a
   recipient the operator can no longer see.
8. On Send:
   - Disable the button, show a spinner, keep the modal open.
   - `getPdfBase64()` → on rejection, show an error naming that the PDF could not be built and
     **do not call the endpoint**.
   - Strip a leading `data:` prefix defensively: if the string matches `/^data:[^;]*;base64,/`,
     remove it. pdfmake's `getBase64` is documented to yield bare base64 but **nothing in this
     checkout calls it**, so treat that as unconfirmed and handle both. The edge function's
     `BASE64_RE` (`index.ts:56`) rejects a `data:` prefix outright, so not stripping would fail every
     send with a confusing 400.
   - For each selected row from the inbox or CRM that is not already saved, and only if
     `hasAction('reports.recipient.manage')`, call `upsertReportRecipient(displayName, phone, source,
     { contactId, conversationId })` with the right `source` (`'whatsapp_chat'` with its
     `conversationId`, or `'crm_contact'` with its `contactId`). **Capture the returned row's `id`
     onto that candidate as `recipientId`** — that is how a freshly-saved recipient reaches the
     delivery log. **A save failure is non-fatal** — log it, leave `recipientId` unset, and send
     anyway; the delivery log records the number either way. This step must complete (all promises
     settled) before the recipients payload is built.
   - Build the payload with a pure helper `ReportWhatsappSend._buildSendRecipients(candidates)`
     returning one object per candidate: `{ phone, display_name }`, **plus `recipient_id` whenever
     the candidate has a `recipientId`** — omit the key entirely when it does not (the edge function
     null-checks it at :386-389). `phone` is the source's original string, never the normalised key.
   - Call `sendReportWhatsapp({ reportInstanceId, pdfBase64, filename, recipients })` inside
     `try/catch`, and also check the returned object.
   - **Separate the network failure path from the rendering path.** The "Could not reach the send
     endpoint. Please try again." message may be shown **only** for a rejection of the
     `sendReportWhatsapp` call itself (or of the steps before it). Once a response object is in hand,
     all result rendering and event firing happen in their own `try/catch`; a failure there logs and
     shows a distinct, non-retry-suggesting message ("The messages were submitted, but the results
     could not be displayed"). An operator must never be told to re-send a report that was already
     delivered.
   - Render `results` in place: one row per recipient, status via `MacStatus.pill(r.status)`, and the
     row's own `error` shown verbatim when present. Guard with `Array.isArray(res.results)`; if it is
     absent, show a summary line built from `sent` / `failed` instead of assuming a shape.
   - Show a summary line reading from `sent` and `failed`, **not** from `success`, via a pure helper
     `ReportWhatsappSend._summarizeSend(resp)` returning `{ sent, failed, text, tone }` where `tone`
     is a Bootstrap alert suffix (`success` / `warning` / `danger`) and is **never** `'success'` when
     `failed > 0 && sent === 0`.
   - On `{ success: false }`, show its `error` verbatim in `Swal.fire({ icon: 'error' })` and leave
     the selection intact so the operator can retry. If the endpoint is not deployed, that message
     is what tells them so.
   - Fire a `document` event **without a jQuery namespace suffix**:
     `$(document).trigger('reportWhatsappSend:completed', [{ reportInstanceId: … }])`, so a later part
     can refresh without this file knowing it exists. A namespaced *trigger* would only reach handlers
     bound under that same namespace — precisely the handlers `destroy()` would strip.
9. **`destroy()` must unbind only this module's own bindings.** Turn off the `.reportWhatsappSend`
   namespace on the elements this file binds (`#reportWhatsappSendSubmitBtn`,
   `#reportWhatsappSendBody`, the add-form controls). **Do not call `$(document).off('.reportWhatsappSend')`
   or any other blanket `document` off** — this file binds nothing on `document`, and a blanket off
   would silently unbind a part-4 listener registered under the same namespace when the editor tears
   down.

### 2. `WebPortal/modules/sales-reports/html/report_editor.html`

- A toolbar button after Download PDF (`report_editor.html:17-19`): `id="reportEditorSendWhatsappBtn"`,
  `class="btn btn-outline-success d-none"`, `data-action-perm="reports.report.send"`, a
  `fa-paper-plane` icon, label "Send via WhatsApp". Starts `d-none`; the editor reveals it.
- `#reportWhatsappSendModal` markup at the end of the file, modelled on `report_list.html:73-113`
  (`data-bs-backdrop="static"`, `data-bs-keyboard="false"`, a footer with a
  `data-bs-dismiss="modal"` Cancel and a `btn-close` header button). Every id must be renamed to the
  `reportWhatsappSend*` prefix — no id copied from `report_list.html` may survive. **Empty containers
  only** — every group list, the add-number sub-form and the results list are populated by JS, and no
  database value appears in static markup.

### 3. `WebPortal/modules/sales-reports/js/report_editor.js`

Three small changes; do not otherwise refactor, and leave `handleDownloadPdf` alone.

- Where status toggles Publish/Re-issue (:160-162), reveal the new button **only** when
  `payload.status === 'published'`. A draft must not be sendable — the PDF builder watermarks a draft
  and the edge function refuses a non-published report with 409, so hiding it keeps the UI honest
  rather than offering a call that will fail. `superseded` is not sendable either. Use the same
  `toggleClass('d-none', status !== 'published')` idiom; a role denied `reports.report.send` stays
  hidden regardless, because `actionAccess.apply` set an inline `display:none` a class toggle cannot
  clear.
- A `.reportEditor`-namespaced click handler on `#reportEditorSendWhatsappBtn` calling
  `ReportWhatsappSend.open({ reportInstanceId: state.reportId, filename: pdfFileName(state.payload),
  periodLabel: displayLabel(state.payload.period_label), getPdfBase64: pdfBase64 })`, guarded with
  `typeof ReportWhatsappSend !== 'undefined'` (and a `state.payload` check) in the same style as the
  existing `typeof ReportPdfBuilder === 'undefined'` guard at :1074. In `init()`, call
  `ReportWhatsappSend.init()` and register the provider once via
  `ReportWhatsappSend.setPdfProvider(pdfBase64)` behind the same guard; in `destroy()`, call
  `ReportWhatsappSend.destroy()` behind the same guard.
- The provider itself. **This exact sketch, which returns its promise rather than relying on a bare
  callback:**

  ```js
  function pdfBase64() {
      return ensurePdfMake().then(function () {
          if (typeof ReportPdfBuilder === 'undefined' || !ReportPdfBuilder.buildReportDocDefinition) {
              throw new Error('builder-missing');
          }
          var docDefinition = ReportPdfBuilder.buildReportDocDefinition(state.payload);
          return new Promise(function (resolve, reject) {
              try {
                  pdfMake.createPdf(docDefinition).getBase64(function (b64) {
                      if (b64) { resolve(b64); } else { reject(new Error('pdf-empty')); }
                  });
              } catch (e) {
                  reject(e);
              }
          });
      });
  }
  ```

  Both `return`s and the `resolve` inside the callback are load-bearing: `getBase64` is
  callback-style and returns nothing, so without this wrapper an `await` on it resolves to
  `undefined` and the send posts an empty PDF. The identifier is `pdfBase64` — reference it by that
  exact name at both call sites (the click handler's `getPdfBase64` option and `setPdfProvider`).

### 4. `WebPortal/js/appRouteConfig.json`

Add `"js/report-whatsapp-send.js"` to the `sales-report-editor` route's `js` array, **before**
`js/report_editor.js` — the same ordering reason `report-pdf-builder.js` precedes it today. Change
nothing else. `npm run registry:verify` requires every path here to exist.

## Security invariants to state in the code, not infer

- **Every value from the database or the gateway reaches the DOM escaped.** Display names come from
  CRM rows and WhatsApp profile names; `error` strings come from a third-party gateway. Use `.text()`
  or `_common.escapeHtml` (`WebPortal/js/common.js:254`) on every interpolation — never raw
  concatenation, and never an HTML-built `title=`/`data-` attribute. The only permitted `.html()`
  calls are a literal static string, a re-applied `originalHtml` captured from static markup, and
  `MacStatus.pill()` (which escapes its own label).
- **No value is assigned into a URI sink.** Nothing here sets `img.src`, `href`, `iframe.src` or
  `location` from a payload value. The signed URL never reaches the browser — the edge function
  deliberately excludes it from the response (:516-527) — so there is nothing to link to. Do not add
  a link to the stored PDF.
- **Never `console.log` the base64 PDF.** Log its length if you need a diagnostic.
- **Deny by default on permissions:** `typeof hasAction !== 'function'` means denied.
- The send is gated twice on purpose: `data-action-perm` on the static button, and the edge
  function's own `has_action` 403. Neither replaces the other.

## Verify before finishing

1. The premise greps above, with output.
2. `npm run test:fleet` passes — it includes `routing:verify`, `username:verify`,
   `verify-phase2-migrations.mjs`, `ui:verify` (no raw hex outside `WebPortal/css/design-tokens.css`),
   `migrations:verify`, `registry:verify`, `reports:verify` and `report-whatsapp-payload:verify`.
   **Append the new script to the end of the chain only.** Do not reorder, weaken, remove or
   otherwise touch any existing step, and do not delete or empty any existing test file. Add no new
   hex; use existing tokens or Bootstrap utilities.
3. `node --check` on both changed/added JS files exits 0, and
   `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
4. **A pure-Node unit check**, `scripts/verify-report-whatsapp-picker.mjs`, wired into `test:fleet`
   as `report-whatsapp-picker:verify`. Follow `scripts/verify-report-rendering.mjs` — **read it
   first**: it loads a module into a bare `vm` context with `{ window: {}, console }` (:45-50) and
   asserts against literal fixtures. Read the module out as
   `ctx.ReportWhatsappSend || (ctx.window && ctx.window.ReportWhatsappSend)` and throw a clear error
   if neither is defined. Collect failures and `process.exit(1)` on any. Assert:
   - `_normalizeKey` maps `'0821234567'`, `'27821234567'`, `'+27 82 123 4567'`, `'(082) 123-4567'`
     and `'821234567'` all to `'+27821234567'`; `''`, `'   '` and `'abc'` to a falsy value
   - de-duplication: a saved recipient on `0821234567` plus a CRM contact on `+27821234567` yields
     **one** row, and it is the saved one
   - a CRM row with an empty `primary_contact_mobile` is excluded and counted as skipped
   - an inbox row with `success === 0` is excluded and **not** counted as skipped
   - `_pruneSelection`: a selected inbox key that is absent from the newly rendered lists is dropped;
     a selected saved key that is still present survives and picks up the refreshed candidate
   - `_buildSendRecipients`: a saved candidate carrying `recipientId` produces an object whose
     `recipient_id` equals that id, and a candidate without one produces an object with **no**
     `recipient_id` key; in both cases `phone` is the source's original string, not the normalised key
   - `_summarizeSend`: `{ sent: 1, failed: 1 }` reads 1 sent / 1 failed, and
     `{ success: true, sent: 0, failed: 2 }` yields a tone that is **not** `'success'`

   Every identifier asserted here (`_normalizeKey`, `_buildCandidateLists`, `_pruneSelection`,
   `_buildSendRecipients`, `_summarizeSend`) must be exported under exactly these names by
   deliverable 1. Before finishing, grep the new module for each one and confirm the spelling matches.
5. `grep -n "innerHTML\|\.html(" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` — report
   every hit and confirm each is either a static string or passes through an escaping helper.
6. `grep -n "chat_normalize_phone" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` must
   return **nothing** — proving the wrong normaliser was not mirrored.
7. `grep -n "bootstrap.Modal" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` must return
   **at least two hits** (a show path and a hide path), and every `.modal('show')` / `.modal('hide')`
   hit, if any, must sit in a trailing `else if` after a `bootstrap.Modal` branch. Report the output.
8. `grep -n "\$(document).off" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` must
   return **nothing**.
9. `grep -n "recipient_id" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` must return at
   least one hit, in the payload builder.

**What cannot be verified from this checkout, and must not be claimed as verified:** the modal
rendering in a browser, pdfmake producing real bytes, whether any migration or the edge function is
deployed to any project, and any actual delivery. Say which parts remain unproven rather than
describing them as working.

## Out of scope

The delivery-history panel and re-send (part 4). The parity harness (part 5). Any migration — the
schema is committed. Any change to the edge function or to `data-functions.js`. Attaching the PDF as
a WhatsApp document instead of a link — that contract is unconfirmed and belongs to a later plan.
Refactoring existing modules that use the dead jQuery modal API (e.g. `crm_whatsapp_contacts_tab.js`) —
note it in the report, do not fix it here.

## Report

Under 30 lines: the premise-grep output, files changed, how each of the three sources behaved in the
unit checks, the verify results (including greps 7, 8 and 9 verbatim), an explicit list of what
remains unverifiable from the checkout, and anything in the merged code that contradicted this plan.
