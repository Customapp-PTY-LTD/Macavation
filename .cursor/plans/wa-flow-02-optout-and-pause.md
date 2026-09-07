# WhatsApp: an opt-out that every sender must pass, and a pause that expires itself

## Context

Macavation can send report templates to a handset that has never replied. Nothing anywhere lets
the person on that handset stop them. Meta requires a working opt-out on a business number, POPIA
requires one locally, and a number that cannot say no is the fastest way to lose the number's
quality rating — which cuts the daily send limit for *every* message, reports included.

`report_subscriptions` already carries `muted_until date` and
`set_report_subscription_by_phone(p_phone, p_report_kind, p_is_active, p_muted_until)` already
exists, is `service_role`-granted, and **has zero callers in this repo**. So the pause half is
mostly wiring. The opt-out half does not exist at all: there is no column for it, and
`report_recipients.is_active` is not it — that is the administrator's switch on the distribution
panel, not the member's.

This plan lands the foundation both halves need, and it lands it *before* the weekly and monthly
senders (wa-flow-04) so those are written against a gate that already exists rather than having to
be retro-fitted with one.

## Read this first — what is already here, and where to read it

Everything below is a claim about **this checkout**. Locate every symbol **by name** (grep for it)
and read it before writing a call against it. Line numbers are hints, not assertions; if a symbol
is not where a number says, find it by name and carry on. Do not "fix" this plan's line numbers as
a deliverable.

### The roster and its selectors — `migrations/20260825090000_report_subscriptions_and_staff.sql`

| Symbol | Approx. line | What it is |
|---|---|---|
| `report_recipients` | `:75-92` | The roster. `is_active`, `is_staff`, `user_id`, `phone` |
| unique index on `report_normalize_wa_phone(phone)` | `:94-95` | Canonical `+27...` form, one row per number |
| `report_subscriptions` | `:98-112` | `report_kind` CHECK(daily/weekly/monthly), `is_active`, `muted_until` |
| `report_daily_recipients()` | `:260-277` | **The only recipient selector any sender uses today** |
| `report_recipient_by_inbound_phone(p_phone)` | `:289` | Bridges bare-digit inbound to the roster form. **Zero callers** |
| `set_report_subscription_by_phone(text, text, boolean, date)` | `:335` | Already supports pause via `p_muted_until`. **Zero callers** |
| grants block | `:398-403` | All three REVOKEd from PUBLIC/anon/authenticated, GRANTed to `service_role` |

`report_daily_recipients()` reads, verbatim:

```sql
    SELECT rr.id, rr.display_name, public.report_normalize_wa_phone(rr.phone), rr.is_staff
    FROM public.report_recipients rr
    JOIN public.report_subscriptions rs
      ON rs.recipient_id = rr.id AND rs.report_kind = 'daily'
    WHERE rr.is_active
      AND rs.is_active
      AND (rs.muted_until IS NULL OR rs.muted_until < public.report_sast_today())
    ORDER BY rr.display_name;
```

Note what that already gets right: **pause is honoured in the selector**, not in the sender. Keep
that property — it is why a sender cannot forget it.

### Two phone canonical forms, and the bridge between them

They differ by the `+` and this is load-bearing:

- `chat_normalize_phone` produces `27821234567` (chat/staff side, and the form inbound `from`
  arrives in)
- `report_normalize_wa_phone` produces `+27821234567` (roster side)

`report_recipient_by_inbound_phone` exists purely to cross that gap.
`scripts/verify-report-whatsapp-parity.mjs` is the guard against a fourth normaliser appearing —
**do not add one**, and run that verifier before you finish.

### The senders that must be gated

| File | What it sends | Auth |
|---|---|---|
| `supabase/functions/send-daily-production-report/index.ts` | The daily template, to `report_daily_recipients()` | Service-role bearer, constant-time compare at `~:155-162` |
| `supabase/functions/send-report-whatsapp/index.ts` | A published report PDF, to **an arbitrary recipient list posted by the browser** | Portal session plus `has_action(user,'reports.report.send')` at `~:224` |

The second is the one that matters most here: it sends to whatever numbers the send dialog passes,
so it is the path by which an opted-out number would still be reached.

### The bot's command router — `supabase/functions/whatsapp-inbound/index.ts`

- `COMMAND_HANDLERS` — the verb map. `HELP`, `YES`/`Y`/`CONFIRM`, `NO`/`N`/`CANCEL`,
  `MENU`/`HI`/`HELLO`/`START`, `'0'`, `'99'`. Find it by name.
- `handleCommand` — dispatch order, documented in its own comment: a reply-id tap wins, then
  `HELP`, then empty or `?` opens the menu, then a registered verb, then a bare 1-2 digit number
  as a menu position, then an unrecognised-verb reply.
- `Object.prototype.hasOwnProperty.call(COMMAND_HANDLERS, verb)` — **keep this guard.** `verb` is
  attacker-controlled text off a public WhatsApp line and a bare lookup would find
  `Object.prototype` members.
- `processCommandForMessage` runs only for freshly-ingested messages, **never** from `statuses[]`.
  A status must never dispatch a command: our own replies generate statuses, so that would loop.
- The unenrolled path: silence, except a body that is exactly 6 digits, tried against
  `whatsapp_confirm_enrolment`, failing **silently** by design.
- `whatsapp_log_command` records every inbound with an `outcome` from
  CHECK(ok/unknown_command/not_enrolled/denied/error).

### `START` is already taken — read this before you touch it

`START` is currently registered in `COMMAND_HANDLERS` as a **greeting that opens the menu**,
alongside `HI` and `HELLO`. Deliverable 2 gives it a second job. That is a real collision and you
must resolve it deliberately, not by accident:

- If the number is opted out, `START` means "start sending again".
- Otherwise `START` keeps its existing meaning and opens the menu.

Write it in that order, and say in your report that you checked the existing binding rather than
overwriting it. Silently removing a greeting would make the bot stop answering "start" for every
user who is not opted out.

### The 2xx rule — non-negotiable

`whatsapp-inbound` must return 2xx for anything that verifies. Control Room **never retries**: a
non-2xx or a timeout is logged on its side and dropped forever. Persist first, log failures loudly
with the wamid, return 200. Its header comment states this; do not weaken it.

## FIXED contracts

These are decisions, not suggestions. Do not redesign them.

1. **Opt-out lives on `report_recipients`, as `opted_out_at timestamptz NULL`.** Not a boolean —
   the timestamp is the audit record of when they asked, and NULL means "never asked". Do not
   reuse `is_active`: that is the administrator's switch, and conflating the two means an admin
   re-activating a row silently re-subscribes somebody who opted out.

2. **The gate goes in the SELECTORS, never in the senders.** Amend `report_daily_recipients()` to
   add `AND rr.opted_out_at IS NULL`. A sender that forgets a check is a bug waiting to happen; a
   selector that cannot return an opted-out row makes the bug impossible.

3. **`send-report-whatsapp` is the exception and needs an explicit refusal**, because its recipient
   list comes from the browser rather than a selector. It must skip an opted-out number, record a
   `report_deliveries` row with `status='failed'` and an `error` naming opt-out, and carry on with
   the rest of the list. It must **not** fail the whole request because one number opted out.

4. **A typed `STOP` takes effect immediately, with no confirmation step.** This deliberately
   differs from every other write in the bot, and from `docs/mockups/whatsapp-simulator.html`,
   which stages a confirm. The reason: Meta requires opt-out to be frictionless, and a person
   typing STOP has already decided. Reversal is one word, and the reply says so.
   **A "Stop everything" row tapped in a menu sheet DOES confirm first** — a mis-tap in a list is
   plausible in a way that typing five letters is not. That sheet is wa-flow-06, not this plan;
   build only the typed path here, and leave the staged path for it.

5. **`STOP` is honoured from any number, in any state** — enrolled or not, on the roster or not,
   mid-confirmation or not. It is checked before the enrolment gate and before any pending-command
   handling. It is the only thing an unenrolled number may do besides send an enrolment code, and
   it **replies** (it does not fall into the silence path), because a person who asks to be left
   alone must be told they have been.

6. **`START` reverses opt-out; `RESUME` clears a pause** — subject to the collision note above.
   Each accepts the other's job if that is the state the number is actually in: a paused person
   typing `START` gets un-paused rather than a pedantic correction.

7. **No new phone normaliser.** Use `report_recipient_by_inbound_phone` to cross from the inbound
   bare-digit form to the roster. `scripts/verify-report-whatsapp-parity.mjs` must still pass.

8. **Every RPC this adds is `service_role` only** — `REVOKE ALL ... FROM PUBLIC, anon,
   authenticated` then `GRANT EXECUTE ... TO service_role`, matching `:398-403`. The browser
   reaches PostgREST as `anon` with a committed key, so an `anon` grant here would let anyone opt
   anybody out.

## Deliverables

### 1. Migration — `migrations/<14-digit-UTC-timestamp>_report_opt_out.sql`

Filename must satisfy `scripts/verify-migration-prefixes.mjs`: a real UTC timestamp
(YYYYMMDDHHMMSS), unique across `migrations/`, `.sql` at the top level. Pick a timestamp later
than `20260907120000`.

- `ALTER TABLE public.report_recipients ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;`
  with a `COMMENT ON COLUMN` saying what it is and that `is_active` is not a substitute.
- `CREATE OR REPLACE FUNCTION public.report_set_opt_out(p_phone text, p_opted_out boolean)
  RETURNS jsonb` — `SECURITY DEFINER`, `SET search_path = public`.
  - Resolve the number through `report_recipient_by_inbound_phone(p_phone)` so both canonical
    forms work.
  - **If there is no roster row, still succeed.** Insert one — `display_name` NULL,
    `source='whatsapp_chat'`, `is_active=false`, `opted_out_at=now()` — so a number nobody has
    ever added to the roster can still opt out, and stays opted out if somebody adds it later.
    This is the case that would otherwise silently do nothing. Note `report_recipients.source`
    has a CHECK constraint of (whatsapp_chat/crm_contact/manual): read it before choosing a value.
  - Setting `p_opted_out=false` clears `opted_out_at` and nothing else. It must **not**
    re-subscribe anybody: that is `set_report_subscription_by_phone`'s job.
  - Return a jsonb envelope in the same shape the sibling RPCs use — read
    `set_report_subscription_by_phone`'s return before choosing keys, and match it.
- Amend `report_daily_recipients()` with `AND rr.opted_out_at IS NULL`. Keep every other line of
  it, including the `muted_until` clause and the `ORDER BY`.
- Grants exactly as contract 8.
- End with `NOTIFY pgrst, 'reload schema';` — `:418` does, and PostgREST will not see the new
  function otherwise.
- A header comment in this repo's migration style: what was wrong, what this changes, and an
  explicit **OUT OF SCOPE: applying this migration** line naming the file, because nothing in this
  repo can reach a database.

### 2. `whatsapp-inbound` — the three verbs

- `STOP` calls `report_set_opt_out(phone, true)`. Reply naming what stopped and how to reverse it.
  Reached **before** the enrolment gate (contract 5). Log `command='STOP', outcome='ok'`.
- `START` per contract 6 and the collision note: opted out means un-opt-out; otherwise the
  existing greeting behaviour, unchanged.
- `RESUME` clears the pause via `set_report_subscription_by_phone(phone, kind, true, NULL)` for
  each kind that is currently paused. If nothing was paused, say so plainly rather than claiming
  to have done something.
- Add the new verbs to `COMMAND_HANDLERS`, and to the `HELP` text — `HELP_COMMAND_LIST` is the
  single place that list lives; do not write a second copy.
- Every one of these replies. None of them fall into the silence path.

### 3. `send-report-whatsapp` — refuse an opted-out number

Per contract 3. The existing per-recipient loop already does
`begin_report_delivery`, then send, then `complete_report_delivery`; the opt-out check belongs
immediately before `begin_report_delivery`, and the failed row it writes must go through the same
two RPCs so the delivery history stays complete. Read the loop before changing it.

### 4. Verifier — `scripts/verify-wa-optout.mjs`

Registered in `package.json` as `wa-optout:verify` and appended to the **end** of the `test:fleet`
chain. Follow the `.ts` discipline of `scripts/verify-wa-plumbing.mjs` and
`scripts/verify-wa-role-features.mjs`: never evaluate a `.ts` file, assert textually, and make
every failure message name the file to fix. Pure `fs` reads, `node:assert`, no dependency, no
network — `test:fleet` must stay hermetic.

Assert at least:

1. `report_daily_recipients()`'s definition in the new migration contains `opted_out_at IS NULL`
   **and** still contains the `muted_until` clause — the second half is the regression that
   matters, because rewriting the function is how the pause silently disappears.
2. `report_set_opt_out` is `SECURITY DEFINER`, pins `search_path`, is GRANTed to `service_role`
   and is **not** granted to `anon` or `authenticated`.
3. `STOP` and `RESUME` are present in `COMMAND_HANDLERS`, and `START` is still mapped to something
   (proving the greeting was not dropped).
4. The `STOP` path is reachable for an unenrolled number. Assert the **ordering** property, not
   just the presence of the verb — e.g. that the STOP check appears before the not-enrolled
   silence return in `processCommandForMessage`'s source order. State in a comment how you assert
   it and why that ordering is what proves it.
5. `HELP_COMMAND_LIST` mentions STOP, so the list the bot shows cannot drift from the verbs it
   answers.
6. `send-report-whatsapp` references `opted_out_at` or the opt-out RPC somewhere in its send loop.
7. No fourth phone normaliser: the count of `function normalizePhone` declarations across
   `supabase/functions/` has not increased beyond what is there today. Count it first, and put the
   number in the assertion with a comment saying when it was counted.

**Before you finish, prove the verifier bites.** For at least assertions 1 and 2, break the thing
deliberately, run the verifier, confirm it fails, restore it, confirm it passes. Say in your report
what you broke and what the failure said. A verifier that cannot fail is worse than none, because
it converts an unverified change into a green tick.

## Verify before finishing

Every one of these is something you can run yourself in this checkout.

1. `npm run test:fleet` — the whole chain, green, including the new verifier. This is the fleet
   merge gate; if it is red, nothing merges.
2. `npm run wa-optout:verify` on its own.
3. `npm run report-whatsapp-parity:verify` — specifically, because contract 7 is about not adding
   a normaliser and this is the verifier that would catch it.
4. `npm run migrations:verify` — proves the new migration's filename prefix is a real, unique UTC
   timestamp. This one fails on a badly-named file and is easy to trip.
5. `npm run wa-staff-menu:verify` and `npm run wa-plumbing:verify` — both read
   `whatsapp-inbound/index.ts` and both will notice if you disturbed something they assert about.
   Expect them to pass; if one fails, you changed something this plan did not ask you to.
6. Do **not** attempt to run the edge functions. There is no Deno in this environment and no
   database to reach, and `node --check` does not accept `.ts`. Textual assertions plus the gate
   are the verification available, which is why deliverable 4 matters.

## Out of scope — do not do these

- **Applying the migration.** Nothing here can reach a database. Say in your report that a human
  must run the new file against dev.
- **The "My reports" settings menu on WhatsApp**, including the staged "Stop everything" sheet row.
  That is wa-flow-06. This plan lands the RPCs and the typed verbs only.
- **The weekly and monthly senders.** wa-flow-04.
- **Anything on the distribution panel.** No `WebPortal/` changes at all in this plan.
- **Submitting a template to Meta.** Impossible from here and not needed for this plan.
