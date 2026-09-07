---
depends_on: wa-flow-08-receipts-and-test-send.md
---

# WhatsApp: push a stock alert to the people who asked for it

## Context

This is the smallest plan in the series, because most of the work is already built. Read this
before assuming otherwise: `whatsapp-inbound/index.ts` already has a complete, working
resolve-an-alert-from-WhatsApp flow — `ACK <n>` stages a confirmation via
`whatsapp_stage_pending_command`, `YES` applies it through the `ACK_ALERT` entry in
`STAGED_COMMAND_HANDLERS`, which re-checks `has_action(user, 'alerts.resolve')` **at confirm time**
(not just when the ACK was first typed) and then calls `resolve_dashboard_alert`. That whole loop —
see, stage, confirm, resolve, re-check permission — exists and needs nothing from this plan.

What does not exist is the other direction: nothing sends an alert **to** WhatsApp when one is
raised. `dashboard_alerts` already fans out to the in-app notification bell via
`trg_dashboard_alert_to_notification`. This plan adds the third branch — WhatsApp — alongside that
existing trigger, not instead of it.

## Read this first

Locate every symbol **by name** and read it before writing against it.

### The alert table and its trigger — `migrations/20260214000001_create_dashboard_alert_simple.sql`
(the table itself) and `migrations/20260602150000_notifications.sql:206-211` (the trigger)

- `dashboard_alerts` columns confirmed by reading `create_dashboard_alert_simple`'s INSERT list:
  `alert_number`, `alert_type`, `severity`, `batch_number`, `alert_title`, `alert_message`,
  `status`. **`severity`'s actual constraint, confirmed live against the dev database directly
  (not derivable from this checkout — no migration in the tracked history names it, it predates
  the tracked migration history) is `dashboard_alerts_severity_check: severity = ANY
  ('info', 'warning', 'critical')`** — identical to the sibling `stock_alert_rules` constraint at
  `migrations/20260602130000_stock_alerts_and_accuracy.sql:18`, so that assumption was correct.
  Also confirmed the same way: `dashboard_alerts_status_check` allows `'active'`,
  `'acknowledged'`, `'resolved'`, `'dismissed'` — confirming `status = 'active'` (used throughout
  this plan and by the existing trigger's `WHEN` clause) is a real, valid value.
- `trg_dashboard_alert_to_notification AFTER INSERT ON dashboard_alerts ... WHEN (NEW.status =
  'active')` calling `tg_dashboard_alert_to_notification()`. **This plan adds a second, independent
  path for the WhatsApp push — it does not add logic inside this existing trigger function.** See
  contract 1 for why.

### The already-built resolve flow — `supabase/functions/whatsapp-inbound/index.ts`

Read the block around `ACK_ALERT` in `STAGED_COMMAND_HANDLERS` (find by name), and the comment at
about `:320`: *"ACK/ACK_ALERT is the worked example"* for how a staged, confirmed, re-checked write
is meant to look in this file. **This plan's push notification's buttons must dispatch into this
existing flow, not build a parallel one.** The existing `commandAck`-style function (find the one
that stages `ACK_ALERT` from a typed `ACK <n>`) is the reference for how a button tap should invoke
the same staging step.

### The alert-list menu item — already exists

`MENU_ITEMS` already has an `alerts` entry ("Open alerts"), gated on `dashboard`, whose `render`
lists open alerts and (if `has_action(user,'alerts.resolve')`) tells the reader to reply `ACK <n>`.
Read it before writing the push notification's body — the push should read as a natural extension
of what that menu item already says, not a differently-worded duplicate.

### Where severity thresholds already live — `stock_alert_rules`

`migrations/20260602130000_stock_alerts_and_accuracy.sql` — per-`(product_type, style)` rows with
`min_qty`, `alert_type`, `severity`. `evaluate_stock_alerts(p_observations jsonb)` compares
observed stock to these rules and inserts a `dashboard_alerts` row, **deduping against an existing
open alert for the same thing** — read the dedupe logic in that function before assuming this plan
needs to add deduplication at the alert-raising level. It does not; raising is already deduped.
**What is not deduped anywhere is repeated WhatsApp sends for the same still-open alert** — that is
this plan's job (contract 4).

## An architectural decision, made deliberately — read before writing any code

**The WhatsApp push must NOT be triggered synchronously from
`trg_dashboard_alert_to_notification` or a new `AFTER INSERT` trigger on `dashboard_alerts`.**

A trigger fires inside the same transaction as the alert-raising `INSERT` — commonly called from
`evaluate_stock_alerts`, itself called from a portal grid's client-side evaluation (per this
repo's existing header comments, e.g. `evaluate-stock-alerts-cron/index.ts`'s own note that nothing
schedules it and the Stock Management grid runs it client-side today). Putting an HTTP send inside
that trigger would mean: a slow or failing WhatsApp send blocks the alert insert itself, and — far
worse — an unhandled exception in the trigger function would **roll back the alert row that
triggered it**, silently erasing the very alert the send was trying to report. This is exactly the
kind of external-contract risk this repo's plan-safety convention exists to catch before an agent
builds it, not after.

**Instead: a small polling cron job**, following wa-flow-05's already-established pattern of a
named SQL wrapper function calling `net.http_post` to reach an edge function, scheduled via
`pg_cron`. It runs every few minutes, finds `dashboard_alerts` rows that are `status='active'`,
meet a recipient's severity floor, and have not yet had a WhatsApp send recorded for them, and
calls a new edge function to push those. This decouples the alert INSERT entirely from any network
I/O. It inherits wa-flow-05's own unconfirmed `pg_net`/Vault contract — **do not re-litigate that
contract here; it was resolved (or not) as part of wa-flow-05's human pre-step, and this plan
assumes wa-flow-05 already merged and its pre-step already happened**, since this plan depends on
it.

## FIXED contracts

1. **Polling, not a trigger.** Per the architectural decision above. A new
   `cron_push_dashboard_alerts()` wrapper function, scheduled via `pg_cron`, calling a new edge
   function via `net.http_post`, following wa-flow-05's exact pattern (named wrapper, `RAISE
   NOTICE` not `RAISE EXCEPTION` since the HTTP result is not known synchronously, Vault for the
   bearer token, never a cleartext key in the cron command string).

2. **Poll interval: every 5 minutes.** Frequent enough that a critical alert reaches someone within
   the "minutes" `docs/mockups/whatsapp-flow-spec.html` section 7 promises, infrequent enough not
   to be its own load concern on a table this small.

3. **A per-recipient severity floor**, stored as a new column on `report_recipients`:
   `alert_severity_floor text CHECK (alert_severity_floor IN ('none', 'critical',
   'critical_and_warning')) DEFAULT 'critical'`. Not a fourth `report_subscriptions.report_kind` —
   subscriptions are about *which report*, this is about *which severity*, and conflating the two
   would mean a `report_kind='alerts'` row with no natural `period_start`/`muted_until` semantics
   to inherit. `info` alerts are **never** pushed to WhatsApp, at any floor — they stay in-app only,
   matching `docs/mockups/whatsapp-integration.html`'s stated table.

4. **A dedupe/already-sent record, per (alert, recipient) pair** — a new
   `dashboard_alert_wa_pushes` table: `alert_id uuid`, `recipient_id uuid`,
   `sent_at timestamptz`, `external_message_id text`, unique on `(alert_id, recipient_id)`. The
   same still-open alert must never be pushed twice to the same person. This is a **new** table,
   not an extension of `report_deliveries` — a `dashboard_alerts` row is not a `report_instances`
   row and forcing it through `report_deliveries`' schema (which requires a `report_kind` in
   `('daily','weekly','monthly')`, per its own CHECK constraint) would mean weakening that
   constraint for a case it was never designed to hold.

5. **A daily cap, per recipient: at most 5 alert pushes in a rolling 24 hours.** Count
   `dashboard_alert_wa_pushes` rows for that recipient in the last 24 hours before sending a 6th;
   if over the cap, skip and let it be picked up by a later poll only if the alert is still open
   and the recipient is still under the cap by then — do not queue it for forced delivery once the
   window rolls over, since an alert raised hours ago may no longer be the most urgent thing to
   surface. State this behaviour plainly in the migration's comment as a deliberate choice, not an
   oversight.

6. **The push template carries two buttons: `Mark resolved` and `Menu`.** No `Snooze` in this
   plan — `docs/mockups/whatsapp-integration.html` shows one, but nothing in this codebase
   implements a snooze concept for `dashboard_alerts` (no `snoozed_until` column, no snooze RPC),
   and inventing one is out of scope for a plan whose job is wiring the push, not extending the
   alert data model. If a snooze is wanted later, it is its own plan.

7. **`Mark resolved` routes into the EXISTING staged-confirm flow** (contract from "Read this
   first"), not a new immediate-resolve path — a tap must still land on a `YES`/`NO` confirmation
   naming the specific alert, exactly as a typed `ACK <n>` does today, and must still re-check
   `alerts.resolve` at confirm time. **A tap must never bypass the permission re-check the typed
   path already has** — this is the one contract in this whole series most worth a deliberate,
   named test in the verifier, because a button feels like it should be a shortcut and the
   temptation to make it skip a step is real.

8. **The new edge function sends via `sendTemplate`, one recipient at a time, exactly like every
   other push sender in this series** (`send-daily-production-report`, `send-period-report`).
   Non-fatal per-recipient error handling; one failure does not abort the batch.

## Deliverables

### 1. Migration — `migrations/<14-digit-UTC-timestamp>_alert_whatsapp_push.sql`

Timestamp later than every prior wa-flow migration. Must satisfy
`scripts/verify-migration-prefixes.mjs`.

- `ALTER TABLE public.report_recipients ADD COLUMN IF NOT EXISTS alert_severity_floor text
  DEFAULT 'critical' CHECK (alert_severity_floor IN ('none','critical','critical_and_warning'));`
- `CREATE TABLE public.dashboard_alert_wa_pushes (...)` per contract 4, with the unique constraint
  and appropriate `REVOKE`/`GRANT` (`service_role` only — this table is never read or written by
  the browser).
- `alert_push_recipients(p_alert_id uuid) RETURNS TABLE(recipient_id uuid, phone text,
  display_name text)` — resolves which recipients should receive a push for one alert, applying
  the severity floor (contract 3), the opt-out gate from wa-flow-02 (`opted_out_at IS NULL` — this
  alert path must obey the same opt-out every report send obeys; do not build a second, ungated
  send path), and the daily cap (contract 5).
- `cron_push_dashboard_alerts()` — the wrapper function per contract 1: selects open alerts with at
  least one un-pushed, cap-eligible recipient, and `net.http_post`s the new edge function once per
  alert (or once total with a batch payload — choose whichever matches the edge function's actual
  request shape from deliverable 2, and state the choice in this migration's comment).
- `cron.schedule('push-dashboard-alerts-to-whatsapp', '*/5 * * * *', ...)` per contract 2. Confirm
  this jobname does not collide with any existing one in `cron.job` before choosing it.
- Header comment: what is missing today (measured — zero rows would exist in the new
  `dashboard_alert_wa_pushes` table because it does not exist yet; the trigger to in-app
  notifications is the only fan-out today), what this adds, the architectural decision (poll, not
  trigger) restated in one paragraph so a future reader does not have to find this plan file to
  understand why, and the explicit **OUT OF SCOPE: applying this migration** line — plus, as in
  wa-flow-05, a note that this migration assumes `pg_net`/Vault were already confirmed working as
  part of wa-flow-05's human pre-step.

### 2. New edge function — `supabase/functions/send-alert-whatsapp/index.ts`

Modelled on `send-daily-production-report/index.ts`'s structure: service-role bearer auth, build
the template body from the alert row (title, severity, a one-line detail — read
`dashboard_alerts.alert_message` for what is available), call `alert_push_recipients`, send via
`sendTemplate` with the two buttons from contract 6, record a `dashboard_alert_wa_pushes` row per
successful send (with the wamid), non-fatal per-recipient handling per contract 8.

### 3. Template — new file `scripts/wa-template-alert-push.mjs`

**Corrected against what wa-flow-03/04 actually built, not what an earlier draft of this plan
assumed.** `scripts/submit-whatsapp-template.mjs` does not exist in this checkout — there is no
Meta-submission client in this repo at all, by design (see
`scripts/wa-template-daily-production.mjs`'s own header). The established, actually-merged pattern
is one small, inert, credential-free descriptor file per template:
`scripts/wa-template-daily-production.mjs` (daily) and `scripts/wa-template-period-reports.mjs`
(weekly/monthly, which duplicates rather than imports the daily file's button labels, specifically
to avoid executing its top-level printer as a side effect — copy that same convention here).

Add `scripts/wa-template-alert-push.mjs` following that exact shape: no `fetch`, no
`process.env`, no URL, no credential, no Meta wire format — it only records the template name
(`macavation_alert`), category (`UTILITY`), body wording, and the two button labels (`Mark
resolved`, `Menu`) this plan fixes. A human submits it to Meta outside this repo, exactly as the
prior two.

### 4. `whatsapp-inbound/index.ts` — dispatch the `Mark resolved` tap

Per contract 7: the button tap must invoke the **same staging function** the typed `ACK <n>` path
already calls (find it by name — do not write a second function that duplicates its body). The
alert id needs to travel with the button tap; use `buildReplyId`/`parseReplyId`
(`_shared/wa-send.ts:205-232`) to encode it, matching the convention every other reply-id in this
file already uses, rather than relying on button text alone the way wa-flow-03's template buttons
do — an alert push is per-alert and needs to carry which one, where the daily/weekly/monthly
buttons did not need to carry anything beyond "which action."

### 5. Verifier — `scripts/verify-wa-alert-push.mjs`

Registered as `wa-alert-push:verify`, appended to the end of `test:fleet`. Same discipline as the
sibling verifiers.

Assert at least:

1. `alert_push_recipients`'s definition contains `opted_out_at IS NULL` — the alert path must not
   have its own, ungated send.
2. `info` severity never appears as an eligible value anywhere the push path filters on severity —
   assert its absence from whatever severity list/comparison the migration uses.
3. `dashboard_alert_wa_pushes` has a unique constraint spanning both `alert_id` and `recipient_id`
   — the dedupe contract, checked structurally rather than by trusting a comment.
4. **The `Mark resolved` button tap dispatches into the same staging function `ACK <n>` uses** —
   assert this by finding the actual function name the typed path calls and confirming the
   button-tap dispatch in deliverable 4 calls the identical name, not a lookalike. This is
   contract 7's most important guard and deserves the most careful assertion in this whole plan.
5. No `RAISE EXCEPTION` inside `cron_push_dashboard_alerts()` — same async-result limitation as
   wa-flow-05's equivalent check.
6. The new cron jobname does not collide with any of the four jobnames the prior plans in this
   series already introduced (the three from wa-flow-05, plus the two pre-existing reseed jobs) —
   list all of them in the verifier as a literal set and check the new one is not among them.
7. `scripts/wa-template-alert-push.mjs` contains none of `fetch(`, `process.env`, `http://`,
   `https://`, `.supabase.co`, `crk_`, `require(` — the same hermeticity check
   `scripts/verify-wa-period-reports.mjs` runs on its own template descriptor (search for its
   `forbidden` array by name and match the same list), so this third descriptor cannot quietly grow
   real submission capability the other two were deliberately built without.

**Prove the verifier bites** on assertion 4 specifically — it is the single most important property
in this plan, and the easiest one for a future "simplify this" pass to quietly break by writing a
second, similar-looking resolve path for the button instead of reusing the one that already
re-checks permission.

## Verify before finishing

1. `npm run test:fleet` — green, including the new verifier.
2. `npm run wa-alert-push:verify` alone.
3. `npm run migrations:verify`.
4. `npm run wa-staff-menu:verify` and `npm run wa-plumbing:verify` — neither should regress.
5. This plan's "Read this first" section already states `dashboard_alerts`' real severity and
   status constraints, confirmed live against the dev database rather than derived from this
   checkout (no migration here defines them). Nothing further to re-derive; just build against the
   three severity values and four status values stated there.

## Out of scope — do not do these

- **A snooze feature.** Contract 6 — no data model exists for it; a separate plan if wanted.
- **Any trigger-based send.** The architectural decision above is fixed.
- **Changing `evaluate_stock_alerts` or its dedupe.** That function's existing dedupe (alert
  raising) is a different concern from this plan's dedupe (push sending) and is untouched.
- **Scheduling `evaluate-stock-alerts-cron` itself.** That function's header already documents it
  is unscheduled and runs client-side from the Stock Management grid; fixing that is a separate
  concern from pushing alerts it has already raised, and is not this plan's job.
- **Applying the migration or deploying the edge function.** Human steps, as always, and this plan
  additionally depends on wa-flow-05's `pg_net`/Vault pre-step already having been done.
