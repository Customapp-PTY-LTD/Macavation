---
depends_on: report-whatsapp-01-data-functions.md
notify: henry@customapp.co.za
retry_of: 3073ac75-c986-4b24-9416-8126731235ea
---

# Report WhatsApp distribution, part 3 — the "Send via WhatsApp" dialog

## Context

Parts 1 and 2 were meant to give the report editor a transport layer and a server-side send
endpoint. This plan is the part a person actually uses: a button on a **published** report that
opens a recipient picker, and on confirm builds the report's PDF in the browser, hands it to the
edge function, and shows what happened to each number.

**Scope has been narrowed against what this checkout actually contains** (see "Grounding" below).
Recipients come from exactly two persisted sources — the shared WhatsApp inbox and CRM contacts —
plus a session-only typed number. There is no saved-recipient store in this repo, so this plan does
not read one, write one, or pretend one exists.

## Dependency reality — read this before writing any code

The frontmatter still carries `depends_on: report-whatsapp-01-data-functions.md`. Part 1 **has
merged**, and it added exactly one wrapper: `sendReportWhatsapp` at
`WebPortal/js/data-functions.js:6263`. It **deliberately did not** add
`listReportRecipients`, `upsertReportRecipient`, `setReportRecipientActive` or
`listReportDeliveries`. Its own block comment at `data-functions.js:6250-6255` states why:

> "As of this commit, no migration under migrations/ defines list_report_recipients,
> upsert_report_recipient, set_report_recipient_active or list_report_deliveries … adding them
> against a guessed signature would silently call a function this repo does not define."

Therefore, as hard constraints on this run:

- **Do not call any `dataFunctions` method that does not exist in `WebPortal/js/data-functions.js`
  at HEAD.** Before writing each call, grep for its definition in that file. The only recipient/send
  methods that exist are `sendReportWhatsapp`, `chatListWhatsappConversations`,
  `getContactsForMessaging`, `getCurrentUserId` and `getToken`.
- **Do not add wrappers to `data-functions.js`.** Do not add, edit or reference any migration.
- **Do not reference the action keys `reports.report.send` or `reports.recipient.manage`** — they
  do not exist in this repo (grep returns nothing outside plan text).
- **Do not implement a saved-recipient list, an "is_active" toggle, or any persistence of a typed
  or picked number.** Those belong to a later plan that first commits the SQL.

`WebPortal/js/appRouteConfig.json` is a shared coordination file and this plan is the only one in
the batch that touches it. Part 4 waits on this plan because it edits the same
`report_editor.html` / `report_editor.js`.

## Grounding — every claim below was re-verified against this checkout

**Recipient sources that exist.**

- `chatListWhatsappConversations(userId, token)` — `data-functions.js:5761-5781`. **Returns `null`**
  (not an error, not `[]`) when the shared-inbox RPC is absent from the database
  (`_whatsappInboxAvailable === false`, :5762 and :5773-5776). Row shape is defined by
  `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:331-344`:
  `success, error, conversation_id, conversation_type, contact_id, external_phone, profile_name,
  other_party_name, last_message_at, last_message_body, last_message_direction, unread_count`.
  `other_party_name` falls back company name → contact name → profile name → formatted phone →
  `'Unknown number'` (same file, :371-377), so it is never blank; use it as the label. The RPC can
  also return a single row with `success = 0` and an `error` string (:348-353) — skip any row whose
  `success` is `0`.
- `getContactsForMessaging(token)` — `data-functions.js:5723-5734`, from `get_contacts_for_messaging`
  (`migrations/20260812100000_crm_whatsapp_module.sql:516-540`). Rows:
  `{ id, contact_type, company_name, primary_contact_name, primary_contact_phone,
  primary_contact_mobile }` — no secondary-contact fields exist on this RPC; do not invent them.
  **It returns `[]` in both the no-rows path (:5729) and the catch path (:5732). It can never
  return `null`.** So:
  - Do NOT write a `null` branch for this source and do NOT show a "source unavailable" note for it.
    An empty CRM result renders as "No CRM contacts found." and nothing more.
  - The `null`-means-unavailable fallback is **specific to `chatListWhatsappConversations`**. Do not
    reuse it at the CRM call site; the two sources have different failure contracts and conflating
    them is what got the previous version of this plan blocked.

**Recipient source that does NOT exist.** There is no saved-recipient RPC, table or wrapper. Nothing
in this dialog may read or write one.

**Phone normalisation.** `report_normalize_wa_phone` does not exist in this repo. The real,
verifiable normaliser is `public.chat_normalize_phone`
(`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92`):

```
strip every non-digit
if the result is empty            -> NULL
if it starts with '0'             -> replace that leading '0' with '27'
if it does not start with '27'
   and its length <= 11           -> prefix '27'
return the digits (no '+' prefix)
```

Mirror this **exactly**, including the empty → `null` case and the absence of any `+`. It is used as
a **local de-duplication key only**. **Send each number exactly as its source gave it** — never the
normalised form.

**The send wrapper.** `sendReportWhatsapp(payload, token)` — `data-functions.js:6263-6335`. Verified
behaviour, which the UI must handle:

- It **throws** (does not resolve) when `reportInstanceId`, `pdfBase64`, a `.pdf`-suffixed
  `filename` or a non-empty `recipients` array with a non-empty `phone` on every entry is missing
  (:6269-6277). **Wrap the call in try/catch as well as checking the returned object.**
- It returns `{ success: false, error }` for a missing session (:6283), a non-OK HTTP response
  (:6309-6314) and any thrown fetch error (:6319-6326).
- On an OK response it returns the parsed body **unchanged** (:6316-6318). The body's shape is
  authored by an edge function that is **not in this checkout** — `supabase/functions/` contains no
  `send-report-whatsapp` directory. So render defensively: use `res.results` only when
  `Array.isArray(res.results)`; otherwise show a single summary line built from what is present.
- Because the function is not deployed, **every send from this UI fails today**, almost certainly as
  `{ success: false, error: 'HTTP 404' }`. Presenting that honestly is the single most important
  behaviour in this plan. Do not fake success, do not swallow it silently.
- Do not assert anything about server-side behaviour you cannot read here: no 409 for a non-published
  report, no filename allowlist, no `data:`-prefix rejection, no server-side recipient cap, no
  server-side 403. None of that is verifiable from this checkout and none of it may appear in a code
  comment or the final report as fact.

**RBAC — use only keys that exist.** `migrations/20260817110000_report_builder_rbac.sql:82-103` seeds
`reports.report.create/edit/delete/publish/generate` for `super_user`, `admin`, `Sales Exec` and
`Palladium Manager`. `reports.report.generate` ("Generate the PDF for a published report") is
currently referenced by no `data-action-perm` in the tree, so wiring the new button to it changes
the gating of nothing else. **Use `reports.report.generate` for this feature, and only that key.**
Introducing a dedicated send key needs a migration, which is out of scope here.

`WebPortal/js/action-access.js:43-47` is default-deny except `super_user`/`admin`;
`window.hasAction` is defined at :95. `WebPortal/js/appRouter.js:251-256` runs `actionAccess.apply`
once, ~100 ms after module load, over `#content-area`, so the attribute is inert on markup injected
later — verified in code, not just in CLAUDE.md. Therefore:

- The static toolbar button in `report_editor.html` MAY carry
  `data-action-perm="reports.report.generate"`, exactly as the Publish/Re-issue buttons carry
  `data-action-perm="reports.report.publish"` (`report_editor.html:20-27`).
- Controls rendered inside the dialog at open time carry **no** `data-action-perm` (it would be
  inert). They need no separate gate: the whole dialog is behind the toolbar button.
- The send handler re-checks permission inline and **fails closed**, mirroring
  `report_editor.js:787` / `:815` exactly:
  `if (typeof hasAction !== 'function' || !hasAction('reports.report.generate')) { … return; }`.
  Never treat a missing `hasAction` as permission granted. This is the only `hasAction` call site in
  this plan.

**The report editor's existing shape** — `WebPortal/modules/sales-reports/js/report_editor.js`:

- The module is `var _reportEditor = function () { … }()` returning `{ init, destroy }` (:1156-1175);
  `initializeReportEditor()` (:1177-1190) waits for `dataFunctions` then calls `_reportEditor.init()`.
  `init()` calls `destroy()` first; `destroy()` does `$(document).off('.reportEditor')`.
- `state.payload` holds the `get_report_instance` payload; `state.payload.status` is `'draft'`,
  `'published'` or `'superseded'`.
- `updatePublishControls(payload)` (:159-163) is the **only** place button visibility is toggled by
  status, and it has exactly **one** call site, `render()` at :672. Publish and re-issue both funnel
  back through `reloadAfterLockChange()` → `render()`, so adding the new toggle inside
  `updatePublishControls` covers every path that can change status.
- Its header comment (:153-157) is binding: drive visibility by **class toggling only**
  (`toggleClass('d-none', …)`), never by inline `display`, because `actionAccess.apply` sets an
  inline `display:none` on a permission-denied control that class toggling must not clear.
- `pdfFileName(payload)` (:1063-1067) builds `Macavation-<sanitised label>.pdf`, always ending
  `.pdf`, which is what `sendReportWhatsapp` requires (:6271). Reuse it; do not write a second one.
- `ensurePdfMake()` (:1054-1058) lazy-loads pdfmake 0.2.10 + `vfs_fonts` from jsDelivr; the comment
  at :1020-1028 explains why they are not in `index.html` (~2.7 MB). Reuse it.
- `handleDownloadPdf()` (:1069-1089) shows the working sequence and the `Swal.fire` error idiom
  (:1079-1085). Leave it untouched.
- Every binding is namespaced `.reportEditor` in `bindEvents()` (:1095+). Match that.

**The dialog pattern is an inline Bootstrap modal in the module's own HTML file.**
`WebPortal/modules/sales-reports/html/report_list.html:73-113` already does this for the New Report
dialog (`#newReportModal`, `data-bs-backdrop="static"`, `data-bs-keyboard="false"`, a `modal-footer`
with a `data-bs-dismiss="modal"` Cancel). Follow it. Do **not** add a route entry for a modal to
`appRouteConfig.json` — those entries mount whole modules and are the wrong mechanism for a dialog
opened over the editor.

**Existing near-duplicate to model the source loading on.**
`WebPortal/modules/crm-whatsapp/js/crm_whatsapp_contacts_tab.js:171-234` is the only existing code
that consumes both of these RPCs. Copy its *shape* for the `null`/`success === 0` handling
(:216-234) and its label choice (`company_name || primary_contact_name`, :180). Do **not** copy two
defects it carries: unnamespaced `.off('click').on('click')` bindings (:157, :165) and
template-string HTML interpolation (:181).

**Module conventions**, written at `report_list_grid.js:1-15` — four rules to honour: a real
`destroy()`; every binding namespaced; `init()` calls `destroy()` first so a second invocation
cannot double-bind; and **every database value reaches the DOM only via `.text()` or an escaping
helper**, never string-concatenated into row HTML. Note that this module deliberately does **not**
auto-init at the bottom of the file (that is the double-init defect named at :10-11) — do not add an
auto-init call, and see the loadability constraint in deliverable 1.

**Shared UI helpers, verified to escape their own arguments.** `MacStatus.pill(status)`
(`WebPortal/js/mac-status.js:61-64`, escaping at :50-54; `TONE_MAP` at :20-38 already maps
`sent`:27, `pending`:29, `failed`:33), and `macLoadingRow`/`macEmptyRow`/`macEmptyState`
(`WebPortal/js/ui-states.js:17-39`, escaping at :12-15). `Swal.fire` is the module's dialog idiom.

## Deliverables

### 1. New file `WebPortal/modules/sales-reports/js/report-whatsapp-send.js`

Follow the file shape of `report-pdf-builder.js:481-486` exactly:

```js
(function (w) {
    'use strict';
    // … private helpers …
    w.ReportWhatsappSend = {
        init: init,
        destroy: destroy,
        open: open,
        normalizePhoneKey: normalizePhoneKey,
        mergeRecipientCandidates: mergeRecipientCandidates
    };
})(typeof window !== 'undefined' ? window : this);
```

**Loadability constraint (required by verify step 3):** at *evaluation* time this file must touch
nothing but `w`. No `$(...)`, no `document`, no `dataFunctions`, no auto-init call at the bottom.
References to those may appear only inside function bodies. `normalizePhoneKey` and
`mergeRecipientCandidates` must be pure functions of their arguments.

`init()` calls `destroy()` first, then binds every handler namespaced `.reportWhatsappSend` via
delegation on `$(document)`. `destroy()` does `$(document).off('.reportWhatsappSend')` and clears
module state.

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
doc-definition call already live in `report_editor.js` (`ensurePdfMake` :1054, `handleDownloadPdf`
:1069), and this file must contain no pdfmake or DOM-rendering-library reference so the two concerns
cannot drift apart — and so it stays loadable in a bare `vm` context.

Behaviour:

1. Show the modal, render a loading row, then load the two sources concurrently with `Promise.all`,
   **each individually guarded so one failing source cannot blank the dialog**:
   - `dataFunctions.chatListWhatsappConversations(dataFunctions.getCurrentUserId())` — a `null`
     result means "this source is unavailable on this database": show a one-line muted note inside
     that group, not an error dialog. Skip any returned row whose `success` is `0`.
   - `dataFunctions.getContactsForMessaging()` — always an array. `[]` renders as
     "No CRM contacts found." **No `null` branch, no "unavailable" note for this source.**
2. Merge into one selectable list under two headings ("From WhatsApp inbox", "From CRM contacts"),
   each row a checkbox with a visible label and the number as the source gave it. Labels:
   `other_party_name` for inbox rows; `company_name || primary_contact_name || 'Unnamed contact'`
   for CRM rows. Numbers: `external_phone` for inbox rows;
   `primary_contact_mobile || primary_contact_phone` for CRM rows.
3. `mergeRecipientCandidates(inboxRows, crmRows)` de-duplicates across the two groups by
   `normalizePhoneKey(number)` so one person cannot be selected twice and charged two sends.
   Deterministic tie-break: **an inbox row wins; the CRM copy of the same normalised number is not
   rendered.** It returns `{ rows: [...], skipped: <count> }`, where a candidate is *skipped* (not
   rendered, counted instead) when `normalizePhoneKey` yields `null` or a key shorter than 11
   characters. A CRM contact with an empty `primary_contact_mobile` and empty `primary_contact_phone`
   is common and must never render as a selectable row with a blank number. Show the count in a muted
   line ("2 contacts have no usable mobile number").
4. `normalizePhoneKey(value)` mirrors `chat_normalize_phone` (rule quoted in Grounding):
   digits only, `null` when no digits remain, `'0…'` → `'27…'`, otherwise prefix `'27'` when it does
   not already start `27` and its length is ≤ 11. **No `+` is ever added.** This value is a
   comparison key only and is never sent.
5. A "Send to another number" sub-form (label + number) that adds a **session-only** entry to the
   current selection. It calls no RPC and persists nothing; label it in the UI as
   "not saved — this send only". Validate locally: `normalizePhoneKey` must return a key of at
   least 11 characters, otherwise show an inline message and do not add the row. A session entry
   participates in the same de-duplication by normalised key.
6. A footer showing the selected count, and a Send button disabled while zero are selected or while
   a send is in flight. Cap the selection at **25 as a client-side guard** (this repo contains no
   server-side cap to match; do not claim one), and say so in the UI when the cap is hit.
7. On Send:
   - Re-check permission inline and fail closed:
     `if (typeof hasAction !== 'function' || !hasAction('reports.report.generate')) { Swal.fire({ icon: 'warning', title: 'Not permitted', … }); return; }`
   - Disable the button and show a spinner. Do not close the modal.
   - `options.getPdfBase64()` → on rejection, `Swal.fire` an error saying the PDF could not be built,
     and **do not call the send endpoint**.
   - Defensively strip a leading `data:` prefix: if the string matches `/^data:[^;]*;base64,/`,
     remove that prefix. pdfmake's `getBase64` is documented to yield bare base64, but **nothing in
     this checkout calls it**, so treat the shape as unconfirmed and handle both. Do not claim the
     server rejects either shape — the server is not in this checkout.
   - Build `recipients` as `[{ phone: <number exactly as its source gave it>, displayName: <label> }]`.
     Do not send a `recipientId` — nothing in this repo issues one.
   - Call `dataFunctions.sendReportWhatsapp({ reportInstanceId, pdfBase64, filename, recipients })`
     **inside a try/catch (or `.catch`)**, because the wrapper throws on argument validation
     (`data-functions.js:6269-6277`) and only *returns* `{ success: false, error }` for transport
     failures. A thrown error is presented the same way as a returned failure — never silently.
   - When `Array.isArray(res.results)`, render one row per result in place: status via
     `MacStatus.pill(r.status)`, the row's own `error` shown verbatim when present. When it is not an
     array, render a single line stating the send completed but returned no per-recipient detail.
     Every one of these values originates outside this system — render each with `.text()` or one of
     the escaping helpers named above, **never** by concatenating into HTML.
   - If the response is falsy or `success` is `false` (or the call threw), show its `error` verbatim
     in a `Swal.fire({ icon: 'error' })` and leave the selection intact so the operator can retry.
     Today this is the expected path, and that message is what tells the operator the endpoint is
     not deployed.
   - Fire a namespaced document event `reportWhatsappSend:completed` carrying the report instance id,
     so part 4's history panel can refresh without this file knowing it exists.
   - **Never `console.log` the base64 PDF.** Log its length if a diagnostic is needed.

### 2. `WebPortal/modules/sales-reports/html/report_editor.html`

- Add a toolbar button inside the `.btn-toolbar` (after `#reportEditorDownloadPdfBtn`, before
  `#reportEditorPublishBtn`):
  `id="reportEditorSendWhatsappBtn"`, `class="btn btn-outline-success d-none"`,
  `data-action-perm="reports.report.generate"`, icon `<i class="fab fa-whatsapp me-1"></i>`
  (the repo's Font Awesome 6 idiom — see `crm_whatsapp_grid.html:5`, `crm_grid.js:26`), label
  "Send via WhatsApp". It starts `d-none`; `report_editor.js` reveals it by class toggle.
  Do **not** use the class `btn-success` anywhere — `scripts/verify-ui-standard.mjs:133` fails the
  build on that literal. Do not add any raw hex or any `bi bi-` icon.
- Add `#reportWhatsappSendModal` at the end of the file, modelled on `report_list.html:73-113`
  (`data-bs-backdrop="static"`, `data-bs-keyboard="false"`, `modal-footer` with a
  `data-bs-dismiss="modal"` Cancel and the Send button). Empty containers only: the two group lists,
  the "send to another number" sub-form, the skipped-count line and the results list are all
  populated by JS. No database value appears in this static markup, and no control inside the modal
  carries `data-action-perm`.

### 3. `WebPortal/modules/sales-reports/js/report_editor.js`

Four small changes only; do not otherwise refactor this file, and leave `handleDownloadPdf` alone
(it works, and part 4 also edits this file).

- In `updatePublishControls` (:159-163), add one line, class-toggle only, visible **only** for a
  published report:
  `$('#reportEditorSendWhatsappBtn').toggleClass('d-none', status !== 'published');`
  A draft must not be sendable — the PDF builder watermarks a draft
  (`report-pdf-builder.js:475`) — and a `superseded` report is not sendable either. This is the only
  status-driven visibility site in the file, and `render()` (:672) is its only caller, so no other
  call site needs the same treatment.
- In `bindEvents()`, a `.reportEditor`-namespaced delegated click handler on
  `#reportEditorSendWhatsappBtn` that guards on the global exactly as :1074 guards the PDF builder:

  ```js
  $(document).on('click.reportEditor', '#reportEditorSendWhatsappBtn', function () {
      if (!state.payload || state.payload.status !== 'published') return;
      if (typeof ReportWhatsappSend === 'undefined' || !ReportWhatsappSend.open) {
          Swal.fire({ icon: 'error', title: 'Could not open the send dialog',
                      text: 'The send module did not load. Reload the page and try again.' });
          return;
      }
      ReportWhatsappSend.open({
          reportInstanceId: state.reportId,
          filename: pdfFileName(state.payload),
          periodLabel: displayLabel(state.payload.period_label),
          getPdfBase64: buildPdfBase64
      });
  });
  ```

- The `buildPdfBase64` function referenced above — **this exact sketch**, which returns its promise
  rather than relying on a bare callback:

  ```js
  function buildPdfBase64() {
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
  returns nothing, so without this wrapper an `await` on it resolves to `undefined` and the send
  posts an empty PDF. The identifier is `buildPdfBase64` at its definition and at the single place
  it is passed in as `getPdfBase64`; deliverable 1 consumes it only as `options.getPdfBase64`.

- Lifecycle delegation, guarded so a missing global can never throw:
  in the returned `init()` (:1157), after `bindEvents()`, add
  `if (typeof ReportWhatsappSend !== 'undefined' && ReportWhatsappSend.init) ReportWhatsappSend.init();`
  and in `destroy()` (:1168), before `$(document).off('.reportEditor')`, add
  `if (typeof ReportWhatsappSend !== 'undefined' && ReportWhatsappSend.destroy) ReportWhatsappSend.destroy();`.

### 4. `WebPortal/js/appRouteConfig.json`

Add `"js/report-whatsapp-send.js"` to the `sales-report-editor` route's `js` array (route entry at
:651-663), **before** `"js/report_editor.js"`, so the global exists when the editor's handler runs —
the same reason `report-pdf-builder.js` precedes it today. Change nothing else in this file.
`npm run registry:verify` fails on a registry path that does not exist, so the new file must be
committed alongside this edit.

### 5. `package.json`

Add `"whatsapp-picker:verify": "node scripts/verify-report-whatsapp-picker.mjs"` and append
`&& npm run whatsapp-picker:verify` to the end of the `test:fleet` chain. The new script must obey
the `"//test:fleet"` contract in that file: pure Node stdlib, no network, no browser, no login, no
database, fixtures declared literally in the script.

## Security invariants — state these in the code, do not leave them to inference

- **Every value from the database or the gateway reaches the DOM via `.text()` or one of the
  escaping helpers** (`MacStatus.pill`, `macLoadingRow`, `macEmptyRow`, `macEmptyState`). Labels come
  from CRM rows and WhatsApp profile names; per-recipient `status`/`error` come from an external
  gateway. None of them may be concatenated into an HTML string.
- **No value is ever assigned into a URI sink.** Nothing in this dialog sets `img.src`, `href`,
  `iframe.src` or `location` from a payload value.
- **Never `console.log` the base64 PDF** — log its length only.
- **Fail closed on permission.** `typeof hasAction !== 'function'` means deny, never allow.
- **Do not claim double gating.** The verifiable gates are the `data-action-perm` sweep on the static
  button and the inline `hasAction('reports.report.generate')` re-check. The send endpoint is not in
  this checkout, so no server-side gate may be asserted anywhere in code comments or the report.

## Verify before finishing

1. `npm run test:fleet` passes. It runs `routing:verify`, `username:verify`,
   `verify-phase2-migrations.mjs`, `ui:verify`, `migrations:verify`, `registry:verify`,
   `reports:verify` and (after deliverable 5) `whatsapp-picker:verify`. `ui:verify` bans the literal
   `btn-success`, `bi bi-` icons and raw hex outside `WebPortal/css/design-tokens.css`; prefer
   Bootstrap utility classes and add no new hex.
2. `node --check` exits 0 on `report-whatsapp-send.js` and `report_editor.js`, and
   `node -e "JSON.parse(require('fs').readFileSync('WebPortal/js/appRouteConfig.json','utf8'))"`
   exits 0.
3. **A pure-Node unit check** in `scripts/verify-report-whatsapp-picker.mjs`, modelled on
   `scripts/verify-report-rendering.mjs:45-58` — read that file first; it loads the target with
   `node:vm` into the context `{ window: {}, console }` and reads the global back off `ctx.window`.
   Load `report-whatsapp-send.js` the same way and read `ctx.window.ReportWhatsappSend`. Because that
   context provides no `document` and no `$`, this check *is* the enforcement of the
   evaluation-time constraint in deliverable 1. Assert:
   - `normalizePhoneKey` maps `'0821234567'`, `'27821234567'`, `'+27 82 123 4567'` and `'821234567'`
     all to `'27821234567'` (digits only, **no `+`**, matching `chat_normalize_phone`), and `''`,
     `'abc'`, `null` and `undefined` to `null`.
   - `mergeRecipientCandidates`, given an inbox row on `'0821234567'` and a CRM row on
     `'+27 82 123 4567'`, returns exactly one row, and it is the inbox one.
   - a CRM row with empty `primary_contact_mobile` **and** empty `primary_contact_phone` is excluded
     from `rows` and counted in `skipped`.
   - a CRM row with a blank mobile but a usable `primary_contact_phone` is included, using that phone.
   - an inbox row with `success === 0` is excluded and is not counted as a skipped contact.
   If the file cannot be loaded in that context, fix the file so it can be — do not weaken the check.
4. `grep -n "innerHTML\|\.html(" WebPortal/modules/sales-reports/js/report-whatsapp-send.js` —
   every hit must be either a static template string with no payload value interpolated, or one of
   the named escaping helpers. Report the list.
5. Re-grep before finishing, and report the result: every `dataFunctions.` call added by this change
   must resolve to a definition in `WebPortal/js/data-functions.js`, and
   `grep -rn "listReportRecipients\|upsertReportRecipient\|reports\.report\.send\|reports\.recipient\.manage"`
   over the changed files must return nothing.

The behaviour that genuinely needs a browser or a deployed backend — the modal opening, pdfmake
producing bytes, a real send — **cannot be verified from this checkout and must not be claimed as
verified**. Say which parts remain unproven, and state plainly that no `send-report-whatsapp` edge
function exists in `supabase/functions/`, so every send currently returns a handled failure.

## Out of scope

Any migration, any change to `WebPortal/js/data-functions.js`, any saved-recipient store or
persistence of picked/typed numbers, the delivery-history panel and re-send (part 4), the parity
harness (part 5), the edge function itself, and attaching the PDF as a WhatsApp document rather than
a link.

## Report

Under 30 lines: files changed, how each of the two recipient sources behaved in the unit checks, the
verify results, an explicit list of what remains unverifiable from this checkout (including that the
edge function and any saved-recipient RPC do not exist here), and any place this plan contradicted
the code you found.
