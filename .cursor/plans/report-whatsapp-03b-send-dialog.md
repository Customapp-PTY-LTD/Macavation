---
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 3b — the "Send via WhatsApp" dialog

## Why this replaces the earlier part 3

An earlier part 3 was blocked, then amended into a version scoped down against a checkout that did
not yet contain this feature's database foundation. That amendment's hard constraints — "do not
reference the action keys `reports.report.send` or `reports.recipient.manage`, they do not exist",
"there is no saved-recipient store in this repo", "`report_normalize_wa_phone` does not exist" —
were all **true when written** and are all **false now**. The foundation merged in `b3e6b66`
(PR #47), and the transport layer and edge function merged in `353056f` and `cc62758`.

That earlier version would have shipped a dialog with no permission gate on the send button and no
saved recipients, so every send meant re-picking from the inbox and CRM. This plan is written against
what is actually on `dev` now.

**This plan is pushed alone**, with no `depends_on` and with nothing depending on it yet, because
it is the largest UI surface in this batch and its two predecessors were both blocked. Parts 4 and 5
follow once this merges, written against this plan's *merged code* rather than its prose.

## Verify the premise before writing anything

Run these and put the output in your report. Do not skip this: the whole reason this plan exists is
that a previous version acted on a premise the checkout did not support.

```
grep -n "listReportRecipients:\|upsertReportRecipient:\|setReportRecipientActive:\|listReportDeliveries:\|sendReportWhatsapp:" WebPortal/js/data-functions.js
ls supabase/functions/send-report-whatsapp/
grep -rn "reports\.report\.send\|reports\.recipient\.manage" migrations/
grep -n "report_normalize_wa_phone" migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql
ls WebPortal/modules/sales-reports/js/
```

The first must return five hits, the next three must return hits, and the last must show that no
`report-whatsapp-send.js` exists yet. **If any of that differs, stop and report it.**

## Grounding — verified against this checkout and the dev database

### The five wrappers, all merged and available

`WebPortal/js/data-functions.js`: `sendReportWhatsapp` :6269, `listReportRecipients` :6344,
`upsertReportRecipient` :6361, `setReportRecipientActive` :6386, `listReportDeliveries` :6402.
Read each one before calling it. Three behaviours matter here:

- **`sendReportWhatsapp` THROWS** on a missing `reportInstanceId`, `pdfBase64`, a `.pdf`-suffixed
  `filename`, or a non-empty `recipients` array with a non-empty `phone` on every entry. It
  **returns** `{ success: false, error }` for a missing session, a non-OK HTTP response and any
  fetch exception. **So wrap the call in try/catch AND check the returned object** — one alone is not
  enough.
- **`listReportRecipients` already returns `phone` normalised** to `+27…` form: the RPC selects
  `public.report_normalize_wa_phone(r.phone)`, not the raw column. Do not normalise it again.
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

On success it returns **200** with
`{ success: true, sent, failed, pdf_storage_path, link_expires_at, results }`, where each `results`
row is `{ phone, display_name, status, external_message_id, error }` and **`status` is only `'sent'`
or `'failed'`** (the TS type at :202-204). There is no `'skipped'` — a delivery-log failure is
recorded as `'failed'` with its own error text. It returns 200 **even when every send failed**;
`success: true` describes the request, not the outcome. **Do not read `success: true` as "it was
delivered."** Read `sent` / `failed` and the per-row statuses.

**Deployment status, stated honestly:** as of writing this plan the function is committed but **not
deployed** to the dev project (`supabase functions list` does not show it). A human deploy step is
pending and may or may not have happened by the time this runs. So the dialog must handle a `404` /
`HTTP 404` from an undeployed endpoint as a plain, visible failure. **Do not fake success, do not
swallow it, and do not assert in a comment that the function is live** — you cannot verify that from
here.

### Recipient sources — three, all with different failure contracts

1. **Saved recipients** — `listReportRecipients(false)`. Rows:
   `{ success, error, id, display_name, phone, source, contact_id, conversation_id, is_active, notes, last_sent_at, created_at }`.
   Throws on RPC failure (it does not return an empty list), so a `try/catch` is required.
2. **Shared WhatsApp inbox** — `chatListWhatsappConversations(userId)` at :5761. **Returns `null`** —
   not an error, not `[]` — when the RPC is absent from the database (`_whatsappInboxAvailable === false`).
   Rows come from `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:331-344`:
   `external_phone`, `profile_name`, `other_party_name`, `conversation_id`, plus `success`/`error`.
   `other_party_name` falls back company → contact → profile → formatted phone → `'Unknown number'`
   (same file, :371-377), so it is never blank — use it as the label. The RPC can also return a
   single row with `success = 0`; **skip any row whose `success` is `0`.**
3. **CRM contacts** — `getContactsForMessaging()` at :5723. From
   `migrations/20260812100000_crm_whatsapp_module.sql:516-540`. Rows:
   `{ id, contact_type, company_name, primary_contact_name, primary_contact_phone, primary_contact_mobile }`.
   **It returns `[]` in BOTH the no-rows path and the catch path — it can never return `null`.**

   So: do **not** write a `null` branch for the CRM source and do **not** show it a
   "source unavailable" note. The `null`-means-unavailable contract is **specific to
   `chatListWhatsappConversations`**. Conflating the two is what got an earlier version of this plan
   blocked. There are no secondary-contact fields on this RPC even though the columns exist on
   `public.contacts` — do not invent them.

### The near-duplicate to model on — and the one defect not to copy

`WebPortal/modules/crm-whatsapp/js/crm_whatsapp_contacts_tab.js` (670 lines) is the closest existing
thing in this repo and **must be read before writing**. It already does the two-source load this
dialog extends: `getContactsForMessaging()` at :173 and `chatListWhatsappConversations(currentUserId)`
at :216-217, behind an `if (dataFunctions.chatListWhatsappConversations)` existence guard. It escapes
every interpolated value through a local `escapeHtml` (:28-30) delegating to
`_common.escapeHtml` (`WebPortal/js/common.js:254`), which is a legitimate escaping route in this
repo.

**But it has no `destroy()` at all** (grep for it returns nothing). That is one of the three defects
`WebPortal/modules/sales-reports/js/report_list_grid.js:1-15` explicitly says it deliberately does
**not** copy from its own reference file. So:

- Model the **data loading and escaping** on `crm_whatsapp_contacts_tab.js`.
- Model the **lifecycle hygiene** on `report_list_grid.js:1-15`: a real `destroy()`, every binding
  namespaced, `init()` calling `destroy()` first so a second invocation cannot double-bind.

Do not copy the contacts tab wholesale.

### `data-action-perm` is inert on dynamic markup

CLAUDE.md states the router runs `actionAccess.apply` once, shortly after module load, over
`#content-area`; markup injected later is never swept. So:

- The **static** toolbar button in `report_editor.html` may carry
  `data-action-perm="reports.report.send"`, as the Publish button already carries
  `data-action-perm="reports.report.publish"` (`report_editor.html:20-21`).
- Every control **inside the dialog** is rendered at open time and must be gated by calling
  `hasAction('reports.recipient.manage')` inline at render time
  (`WebPortal/js/action-access.js:95`).

Both action keys exist and are granted to `super_user`, `admin`, `Sales Exec` and
`Palladium Manager` by `migrations/20260822090200_report_whatsapp_send_rbac.sql`. Verified against
dev: `has_action` returns `true` for a real `super_user` and a real `Sales Exec`.

### The report editor's existing shape

`WebPortal/modules/sales-reports/js/report_editor.js`: `state.payload` holds the
`get_report_instance` payload; status drives the Publish/Re-issue buttons at :160-162;
`pdfFileName(payload)` at :1060-1067 already produces a name that satisfies the edge function's
filename allowlist; `ensurePdfMake()` at :1054-1058 lazy-loads pdfmake 0.2.10 + `vfs_fonts`;
`handleDownloadPdf()` at :1069-1088 shows the working build sequence. Bindings are namespaced
`.reportEditor` and removed in `destroy()`.

The dialog pattern for this feature is an **inline Bootstrap modal in the module's own HTML file** —
`WebPortal/modules/sales-reports/html/report_list.html:73-108` already does this for the New Report
dialog. Do **not** add a `modals/` route entry to `appRouteConfig.json`; those entries
(e.g. `crm-contact-modal` at :233) are full-route navigations that replace `#content-area`, which is
the wrong mechanism for a dialog opened over the editor.

## Deliverables

### 1. New file `WebPortal/modules/sales-reports/js/report-whatsapp-send.js`

IIFE assigning one global, `ReportWhatsappSend`, with `init()`, `destroy()`, `open(options)` and
`setPdfProvider(fn)`. Bindings namespaced `.reportWhatsappSend`; `init()` calls `destroy()` first.

`open(options)` takes `{ reportInstanceId, filename, periodLabel, getPdfBase64 }` where
`getPdfBase64` returns a `Promise<string>`. It is **injected**, not implemented here, so this file
carries no pdfmake reference — the loader and doc-definition call already live in `report_editor.js`.
Also expose `setPdfProvider(fn)` storing the same provider at module scope, so part 4 can trigger a
send without the dialog having been opened. (Part 4 is not in this plan; the hook is, because adding
it later would mean editing this file again.)

Behaviour:

1. Show the modal, render a loading state, then load all three sources concurrently with
   `Promise.all`, **each individually guarded** so one failing source cannot blank the dialog:
   - saved: `listReportRecipients(false)` in a try/catch → on throw, show a muted
     "Saved recipients could not be loaded" line in that group only.
   - inbox: `chatListWhatsappConversations(dataFunctions.getCurrentUserId())` → `null` means
     unavailable; show a muted one-line note. Skip rows with `success === 0`.
   - CRM: `getContactsForMessaging()` → `[]` means "No CRM contacts found." **No null branch.**
2. Render three groups — "Saved recipients", "From WhatsApp inbox", "From CRM contacts" — each row a
   checkbox with a label and the number.
3. **De-duplicate across groups on a normalised comparison key.** A saved recipient wins; the other
   groups' copy of that number is not rendered. The key must mirror
   `public.report_normalize_wa_phone`
   (`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`, section 1) **exactly**:

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

   Expose this helper on the global (e.g. `ReportWhatsappSend._normalizeKey`) so it is
   unit-testable. Add a comment naming it as one of the copies
   `scripts/verify-report-whatsapp-parity.mjs` will police in a later plan.

   **Send each number exactly as its source gave it** — never the normalised form. The server
   normalises, and two normalisers that disagree is the whole hazard here.
4. Skip any candidate whose key is `null` or shorter than 11 characters, and report the count in a
   muted line ("2 contacts have no usable mobile number"). A CRM contact with an empty
   `primary_contact_mobile` is common and must never render as a selectable row with a blank number.
5. An "Add a number" sub-form (name + number), rendered **only when
   `hasAction('reports.recipient.manage')` is true**, checked inline at render time. On submit call
   `upsertReportRecipient(name, phone, 'manual')`, then re-list with `forceRefresh = true`. Surface a
   `success = 0` row's own `error` verbatim — the RPC returns "A display name is required." and
   "A valid phone number is required.", which are better messages than anything invented here.
6. Footer with the selected count; Send disabled at zero selected or while a send is in flight. Cap
   selection at **25** to match `MAX_RECIPIENTS`, and say so when the cap is hit.
7. On Send:
   - Disable the button, show a spinner, keep the modal open.
   - `getPdfBase64()` → on rejection, show an error naming that the PDF could not be built and
     **do not call the endpoint**.
   - Strip a leading `data:` prefix defensively: if the string matches `/^data:[^;]*;base64,/`,
     remove it. pdfmake's `getBase64` is documented to yield bare base64 but **nothing in this
     checkout calls it**, so treat that as unconfirmed and handle both. The edge function's
     `BASE64_RE` rejects a `data:` prefix outright (:56), so not stripping would fail every send
     with a confusing 400.
   - For each selected row from the inbox or CRM that is not already saved, and only if
     `hasAction('reports.recipient.manage')`, call `upsertReportRecipient` with the right `source`
     (`'whatsapp_chat'` with its `conversation_id`, or `'crm_contact'` with its `contact_id`) so the
     next send is one click. **A save failure is non-fatal** — log it and send anyway; the delivery
     log records the number either way.
   - Call `sendReportWhatsapp({ reportInstanceId, pdfBase64, filename, recipients })` inside
     `try/catch`, and also check the returned object.
   - Render `results` in place: one row per recipient, status via `MacStatus.pill(r.status)`
     (`WebPortal/js/mac-status.js:61` — its map already covers `sent` at :27 and `failed` at :33), and
     the row's own `error` shown verbatim when present. Guard with `Array.isArray(res.results)`;
     if it is absent, show a summary line built from `sent` / `failed` instead of assuming a shape.
   - Show a summary line reading from `sent` and `failed`, **not** from `success`.
   - On `{ success: false }`, show its `error` verbatim in `Swal.fire({ icon: 'error' })` and leave
     the selection intact so the operator can retry. If the endpoint is not deployed, that message
     is what tells them so.
   - Fire a namespaced `document` event `reportWhatsappSend:completed` carrying the report instance
     id, so a later part can refresh without this file knowing it exists.

### 2. `WebPortal/modules/sales-reports/html/report_editor.html`

- A toolbar button after Download PDF: `id="reportEditorSendWhatsappBtn"`,
  `class="btn btn-outline-success d-none"`, `data-action-perm="reports.report.send"`, a
  `fa-paper-plane` icon, label "Send via WhatsApp". Starts `d-none`; the editor reveals it.
- `#reportWhatsappSendModal` markup at the end of the file, modelled on `report_list.html:73-108`
  (`data-bs-backdrop="static"`, `data-bs-keyboard="false"`, a footer with a
  `data-bs-dismiss="modal"` Cancel). **Empty containers only** — every group list, the add-number
  sub-form and the results list are populated by JS, and no database value appears in static markup.

### 3. `WebPortal/modules/sales-reports/js/report_editor.js`

Three small changes; do not otherwise refactor, and leave `handleDownloadPdf` alone.

- Where status toggles Publish/Re-issue (:160-162), reveal the new button **only** when
  `payload.status === 'published'`. A draft must not be sendable — the PDF builder watermarks a draft
  and the edge function refuses a non-published report with 409, so hiding it keeps the UI honest
  rather than offering a call that will fail. `superseded` is not sendable either.
- A `.reportEditor`-namespaced click handler on `#reportEditorSendWhatsappBtn` calling
  `ReportWhatsappSend.open({...})`, guarded with `typeof ReportWhatsappSend !== 'undefined'` in the
  same style as the existing `typeof ReportPdfBuilder === 'undefined'` guard at :1074. Register the
  provider once via `ReportWhatsappSend.setPdfProvider(pdfBase64)` at init, same guard.
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
  `undefined` and the send posts an empty PDF.

### 4. `WebPortal/js/appRouteConfig.json`

Add `"js/report-whatsapp-send.js"` to the `sales-report-editor` route's `js` array, **before**
`js/report_editor.js` — the same ordering reason `report-pdf-builder.js` precedes it today. Change
nothing else. `npm run registry:verify` requires every path here to exist.

## Security invariants to state in the code, not infer

- **Every value from the database or the gateway reaches the DOM escaped.** Display names come from
  CRM rows and WhatsApp profile names; `error` strings come from a third-party gateway. Use `.text()`
  or `_common.escapeHtml` (`WebPortal/js/common.js:254`) on every interpolation — never raw
  concatenation, and never an HTML-built `title=`/`data-` attribute.
- **No value is assigned into a URI sink.** Nothing here sets `img.src`, `href`, `iframe.src` or
  `location` from a payload value. The signed URL never reaches the browser — the edge function
  deliberately excludes it from the response (:517-519) — so there is nothing to link to. Do not add
  a link to the stored PDF.
- **Never `console.log` the base64 PDF.** Log its length if you need a diagnostic.
- The send is gated twice on purpose: `data-action-perm` on the static button, and the edge
  function's own `has_action` 403. Neither replaces the other.

## Verify before finishing

1. The premise greps above, with output.
2. `npm run test:fleet` passes — it now includes `report-whatsapp-payload:verify` as well as
   `ui:verify` (no raw hex outside `WebPortal/css/design-tokens.css`), `registry:verify`,
   `routing:verify` and `reports:verify`. Add no new hex; use existing tokens or Bootstrap utilities.
3. `node --check` on both changed/added JS files exits 0, and
   `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
4. **A pure-Node unit check**, `scripts/verify-report-whatsapp-picker.mjs`, wired into `test:fleet`.
   Follow `scripts/verify-report-rendering.mjs` — **read it first**: it loads a module into a bare
   `vm` context with `{ window: {}, console }` (:47-50) and asserts against literal fixtures. This
   file touches `window`/`document` at call time, so if it will not load that way, expose the pure
   helpers on the global and test those directly rather than weakening the assertions. Assert:
   - the normalise key maps `'0821234567'`, `'27821234567'`, `'+27 82 123 4567'`, `'(082) 123-4567'`
     and `'821234567'` all to `'+27821234567'`; `''`, `'   '` and `'abc'` to a falsy value
   - de-duplication: a saved recipient on `0821234567` plus a CRM contact on `+27821234567` yields
     **one** row, and it is the saved one
   - a CRM row with an empty `primary_contact_mobile` is excluded and counted as skipped
   - an inbox row with `success === 0` is excluded
   - a `results` array of `[{status:'sent'},{status:'failed'}]` produces a summary reading 1 sent /
     1 failed, and a response of `{ success: true, sent: 0, failed: 2 }` is **not** presented as a
     success
5. `grep -n "innerHTML\|\.html(" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` — report
   every hit and confirm each is either a static string or passes through `escapeHtml`.
6. `grep -n "chat_normalize_phone" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` must
   return **nothing** — proving the wrong normaliser was not mirrored.

**What cannot be verified from this checkout, and must not be claimed as verified:** the modal
rendering in a browser, pdfmake producing real bytes, and any actual delivery. The edge function may
also still be undeployed. Say which parts remain unproven rather than describing them as working.

## Out of scope

The delivery-history panel and re-send (part 4). The parity harness (part 5). Any migration — the
schema is applied. Any change to the edge function or to `data-functions.js`. Attaching the PDF as a
WhatsApp document instead of a link — that contract is unconfirmed and belongs to a later plan.

## Report

Under 30 lines: the premise-grep output, files changed, how each of the three sources behaved in the
unit checks, the verify results, an explicit list of what remains unverifiable from the checkout, and
anything in the merged code that contradicted this plan.
