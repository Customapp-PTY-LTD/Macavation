---
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 1 — the transport layer in data-functions.js

## Context

A Sales & Production report can already be created, edited, PDF-exported and published. It cannot
be **sent to anyone**. The database side of sending now exists and has been applied to dev
(see Grounding below): a saved recipient list, a per-attempt delivery log, and a private storage
bucket for the PDF.

This plan adds **only the transport wrappers** in `WebPortal/js/data-functions.js` — nothing
user-visible. It is deliberately first and deliberately small, because the send dialog (part 3) and
the delivery-history panel (part 4) both consume these wrappers, and both would otherwise edit this
same 6,594-line shared file and collide.

`WebPortal/js/data-functions.js` is a shared coordination file. No other plan in this batch touches
it — parts 3, 4 and 5 depend on this one landing first.

## Grounding — verified against this checkout and the dev database

**The RPCs and the bucket already exist.** They were applied to dev
(`nmdmddugxclpqrwylyfa`) on 2026-08-19 and committed in
`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`,
`migrations/20260822090100_report_pdf_storage_bucket.sql` and
`migrations/20260822090200_report_whatsapp_send_rbac.sql`. Read those three files — they are in this
checkout and they are the contract. Signatures, copied from them:

```
list_report_recipients(p_include_inactive boolean DEFAULT false)
  RETURNS TABLE (success int, error text, id uuid, display_name text, phone text, source text,
                 contact_id uuid, conversation_id uuid, is_active boolean, notes text,
                 last_sent_at timestamptz, created_at timestamptz)

upsert_report_recipient(p_display_name text, p_phone text, p_source text DEFAULT 'manual',
                        p_contact_id uuid DEFAULT NULL, p_conversation_id uuid DEFAULT NULL,
                        p_notes text DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
  RETURNS TABLE (success int, error text, id uuid)

set_report_recipient_active(p_recipient_id uuid, p_is_active boolean,
                            p_actor_user_id uuid DEFAULT NULL)
  RETURNS TABLE (success int, error text)

list_report_deliveries(p_report_instance_id uuid)
  RETURNS TABLE (success int, error text, id uuid, recipient_id uuid, phone text,
                 display_name text, channel text, status text, external_message_id text,
                 delivery_error text, sent_by uuid, sent_by_name text, created_at timestamptz,
                 completed_at timestamptz, link_expires_at timestamptz)
```

Note `delivery_error`, not `error` — the row's own failure text is named `delivery_error` in the
result so it cannot be confused with the leading `error` column that carries an RPC-level fault.
Do not rename it in the wrapper.

`begin_report_delivery`, `complete_report_delivery` and `record_report_pdf_storage` also exist but
are granted to `service_role` ONLY (section 7 of the first migration). **Do not add browser wrappers
for them.** They are called from the edge function in part 2. A browser wrapper would be a dead
call that returns a permission error, and adding one invites someone to grant them to `anon` later.

**The two RPCs that already back the recipient picker's other sources** (part 3 uses these; this
plan does not need to add them, and must not duplicate them):

- `dataFunctions.getContactsForMessaging()` — `WebPortal/js/data-functions.js:5723-5733`, calling
  `get_contacts_for_messaging` (`migrations/20260812100000_crm_whatsapp_module.sql:516-538`).
- `dataFunctions.chatListWhatsappConversations(userId)` — `WebPortal/js/data-functions.js:5761`,
  calling `chat_list_whatsapp_conversations`
  (`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:325-343`).

**The house pattern for an RPC wrapper** is `callFunction(name, params, token, options)`
(`WebPortal/js/data-functions.js:645`). Model the four new wrappers on the report-builder block
that already sits in this file — `getReportTemplates` (:5927), `listReportInstances` (:5951),
`publishReportInstance` (:6096), `upsertReportPeriodTarget` (:6163) — including:

- the block comment convention those wrappers use, which states plainly that whether the
  underlying migration has been applied to any given database cannot be verified from the
  checkout;
- **never swallowing an RPC error into a fake empty success** — that comment at :6087-6095 is
  explicit that a missing migration must surface as a thrown error, not look like "no reports yet";
- local argument validation that throws a clean `Error` before the call (e.g.
  `listReportInstances`' `throw new Error('getReportCurrentPeriod: periodType is required.')` at
  :5940), so a missing no-DEFAULT parameter never degrades into a confusing
  "function not found";
- `this.getCurrentUserId() || undefined` for actor ids (:6101), and
  `this.clearCachePattern(...)` after every write (:6106-6107).

**The edge-function call pattern** is `sendWhatsappMessageNow`
(`WebPortal/js/data-functions.js:5864-5897`). Copy its shape exactly: build the URL from
`window.MACAVATION_SUPABASE` (`.url` with a trailing slash stripped) plus
`/functions/v1/<name>`, send `Authorization: Bearer <anonKey>`, `apikey: <anonKey>` and
`X-Portal-Session: <this.getToken()>`, and **return a `{ success: false, error }` object rather
than throwing** on any failure, including a caught exception. That last part matters here: the
`send-report-whatsapp` function does not exist yet at the moment this plan merges (part 2 authors
it and a human deploys it), so this wrapper MUST degrade to a returned error object, not an
unhandled rejection.

## Deliverables

One file changes: `WebPortal/js/data-functions.js`. Add a single new block, immediately after the
existing report period targets / manual baselines block (which ends at
`upsertReportManualBaseline`, around :6250) and before the
"Sales & Production Data page" block that follows it. Open it with a block comment in the same
voice as its neighbours, naming the three migrations it depends on and stating that whether they
are applied to a given database cannot be verified from this checkout.

### 1. `listReportRecipients(includeInactive = false, token = null, forceRefresh = false)`

Calls `list_report_recipients` with `{ p_include_inactive: !!includeInactive }`. Cached:
`cacheKey: 'report_recipients_' + (includeInactive ? 'all' : 'active')`, `useCache: true`,
`cacheTtl: this.cache.ttl.dynamic`, `forceRefresh: !!forceRefresh` — same options object as
`getReportMetrics` (:6134-6140). Returns the raw result; do not reshape or filter.

### 2. `upsertReportRecipient(displayName, phone, source = 'manual', options = {}, token = null)`

`options` carries the optional `contactId`, `conversationId` and `notes`. Validate locally and
throw before calling:

- `displayName` trimmed must be non-empty → `throw new Error('upsertReportRecipient: displayName is required.')`
- `phone` trimmed must be non-empty → `throw new Error('upsertReportRecipient: phone is required.')`
- `source`, if given, must be one of `'whatsapp_chat'`, `'crm_contact'`, `'manual'` →
  `throw new Error('upsertReportRecipient: source must be whatsapp_chat, crm_contact or manual.')`

Do NOT normalise or reformat the phone number in JS. `report_normalize_wa_phone` does it
server-side and is the single source of truth for what "the same number" means (that is what the
unique index is built on). A second, subtly different JS normalisation here is exactly the defect
part 5's parity harness exists to prevent.

Params: `p_display_name`, `p_phone`, `p_source`, `p_contact_id`, `p_conversation_id`, `p_notes`,
`p_actor_user_id: this.getCurrentUserId() || undefined`. `useCache: false`. Afterwards call
`this.clearCachePattern('report_recipients_')`.

### 3. `setReportRecipientActive(recipientId, isActive, token = null)`

Throws on a missing `recipientId`. Params `p_recipient_id`, `p_is_active: !!isActive`,
`p_actor_user_id`. `useCache: false`, then `this.clearCachePattern('report_recipients_')`.

### 4. `listReportDeliveries(reportInstanceId, token = null, forceRefresh = false)`

Throws on a missing id. `cacheKey: 'report_deliveries_' + id`, `useCache: true`,
`cacheTtl: this.cache.ttl.dynamic`, `forceRefresh`. Returns the raw result.

### 5. `sendReportWhatsapp(payload, token = null)`

The edge-function caller. Modelled line-for-line on `sendWhatsappMessageNow` (:5864-5897).

`payload` is `{ reportInstanceId, pdfBase64, filename, recipients }` where `recipients` is an array
of `{ recipientId?, phone, displayName? }`. Validate locally, throwing a clean `Error`, that:

- `reportInstanceId` is a non-empty string
- `pdfBase64` is a non-empty string
- `filename` is a non-empty string ending in `.pdf`
- `recipients` is a non-empty array and every entry has a non-empty `phone`

POST to `/functions/v1/send-report-whatsapp` with the three headers named in Grounding and a body
of `{ report_instance_id, pdf_base64, filename, recipients }` (snake_case on the wire, matching
every other edge-function body in this repo). Then:

- On a non-`res.ok`, return `{ success: false, error: data.error || ('HTTP ' + res.status) }` —
  the same shape `sendWhatsappMessageNow` returns at :5885-5890.
- On success, return the parsed body unchanged. The contract, which part 2 implements, is
  `{ success: true, sent: <int>, failed: <int>, pdf_storage_path: <text>, results: [ { phone, status, external_message_id, error } ] }`.
- Wrap the whole thing in try/catch and return `{ success: false, error: e.message || String(e) }`
  from the catch, so a not-yet-deployed function surfaces as a handled error.

After a send, clear both caches this feature owns:
`this.clearCachePattern('report_deliveries_')` and `this.clearCachePattern('report_recipients_')`
(a send updates `last_sent_at` in the recipient list).

## Security invariants to state in the code, not infer

- **Never log or console-print `pdfBase64`.** It is the full contents of a confidential report. The
  existing chat wrappers `console.warn` their failures with `e.message` only (:5676, :5731) — keep
  to that, and never widen it to log the payload.
- **This file must not gain a wrapper for `begin_report_delivery`, `complete_report_delivery` or
  `record_report_pdf_storage`.** They are service-role-only by design.
- No value from any of these wrappers is rendered here; this file returns data only. Rendering and
  escaping are parts 3 and 4's problem, and their plans state it.

## Verify before finishing

All three of these run inside the checkout with no browser, no network and no database:

1. `npm run test:fleet` passes. This plan touches one JS file that none of those checks parse for
   behaviour, so this is a non-regression check, not a proof — say so rather than overclaiming.
2. **A pure-Node syntax and shape check.** `node --check WebPortal/js/data-functions.js` exits 0.
   Then, in a throwaway script under `scripts/` that you delete before finishing (or simply a
   one-liner `node -e`), confirm the five new keys are present in the file's exported object by
   grepping: `grep -c "listReportRecipients:\|upsertReportRecipient:\|setReportRecipientActive:\|listReportDeliveries:\|sendReportWhatsapp:" WebPortal/js/data-functions.js` returns 5.
3. **Grep for the forbidden wrappers**: `grep -n "begin_report_delivery\|complete_report_delivery\|record_report_pdf_storage" WebPortal/js/data-functions.js` must return nothing.

## Out of scope

No UI, no HTML, no CSS, no route-config change, no edge function, no migration. Every one of those
belongs to a later part of this batch.

## Report

Keep the final report under 25 lines: the five wrapper names with their line numbers, the three
verify results, and anything you found in the migrations that contradicted this plan.
