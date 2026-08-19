---
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 1b — the four recipient/delivery wrappers part 1 correctly deferred

## Context

Part 1 merged as commit `324bfce` and added exactly one wrapper, `sendReportWhatsapp`. It
**deliberately declined** to add the other four, and its own block comment at
`WebPortal/js/data-functions.js:6250-6255` says why:

> "As of this commit, no migration under migrations/ defines list_report_recipients,
> upsert_report_recipient, set_report_recipient_active or list_report_deliveries (checked by grep
> immediately before writing this block), so those four PostgREST wrappers are not implemented here
> — adding them against a guessed signature would silently call a function this repo does not
> define. They are deferred until a later plan commits the SQL that defines them."

That was the right call and it was true when written. **It is no longer true.** The SQL landed on
`dev` in merge commit `b3e6b66` (PR #47). This plan is the "later plan" that comment names.

Two jobs, and the second is not optional: add the four wrappers, and **correct that stale comment**,
which now asserts something false about the repo in a permanent code artifact.

## Why the comment was accurate and is now wrong — verify this yourself first

Before writing anything, run these and record the results in your report. The point is to confirm
the premise has genuinely changed rather than take this plan's word for it — a previous plan in this
batch was blocked precisely for asserting a database foundation existed when the checkout did not
show it:

```
ls migrations/20260822*
grep -n "list_report_recipients\|upsert_report_recipient\|set_report_recipient_active\|list_report_deliveries" migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql
grep -n "report_normalize_wa_phone" migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql
grep -rn "reports\.report\.send\|reports\.recipient\.manage" migrations/
```

All four must return hits. If any returns nothing, **stop and report that** rather than proceeding —
it would mean this plan's premise is wrong in the same way the earlier one was.

## Grounding — signatures copied verbatim from the migration in this checkout

From `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`, sections 4 and 5:

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

Four facts about these that are easy to get wrong:

1. **`list_report_deliveries` returns `delivery_error`, not `error`.** The leading `error` column is
   the RPC-level fault (non-null only when `success = 0`). The per-row failure text is
   `delivery_error`. Do not rename or remap either one in the wrapper — pass the row through as-is.
2. **`list_report_recipients` already returns `phone` normalised.** Section 4 selects
   `public.report_normalize_wa_phone(r.phone)`, not `r.phone`. So the wrapper must not normalise
   again, and callers get a `+27…` form.
3. **`upsert_report_recipient` matches on the normalised number and reactivates an existing row**
   rather than inserting a duplicate — the unique index
   `idx_report_recipients_phone_norm` is built on `report_normalize_wa_phone(phone)`. So "upsert"
   here can return the id of a row the caller did not know existed. That is intended; do not add a
   client-side existence check to "improve" it.
4. **`p_source` is constrained** to `'whatsapp_chat'`, `'crm_contact'`, `'manual'` by a CHECK on the
   table, and the function silently coerces anything else to `'manual'`. Validate locally anyway so
   a typo surfaces as a clear JS error instead of a silently mislabelled row.

**The three RPCs you must NOT wrap.** `begin_report_delivery`, `complete_report_delivery` and
`record_report_pdf_storage` are `REVOKE`d from `PUBLIC, anon, authenticated` and granted to
`service_role` only — section 7 of the same migration states this and gives the reason: they are
reached from an edge function that has already validated the caller's portal session, and "anything
the browser could call directly it could also call with a forged report id." A browser wrapper would
be a permission error at best, and an invitation to widen the grant at worst. Part 1's merged code
already avoids them; keep it that way.

**`report_normalize_wa_phone` now exists** (same migration, section 1) and returns a `+`-prefixed
form, returning `NULL` for empty input. Note this is a **different** function from
`public.chat_normalize_phone`
(`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92`), which returns bare digits
with **no `+`**. Both exist and both are correct for their own callers. This plan does not implement
either one in JS and does not need to — it is stated here only so a later plan does not assume the
two are interchangeable.

## The house pattern to follow

Model these four on the report-builder wrappers already in this file — `getReportMetrics`
(`WebPortal/js/data-functions.js:6134`), `getReportPeriodTargets` (:6146),
`upsertReportPeriodTarget` (:6163), `listReportInstances` (:5960) — including:

- `callFunction(name, params, token, options)` (:645) as the only transport.
- **Never swallowing an RPC error into a fake empty success.** The block comment at :6087-6095 is
  explicit that a missing migration must surface as a thrown error, not look like "no reports yet".
  Let `callFunction` throw; do not add a try/catch that returns `[]`.
- Local argument validation that throws a clean `Error` **before** the call, in the same
  `'<fnName>: <what is wrong>'` message style as :5940 and :6152.
- `p_actor_user_id: this.getCurrentUserId() || undefined` on writes (:6101).
- `this.clearCachePattern(...)` after every write (:6106-6107).
- The `{ cacheKey, useCache: true, cacheTtl: this.cache.ttl.dynamic, forceRefresh }` options object
  for reads (:6134-6140).

## Deliverables

One file changes: `WebPortal/js/data-functions.js`.

### 1. Correct the stale block comment at :6250-6255

Replace the "As of this commit, no migration under migrations/ defines …" paragraph. The replacement
must state the current truth: the four RPCs are defined in
`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql` (merged in `b3e6b66`) and
are wrapped below; `begin_report_delivery`, `complete_report_delivery` and
`record_report_pdf_storage` are service-role-only and deliberately have no wrapper here.

Keep the paragraph that follows it — the one noting that whether any migration has actually been
applied to a given database cannot be verified from this checkout. That caveat is still true and
every neighbouring block carries it.

Also revise the comment inside `sendReportWhatsapp`'s `finally` block (:6329-6334), which currently
says "No wrapper in this file yet writes the 'report_deliveries_' or 'report_recipients_' cache
prefixes … so both calls are harmless no-ops today." After this plan they are no longer no-ops.
Leave the two `clearCachePattern` calls exactly where they are — the comment's own stated intent was
that a later plan would not have to remember to add them, and that intent is now satisfied.

### 2. `listReportRecipients(includeInactive = false, token = null, forceRefresh = false)`

`{ p_include_inactive: !!includeInactive }`. Cache key
`'report_recipients_' + (includeInactive ? 'all' : 'active')`. Returns the raw result — no filtering,
no reshaping, no sorting (the RPC already orders by `display_name`).

### 3. `upsertReportRecipient(displayName, phone, source = 'manual', options = {}, token = null)`

`options` carries optional `contactId`, `conversationId`, `notes`. Throw before calling when:

- trimmed `displayName` is empty → `'upsertReportRecipient: displayName is required.'`
- trimmed `phone` is empty → `'upsertReportRecipient: phone is required.'`
- `source` is not one of the three allowed values →
  `'upsertReportRecipient: source must be whatsapp_chat, crm_contact or manual.'`

**Do not normalise or reformat the phone number in JS.** `report_normalize_wa_phone` is the single
source of truth for what "the same number" means, because the unique index is built on it. A second,
subtly different JS normalisation is exactly the drift that a later plan in this batch adds a harness
to prevent.

Params `p_display_name`, `p_phone`, `p_source`, `p_contact_id`, `p_conversation_id`, `p_notes`,
`p_actor_user_id`. `useCache: false`, then `this.clearCachePattern('report_recipients_')`.

### 4. `setReportRecipientActive(recipientId, isActive, token = null)`

Throws on a missing `recipientId`. Params `p_recipient_id`, `p_is_active: !!isActive`,
`p_actor_user_id`. `useCache: false`, then `this.clearCachePattern('report_recipients_')`.

### 5. `listReportDeliveries(reportInstanceId, token = null, forceRefresh = false)`

Throws on a missing id. Cache key `'report_deliveries_' + id`. Returns the raw result.

## Blast radius on existing behaviour

`sendReportWhatsapp` at :6263-6335 is the only existing code in this region and this plan does not
change its logic — only the two comments named above. Nothing else in `WebPortal/` calls any of the
five names yet (`grep -rn "listReportRecipients\|listReportDeliveries\|upsertReportRecipient\|setReportRecipientActive" WebPortal/`
returns only the definitions after this change), so no existing screen can regress. State that grep's
result in your report rather than assuming it.

No existing test asserts anything about this file's contents. `npm run test:fleet` does not parse it
for behaviour, so a green run is a non-regression signal, not a proof — say so rather than
overclaiming.

## Verify before finishing

All hermetic: no browser, no network, no database.

1. The four premise greps from "Why the comment was accurate and is now wrong", with their output.
2. `node --check WebPortal/js/data-functions.js` exits 0.
3. `grep -c "listReportRecipients:\|upsertReportRecipient:\|setReportRecipientActive:\|listReportDeliveries:\|sendReportWhatsapp:" WebPortal/js/data-functions.js`
   returns 5.
4. `grep -n "begin_report_delivery\|complete_report_delivery\|record_report_pdf_storage" WebPortal/js/data-functions.js`
   returns **nothing**.
5. `grep -n "As of this commit, no migration" WebPortal/js/data-functions.js` returns **nothing** —
   proving the stale claim is gone rather than merely supplemented.
6. Each of the four wrappers' `p_` parameter names, checked one by one against the `CREATE OR REPLACE
   FUNCTION` signatures in
   `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`. List each match in the
   report. A wrapper passing a parameter name the function does not declare fails as "function not
   found" at runtime with no hint as to why, and no static check in this repo would catch it.
7. `npm run test:fleet` passes.

## Out of scope

No UI, HTML, CSS or route-config change. No migration — the SQL is already written and applied. No
edge function. No wrapper for the three service-role-only RPCs.

## Report

Under 25 lines: the premise-grep results, the five wrapper names with line numbers, the
parameter-name cross-check for all four, the verify results, and anything in the merged part 1 code
or the migration that contradicted this plan.
