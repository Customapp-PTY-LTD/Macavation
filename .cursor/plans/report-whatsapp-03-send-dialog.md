---
depends_on: report-whatsapp-01-data-functions.md
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 3 — the "Send via WhatsApp" dialog

## Context

Parts 1 and 2 give the report editor a transport layer and a server-side send endpoint. This plan is
the part a person actually uses: a button on a **published** report that opens a recipient picker,
and on confirm builds the report's PDF in the browser, hands it to the edge function, and shows what
happened to each number.

The recipient sources are the three the operator asked for — the numbers already in the shared
WhatsApp inbox, CRM contacts, and saved/typed entries — and all three already have RPCs and
`data-functions` wrappers. Nothing new is invented here.

## Why this waits on part 1

`depends_on: report-whatsapp-01-data-functions.md`. Part 1 adds the five wrappers this plan calls
into `WebPortal/js/data-functions.js`. Without them every call here is undefined.

`WebPortal/js/appRouteConfig.json` is a shared coordination file and this plan is the only one in
the batch that touches it. Part 4 waits on this plan for the same reason in reverse: it edits the
same `report_editor.html` / `report_editor.js` that this plan edits.

## Grounding — verified against this checkout

**The action keys exist and are already granted.**
`migrations/20260822090200_report_whatsapp_send_rbac.sql` seeds `reports.report.send` and
`reports.recipient.manage` for `super_user`, `admin`, `Sales Exec` and `Palladium Manager`, applied
to dev 2026-08-19.

**`data-action-perm` is inert on dynamically rendered markup.** CLAUDE.md states this outright: the
router runs `actionAccess.apply` a single time shortly after module load over `#content-area`, so
markup injected later is never swept. Therefore:

- The static "Send via WhatsApp" toolbar button in `report_editor.html` MAY carry
  `data-action-perm="reports.report.send"`, exactly as the existing Publish button carries
  `data-action-perm="reports.report.publish"` (`report_editor.html:22-24`).
- Every control rendered inside the dialog — which is populated at open time — MUST be gated by
  calling `hasAction('reports.recipient.manage')` inline at render time.
  `WebPortal/js/action-access.js:95` defines `window.hasAction = function (key) { return actionAccess.has(key); }`.
  CLAUDE.md notes this is what the existing dashboard code does.

**The report editor's existing shape** — `WebPortal/modules/sales-reports/js/report_editor.js`:

- `state.payload` holds the `get_report_instance` payload; `state.payload.status` is `'draft'`,
  `'published'` or `'superseded'` and drives the Publish/Re-issue buttons at :160-162.
- `pdfFileName(payload)` at :1060-1067 builds `Macavation-<sanitised period label>.pdf`, replacing
  every non-alphanumeric run with a dash. Reuse it; do not write a second one. Its output already
  satisfies the edge function's filename allowlist.
- `ensurePdfMake()` at :1054-1058 lazy-loads pdfmake 0.2.10 + `vfs_fonts` from jsDelivr, and its
  comment at :1023-1031 explains why they are not in `index.html` (~2.7 MB). Reuse it.
- `handleDownloadPdf()` at :1069-1088 shows the working sequence:
  `ensurePdfMake()` → guard `typeof ReportPdfBuilder === 'undefined'` →
  `ReportPdfBuilder.buildReportDocDefinition(state.payload)` → `pdfMake.createPdf(dd)`.
- Every handler is bound namespaced `.reportEditor` and removed in `destroy()` (:1096+). Match that.

**The dialog pattern for this feature is an inline Bootstrap modal in the module's own HTML file**,
not a router "modal route". `WebPortal/modules/sales-reports/html/report_list.html:73-108` already
does exactly this for the New Report dialog (`#newReportModal`, `data-bs-backdrop="static"`,
`data-bs-keyboard="false"`, a `modal-footer` with a `data-bs-dismiss="modal"` Cancel). Follow it.
Do NOT add an entry to `appRoutes` for a modal — the `crm-contact-modal` style entries in
`appRouteConfig.json:233` are full-route navigations that replace `#content-area`, which is the
wrong mechanism for a dialog opened over the editor.

**The module conventions** are written out at the top of
`WebPortal/modules/sales-reports/js/report_list_grid.js:1-15`, including three defects in its own
reference file that it deliberately does not copy: it has a real `destroy()`, every binding is
namespaced, `init()` calls `destroy()` first so a second invocation cannot double-bind, and **every
database value reaches the DOM only via `.text()` or an escaping helper** — never string-concatenated
into row HTML. Honour all four.

**The three recipient-source wrappers**, all already in `WebPortal/js/data-functions.js`:

- `listReportRecipients(includeInactive, token, forceRefresh)` — added by part 1. Rows:
  `{ success, error, id, display_name, phone, source, contact_id, conversation_id, is_active, notes, last_sent_at, created_at }`.
- `chatListWhatsappConversations(userId, token)` at :5761. **Returns `null`** — not an error and not
  an empty array — when the shared-inbox RPC is unavailable on the database
  (`_whatsappInboxAvailable === false`, :5751 and :5774-5776). Rows carry
  `external_phone`, `profile_name`, `other_party_name`, `conversation_id`, `last_message_at`.
  `other_party_name` is documented in
  `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql` as falling back contact name →
  WhatsApp profile name → phone, so it is never blank; prefer it as the label.
- `getContactsForMessaging(token)` at :5723-5733, from `get_contacts_for_messaging`
  (`migrations/20260812100000_crm_whatsapp_module.sql:516-538`). Rows:
  `{ id, contact_type, company_name, primary_contact_name, primary_contact_phone, primary_contact_mobile }`.
  It returns `null` on failure too (:5731). Note it exposes `primary_contact_mobile` and
  `primary_contact_phone` but **not** the secondary contact fields — those columns exist on
  `public.contacts` but this RPC does not return them, so this plan cannot offer them. Do not
  invent them.

**`sendReportWhatsapp(payload, token)`** — added by part 1. Takes
`{ reportInstanceId, pdfBase64, filename, recipients: [{ recipientId?, phone, displayName? }] }`
and **always resolves**, returning `{ success: false, error }` rather than throwing. Its response on
success is
`{ success: true, sent, failed, pdf_storage_path, link_expires_at, results: [ { phone, display_name, status, external_message_id, error } ] }`.

**The edge function is authored by part 2 but is NOT deployed when this plan merges.** Deployment is
a human step. So `sendReportWhatsapp` will return `{ success: false, error: … }` on dev until that
happens, and this UI must present that as a plain, honest failure message — not a silent no-op and
not a false success. That is the single most important behaviour in this plan.

**Shared UI helpers**, all of which escape their own arguments (stated at
`report_list_grid.js:11-14`): `MacStatus.pill(status)` (`WebPortal/js/mac-status.js:61`) — its map
already includes `sent`, `pending` and `failed` (:13-19) — and `macLoadingRow`, `macEmptyRow`,
`macEmptyState` (`WebPortal/js/ui-states.js:37-39`). `Swal.fire` is the established dialog for
errors and confirmations in this module (`report_editor.js:1079-1085`).

## Deliverables

### 1. New file `WebPortal/modules/sales-reports/js/report-whatsapp-send.js`

An IIFE assigning one global, `ReportWhatsappSend`, with `init()`, `destroy()` and
`open(options)`. Every binding namespaced `.reportWhatsappSend`; `init()` calls `destroy()` first.

`open(options)` takes:

```js
{
  reportInstanceId: '<uuid>',
  filename: 'Macavation-August-2026.pdf',
  periodLabel: 'August 2026',
  getPdfBase64: function () { /* returns a Promise<string> */ }
}
```

`getPdfBase64` is injected rather than implemented here **on purpose**: pdfmake's loader and the
doc-definition call already live in `report_editor.js` (`ensurePdfMake`, :1054; `handleDownloadPdf`,
:1069), and this file must stay free of any pdfmake or DOM-rendering-library reference so the two
concerns do not drift apart.

Behaviour:

1. Show the modal, render a loading row, then load all three sources concurrently with
   `Promise.all`, **each individually guarded so one failing source does not blank the dialog**:
   - `dataFunctions.listReportRecipients(false)`
   - `dataFunctions.chatListWhatsappConversations(dataFunctions.getCurrentUserId())` — treat a
     `null` result as "this source is unavailable" and show a one-line muted note in that group,
     not an error dialog.
   - `dataFunctions.getContactsForMessaging()` — same `null` handling.
2. Merge into one selectable list, grouped under three headings ("Saved recipients", "From WhatsApp
   inbox", "From CRM contacts"), each row a checkbox with a visible label and the number.
   **De-duplicate across groups by normalised number** so the same person cannot be selected twice
   and charged two sends. Normalise for the comparison key ONLY, using the same rule the database
   uses (`report_normalize_wa_phone` in
   `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`): strip non-digits;
   leading `0` → `27`; else if not starting `27` and length ≤ 11 → prefix `27`; prefix `+`. A row
   already present as a saved recipient wins, and the other groups' copy is not rendered.
   **Send the number as the user's source gave it** — the server normalises. Do not send your
   normalised form; two normalisers that disagree are what part 5's harness exists to catch.
3. Skip any candidate whose normalised number is `null` or shorter than 11 characters, and say how
   many were skipped in a muted line ("2 contacts have no usable mobile number"). A CRM contact with
   an empty `primary_contact_mobile` is common and must not render as a selectable row with a blank
   number.
4. An "Add a number" sub-form (name + number) shown **only when `hasAction('reports.recipient.manage')`
   is true**, checked inline at render time. On submit call
   `dataFunctions.upsertReportRecipient(name, phone, 'manual')`, then re-list with
   `forceRefresh = true`. Surface a `success = 0` row's own `error` text verbatim — the RPC returns
   "A display name is required." / "A valid phone number is required." and those are better messages
   than anything invented here.
5. A footer showing the selected count, and a Send button disabled while zero are selected or while
   a send is in flight. Cap the selection at **25**, matching the edge function's own cap
   (part 2, step 4), and say so in the UI when the cap is hit rather than letting the server reject
   the whole batch.
6. On Send:
   - Disable the button and show a spinner. Do not close the modal.
   - `options.getPdfBase64()` → on rejection, `Swal.fire` an error naming that the PDF could not be
     built, and **do not call the send endpoint**.
   - Defensively strip a leading `data:` prefix: if the returned string matches
     `/^data:[^;]*;base64,/`, remove that prefix before sending. pdfmake's `getBase64` is documented
     to yield bare base64, but **nothing in this checkout calls it** — this repo has never used it —
     so treat that as unconfirmed and handle both shapes. The edge function rejects a `data:` prefix
     outright, so failing to strip it here would fail every send with a confusing 400.
   - For each selected row that came from the WhatsApp inbox or the CRM and is not yet saved, and
     only if `hasAction('reports.recipient.manage')`, call `upsertReportRecipient` with the right
     `source` (`'whatsapp_chat'` with its `conversation_id`, or `'crm_contact'` with its
     `contact_id`) so the next send is one click. A failure to save is **non-fatal** — log it and
     send anyway; the delivery log records the number either way.
   - Call `dataFunctions.sendReportWhatsapp({ reportInstanceId, pdfBase64, filename, recipients })`.
   - Render the returned `results` array in place, one row per recipient, status via
     `MacStatus.pill(r.status)` and the row's own `error` text shown verbatim when present. Every
     one of those values comes from an external gateway via the database — render each with
     `.text()` or one of the escaping helpers named above, **never** by concatenating into HTML.
   - If the top-level response is `{ success: false }`, show its `error` verbatim in a
     `Swal.fire({ icon: 'error' })` and leave the selection intact so the operator can retry. If the
     endpoint is simply not deployed yet, that message is what tells them so.
   - Fire a namespaced document event `reportWhatsappSend:completed` with the report instance id, so
     part 4's history panel can refresh without this file knowing it exists.

### 2. `WebPortal/modules/sales-reports/html/report_editor.html`

- Add a toolbar button after the existing Download PDF button:
  `id="reportEditorSendWhatsappBtn"`, `class="btn btn-outline-success d-none"`,
  `data-action-perm="reports.report.send"`, a `fa-brands fa-whatsapp` or `fa-paper-plane` icon, label
  "Send via WhatsApp". Start it `d-none`; `report_editor.js` reveals it (see below).
- Add the `#reportWhatsappSendModal` markup at the end of the file, modelled on
  `report_list.html:73-108`. Empty containers only — the group lists, the add-number sub-form and
  the results list are all populated by JS, and no database value appears in this static markup.

### 3. `WebPortal/modules/sales-reports/js/report_editor.js`

Three small changes only:

- In the same place that toggles Publish/Re-issue by status (:160-162), toggle the new button:
  visible **only** when `payload.status === 'published'`. A draft must not be sendable — the PDF
  builder watermarks a draft, and the edge function refuses a non-published report with a 409
  anyway, so hiding it here keeps the UI honest instead of offering a call that will fail. A
  `superseded` report is also not sendable.
- A `.reportWhatsappSend`-free, `.reportEditor`-namespaced click handler on
  `#reportEditorSendWhatsappBtn` that calls `ReportWhatsappSend.open({...})`, guarded with
  `typeof ReportWhatsappSend !== 'undefined'` in the same style as the existing
  `typeof ReportPdfBuilder === 'undefined'` guard at :1074.
- A `getPdfBase64` function passed in that closure. **This exact sketch, which returns its promise
  rather than relying on a bare callback:**

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

  Note the two `return`s and the `resolve` inside the callback: `getBase64` is callback-style and
  returns nothing, so without this wrapper an `await` on it would resolve to `undefined` and the
  send would post an empty PDF.

Do not otherwise refactor `report_editor.js`. In particular leave `handleDownloadPdf` alone — it
works and part 4 also edits this file.

### 4. `WebPortal/js/appRouteConfig.json`

Add `"js/report-whatsapp-send.js"` to the `sales-report-editor` route's `js` array, **before**
`js/report_editor.js` (so the global exists when the editor's handler runs, matching why
`report-pdf-builder.js` precedes it today). Change nothing else in this file. `npm run registry:verify`
checks that every path in this file exists, so the new file must be committed with it.

## Security invariants to state in the code, not infer

- **Every value from the database or the gateway reaches the DOM via `.text()` or an escaping
  helper.** Display names come from CRM rows and from WhatsApp profile names — both are
  externally-supplied text. `report_list_grid.js:11-14` names the helpers verified to escape their
  own arguments.
- **No value is ever assigned into a URI sink.** Nothing in this dialog sets `img.src`, `href`,
  `iframe.src` or `location` from a payload value, and the signed URL never reaches the browser at
  all (part 2 does not return it).
- **Never `console.log` the base64 PDF.** Log its length if you need a diagnostic.
- The dialog is gated twice on purpose: `data-action-perm` on the static button, and the edge
  function's own 403. Neither replaces the other.

## Verify before finishing

1. `npm run test:fleet` passes — it now includes `ui:verify` (no raw hex outside
   `design-tokens.css`), `registry:verify` (every `appRouteConfig.json` path exists),
   `routing:verify` and `reports:verify`. Any new colour must use an existing
   `WebPortal/css/design-tokens.css` token; prefer Bootstrap utility classes and add no new hex.
2. `node --check` on both changed/added JS files exits 0, and
   `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
3. **A pure-Node unit check of the two pure helpers**, added to
   `scripts/verify-report-whatsapp-payload.mjs` if part 2's file has merged, otherwise as its own
   `scripts/verify-report-whatsapp-picker.mjs` wired into `test:fleet`. Load
   `report-whatsapp-send.js` with `node:vm` against a minimal global stub — the technique
   `scripts/verify-report-rendering.mjs` already uses for `report-pdf-builder.js`; **read that
   script first and confirm its stubbing approach still applies**, since this file, unlike the pure
   builder, references `window`/`document` at call time even though it must not at evaluation time.
   If it cannot be loaded that way, export the two helpers as properties on the global and test them
   directly rather than weakening the check. Assert:
   - the normalise-for-comparison helper maps `'0821234567'`, `'27821234567'`, `'+27 82 123 4567'`
     and `'821234567'` all to `'+27821234567'`, and `''`/`'abc'` to a falsy value
   - the de-duplication helper, given a saved recipient on `0821234567` and a CRM contact on
     `+27821234567`, returns one row, and it is the saved one
   - a CRM row with an empty `primary_contact_mobile` is excluded and counted as skipped
4. `grep -n "innerHTML" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` — every hit must
   be either a static template string with no payload value interpolated, or one of the named
   escaping helpers. Report the list.

The behaviour that genuinely needs a browser — the modal opening, pdfmake producing bytes, a real
send — **cannot be verified from this checkout and must not be claimed as verified.** Say which parts
remain unproven and that the endpoint is undeployed, rather than describing them as working.

## Out of scope

The delivery-history panel and re-send (part 4). The parity harness (part 5). Any migration. Any
change to the edge function. Attaching the PDF as a WhatsApp document rather than a link — that
contract is unconfirmed and belongs to a later plan.

## Report

Under 30 lines: files changed, how each of the three recipient sources behaved in your unit checks,
the verify results, an explicit list of what remains unverifiable from the checkout, and any place
this plan contradicted the code you found.
