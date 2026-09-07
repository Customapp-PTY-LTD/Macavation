---
depends_on: wa-flow-07-panel-add-and-join.md
---

# WhatsApp: show delivery receipts on the panel, and a "Test send to me" button

## Context

WhatsApp already tells Macavation when a message is delivered and when it is read — Meta sends a
status webhook for both. `whatsapp-inbound` already receives that webhook and already records it,
but only against `chat_messages` (the shared team inbox), via `chat_record_whatsapp_status`, keyed
on wamid. **Nothing records a status update against `report_deliveries`.** Its own status column is
`CHECK (status = ANY (ARRAY['pending', 'sent', 'failed']))` — there is no `delivered` or `read`
state to hold one even if something tried to write it. So "did they get it" is currently
unanswerable from the panel for a report send, even though the data to answer it already arrives on
every send.

This plan closes that gap, and adds a "Test send to me" control so a report can be proven on one's
own handset before it reaches everyone on the roster — the second half of the same trust problem.

## Read this first

Locate every symbol **by name** and read it before writing against it.

### The status webhook path — `supabase/functions/whatsapp-inbound/index.ts`

Find the loop that iterates inbound `statuses[]` entries and calls `chat_record_whatsapp_status`
(search for that RPC name). Read the surrounding ~30 lines: it extracts `wamid`, `status`, and an
error text from Meta's status payload, and its own comment records the reason a status must never
dispatch a bot command — the bot's own replies generate statuses, so treating one as a command
would loop. **This plan extends this same loop**; it does not add a second webhook handler.

### `report_deliveries`'s current status enum

`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql` — the
`report_deliveries_status_check` constraint is `ARRAY['pending', 'sent', 'failed']`. **No
`delivered` or `read` state exists.** This is a real gap, not an oversight to route around;
deliverable 1 below adds to this enum.

### The RPCs that write and read delivery rows

- `begin_report_delivery(...)` / `complete_report_delivery(...)` — every sender in this codebase
  (`send-daily-production-report`, `send-report-whatsapp`, and wa-flow-04's `send-period-report`)
  calls these around its send. `complete_report_delivery` is where `external_message_id` is set
  from the send result's wamid. Read its full parameter list before adding a new one to it — do
  not duplicate what it already records.
- `list_report_deliveries(p_report_instance_id uuid)` at about `:390` of the same migration —
  already returns `status`, `external_message_id`, `completed_at` per row, already granted to
  `anon, authenticated, service_role`. This is what the panel will call to render receipts; it
  needs a new **timestamp column for when a status update was last recorded** (see deliverable 1),
  which this function must then also return.
- **Two idempotency functions now exist, and this section originally described a wa-flow-04 that
  had not yet been built — corrected here against the actual merged migration
  (`migrations/20260908090000_period_report_senders.sql:153-163`), not the earlier assumption.**
  `daily_report_already_sent(p_date)` (`20260825091000_daily_production_report.sql:279-287`) keys
  on `d.report_kind = 'daily' AND d.report_date = p_date AND d.status = 'sent'` — no
  `message_kind` clause, because `send-report-whatsapp`'s manual sends default to
  `report_kind='weekly'` (never `'daily'`), so a manual send can never masquerade as one.
  `period_report_already_sent(p_report_instance_id)` keys on
  `d.report_instance_id = p_report_instance_id AND d.status = 'sent' AND d.message_kind =
  'template'` — the `message_kind = 'template'` clause is load-bearing there specifically because
  a manual send **can** collide on `report_instance_id` for a weekly/monthly report, and without it
  one manual send to one person would suppress the automatic broadcast to everyone else. **Neither
  function's WHERE clause may be touched by this plan**, and a receipt update must never move
  `status` away from `'sent'` to something either check would stop matching — idempotency for both
  keeps checking for `status = 'sent'` specifically, never for the absence of `pending`/`failed`,
  and the widened enum must not change that for either function. State this explicitly in your
  migration's comment.

### The panel — `WebPortal/modules/sales-reports/js/report_list_grid.js` and
`WebPortal/modules/sales-reports/html/report_list.html`

Same distribution block wa-flow-07 extended. This plan adds a receipt indicator per row (reusing
`list_report_deliveries`, already called somewhere in this file for the report-editor's send
history view — find that existing call before adding a second, divergent one) and a
"Test send to me" button.

### The manual send path — `supabase/functions/send-report-whatsapp/index.ts`

This is what "Test send to me" calls, with the caller's own number as the sole recipient. Read its
existing auth (`has_action(user,'reports.report.send')`) and its recipient-list contract (up to 25
numbers, validated) before deciding how a one-recipient test call differs from a normal send — the
answer should be "not at all, at the API level," per contract 3 below.

## FIXED contracts

1. **Two new terminal statuses, `delivered` and `read`, added to `report_deliveries`'s existing
   CHECK constraint** — not a separate receipts table. A report delivery has exactly one lifecycle;
   splitting receipt state into a second table would mean two places to keep in sync for one fact.
   `sent` → `delivered` → `read` is a **forward-only** progression (a `read` update must never
   regress a row back to `delivered`, since Meta can send them out of expected order or only
   partially) — the update function enforces this, not the caller.

2. **A new `report_record_delivery_status(p_wamid text, p_status text) RETURNS jsonb`**,
   `SECURITY DEFINER`, `service_role` only, modelled directly on `chat_record_whatsapp_status`'s
   shape (same wamid-keyed lookup, same "not found" is not an error" tolerance — a status for a
   wamid this table has never heard of is normal, not a fault, because the same webhook fires for
   `chat_messages` and `report_deliveries` and a given wamid belongs to at most one of them).
   Forward-only per contract 1: an update that would move `status` backwards (e.g. `read` arriving
   after `read` again, or a stray `delivered` after `read`) is a no-op, not an error.

3. **"Test send to me" is not a new send path.** It calls the existing `send-report-whatsapp`
   function with the caller's own number as the sole entry in the recipient list, through whatever
   the panel already uses to invoke that function for a normal send (find it before adding a
   second call site). The only new thing is the UI: a button, and confirmation that it went to the
   caller's own number specifically — read the caller's own `whatsapp_phone` (post-wa-flow-01's
   verified-phone concept) or their `mobile_number`, and if neither is set, the button must be
   disabled with an explanation rather than silently failing on submit.

4. **Receipts render as a compact indicator, not a new column that pushes the table wider.**
   `docs/mockups/whatsapp-integration.html`'s treatment (a ✓✓ read timestamp inline with the
   existing Status cell, or immediately beside it) is the reference; match its density rather than
   adding a seventh full-width column to a table that is already six columns on a card-width
   container.

5. **Both new deliverables (receipt display, test-send) apply only to `report_deliveries` rows —
   not to `chat_messages`.** The shared team inbox's own read/unread handling
   (`chat_get_whatsapp_unread_count`, the 60-second badge poll) is untouched; this plan does not
   extend or modify it.

## Deliverables

### 1. Migration — `migrations/<14-digit-UTC-timestamp>_report_delivery_receipts.sql`

Timestamp later than every prior wa-flow migration. Must satisfy
`scripts/verify-migration-prefixes.mjs`.

- Widen `report_deliveries_status_check` to `ARRAY['pending', 'sent', 'failed', 'delivered',
  'read']`. Use `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...` — read how an earlier
  migration in this repo widened a similar CHECK (search for `_check` constraints being replaced
  elsewhere in `migrations/` for the house pattern) rather than inventing a new one.
- `ALTER TABLE public.report_deliveries ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;`
  — when the last status change landed, for the panel to show "read 07:12" rather than just a tick.
- `report_record_delivery_status(p_wamid text, p_status text) RETURNS jsonb` per contract 2.
  Map Meta's status vocabulary (`sent`/`delivered`/`read`/`failed` — read what values
  `chat_record_whatsapp_status`'s existing `v_status` normalisation already accepts, and use the
  same vocabulary rather than inventing a second one) onto `report_deliveries.status`, honouring
  the forward-only rule and the idempotency-safety note from the "Read this first" section.
- `list_report_deliveries` — add `status_updated_at` to its return columns and its `SELECT`. This
  is an existing, already-granted, already-called function; extend it, do not fork a second one.
- Grants for the new function per the house pattern: `REVOKE ALL ... FROM PUBLIC, anon,
  authenticated` then `GRANT EXECUTE ... TO service_role`.
- `NOTIFY pgrst, 'reload schema';`.
- Header comment: what is missing today (measured — the CHECK constraint's literal current values,
  and the fact `chat_record_whatsapp_status` never touches `report_deliveries`), what this adds,
  and the explicit **OUT OF SCOPE: applying this migration** line.

### 2. `supabase/functions/whatsapp-inbound/index.ts` — extend the status loop

In the same loop that calls `chat_record_whatsapp_status` per status entry, add a call to
`report_record_delivery_status(wamid, status)` — **non-fatal**, same tolerance the existing call
already has for `isMissingRpc` and a general failure (log and `continue`, never abort the loop over
one bad status). A wamid that belongs to a `chat_messages` row and not a `report_deliveries` row
(or vice versa) is expected and must not log as an error; both calls simply do nothing when their
respective wamid is not found — confirm `report_record_delivery_status`'s "not found" tolerance
(contract 2) makes this true before wiring the second call in.

### 3. Panel — receipt display and "Test send to me"

Per contracts 3 and 4, in `report_list.html` / `report_list_grid.js`, following the existing
distribution block's structure and its `dataFunctions` wrapper convention (add a wrapper for
`report_record_delivery_status` only if something client-side needs to call it directly — it is
`service_role` only, so the answer is almost certainly no; the panel only ever **reads** the result
via `list_report_deliveries`, it never writes a status).

### 4. Verifier — `scripts/verify-wa-delivery-receipts.mjs`

Registered as `wa-delivery-receipts:verify`, appended to the end of `test:fleet`. Same discipline
as the sibling verifiers.

Assert at least:

1. The new migration's `report_deliveries_status_check` constraint includes `delivered` and `read`
   **in addition to** `pending`, `sent`, `failed` — not replacing them.
2. `report_record_delivery_status` is `SECURITY DEFINER`, pins `search_path`, is `service_role`
   only.
3. `list_report_deliveries`'s definition in the new migration returns `status_updated_at`.
4. `whatsapp-inbound/index.ts`'s status loop calls both `chat_record_whatsapp_status` **and**
   `report_record_delivery_status` — the regression this guards against is a future edit to that
   loop that "cleans up" what looks like a redundant second call.
5. `daily_report_already_sent`'s definition (read fresh from
   `migrations/20260825091000_daily_production_report.sql`, not from memory) still contains
   `d.status = 'sent'` — i.e. the new `delivered`/`read` states were not used to redefine what
   "already sent" means for the daily sender.
5a. `period_report_already_sent`'s definition (read fresh from
   `migrations/20260908090000_period_report_senders.sql`, not from memory) still contains both
   `d.status = 'sent'` **and** `d.message_kind = 'template'` — the second clause is not incidental:
   without it, a manual send sharing the same `report_instance_id` would suppress the automatic
   broadcast, and this plan's widened status enum must not be the change that quietly drops it.
6. Somewhere in the panel's JS or HTML, a control identifiable as "Test send to me" (or the actual
   name deliverable 3 used) exists and its handler references the same send path
   (`send-report-whatsapp` or its `dataFunctions` wrapper) an existing normal send already uses —
   not a second, parallel call.

**Prove the verifier bites** on assertions 1, 5 and 5a — all three are exactly the kind of
"simplification" a later change could make without realising it breaks something. Break, run, see
green, report what you did.

## Verify before finishing

1. `npm run test:fleet` — green, including the new verifier.
2. `npm run wa-delivery-receipts:verify` alone.
3. `npm run migrations:verify`.
4. `npm run ui:verify` — the panel changes must not introduce a second icon set or dialog skin.
5. `npm run wa-plumbing:verify` — should be unaffected; a failure means the status-loop edit
   touched something outside this plan's stated scope.
6. Re-read `complete_report_delivery`'s existing parameter list once more before finishing and
   confirm deliverable 1 did not duplicate a column or parameter it already provides.

## Out of scope — do not do these

- **A separate receipts/audit table.** Contract 1 — one lifecycle, one table.
- **Extending `chat_messages`' own receipt handling.** Contract 5 — untouched.
- **Changing what counts as "already sent" for idempotency.** Explicitly guarded by verifier
  assertion 5.
- **Applying the migration or deploying the edge function.** Human steps, as always.
