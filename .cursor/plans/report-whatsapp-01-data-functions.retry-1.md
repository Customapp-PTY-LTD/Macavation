---
notify: henry@customapp.co.za
retry_of: 75232922-62ff-4893-aa18-27538da82275
---

# Report WhatsApp distribution, part 1 — the transport layer in data-functions.js

## Context

A Sales & Production report can already be created, edited, PDF-exported and published. It cannot
be **sent to anyone**. This plan adds **only transport wrappers** in
`WebPortal/js/data-functions.js` — nothing user-visible. It is deliberately first and deliberately
small, because the send dialog (part 3) and the delivery-history panel (part 4) both consume these
wrappers, and both would otherwise edit this same shared file and collide.

`WebPortal/js/data-functions.js` is a shared coordination file. No other plan in this batch touches
it — parts 3, 4 and 5 depend on this one landing first.

**Scope change from the original draft of this plan, and the reason for it.** The original draft
asserted that three migrations defining the recipient/delivery RPCs were committed in this
checkout and were "the contract". They are not here (see Grounding). The plan is therefore
narrowed: the edge-function wrapper ships unconditionally, and the four PostgREST wrappers ship
**only if** the defining SQL is actually present in `migrations/` when you run, in which case you
derive their parameter names by reading that SQL. If the SQL is absent you ship a recorded gap
instead of guessed code. Parts 3 and 4 must not assume the four wrappers exist; whichever part
lands the migrations lands them.

## Grounding — verified against this checkout only

Everything in this section was confirmed by reading files in this checkout. Nothing here rests on
the state of any database, and you must not add anything to this plan's output that does.

**What is NOT here — confirm this yourself before writing any code.**

- There is no `migrations/20260822*` file of any kind. The newest migration in `migrations/` is
  `20260821180000_report_targets_module.sql`.
- A repo-wide grep for `list_report_recipients`, `upsert_report_recipient`,
  `set_report_recipient_active`, `list_report_deliveries`, `begin_report_delivery`,
  `complete_report_delivery`, `record_report_pdf_storage`, `report_normalize_wa_phone`,
  `report_recipient`, `report_deliver` and `send-report-whatsapp` returns **zero matches**.
- `supabase/functions/` contains eight functions (`send-whatsapp-message`,
  `send-daily-digest-whatsapp`, `send-daily-digest`, `whatsapp-inbound`, `auth-google`,
  `send-password-reset`, `portal-assistant`, `evaluate-stock-alerts-cron`).
  `send-report-whatsapp` is **not** among them; part 2 authors it and a human deploys it.

**Hard constraint on sourcing.** You may not reconstruct any RPC signature, parameter name,
enum/allowlist value or result-column name from this plan's prose, from a commit message, from a
sibling plan, or from memory. The only admissible source for a PostgREST parameter name is SQL you
have read in `migrations/` in this checkout. This is not pedantry: `data-functions.js:6258-6260`
records that a single wrong or stripped parameter surfaces as "function not found", which is
indistinguishable from an unapplied migration, so a wrong guess fails silently at runtime and no
check in this repo would catch it.

**Claims from the original draft that you must treat as unverified and must not restate anywhere**
(not in code, not in comments, not in the final report): that the RPCs were applied to any named
database on any date; that `begin_report_delivery`, `complete_report_delivery` and
`record_report_pdf_storage` are granted to `service_role` only; that `report_normalize_wa_phone`
exists and backs a unique index. None of these can be checked from this checkout.

**The house pattern for an RPC wrapper** is `callFunction(name, params, token, options)`
(`WebPortal/js/data-functions.js:645`). Note it throws `'No authentication token available. Please
sign in again.'` when there is no token (:648-650), and it honours
`cacheKey` / `useCache` / `cacheTtl` / `forceRefresh` (:653-656).

Verified neighbours to model on, with corrected citations:

- Block-comment voice and the no-fake-success rule: the report-builder block header at
  **:5917-5925**, whose text at **:5922-5924** says a missing migration must surface as a thrown
  error, "not look like 'no reports yet'". (The original draft cited :6087-6095 for this; that is
  `deleteReportInstance`'s offline-queueing comment — do not copy it.)
- Local argument validation that throws before the call:
  `throw new Error('getReportCurrentPeriod: periodType is required.')` at **:5938-5940**, inside
  **`getReportCurrentPeriod`**. (The original draft attributed this throw to `listReportInstances`;
  `listReportInstances` at :5951-5966 contains no validation throws at all. It does pass
  `p_limit`/`p_offset` — relevant to Deliverable 3 below.)
- Actor stamping and cache clearing: `publishReportInstance` :6096, with
  `p_actor_user_id: this.getCurrentUserId() || undefined` at :6101 and `this.clearCachePattern(...)`
  at :6106-6107.
- Cached-read options object: `getReportMetrics` :6135-6145.
- `clearCachePattern` itself is a substring sweep over the in-memory cache map (:129-135). Calling
  it with a prefix nothing has ever written is a harmless no-op — this matters for Deliverable 2.
- Failure logging precedent: `console.warn('[Chat] …', e.message)` at :5676 and :5731 — message
  only, never the payload.

**The edge-function call pattern** is `sendWhatsappMessageNow` (**:5864-5897**), verified
line-by-line: URL from `window.MACAVATION_SUPABASE` with `.url` run through `.replace(/\/$/, '')`
plus `/functions/v1/<name>` (:5866-5867); headers `Authorization: Bearer <anonKey>`,
`apikey: <anonKey>`, `X-Portal-Session: <token || this.getToken()>` (:5873-5878);
`{ success: false, error: data.error || 'HTTP ' + res.status }` on `!res.ok` (:5884-5889); parsed
body returned unchanged on success (:5891); `{ success: false, error: e.message || String(e) }`
from the catch (:5892-5897).

**The two RPCs that already back the recipient picker's other sources** (part 3 uses these; this
plan does not add them and must not duplicate them):

- `dataFunctions.getContactsForMessaging()` — `WebPortal/js/data-functions.js:5723`, calling
  `get_contacts_for_messaging` (`migrations/20260812100000_crm_whatsapp_module.sql`).
- `dataFunctions.chatListWhatsappConversations(userId)` — `WebPortal/js/data-functions.js:5761`,
  calling `chat_list_whatsapp_conversations`
  (`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql`).

Both migrations exist in this checkout; both citations were re-verified.

## Deliverables

One file changes: `WebPortal/js/data-functions.js`. Add a single new block immediately after
`upsertReportManualBaseline` (which ends at **:6238**) and before the "Sales & Production Data
page" block header at **:6240-6247**.

### 1. The block comment (unconditional)

Open the new block with a comment in the same voice as :5917-5925 and :6240-6247 that states, in
plain terms and using only facts you have re-confirmed by grep at implementation time:

- what the block is for (report WhatsApp distribution transport);
- that as of this commit **no migration in `migrations/` defines** `list_report_recipients`,
  `upsert_report_recipient`, `set_report_recipient_active` or `list_report_deliveries`, and that
  the recipient/delivery wrappers are therefore deferred until such a migration is committed here
  (omit this bullet, and say which migration files you read instead, if Deliverable 3's
  precondition turned out to be met);
- that `supabase/functions/send-report-whatsapp` does not exist in this checkout either, which is
  why the edge-function wrapper returns an error object instead of throwing;
- that whether any migration has been applied to a given database cannot be verified from this
  checkout — the same caveat its neighbours carry.

Do not write a date, a project ref, or a claim about who applied what where.

### 2. `sendReportWhatsapp(payload, token = null)` (unconditional)

The edge-function caller, modelled on `sendWhatsappMessageNow` (:5864-5897). This wrapper's request
body is a contract **this batch defines** for part 2 to implement; it is not read from any existing
file, and the wrapper is built so that a missing or undeployed function is a handled, returned
error rather than an exception.

`payload` is `{ reportInstanceId, pdfBase64, filename, recipients }`, where `recipients` is an
array of `{ recipientId?, phone, displayName? }`. Validate locally, throwing a clean `Error`, that:

- `reportInstanceId` is a non-empty string
- `pdfBase64` is a non-empty string
- `filename` is a non-empty string ending in `.pdf`
- `recipients` is a non-empty array and every entry has a non-empty `phone`

**Session guard — required, and a deliberate divergence from the model wrapper.**
`sendWhatsappMessageNow` falls back to `'X-Portal-Session': authToken || ''` and posts anyway. Do
not reuse that fallback unchanged here: this payload is a full confidential report PDF, and posting
it bearing only the public anon key is a different risk from posting a text message. Before
building the request, resolve `const authToken = token || this.getToken();` and if it is falsy,
**return** `{ success: false, error: 'sendReportWhatsapp: no portal session; not sending.' }`
without issuing the fetch. Return, do not throw — this wrapper's whole contract is that it never
rejects.

Then, exactly as the model does: build the URL from `window.MACAVATION_SUPABASE`
(`.url` with the trailing slash stripped via `.replace(/\/$/, '')`) plus
`/functions/v1/send-report-whatsapp`; send the three headers; POST a body of
`{ report_instance_id, pdf_base64, filename, recipients }` (snake_case on the wire, matching every
other edge-function body in this repo).

- On a non-`res.ok`, return `{ success: false, error: data.error || ('HTTP ' + res.status) }`.
- On success, return the parsed body unchanged. Do not reshape it and do not document its shape as
  settled — part 2 authors the response; a comment may say what this wrapper *expects*, phrased as
  an expectation, or say nothing.
- Wrap the whole thing in try/catch and return `{ success: false, error: e.message || String(e) }`
  from the catch, so a not-yet-deployed function surfaces as a handled error.

After a send, call `this.clearCachePattern('report_deliveries_')` and
`this.clearCachePattern('report_recipients_')`. These are correct now and remain correct if
Deliverable 3 never lands: `clearCachePattern` (:129-135) simply deletes matching keys from the
in-memory map, so with no wrapper writing those prefixes both calls are no-ops. Add a one-line
comment saying so, so a later reader does not conclude the wrapper is broken or that the missing
wrappers must exist.

### 3. Recipient and delivery wrappers — CONDITIONAL, gated on SQL you can read

First, run this check in the checkout (no network, no database):

```
ls migrations/ | grep -i 'report.*\(recipient\|deliver\|whatsapp_send\)'
grep -rl 'list_report_recipients\|upsert_report_recipient\|set_report_recipient_active\|list_report_deliveries' migrations/
```

**If both return nothing** (the expected outcome on this base branch): implement **none** of
`listReportRecipients`, `upsertReportRecipient`, `setReportRecipientActive` or
`listReportDeliveries`. Do not stub them, do not add them throwing "not implemented", do not add
commented-out drafts. Record the gap in the block comment per Deliverable 1 and in the final
report, and stop — Deliverable 2 is the whole change.

**If and only if** those greps find real SQL, implement the four wrappers, subject to all of:

- Read the `CREATE FUNCTION` statements you found and take every parameter name, default,
  allowlist/CHECK value and result-column name **from that SQL verbatim**. If the SQL disagrees
  with any expectation carried in a sibling plan, the SQL wins; say so in the final report.
- Model each read wrapper's options object on `getReportMetrics` (:6135-6145) and each write
  wrapper on `publishReportInstance` (:6096-6109): `p_actor_user_id: this.getCurrentUserId() ||
  undefined` for any actor parameter the SQL actually declares, `useCache: false` on writes, and
  `this.clearCachePattern('report_recipients_')` after every recipient write.
- Cache keys: `'report_recipients_' + (includeInactive ? 'all' : 'active')` for the recipient list
  and `'report_deliveries_' + <instance id>` for the delivery list, so Deliverable 2's sweeps match.
- Throw a clean local `Error` in the `'<wrapperName>: <arg> is required.'` form of :5938-5940 for
  every argument the SQL declares without a DEFAULT, before calling — a no-DEFAULT parameter that
  arrives blank is stripped by PostgREST and reported as a missing function (:6258-6260).
- If — and only if — the SQL declares limit/offset parameters, pass them through the way
  `listReportInstances` does (:5951-5957). Do not invent limit or offset arguments the SQL does not
  declare, and do not filter or slice results client-side to simulate them.
- Return the raw result of each read wrapper. Do not reshape it, do not rename result columns, and
  never convert an RPC error into an empty-but-successful value (:5922-5924).
- Do not normalise or reformat phone numbers in JS. A transport wrapper passes the caller's string
  through, exactly as `upsertReportManualBaseline` (:6218-6238) only trims and stringifies. Whatever
  the database considers "the same number" is decided server-side; a second, subtly different JS
  normalisation is precisely the defect part 5's parity harness exists to prevent.

## Security invariants to state in the code, not infer

- **Never log or console-print `pdfBase64`, and never include it in an error message or a thrown
  `Error`.** It is the full contents of a confidential report. Follow the `console.warn(…,
  e.message)` precedent at :5676 and :5731 — message only.
- **Do not POST the PDF without a portal session.** The guard in Deliverable 2 is a hard
  requirement, not an optimisation.
- **Do not add a browser wrapper for `begin_report_delivery`, `complete_report_delivery` or
  `record_report_pdf_storage`.** No migration in this checkout defines them, so a wrapper would call
  a name this repo does not define. State that as the reason in code if you state a reason; do not
  assert anything about their grants, which cannot be checked here.
- No value from any of these wrappers is rendered here; this file returns data only. Rendering and
  escaping are parts 3 and 4's problem, and their plans state it.

## Verify before finishing

All of these run inside the checkout with no browser, no network and no database.

1. `npm run test:fleet` passes. This plan touches one JS file that none of those checks parse for
   behaviour (`reports:verify` only exercises `report-pdf-builder.js`), so this is a non-regression
   check, not a proof — say exactly that in the report rather than overclaiming.
2. `node --check WebPortal/js/data-functions.js` exits 0.
3. Per-identifier presence, matching the function-definition line so that prose in your own block
   comment cannot change the result. `sendReportWhatsapp` must be present:
   `grep -nE '^\s*sendReportWhatsapp: async function' WebPortal/js/data-functions.js` returns
   exactly one line. Run the same pattern for `listReportRecipients`, `upsertReportRecipient`,
   `setReportRecipientActive` and `listReportDeliveries`: each must return **exactly one line if
   and only if** Deliverable 3's precondition was met, and **zero lines** otherwise. Report which
   branch you were in and paste the counts.
4. Forbidden names absent:
   `grep -n 'begin_report_delivery\|complete_report_delivery\|record_report_pdf_storage' WebPortal/js/data-functions.js`
   must return nothing.
5. Re-run Deliverable 3's gate greps once more at the end and paste their output verbatim into the
   report, so the branch you took is evidenced rather than asserted.

## Out of scope

No UI, no HTML, no CSS, no route-config change, no edge function, no migration. Authoring the
missing recipient/delivery SQL is explicitly **not** this plan's job — do not create a migration to
unblock Deliverable 3, and do not `CREATE OR REPLACE` anything. Every one of those belongs to a
later part of this batch.

## Report

Keep the final report under 25 lines: which branch of Deliverable 3 you took and the verbatim gate
grep output that decided it; the wrapper names you actually added with their line numbers; the five
verify results; and anything you read in `migrations/` that contradicted this plan. Do not state
anything about a database's contents or about which migrations have been applied anywhere.
