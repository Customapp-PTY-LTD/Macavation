---
depends_on: wa-reports-01-shared-plumbing.md
---
# WhatsApp reports — the 17:00 daily production sender

## Context

Macavation's daily production figures must go out on WhatsApp every afternoon at 17:00 SAST with
nobody in the loop. This plan authors the edge function that does it:
`send-daily-production-report`.

An unprompted WhatsApp message cannot be free text — Meta only allows free wording within 24 hours
of the recipient's own last message. So the daily goes out as an **approved message template**,
`macavation_daily_production`, carrying seven body parameters and three quick-reply buttons. The
template is submitted for Meta's approval outside the fleet; this function only *sends* it, which
uses the ordinary `send_message` action and needs no special credential beyond the forward secret
already used by every other send.

`wa-reports-01-shared-plumbing.md` created `_shared/wa-send.ts`. **Use `sendTemplate` from it. Do
not build the payload inline** — that is the whole point of plan 01.

**You cannot deploy this, apply a migration, or reach a database.** Author files only. A human
deploys with
`supabase functions deploy send-daily-production-report --project-ref nmdmddugxclpqrwylyfa`.
Do not attempt it, and do not treat "not deployed" as a failure.

**The RPCs below do not exist in the database when this merges.** A human applies those migrations
out of band. That is fine and expected: nothing invokes this function until a human both deploys it
and schedules it. **Do not add a fallback that reads the tables directly, and do not degrade to
guessing figures** — if an RPC is missing the function should fail loudly with the Postgres error, so
whoever deploys it finds out immediately.

## ⚠ Correction — how this repo's RPCs actually return (read before writing any call)

An earlier revision of this plan stated these contracts wrongly. **These are the real ones,
read out of `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`.**

**Every RPC in this family returns an envelope, not a bare value, and never throws for a business
failure.** `RETURNS TABLE (success int, error text, …)`. Over PostgREST that arrives as an **array of
rows** — so read `data[0]`, check `success === 1`, and treat `error` as the message to surface or log.
A `success: 0` is a normal response with HTTP 200, not an exception. Code that only try/catches will
sail straight past a refusal.

## FIXED contracts — implement against these exactly

These signatures and shapes are settled. Do not adapt them, and do not defensively handle a
different shape.

**`report_sast_today() → date`** — today in `Africa/Johannesburg`.

**`reseed_data_production_daily(p_from date, p_to date, p_actor text) → jsonb`** — already exists
(`migrations/20260819090000_data_page_production_daily.sql:228`). Refreshes the factory mirror
columns only; it never overwrites a hand-entered figure.

**`get_daily_production_report(p_date date default null) → jsonb`**

```json
{
  "report_date": "2026-08-27",
  "date_label": "Thu 27 Aug 2026",
  "has_production": true,
  "refreshed_at": "2026-08-27T14:58:11+00:00",
  "cracked_kg": 12480.00,
  "sk_packed_kg": 4210.00,
  "wholes_pct": 62.4,
  "nis_kg": 18000.00,
  "week_start": "2026-08-24",
  "week_label": "Mon 24 Aug to Thu 27 Aug",
  "wtd_cracked_kg": 48600.00,
  "wtd_target_kg": 60000.00
}
```

Any numeric field may be `null` (a null is a genuinely uncaptured figure, never a zero).
`has_production` is the authoritative "was there a working day" flag — trust it rather than
re-deriving it from the numbers.

**`report_daily_recipients() → setof (recipient_id uuid, display_name text, phone text, is_staff boolean)`**
— active daily subscribers who are not muted. `phone` is already `+27…`.

**`daily_report_already_sent(p_date date) → boolean`** — true when a `sent` delivery row already
exists for that date.

**`begin_report_delivery(p_report_instance_id uuid, p_phone text, p_display_name text DEFAULT NULL, p_recipient_id uuid DEFAULT NULL, p_message_body text DEFAULT NULL, p_pdf_storage_bucket text DEFAULT NULL, p_pdf_storage_path text DEFAULT NULL, p_link_expires_at timestamptz DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL, p_report_kind text DEFAULT 'weekly', p_report_date date DEFAULT NULL, p_message_kind text DEFAULT 'text', p_template_name text DEFAULT NULL)`**
→ `TABLE (success int, error text, id uuid)`. Note the **parameter order and names** — `p_phone` is
second, and the actor is `p_actor_user_id`, not `p_sent_by`. The last four are new.

For the daily send pass: `p_report_instance_id => null`, `p_report_kind => 'daily'`,
`p_report_date => <the date>`, `p_message_kind => 'template'`,
`p_template_name => 'macavation_daily_production'`, `p_actor_user_id => null`. Take the delivery id
from `data[0].id` **after** checking `data[0].success === 1`.

⚠ `p_report_instance_id` is normally required and the function returns
`success: 0, error: 'p_report_instance_id is required.'` when it is null. The migration that adds
`p_report_kind` relaxes that specifically for `p_report_kind => 'daily'`. If you get that error back,
the migration has not been applied yet — surface it, do not work around it.

**`complete_report_delivery(p_delivery_id uuid, p_status text, p_external_message_id text DEFAULT NULL, p_error text DEFAULT NULL, p_message_body text DEFAULT NULL)`**
→ `TABLE (success int, error text)`. `p_status` is `'sent'` or `'failed'`. The gateway's own message
goes in `p_error` **verbatim**. `p_message_body` is new and appended last.

## The template — its shape is fixed by Meta approval

`macavation_daily_production`, language `en`. Seven body parameters, **in this order**:

| # | Value | From |
|---|---|---|
| 1 | date label | `date_label` |
| 2 | cracked kg | `cracked_kg` |
| 3 | kernel packed kg | `sk_packed_kg` |
| 4 | wholes percent | `wholes_pct` |
| 5 | NIS received kg | `nis_kg` |
| 6 | week-to-date cracked kg | `wtd_cracked_kg` |
| 7 | week-to-date target kg | `wtd_target_kg` |

Three quick-reply buttons are baked into the approved template and need **no** component
parameters — send only the `body` component. Their payloads (`WEEK_TO_DATE`, `FULL_BREAKDOWN`,
`MENU`) are handled by a different plan.

**Formatting rules that are not negotiable.** A template body parameter may not contain a newline, a
tab, or four or more consecutive spaces — Meta rejects the send. So each parameter is a single short
string. Write one helper and use it for every numeric parameter:

- thousands separated by a **non-breaking space** (U+00A0), not a regular space — four consecutive
  regular spaces are what trip the rule, and a narrow number like `1 000` is safer this way
- no trailing `kg` (the template's own text carries the unit)
- `wholes_pct` to one decimal place
- a `null` becomes the literal string `not captured` — never `null`, never `0`

## Work

### 1. `supabase/functions/send-daily-production-report/config.toml`

```toml
[functions.send-daily-production-report]
verify_jwt = true
```

`verify_jwt` stays **on**: this is invoked by a scheduled job presenting the service-role key, not by
a browser, so there is no portal session to validate. Say so in a comment — every other WhatsApp
function in this repo is `verify_jwt = false` and a reader will wonder why this one differs.

### 2. `supabase/functions/send-daily-production-report/index.ts`

Doc-comment header in the house style (`send-report-whatsapp/index.ts:1-32`) naming the deploy
command, the schedule it is intended for (`0 15 * * *` UTC = 17:00 SAST — SAST has no daylight
saving, so a fixed offset is safe year-round), every RPC called, and every env var read.

`POST` only; `OPTIONS` short-circuits to the preflight response; anything else 405. Service client
from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, exactly as `send-report-whatsapp/index.ts:77-78`.

Request body, all optional: `{ date?: 'YYYY-MM-DD', dry_run?: boolean, force?: boolean }`.

Sequence:

1. **Resolve the date.** `date` if given (validate against `/^\d{4}-\d{2}-\d{2}$/` and reject
   otherwise), else `report_sast_today()`. Never `new Date()` — the container is UTC and a late
   evening run would file against the wrong day.
2. **Refresh from the factory**: `reseed_data_production_daily(d, d, 'daily_report_job')`. If it
   errors, **stop and return 502** — sending yesterday's snapshot as though it were today's is worse
   than sending nothing.
3. **Read the figures**: `get_daily_production_report(d)`.
4. **Suppress guard.** If `has_production` is false, send nothing and return 200 with
   `{ skipped: 'no_production', date: d }`. No Sunday message, no public-holiday message, no "0 kg".
5. **Idempotency guard.** Unless `force === true`, if `daily_report_already_sent(d)` return 200 with
   `{ skipped: 'already_sent', date: d }`. A scheduled job gets retried; nobody should receive the
   same figures twice.
6. **Recipients**: `report_daily_recipients()`. Empty list → 200 with
   `{ skipped: 'no_recipients' }`. Cap at 25 and, if the list is longer, **`console.warn` the number
   dropped** — a silently truncated recipient list reads as a successful send.
7. **`dry_run === true`** → return 200 with the resolved date, the seven composed parameter strings
   in order, and the recipient list (name and phone), **having sent nothing**. This is how a human
   proves the message before it is ever scheduled, so make the response show exactly what would go
   out.
8. **Send, one recipient at a time, sequentially** (not `Promise.all` — a burst looks like spam to
   Meta and makes a partial failure hard to read). Per recipient:
   `begin_report_delivery(...)` → `sendTemplate(phone, 'macavation_daily_production', 'en', [bodyComponent])`
   → `complete_report_delivery(deliveryId, ok ? 'sent' : 'failed', wamid, error, renderedBodyText)`.
   `renderedBodyText` is a plain-text rendering of what was sent, for the audit trail.
   **Never let one recipient's failure abort the loop** — catch per recipient, record it, continue.
9. **Response**: 200 with `{ date, sent, failed, results: [{ phone, display_name, status, external_message_id, error }] }`.

Return **200 even when every send failed**, matching `send-report-whatsapp/index.ts:516-527`, and put
the truth in `sent`/`failed`. A caller reading only the HTTP status learns nothing either way; the
counts are the contract.

## Out of scope

No migrations, no RBAC, no scheduling, no template submission, no deployment — all handled outside
the fleet. No changes to `whatsapp-inbound` (the buttons are a separate plan). No new verifier
registered in `package.json`; plan 01's covers the payload shapes this function relies on.

## Verification

Nothing here can be run against a real database or gateway from the fleet, so verify by inspection
and reasoning, and state your findings:

- The seven parameters are built in the documented order, and each is a single line with no tab and
  no run of four or more regular spaces.
- A `null` figure renders `not captured`, and nowhere renders `0` for a null.
- Both guards return before any send, and `force` bypasses only the idempotency one — never the
  `has_production` one.
- `dry_run` cannot reach `sendTemplate`. Trace the path and confirm it.
- The per-recipient loop cannot be aborted by a single failure, and every path through it writes
  exactly one `complete_report_delivery`.
- `npm run test:fleet` passes.

Then state plainly in your report that the function is **authored but not deployed and not
scheduled**, and that a human must deploy it, apply the migrations, and confirm a `dry_run` before
it is ever put on a timer.
