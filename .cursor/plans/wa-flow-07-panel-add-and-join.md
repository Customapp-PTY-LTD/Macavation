---
depends_on: wa-flow-06-my-reports-on-whatsapp.md
---

# WhatsApp: add a recipient from the panel, and let one join by messaging the number

## Context

The distribution panel's own banner text, in `WebPortal/modules/sales-reports/html/report_list.html`
today, says:

> *"People are added to this list by enrolling on WhatsApp, not here."*

That sentence is false. `upsert_report_recipient` — the only function that ever creates a
`report_recipients` row — has exactly one caller in this codebase: the report editor's manual
"Send via WhatsApp" dialog. `set_report_subscription_by_phone` and
`report_recipient_by_inbound_phone`, the two functions that would make the banner's claim true,
have zero callers. This plan makes both halves real: a person can be added from the panel directly,
and a person can join by messaging the number, exactly as the panel already claims.

## Read this first

Locate every symbol **by name** and read it before writing against it.

### The panel today — `WebPortal/modules/sales-reports/html/report_list.html` and
`WebPortal/modules/sales-reports/js/report_list_grid.js`

- The table: `#reportDistributionTable` / `#reportDistributionTableBody`, columns Name / WhatsApp /
  Daily / Weekly / Monthly / Status. Read the whole distribution block in the JS file — it is
  clearly delimited by its own comment banner, "Report distribution — who gets these reports."
- `loadDistribution()`, `subscriptionCell(recipientId, kind, sub)`, `toggleSubscription($checkbox)`
  — the existing render/write cycle. **Read `toggleSubscription`'s comment closely**: it
  deliberately re-fetches the whole list after a change rather than trusting the local checkbox
  state, because a server-side pause can be cleared as a side effect of ticking a box back on.
  Any new write this plan adds should follow the same re-fetch-don't-trust-local pattern.
- `bindEvents()` — the delegated event bindings, all namespaced `.salesReports` so `destroy()` can
  remove them cleanly. Follow this namespacing for every new binding.
- The banner markup at `report_list.html:90-95` — the sentence this plan makes true. **Update its
  wording once "Add person" exists**, so it accurately describes both ways in now, rather than
  leaving a claim that used to be false and is now merely incomplete.

### The RPCs already built for this, already portal-callable

All in `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`, all already
`GRANT`ed to `anon, authenticated, service_role` — no new grant needed for these two:

- `upsert_report_recipient(p_display_name, p_phone, p_source DEFAULT 'manual', p_contact_id
  DEFAULT NULL, p_conversation_id DEFAULT NULL, p_notes DEFAULT NULL, p_actor_user_id DEFAULT NULL)
  RETURNS TABLE(success int, error text, id uuid)` at about `:201`. Upserts on the normalised
  phone (there is a unique index on `report_normalize_wa_phone(phone)` — read it at about `:94` of
  `migrations/20260825090000_report_subscriptions_and_staff.sql`), so calling it twice for the same
  number edits rather than duplicates.
- `set_report_recipient_active(p_recipient_id, p_is_active, p_actor_user_id)` at about `:265` —
  this is the "remove" half; there is no delete, only deactivate. The panel already has a "Show
  inactive" toggle that depends on this existing.
- `set_report_recipient_staff(p_recipient_id, p_is_staff, p_actor_user_id)` — in
  `migrations/20260825090000_report_subscriptions_and_staff.sql:226`, also already portal-granted.
  The panel currently has no control for this at all.

### The two RPCs for the WhatsApp-side join, already service_role-only

- `report_recipient_by_inbound_phone(p_phone) RETURNS jsonb` at `:289` of the same migration —
  resolves a bare-digit inbound number to a roster row, or tells you there is not one yet.
- `set_report_subscription_by_phone` — from wa-flow-02's context, already covered there; this plan
  is one of its intended callers.

### The bot's unenrolled-number path — `supabase/functions/whatsapp-inbound/index.ts`

Read `tryConfirmEnrolment` and the surrounding unenrolled-number handling before adding to it. The
existing behaviour: an unenrolled number gets **total silence** except for a body that is exactly
six digits, tried as an enrolment code, and (after wa-flow-02) `STOP`. This plan adds one more
carve-out, and the comment on the existing function already states the reasoning to follow: replying
to a wrong guess would confirm the line is live to a stranger. Read that reasoning before deciding
how permissive the new carve-out is.

## An unconfirmed design question — resolve it by re-reading the code, not by guessing

**Whether "join by messaging the number" should require the enrolled-staff identity check
(`whatsapp_resolve_staff_user`) or should work for someone who is never going to be staff at
all** — a shareholder or an external contact who wants the weekly report but has no portal login.
`report_recipients.is_staff` exists precisely to distinguish these two populations, and
`report_daily_recipients()` (post-wa-flow-02) does not gate on `is_staff` — a non-staff recipient
can already receive reports. **This plan's join flow must therefore work for a number that will
never be enrolled as staff.** Confirm this by re-reading `report_daily_recipients()`'s WHERE
clause before writing the join flow — do not gate it on staff enrolment, because that would exclude
exactly the population (external report recipients) this feature most needs to serve. State in
your report that you checked this.

## FIXED contracts

1. **"Add person" on the panel is a modal or inline form**, not a new page: display name, WhatsApp
   number, an optional starting subscription (Daily/Weekly/Monthly checkboxes, all off by default —
   adding someone must never silently opt them into anything). On submit: `upsert_report_recipient`,
   then `set_report_subscription_by_phone` once per ticked kind. Follow the panel's existing
   re-fetch-after-write pattern; do not hand-patch the DOM.

2. **"Remove" is deactivate, not delete** — calls `set_report_recipient_active(id, false, actor)`.
   The row remains visible only when "Show inactive" is ticked, exactly as an already-inactive row
   behaves today.

3. **A "Staff" toggle appears on each row**, calling `set_report_recipient_staff`. This is a small,
   separate addition the panel currently has no control for at all, despite the RPC existing since
   25 August.

4. **The WhatsApp join flow is a new, unauthenticated-but-narrow inbound path**: a message from an
   unenrolled number containing the word `reports` (case-insensitive, alone or as part of a short
   phrase like "I want reports") triggers `report_recipient_by_inbound_phone` to check for an
   existing roster row; if none, `upsert_report_recipient(display_name=null, phone=from,
   source='whatsapp_chat')` creates one with **every subscription kind left off** — joining states
   intent, it does not itself choose what to receive — followed by a reply directing them to reply
   `daily`, `weekly` or `monthly` to choose, each of which calls
   `set_report_subscription_by_phone`. This is a small, self-contained state machine; do not fold
   it into the general command router's confirm/staged-command machinery — it is one linear
   sequence with no ambiguity to confirm.

5. **The join flow never touches staff enrolment.** `is_staff` on the new row is `false`. Becoming
   staff is a portal admin action (`set_report_recipient_staff`, or the existing WhatsApp staff
   enrolment code flow) and is out of scope here, per the unconfirmed-design-question resolution
   above.

6. **The join flow replies, unlike every other unenrolled-number interaction.** This is a
   deliberate, narrow exception to the silence rule, scoped to exactly one keyword. State this
   explicitly in the code comment at the point it is added, referencing the reasoning in
   `tryConfirmEnrolment`'s comment for why silence is otherwise the rule, so a future reader does
   not read this exception as a mistake and "fix" it back to silence.

## Deliverables

### 1. `WebPortal/modules/sales-reports/html/report_list.html` and
`WebPortal/modules/sales-reports/js/report_list_grid.js`

- "Add person" control per contract 1, in the existing card header alongside "Show inactive" and
  "Refresh" — match the existing button styling (`btn btn-outline-secondary btn-sm`, the same
  classes already on `#refreshReportDistributionBtn`).
- A "Staff" toggle per row per contract 3 — a small checkbox or badge in the existing table, not a
  new column that would push the table wider than its container; check how the table already
  handles the Daily/Weekly/Monthly checkboxes and follow the same visual density.
- "Remove" per contract 2 — likely an icon button per row, following whatever icon convention the
  rest of this table (or the wider `WebPortal/`) already uses; do not introduce a new icon set —
  `ui:verify` checks for exactly one icon set across the tree and will fail if you do.
- Update the banner text per the "Read this first" section's note, once both halves exist.
- New `dataFunctions` wrapper(s) for `upsert_report_recipient`, `set_report_recipient_active`,
  `set_report_recipient_staff` if wrappers do not already exist — check
  `WebPortal/js/data-functions.js` by name before adding a duplicate.

### 2. `supabase/functions/whatsapp-inbound/index.ts` — the join keyword

Per contracts 4-6. Placed in the unenrolled-number branch, alongside the existing 6-digit code
check, following the same "try this, otherwise fall through" shape that function already has.
Logged via `whatsapp_log_command` with a `command` value that makes this path identifiable in
`whatsapp_command_log` — a human reading that table should be able to tell a join request from an
enrolment attempt.

### 3. Verifier — `scripts/verify-wa-panel-join.mjs`

Registered as `wa-panel-join:verify`, appended to the end of `test:fleet`. Same `.ts` discipline as
the sibling verifiers for the edge-function half; for the `WebPortal/` JS/HTML half, follow
`scripts/verify-ui-standard.mjs`'s general approach of textual assertion against real markup rather
than a DOM-evaluation framework this repo does not have.

Assert at least:

1. `report_list_grid.js` calls `upsert_report_recipient` (directly or via a `dataFunctions`
   wrapper — check which convention the file already uses and assert against that).
2. `report_list.html` contains a control whose visible text or id indicates "Add person" (or the
   name deliverable 1 actually used — match it, do not assume).
3. A "Staff" control exists and is wired to `set_report_recipient_staff`.
4. `whatsapp-inbound/index.ts` contains the join keyword path, and it is reachable from the
   unenrolled branch — same ordering-assertion technique as wa-flow-02's verifier assertion 4.
5. The join path's new roster row is created with every subscription kind left off — assert this
   by checking that the `upsert_report_recipient` call in the join path is **not** immediately
   followed by any `set_report_subscription_by_phone` call with `p_is_active=true` in the same
   code block, per contract 4's "joining states intent, it does not choose."
6. `report_list.html`'s banner no longer asserts recipients are added "not here" — its own past
   inaccuracy, now closed.

**Prove the verifier bites** on assertion 5 specifically — it is the contract most likely to be
"improved" by a well-meaning future change that auto-subscribes a new joiner to Daily by default.
Break it, run, see red, fix, see green, report what you did.

## Verify before finishing

1. `npm run test:fleet` — green, including the new verifier.
2. `npm run wa-panel-join:verify` alone.
3. `npm run ui:verify` — this is the check that will catch a stray icon set, a second dialog skin,
   or a css-token violation in the new markup. It is pure `fs` reads and fast; run it, do not skip
   it because the change feels small.
4. `npm run wa-staff-menu:verify` and `npm run wa-plumbing:verify` — neither should regress.
5. Confirm in your report that no new phone normaliser was added (contract inherited from every
   sibling plan) — `npm run report-whatsapp-parity:verify`.

## Out of scope — do not do these

- **Delivery receipts, "test send to me."** wa-flow-08.
- **Any change to `report_daily_recipients()` or the subscription/pause machinery.** wa-flow-02
  already owns that; this plan only calls what exists.
- **A true delete of a recipient row.** Contract 2 — deactivate only, matching the existing pattern
  for every other row-hiding control in this table.
- **Applying migrations or deploying edge functions.** None are needed for this plan — every RPC it
  calls already exists and is already granted. Say this explicitly in your report: this is the
  first wa-flow plan with **no migration**.
