---
notify: henry@customapp.co.za
retry_of: ded92e05-93d0-41a4-8be4-459334c122e1
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

From `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`, sections 4 and 5
(definition lines: `list_report_recipients` :159, `upsert_report_recipient` :201,
`set_report_recipient_active` :265, `list_report_deliveries` :390):

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

1. **`list_report_deliveries` returns `delivery_error`, not `error`** (OUT column :403, fed from
   `d.error` :432). The leading `error` column is the RPC-level fault (non-null only when
   `success = 0`). The per-row failure text is `delivery_error`. Do not rename or remap either one
   in the wrapper — pass the row through as-is.
2. **`list_report_recipients` already returns `phone` normalised.** Section 4 selects
   `public.report_normalize_wa_phone(r.phone)` (:185), not `r.phone`. So the wrapper must not
   normalise again, and callers get a `+27…` form.
3. **`upsert_report_recipient` matches on the normalised number and reactivates an existing row**
   (:235-258) rather than inserting a duplicate — the unique index
   `idx_report_recipients_phone_norm` (:93) is built on `report_normalize_wa_phone(phone)`. So
   "upsert" here can return the id of a row the caller did not know existed. That is intended; do
   not add a client-side existence check to "improve" it.
4. **`p_source` is constrained** to `'whatsapp_chat'`, `'crm_contact'`, `'manual'` by a CHECK on the
   table (:80), and the function silently coerces anything else to `'manual'` (:229-231). Validate
   locally anyway so a typo surfaces as a clear JS error instead of a silently mislabelled row.

Two transport facts, verified in this checkout, that the wrappers depend on:

- `buildPostgrestRpcBody` (:502-522) strips a value only when it is `null`, `undefined` or `''`
  under strict equality. **`false` survives.** That matters for `p_is_active`, which has **no
  DEFAULT** (:267): a stripped `false` would make PostgREST fail overload resolution and report
  "could not find the function", i.e. every *deactivate* would break. Pass `p_is_active: !!isActive`
  and do not stringify it, and do not pass `preserveNullParams` / `preserveEmptyParams` — they are
  not needed here because every param this plan sends is either a validated non-empty string, a
  boolean, or an intentionally-omitted optional.
- `p_actor_user_id` has `DEFAULT NULL` in **both** write RPCs (`upsert_report_recipient` :208,
  `set_report_recipient_active` :268). So the house `this.getCurrentUserId() || undefined` fallback
  is safe at **both** new call sites: `undefined` is stripped and the DEFAULT applies. Do not
  substitute a placeholder/sentinel uuid, and do not add `preserveNullParams` to force an explicit
  NULL.
- Offline queuing in `callFunction` (:672-676, :781-784) triggers only when the RPC *name* contains
  `create`, `update`, `delete` or `deactivate`. None of `list_report_recipients`,
  `upsert_report_recipient`, `set_report_recipient_active`, `list_report_deliveries` contains any of
  those substrings, so none of the four is ever offline-queued. **Do not copy the
  "callFunction queues this while offline" comment from `createReportInstance` (:5978-5979) onto any
  of these four wrappers** — it would be a false statement in a permanent artifact.

**The three RPCs you must NOT wrap.** `begin_report_delivery`, `complete_report_delivery` and
`record_report_pdf_storage` are `REVOKE`d from `PUBLIC, anon, authenticated` and granted to
`service_role` only (:509-514); section 7 of the same migration gives the reason (:495-500): they
are reached from an edge function that has already validated the caller's portal session, and
"anything the browser could call directly it could also call with a forged report id." A browser
wrapper would be a permission error at best, and an invitation to widen the grant at worst. Part 1's
merged code already avoids them; keep it that way. **This is a security invariant of this change:
the three names may appear in this file only inside `//` comment text that documents the boundary,
and never inside a `callFunction(...)` argument.**

**`report_normalize_wa_phone` now exists** (same migration, section 1, :46) and returns a
`+`-prefixed form, returning `NULL` for empty input. Note this is a **different** function from
`public.chat_normalize_phone`
(`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92`), which returns bare digits
with **no `+`**. Both exist and both are correct for their own callers. This plan does not implement
either one in JS and does not need to — it is stated here only so a later plan does not assume the
two are interchangeable.

## The house pattern to follow

Model these four on the report-builder wrappers already in this file — `getReportMetrics`
(`WebPortal/js/data-functions.js:6135`), `getReportPeriodTargets` (:6148),
`upsertReportPeriodTarget` (:6163), `listReportInstances` (:5951) — including:

- `callFunction(name, params, token, options)` (:645) as the only transport.
- **Never swallowing an RPC error into a fake empty success.** The block comment at **:5922-5924**
  is explicit that a missing migration must surface as a thrown error, not look like "no reports
  yet". Let `callFunction` throw; do not add a try/catch that returns `[]` or
  `{ success: false }` in any of the four new wrappers. Note the one deliberate exception already in
  this region: `sendReportWhatsapp` returns a handled `{ success: false, error }` for
  *edge-function transport* failures, and its own comment at :6241-6248 explains why. That exception
  is correct for an edge-function call and must NOT be extended to these four PostgREST wrappers,
  and `sendReportWhatsapp` must NOT be "made consistent" by converting it to throw.
- Local argument validation that throws a clean `Error` **before** the call, in the same
  `'<fnName>: <what is wrong>'` message style as :5940 and :6151-6152.
- `p_actor_user_id: this.getCurrentUserId() || undefined` on writes (as at :6177 and :6012).
- `this.clearCachePattern(...)` after every write (as at :6180-6181).
- The `{ cacheKey, useCache: true, cacheTtl: this.cache.ttl.dynamic, forceRefresh: !!forceRefresh }`
  options object for reads (:6140-6145).
- Declare each wrapper in the same form and at the same indentation as its neighbours —
  `<name>: async function (<args>) {` as a direct property of the returned object (compare
  :6135, :6148, :6263). Verify step 3 below is an anchored grep on exactly that form; a different
  shape (arrow property, `async <name>()` shorthand) will fail it.

## Deliverables

One file changes: `WebPortal/js/data-functions.js`.

### 1. Correct the stale block comment at :6250-6255

Replace the "As of this commit, no migration under migrations/ defines …" paragraph. The replacement
must state the current truth, and must include **both** of these:

- the four RPCs are defined in
  `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql` (merged in `b3e6b66`)
  and are wrapped below;
- `begin_report_delivery`, `complete_report_delivery` and `record_report_pdf_storage` are
  service-role-only (REVOKE/GRANT lines at :509-514 of that migration) and deliberately have **no**
  wrapper here.

The three service-role-only names **must be written out literally** in that comment. This is
required, not optional: verify step 4 below checks for their presence as documentation *and* for
their absence as call sites. Do not omit them to make a grep pass.

Keep the paragraph that follows it (:6257-6259) — the one noting that whether any migration has
actually been applied to a given database cannot be verified from this checkout. That caveat is
still true and every neighbouring block carries it (compare :6129-6130, :6339-6340).

Also revise the comment inside `sendReportWhatsapp`'s `finally` block at **:6327-6331**, which
currently says "No wrapper in this file yet writes the 'report_deliveries_' or 'report_recipients_'
cache prefixes … so both calls are harmless no-ops today." After this plan they are no longer
no-ops: `clearCachePattern` matches with `key.includes(pattern)` (:129-135), and the cache keys
added below (`report_recipients_all` / `report_recipients_active`, `report_deliveries_<id>`) are
matched by those two prefixes. The revised comment must say that they now invalidate real keys.
Leave the two `clearCachePattern` calls exactly where they are (:6332-6333) — the comment's own
stated intent was that a later plan would not have to remember to add them, and that intent is now
satisfied. Do not add or remove any `clearCachePattern` call inside `sendReportWhatsapp`.

### 2. `listReportRecipients(includeInactive = false, token = null, forceRefresh = false)`

`{ p_include_inactive: !!includeInactive }`. Cache key
`'report_recipients_' + (includeInactive ? 'all' : 'active')`. Returns the raw result — no filtering,
no reshaping, no sorting (the RPC already orders by `display_name`, :197). Read options object per
the house pattern; no `clearCachePattern`.

### 3. `upsertReportRecipient(displayName, phone, source = 'manual', options = {}, token = null)`

`options` carries optional `contactId`, `conversationId`, `notes`. Throw before calling when:

- trimmed `displayName` is empty → `'upsertReportRecipient: displayName is required.'`
- trimmed `phone` is empty → `'upsertReportRecipient: phone is required.'`
- `source` is not one of the three allowed values →
  `'upsertReportRecipient: source must be whatsapp_chat, crm_contact or manual.'`

These three `'<fnName>: …'` messages are mandatory and must not be shortened, merged or dropped —
no verify step in this plan counts them, so there is no reason to trim them.

**Do not normalise or reformat the phone number in JS.** `report_normalize_wa_phone` is the single
source of truth for what "the same number" means, because the unique index is built on it. A second,
subtly different JS normalisation is exactly the drift that a later plan in this batch adds a harness
to prevent.

Params `p_display_name`, `p_phone`, `p_source`, `p_contact_id`, `p_conversation_id`, `p_notes`,
`p_actor_user_id` (the last as `this.getCurrentUserId() || undefined`). `useCache: false`, then
`this.clearCachePattern('report_recipients_');`.

### 4. `setReportRecipientActive(recipientId, isActive, token = null)`

Throws `'setReportRecipientActive: recipientId is required.'` on a missing/blank `recipientId`.
Params `p_recipient_id`, `p_is_active: !!isActive`, `p_actor_user_id`. `useCache: false`, then
`this.clearCachePattern('report_recipients_');`. `p_is_active` has no DEFAULT — always send it, in
both the `true` and `false` case (see the transport facts above).

### 5. `listReportDeliveries(reportInstanceId, token = null, forceRefresh = false)`

Throws `'listReportDeliveries: reportInstanceId is required.'` on a missing/blank id. Cache key
`'report_deliveries_' + id`. Returns the raw result. Read options object per the house pattern; no
`clearCachePattern`.

## Blast radius on existing behaviour

`sendReportWhatsapp` at :6263-6335 is the only existing code in this region and this plan does not
change its logic — only the two comments named above (:6250-6255 and :6327-6331). Nothing else in
`WebPortal/` calls any of the five names yet
(`grep -rn "listReportRecipients\|listReportDeliveries\|upsertReportRecipient\|setReportRecipientActive" WebPortal/`
returns only the definitions after this change), so no existing screen can regress. State that
grep's result in your report rather than assuming it.

Because no UI consumes the four new wrappers, this change alters no user-visible behaviour, copy,
navigation or route, so no `WebPortal/help/` page or route appendix needs editing in this commit; if
that grep unexpectedly shows a caller outside this file, stop and report it instead of wiring a
screen up here.

No existing test asserts anything about this file's contents: no script referenced by
`package.json`'s `test:fleet` (`routing:verify`, `username:verify`,
`scripts/verify-phase2-migrations.mjs`, `ui:verify`, `migrations:verify`, `registry:verify`,
`reports:verify`) reads `WebPortal/js/data-functions.js` — `reports:verify` reads
`WebPortal/modules/sales-reports/js/report-pdf-builder.js`. So a green run is a non-regression
signal, not a proof — say so rather than overclaiming. Do not modify `package.json` scripts.

## Verify before finishing

All hermetic: no browser, no network, no database. Run every step and paste its actual output; if a
step's output disagrees with the expected value stated here, **report the disagreement rather than
editing code to force the number**.

1. The four premise greps from "Why the comment was accurate and is now wrong", with their output.

2. **Parse check, baselined.** `package.json` sets `"type": "module"` (:4) while
   `WebPortal/js/data-functions.js` is a classic browser script (top-level `var _dataFunctions`
   at :7, `window.dataFunctions` at :6661), so `node --check` on it may be evaluated under ESM
   rules. Therefore: run the check **once on the unmodified file before editing** and record the
   result, then run the identical command after editing. The requirement is *no new parse error
   relative to that baseline*. Primary command (module-mode independent, Node stdlib only):

   ```
   node --input-type=module -e "import fs from 'node:fs'; import vm from 'node:vm'; new vm.Script(fs.readFileSync('WebPortal/js/data-functions.js','utf8')); console.log('parsed ok');"
   ```

   Also report `node --check WebPortal/js/data-functions.js` before and after, for information.

3. **Definition count (definitions only, not error-message lines).**

   ```
   grep -cE "^[[:space:]]*(listReportRecipients|upsertReportRecipient|setReportRecipientActive|listReportDeliveries|sendReportWhatsapp): async function \(" WebPortal/js/data-functions.js
   ```

   Expected: **5** — one pre-existing (`sendReportWhatsapp`, :6263) plus the four added here. This
   pattern is anchored to the declaration form, so the `'<fnName>: …'` validation strings do NOT
   inflate it. (A bare `grep -c "sendReportWhatsapp:"` matches 7 lines today — :6263, :6269, :6270,
   :6271, :6272, :6275, :6283 — which is why counting must be anchored to `: async function (`.)
   If this returns other than 5, the fix is to align a wrapper's declaration form with the house
   pattern, never to delete a validation throw or its message prefix.

4. **Service-role boundary: documented, but never called.** Two complementary checks; both are
   required, and neither may be satisfied by deleting the Deliverable-1 comment.

   4a. No call site:
   ```
   grep -nE "callFunction\('(begin_report_delivery|complete_report_delivery|record_report_pdf_storage)'" WebPortal/js/data-functions.js
   ```
   Expected: **no output**.

   4b. Every mention is comment text (not code):
   ```
   grep -nE "(begin_report_delivery|complete_report_delivery|record_report_pdf_storage)" WebPortal/js/data-functions.js | grep -vE "^[0-9]+:[[:space:]]*//"
   ```
   Expected: **no output** — i.e. each of the three names appears only on `//` comment lines.

   4c. The documentation is actually present:
   ```
   grep -c "begin_report_delivery" WebPortal/js/data-functions.js
   grep -c "complete_report_delivery" WebPortal/js/data-functions.js
   grep -c "record_report_pdf_storage" WebPortal/js/data-functions.js
   ```
   Each expected: **at least 1** (all three are 0 in the unmodified file; Deliverable 1 introduces
   them as comment text). A zero here means the boundary note was omitted and the change is not
   done.

5. `grep -n "As of this commit, no migration" WebPortal/js/data-functions.js` returns **nothing** —
   proving the stale claim is gone rather than merely supplemented. Likewise
   `grep -n "harmless no-ops today" WebPortal/js/data-functions.js` returns **nothing**, proving the
   `finally`-block comment was revised.

6. **Cache-invalidation counts, with their derivation:**
   ```
   grep -c "this.clearCachePattern('report_recipients_');" WebPortal/js/data-functions.js   # expected 3
   grep -c "this.clearCachePattern('report_deliveries_');" WebPortal/js/data-functions.js   # expected 1
   ```
   3 = the pre-existing call in `sendReportWhatsapp`'s `finally` (:6333) + `upsertReportRecipient` +
   `setReportRecipientActive`. 1 = the pre-existing `finally` call (:6332) only; no wrapper in this
   plan clears `report_deliveries_`.

7. Each of the four wrappers' `p_` parameter names, checked one by one against the `CREATE OR REPLACE
   FUNCTION` signatures in
   `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql` (:159, :201, :265,
   :390). List each match in the report. A wrapper passing a parameter name the function does not
   declare fails as "function not found" at runtime with no hint as to why, and no static check in
   this repo would catch it.

8. The blast-radius grep from the section above, with its output.

9. `npm run test:fleet` passes.

## Out of scope

No UI, HTML, CSS, help-page or route-config change. No migration — the SQL is already written in
this checkout (whether it has been applied to any given database cannot be verified from here, which
is exactly why the caveat paragraph at :6257-6259 stays). No edge function. No wrapper for the three
service-role-only RPCs, and no change to any GRANT/REVOKE. No change to `package.json` or to any
`scripts/verify-*` file. No change to `sendReportWhatsapp`'s logic, its returned-failure contract, or
the placement of its two `clearCachePattern` calls.

## Report

Under 25 lines: the premise-grep results, the five wrapper names with line numbers, the
parameter-name cross-check for all four, the verify results (including the before/after parse
baseline and the exact counts from steps 3, 4c and 6), and anything in the merged part 1 code or the
migration that contradicted this plan.
