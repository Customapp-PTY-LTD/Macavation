---
depends_on: wa-add-contact-01-typed.md
notify: henry@customapp.co.za
---
# WhatsApp: "Add contact" form on the menu Flow screen

## Why

`wa-add-contact-01-typed.md` (merged before this runs) lets staff add a CRM contact by typing
`/contact` and answering questions. This plan adds the same capture as a one-screen form inside
the WhatsApp menu Flow (`supabase/flows/daily-report-menu.flow.json`), so a member can tap
"Add contact", fill five fields, and submit. The submission goes through the SAME validation,
duplicate check, summary, and YES confirmation as plan 01. There is one write path, not two.

## What already exists

- `supabase/flows/daily-report-menu.flow.json` (Flow JSON `version: "7.3"`): screen `REPORT_MENU`
  (a `NavigationList` bound to `${data.rows}`) and a terminal screen `DETAIL` (RichText). Today
  every row navigates to `DETAIL`.
- `supabase/functions/whatsapp-inbound/index.ts`: `buildDigestFlowRows` builds the `REPORT_MENU`
  rows. `commandMenu` sends the Flow only when `WA_DAILY_REPORT_FLOW_ID` is set, and otherwise
  sends the native list. That env var is NOT set on any environment today, so the Flow path is
  dormant. That is expected, and this plan must keep the native-list path unchanged.
- From plan 01, in the same file: the five-type allowlist, the pure validators
  (`validateCompanyName`, `normaliseMobile`, `validateEmail`, `isSkipAnswer`), the
  `whatsapp_find_contacts_by_company` duplicate check, `buildAddContactSummary`, the
  `ADD_CONTACT` staging and its staged handler, and the `crm-grid` gate. Reuse them. Do not copy them.
- `supabase/functions/_shared/wa-inbound.ts` `classifyMessage`: it has no `nfm_reply` handling,
  and nothing in this repo parses a Flow submission today.

## Deliverables

### 1. Flow JSON: new screen `ADD_CONTACT` in `daily-report-menu.flow.json`

- Settings: `"terminal": true`, `"success": true`, `"title": "Add contact"`.
- Layout: `SingleColumnLayout` containing a `Form` (name `add_contact_form`) with:
  - `Dropdown` `contact_type`, required, `data-source` = the five types from plan 01
    (`id` = the type key, `title` = the same label)
  - `TextInput` `company_name`, required, label "Company name"
  - `TextInput` `contact_name`, label "Contact person"
  - `TextInput` `mobile`, `input-type: "phone"`, label "Mobile"
  - `TextInput` `email`, `input-type: "email"`, label "Email"
  - `Footer` "Next", with `on-click-action`
    `{ "name": "complete", "payload": { "form": "add_contact", "contact_type": "${form.contact_type}", "company_name": "${form.company_name}", "contact_name": "${form.contact_name}", "mobile": "${form.mobile}", "email": "${form.email}" } }`
- Leave `REPORT_MENU` and `DETAIL` unchanged.
- These component names follow Meta's Flow JSON docs. This repo only uses `NavigationList` and
  `RichText` so far, so the exact syntax is **UNCONFIRMED here**. Keep the file valid JSON, and
  record the "unconfirmed against Meta" status as a comment in the verifier, not in the JSON
  (Flow JSON rejects unknown keys).

### 2. Menu row

In `commandMenu`'s Flow branch, append one row after the digest rows when BOTH of these hold:
- the role has `crm-grid`, and
- `Deno.env.get('WA_FLOW_ADD_CONTACT_ENABLED') === 'true'`.

The row: `{ id: 'addcontact', 'main-content': { title: 'Add contact', metadata: 'Add a supplier or customer' }, 'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'ADD_CONTACT' }, payload: {} } }`.

The env flag exists because a Flow already published in Meta from an OLDER copy of this JSON has
no `ADD_CONTACT` screen, and navigating to it would fail inside WhatsApp. The flag is switched on
only after the new version is published. With the flag off, nothing changes. The native-list menu
still gets "Add contact" from plan 01, and `/contact` keeps working everywhere.

### 3. Receive the submission

- `classifyMessage`: add `interactive.type === 'nfm_reply'` returning a new `kind: 'flow_reply'`
  with `responseJson`, the result of `JSON.parse(interactive.nfm_reply.response_json)` (a string).
  Guard it: a parse failure or non-object becomes `unsupported`. This shape follows Meta's Cloud
  API docs (`messages[].interactive.nfm_reply.{name, body, response_json}`), but nothing in this
  repo produces or reads it yet, so it is **UNCONFIRMED here**. Treat every field as optional.
- Route it to the command path for enrolled staff only, exactly as plan 01 did for `contacts`.
  Unenrolled senders stay unchanged.
- In `handleCommand`: when `responseJson.form === 'add_contact'`, run each field through plan 01's
  validators. The Flow's own `required` flags are client-side and are NOT trusted.
  - If something fails: reply with what was wrong in plain words, plus "Send /contact to try
    again."
  - If everything passes: run the duplicate check, stage `ADD_CONTACT`, and send the identical
    `buildAddContactSummary` reply asking for YES. Re-check `crm-grid` first.
- A `flow_reply` with any other `form` value is logged and ignored.
- The `flow_token` is not an authorisation. The enrolled sender is.

### 4. Tests

Extend `scripts/verify-wa-add-contact.mjs` (from plan 01):
- The Flow JSON parses and has `ADD_CONTACT` with `terminal: true`, the five dropdown ids equal to
  the plan-01 allowlist, the `complete` action payload containing `form: "add_contact"` and all
  five fields, and `REPORT_MENU` / `DETAIL` still present.
- Re-declared `classifyMessage` copy: a valid `nfm_reply`, malformed `response_json`, and a missing
  `nfm_reply`.
- Literal presence of `WA_FLOW_ADD_CONTACT_ENABLED` and of the `crm-grid` check on the row.

Existing tests at risk: `scripts/verify-wa-plumbing.mjs` re-declares `classifyMessage`. Update that
copy and add an `nfm_reply` case (IN SCOPE). Any verifier that asserts the Flow JSON's exact
screen list must be updated to include `ADD_CONTACT`. Never weaken an assertion.

## Verify before finishing

`npm run test:fleet` passes.

## Out of scope

Publishing the Flow in Meta and setting `WA_DAILY_REPORT_FLOW_ID` /
`WA_FLOW_ADD_CONTACT_ENABLED`. Those are human steps after merge. Also out of scope: the
`data_exchange` endpoint mode, and editing contacts.
