---
notify: henry@customapp.co.za
---
# WhatsApp: add a CRM contact with /contact (guided questions)

## Why

Pete (staff, enrolled on the Macavation WhatsApp line) sometimes needs to add a contact to the
CRM while he is away from his computer. Today the only way is the portal's Add contact modal.
Add a guided, confirm-before-save flow on the existing WhatsApp staff line, so he can type
`/contact` (or tap "Add contact" in the menu, or share a phone contact card), answer a few short
questions, reply YES, and the contact appears in the portal's Contacts grid exactly as if it had
been added there.

Phone capture is deliberately minimal: type, company, contact person, mobile, email. Everything
else (address, rates, account manager, supplier number) stays a portal job.

## What already exists - build on it, do not rebuild it

Read these before writing anything:

- `supabase/functions/whatsapp-inbound/index.ts`
  - `handleCommand` (around line 2250-2320): a leading `/` is already stripped
    (`.replace(/^\//, '')`), so registering verb `CONTACT` in `COMMAND_HANDLERS` makes `/contact`
    and `contact` both work. No slash-specific code is needed.
  - `COMMAND_HANDLERS` (around line 2174) and `STAGED_COMMAND_HANDLERS` (around line 1682): the
    comment at line ~330 says a new write command = a STAGED handler + a verb that stages it.
    `commandAck` + `ACK_ALERT` is the worked example to copy (staging reply wording, permission
    re-check inside the staged handler, error replies).
  - `commandYes` / `commandNo` (around line 1815-1900): YES takes the pending row and dispatches
    on its `command`; a command with no registered handler replies "expired".
  - `MENU_ITEMS`, `MenuItem` (`render` | `resolve` | `subMenu` - exactly one), `visibleItems`,
    `loadFeatureKeys`, `followUpItemsOf`, `sendMenuAsList`, `sendList`, `sendButtons`,
    `buildReplyId` / `parseReplyId` (segment rule `[a-z0-9][a-z0-9_-]{0,23}`), `MAX_LIST_TITLE` (24).
  - `bodyForMessage` line ~170: a `type:'contacts'` message (shared contact card) is currently
    only stored as the placeholder `[shared contact card]`.
- `supabase/functions/_shared/wa-inbound.ts` `classifyMessage`: today returns `unsupported` for
  every type except text / interactive button_reply / list_reply / button.
- `migrations/20260815130000_whatsapp_pending_commands.sql`: `whatsapp_pending_commands`
  (one row per phone, 10-minute expiry), `whatsapp_stage_pending_command` (upsert),
  `whatsapp_take_pending_command` (fetch-and-delete), `whatsapp_clear_pending_command`. All
  service_role only.
- `migrations/20260818090200_contact_rpcs_persist_all_live_columns.sql:30-56`: the CURRENT
  `create_contact_simple(...)` signature the portal uses. Returns json
  `{ success, id, message }` or `{ success:false, error }`. Requires `p_company_name` and
  `p_contact_type`. Read its GRANT lines: if `service_role` cannot EXECUTE it, add the grant in
  this plan's migration.
- `WebPortal/modules/modals/modal-crm-contact/html/modal_crm_contact.html` `#contactType`: the
  portal's contact types. Use ONLY the five current ones: `nis_supplier` (NIS supplier),
  `oil_processor` (Oil processor), `oil_ingredient_supplier` (Oil ingredient supplier),
  `oil_protein_customer` (Oil & protein customer), `kernel_customer` (Kernel customer). Never the
  legacy `customer` / `supplier` / `both`.
- `migrations/20260302000003_seed_features.sql:10`: feature key `crm-grid` = the portal Contacts
  page. This is the permission gate.
- `scripts/verify-wa-staff-menu.mjs`: the test pattern to follow (no `.ts` evaluation; pure
  helpers get a literal-presence assertion plus a re-declared JS copy; CRLF normalised).
- `BluePrint/SUPABASE_BEST_PRACTICES.md` and `BluePrint/CRUD_FUNCTIONS_GUIDE.md` for DB rules.

## Deliverables

### 1. Migration `migrations/20261001120000_whatsapp_add_contact_support.sql`

Mirror the conventions of `20260815130000_whatsapp_pending_commands.sql` exactly (SECURITY
DEFINER, `SET search_path = public`, REVOKE from PUBLIC/anon/authenticated, GRANT to
service_role only, COMMENT ON FUNCTION, same phone canonicalisation and argument checks).

- `whatsapp_peek_pending_command(p_phone text, p_user_id uuid)` - same return shape and same
  phone/user/expiry checks as `whatsapp_take_pending_command`, but does NOT delete. Read the take
  function and copy its body minus the delete.
- `whatsapp_find_contacts_by_company(p_company_name text)` - up to 3 rows
  `(id uuid, company_name text, contact_type text)` from `public.contacts` where
  `lower(btrim(company_name)) = lower(btrim(p_company_name))`. Empty or NULL input returns no rows.
- The `create_contact_simple` service_role grant, ONLY if it is missing (see above).

The migration must pass `npm run migrations:verify`. It is applied by a human after merge. Until
then the code below must degrade (see 2h).

### 2. `supabase/functions/whatsapp-inbound/index.ts`

**a. Entry points**, all calling one `startAddContact(ctx)`:
- `COMMAND_HANDLERS`: `CONTACT`, `ADDCONTACT`, `NEWCONTACT`, and `ADD`. `ADD` starts the flow
  only when the rest of the text is `contact` or `contacts`. Anything else falls through to
  exactly what an unknown verb does today (`commandMenu`).
- A new `MENU_ITEMS` entry, placed last:
  `{ action: 'addcontact', title: 'Add contact', feature: 'crm-grid', subMenu: startAddContact }`.
  Exclude it from `followUpItemsOf` (that list backs the "Reports" button and must stay reports-only).
- A shared contact card (see 2e).
- Add a `/contact` line to the HELP text (`helpReplyText`).

**b. Permission**: the role must have `crm-grid` via `loadFeatureKeys`, checked when the flow
starts AND again inside the staged `ADD_CONTACT` handler (a role can change in the 10 minutes
before YES). Without it: "Sorry {name}, adding contacts is not on your access." Do NOT start a draft.

**c. Draft state** lives in `whatsapp_pending_commands` as command `ADD_CONTACT_DRAFT`, with payload
`{ step, contact_type, company_name, contact_name, mobile, email, duplicate_of }`. Each answer
re-stages it, which resets the 10-minute expiry. Starting a new draft replaces any pending row for
that phone, which is how `whatsapp_stage_pending_command` already behaves.

**d. Routing while a draft is open.** In `handleCommand`, BEFORE the HELP / verb lookup and only
for typed text (not `replyId`): call `whatsapp_peek_pending_command`. If it returns
`ADD_CONTACT_DRAFT`, the message is an answer to the current step, except:
- `CANCEL` / `NO` / `N`: clear the pending row and reply "Cancelled - nothing was saved."
- `0` / `99` / `MENU`: clear it and open the menu (`commandMenu`).
- `HELP`: show help and keep the draft.

Peek failure, a missing RPC, or any other pending command means behave exactly as today. A peek
error must never break an unrelated command.

**e. Steps** (one question per message, with a short prompt that ends "Reply CANCEL to stop."):
1. `type`: `sendList` with the five types as rows. Reply ids use
   `buildReplyId('contact', 'type', <key>)`; add a `CONTACT_NS = 'contact'` branch to the
   `replyId` section of `handleCommand`. A typed `1`-`5` is also accepted. If the list send fails,
   fall back to numbered text. A type tap with no open draft replies "That contact form has
   expired - send /contact to start again."
2. `company`: required, trimmed, internal whitespace collapsed, 2-120 characters. Then call
   `whatsapp_find_contacts_by_company`; on a match, store `duplicate_of` (the existing name) for
   the summary.
3. `person`: optional (`skip` or `-` skips), max 120 characters.
4. `mobile`: optional; strip spaces, `-`, `(`, `)`; allow a leading `+`; must then be 9-15
   digits, otherwise re-ask the same step.
5. `email`: optional; `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, max 254, lowercased, otherwise re-ask.
6. Done: stage `ADD_CONTACT` with the final payload and reply with a summary (type label, company,
   person, mobile, email; "-" for skipped fields). If `duplicate_of` is set, add the line
   "Note: a contact called *{name}* already exists." End with the same "Reply YES to confirm or
   NO to cancel" wording `commandAck` uses.

**Shared contact card**: when an ENROLLED staff member with `crm-grid` sends `type:'contacts'`,
start the draft prefilled from `messages[].contacts[0]`: `name.formatted_name` goes to person, the
first `phones[].phone` (else `wa_id`) to mobile, the first `emails[].email` to email, and
`org.company` to company. Then ask only the steps that are still empty, `type` always included.
That payload shape follows Meta's Cloud API docs, but **nothing in this repo reads it yet**, so it
is UNCONFIRMED here. Treat every field as optional; if nothing usable is present, run the normal
flow. This needs `classifyMessage` to return a new `kind: 'contacts'` carrying the raw first
contact. Trace where `whatsapp-inbound` currently returns early for non-text types and route this
one type through to the command path for enrolled staff only. Unenrolled senders stay exactly as
today (silent, placeholder stored).

**f. Staged handler `ADD_CONTACT`** in `STAGED_COMMAND_HANDLERS`:
- Re-check `crm-grid`.
- Re-validate the staged payload with the same validators: type must be in the five-type
  allowlist, company non-empty, lengths capped. Never trust the staged payload blindly.
- Call `create_contact_simple` with `p_contact_type`, `p_company_name`, `p_primary_contact_name`,
  `p_primary_contact_mobile`, `p_primary_contact_email`, `p_status: 'active'`, and
  `p_notes: 'Added over WhatsApp by {displayName} on {YYYY-MM-DD SAST}'`. Everything else stays
  null/default.
- `success !== true`: reply "Sorry {name}, I could not save that contact: {error}". Success:
  "Saved. *{company}* is now in Contacts. Add the address and other details from the portal."

**g. Security invariants** (this is a public WhatsApp line):
- All message text is attacker-controlled. It goes to the DB only as RPC parameters, never
  string-built SQL.
- Every lookup into a plain object uses `hasOwnProperty`, matching the existing code.
- Length-cap every field before staging.
- Never echo a stack trace or raw error object to the handset; use `error.message` only.

**h. Degrade before the migration is applied.** If `whatsapp_peek_pending_command` or
`whatsapp_find_contacts_by_company` is missing (`isMissingRpc`), `startAddContact` replies
"Adding contacts on WhatsApp is not switched on yet." and logs the migration name with
`console.error`. Every other command keeps working, and the function still returns 2xx.

### 3. Tests

- New `scripts/verify-wa-add-contact.mjs`, following `verify-wa-staff-menu.mjs`. Keep the
  validators and parsers as PURE top-level functions in `index.ts` (e.g. `contactTypeFromInput`,
  `isSkipAnswer`, `validateCompanyName`, `normaliseMobile`, `validateEmail`,
  `buildAddContactSummary`, `extractSharedContact`) so they can be re-declared and tested. Cover:
  - every validator, including the boundaries (1/2/120/121 characters, 8/9/15/16 digits, bad
    email)
  - `1`-`5` and reply ids mapping to the right type, and a legacy type being rejected
  - the summary with and without the duplicate line
  - contact-card extraction from a full card, an empty card, and a missing field
  - literal-presence checks: the `CONTACT` / `ADDCONTACT` / `NEWCONTACT` / `ADD` verbs, the
    `ADD_CONTACT` staged handler, the `addcontact` menu item with `feature: 'crm-grid'`, a
    `crm-grid` check inside the staged handler, and `create_contact_simple` being called with
    `p_company_name`
  - the migration file defining both functions, granting only to service_role
- Add `"wa-add-contact:verify": "node scripts/verify-wa-add-contact.mjs"` to `package.json` and
  append `&& npm run wa-add-contact:verify` to the END of `test:fleet`. Do not remove or reorder
  anything already in `test:fleet`.
- **Existing tests at risk.** Adding a `MENU_ITEMS` row and a `classifyMessage` branch can break
  assertions that already exist in `scripts/verify-wa-staff-menu.mjs` (it parses the real
  `MENU_ITEMS` table and checks row limits and invariants), `scripts/verify-wa-my-reports.mjs`
  (regex on the `settings` item at ~line 138, which must stay matching), and
  `scripts/verify-wa-plumbing.mjs` (which re-declares a copy of `classifyMessage`; update that
  copy and add a `contacts` case). Updating those to match the new code is IN SCOPE. Never weaken
  an assertion to make it pass: update it to describe the new truth.

## Verify before finishing

`npm run test:fleet` passes. Run `npm run wa-add-contact:verify` on its own and confirm it reports
a non-zero pass count.

## Out of scope

The WhatsApp Flow screen, which is a separate follow-on plan. Editing existing contacts.
Address, rates, supplier number and account manager. Applying the migration, which is a human step.
