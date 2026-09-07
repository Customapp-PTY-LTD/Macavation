---
retry_of: fd9efdec-3bd4-41ce-bda3-9f0086e7f978
---

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
| `report_recipients` | `20260822090000…sql:75-92` | The roster. `is_active`, `is_staff`, `user_id`, `phone`, **`display_name text NOT NULL`** |
| unique index `idx_report_recipients_phone_norm` | `20260822090000…sql:93-95` | On `report_normalize_wa_phone(phone)`. Canonical `+27...` form, one row per number |
| `report_subscriptions` | `:98-112` | `report_kind` CHECK(daily/weekly/monthly), `is_active`, `muted_until` |
| `report_daily_recipients()` | `:260-277` | **The only recipient selector any sender uses today** |
| `report_recipient_by_inbound_phone(p_phone)` | `:289-329` | Bridges bare-digit inbound to the roster form. **Zero callers.** Filters `AND rr.is_active` at `:311` |
| `set_report_subscription_by_phone(text, text, boolean, date)` | `:335-378` | Pause via `p_muted_until`. **Zero callers.** Also filters `AND rr.is_active` at `:360`, and its write is `INSERT … ON CONFLICT DO UPDATE SET is_active = true` at `:367-374` |
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
that property — it is why a sender cannot forget it. Keep the `<` comparison exactly as written;
do not "fix" it to `<=`.

### THREE SCHEMA FACTS THAT KILLED THE PREVIOUS ATTEMPT — read them before writing any SQL

1. **`report_recipients.display_name` is `text NOT NULL`**
   (`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:77`). Only two
   migrations touch that table and neither relaxes it. Any INSERT that leaves `display_name` NULL
   raises 23502 at runtime, the edge function swallows it, and the opt-out is silently not
   recorded while every textual check passes. **Every INSERT this plan adds must supply a
   non-NULL `display_name`.**

2. **`report_recipient_by_inbound_phone` filters `AND rr.is_active` (`:311`), and so does
   `set_report_subscription_by_phone` (`:360`).** A `report_recipients` row with
   `is_active = false` is invisible to both, forever. That matters at three places:
   a second STOP from the same number would fail to resolve and re-INSERT, colliding with
   `idx_report_recipients_phone_norm`; START could never clear `opted_out_at` for the rows this
   plan creates; and an admin-deactivated roster row could never be opted out either.
   **Therefore the new RPCs in deliverable 1 must NOT resolve through
   `report_recipient_by_inbound_phone`.** They resolve with
   `public.chat_normalize_phone(rr.phone) = public.chat_normalize_phone(p_phone)` and **no
   `is_active` filter** — the same comparison idiom `set_report_subscription_by_phone:360` uses,
   minus that filter. This is not a new normaliser: it calls the existing
   `chat_normalize_phone`.

3. **`set_report_subscription_by_phone` CREATES a subscription it did not find**
   (`INSERT … ON CONFLICT (recipient_id, report_kind) DO UPDATE SET is_active = COALESCE(p_is_active,false)`,
   `:367-374`). Calling it for a kind the person never subscribed to signs them up. The header of
   that same migration (`:22-26`) states the opposite principle for itself: "silently converting
   those into standing subscriptions would start sending people reports they never agreed to."
   **Never call it unless a subscription row for that kind already exists and is already
   consented-to** (see deliverable 2's RESUME guard).

### Two phone canonical forms, and the bridge between them

They differ by the `+` and this is load-bearing:

- `chat_normalize_phone` produces `27821234567` (chat/staff side, and the form inbound `from`
  arrives in)
- `report_normalize_wa_phone` produces `+27821234567` (roster side)

Both are existing functions and both may be called freely. `scripts/verify-report-whatsapp-parity.mjs`
is the guard against a fourth normaliser *implementation* appearing — **do not write one**, and run
that verifier before you finish.

**Blast radius you must respect** (this verifier asserts exact counts, not just presence):

- Its SQL sweep asserts there are **exactly 3** `migrations/*.sql` files containing both
  `'\D', '', 'g'` and `'27'`. The new migration must therefore **not** contain the
  `regexp_replace(…, '\D', '', 'g')` idiom at all.
- Its JS/TS sweep asserts there are **exactly 6** files under `supabase/functions/` (`.ts`) plus
  `WebPortal/` (`.js`) containing both `replace(/\D/g` and `27`. `whatsapp-inbound/index.ts` is
  not one of them today. Do **not** add `replace(/\D/g` to it. (`replace(/\s+/g, ' ')` is fine —
  that is `\s`, not `\D`.)

### The senders that must be gated

| File | What it sends | Auth |
|---|---|---|
| `supabase/functions/send-daily-production-report/index.ts` | The daily template, to `report_daily_recipients()` | Service-role bearer, constant-time compare at `~:155-162` |
| `supabase/functions/send-report-whatsapp/index.ts` | A published report PDF, to **an arbitrary recipient list posted by the browser** | Portal session plus `has_action(user,'reports.report.send')` at `~:224` |

The second is the one that matters most here: it sends to whatever numbers the send dialog passes,
so it is the path by which an opted-out number would still be reached. Its per-recipient loop is
at `~:380-513`; `begin_report_delivery` is the first call inside it at `~:392`.

### The bot's command router — `supabase/functions/whatsapp-inbound/index.ts`

- `COMMAND_HANDLERS` (`~:1223-1246`) — the verb map. `HELP`, `YES`/`Y`/`CONFIRM`, `NO`/`N`/`CANCEL`,
  `REPORT`, `ACK`, `MENU`/`HI`/`HELLO`/`START`, `'0'`, `'99'`.
- `handleCommand` (`~:1261`) — dispatch order, documented in its own comment: a reply-id tap wins,
  then `HELP`, then empty or `?` opens the menu, then a registered verb, then a bare 1-2 digit
  number as a menu position, then an unrecognised-verb reply.
- `Object.prototype.hasOwnProperty.call(COMMAND_HANDLERS, verb)` (`~:1295`) — **keep this guard
  byte-for-byte.** `verb` is attacker-controlled text off a public WhatsApp line and a bare lookup
  would find `Object.prototype` members. `scripts/verify-wa-staff-menu.mjs:97-104` asserts this
  exact string and asserts the unguarded form is absent.
- `CommandContext` (`~:323-341`) requires `userId: string`, `roleId`, `displayName`. It is built
  at `~:1476-1485` **only after** `whatsapp_resolve_staff_user` succeeds (`~:1425`). A handler in
  `COMMAND_HANDLERS` therefore **cannot** be the pre-enrolment STOP path. This is why deliverable 2
  is shaped the way it is.
- `processCommandForMessage` (`~:1388`) runs only for freshly-ingested messages, **never** from
  `statuses[]`. A status must never dispatch a command: our own replies generate statuses, so that
  would loop.
- The unenrolled path (`~:1450-1473`): silence, except a body that is exactly 6 digits, tried
  against `whatsapp_confirm_enrolment`, failing **silently** by design. The line
  `if (!replyId && /^\d{6}$/.test(trimmedBody))` is asserted verbatim by
  `scripts/verify-wa-staff-menu.mjs:137-142` — do not reword it.
- `isMissingRpc` (`~:184-188`) — "a missing RPC means the migration is not applied yet — degrade,
  do not 500". Reuse it; do not write a second copy.
- `logCommand` (`~:279-314`) records every inbound with an `outcome` from
  CHECK(ok/unknown_command/not_enrolled/denied/error) and accepts `userId: null`.
- `sendWhatsappText` (`~:230`) — the local text reply path. Never throws. Use it.

### `START` is already taken — read this before you touch it

`START` is currently registered in `COMMAND_HANDLERS` as `START: commandMenu` (`~:1240`), a
greeting that opens the menu, alongside `HI` and `HELLO`. This plan gives it a second job **without
changing that entry at all**:

- If the number is opted out, the pre-gate interceptor answers `START` ("start sending again") and
  returns. `COMMAND_HANDLERS` is never reached.
- Otherwise the interceptor falls through and `START: commandMenu` keeps its existing meaning.

Write it in that order. `START: commandMenu` must still be present in `COMMAND_HANDLERS` when you
are done, unmodified. Silently removing a greeting would make the bot stop answering "start" for
every user who is not opted out.

### The 2xx rule — non-negotiable

`whatsapp-inbound` must return 2xx for anything that verifies. Control Room **never retries**: a
non-2xx or a timeout is logged on its side and dropped forever. Persist first, log failures loudly
with the wamid, return 200. Its header comment states this; do not weaken it. Everything you add
inside `processCommandForMessage` goes inside its existing `try` (`~:1422`) so the backstop `catch`
still covers it.

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
   the rest of the list. It must **not** fail the whole request because one number opted out. The
   lookup it uses is the named RPC `report_opt_out_status` from deliverable 1 — **never** a raw
   table filter comparing the browser's `phone` string against unnormalised
   `report_recipients.phone`, which would match nobody and silently refuse nobody.

4. **A typed `STOP` takes effect immediately, with no confirmation step.** This deliberately
   differs from every other write in the bot. The reason: Meta requires opt-out to be
   frictionless, and a person typing STOP has already decided. Reversal is one word, and the reply
   says so.
   **A "Stop everything" row tapped in a menu sheet DOES confirm first** — a mis-tap in a list is
   plausible in a way that typing four letters is not. That sheet is wa-flow-06, not this plan;
   build only the typed path here, and leave the staged path for it. (The staged menu design lives
   in `docs/whatsapp/whatsapp-reports-rev2.html:640-678`. An earlier draft of this plan cited
   `docs/mockups/whatsapp-simulator.html`, which **does not exist in this checkout** — do not go
   looking for it, and do not create or edit any document under `docs/` as part of this plan.)

5. **`STOP` is honoured from any number, in any state** — enrolled or not, on the roster or not,
   mid-confirmation or not. It is checked before the enrolment gate and before any pending-command
   handling. It is the only thing an unenrolled number may do besides send an enrolment code, and
   it **replies** (it does not fall into the silence path), because a person who asks to be left
   alone must be told they have been. Because it runs before `whatsapp_resolve_staff_user`, its
   audit row carries `userId: null` **even for an enrolled staff member** — that is accepted, and
   the phone number in the row is the identifier.

6. **`START` reverses opt-out; `RESUME` clears a pause — and each stays in its own lane.**
   - `START` (pre-gate) clears `opted_out_at` and nothing else. It does not touch subscriptions
     and does not clear a pause.
   - `RESUME` (post-gate verb) clears a **daily** pause and nothing else.
   The previous draft of this contract had each verb absorb the other's job. That is withdrawn:
   pause state for weekly and monthly is **not readable anywhere in this checkout**
   (`report_recipient_by_inbound_phone` returns only `subscribed_daily` and the daily
   `muted_until`, `:303-327`), and the only write RPC available creates consent where none existed
   (schema fact 3). A verb that cannot read the state it claims to fix must not guess at it.
   Extending RESUME to weekly/monthly needs a read RPC that does not exist yet — that is
   wa-flow-06's job, and it is listed out of scope below.

7. **No new phone normaliser.** Call the existing `chat_normalize_phone` and
   `report_normalize_wa_phone`. Do not add the digit-strip idiom to any new or edited file — see
   the exact-count blast radius above. `scripts/verify-report-whatsapp-parity.mjs` must still pass.

8. **Every RPC this adds is `service_role` only** — `REVOKE ALL ... FROM PUBLIC, anon,
   authenticated` then `GRANT EXECUTE ... TO service_role`, matching `:398-403`. The browser
   reaches PostgREST as `anon` with a committed key, so an `anon` grant here would let anyone opt
   anybody out — or enumerate whether a given number is on a confidential distribution list.

9. **Both new RPCs resolve a phone without an `is_active` filter** (schema fact 2), and **every
   INSERT supplies a non-NULL `display_name`** (schema fact 1). These two are the reason the
   previous attempt was blocked; they are contracts, not implementation detail.

## Deliverables

### 1. Migration — `migrations/<14-digit-UTC-timestamp>_report_opt_out.sql`

Filename must satisfy `scripts/verify-migration-prefixes.mjs`: a real UTC timestamp
(YYYYMMDDHHMMSS), unique across `migrations/`, `.sql` at the top level. The highest prefix in the
tree today is `20260907120000`; pick something later than that.

**1a. The column**

```sql
ALTER TABLE public.report_recipients ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;
```

with a `COMMENT ON COLUMN` saying what it is, that the timestamp is the audit record of when the
person asked, and that `is_active` is not a substitute (that is the administrator's switch).

No new index: the roster is small and every selector over it already scans and orders by
`display_name`. Do not add one.

**1b. `public.report_set_opt_out(p_phone text, p_opted_out boolean) RETURNS jsonb`**

`LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`.

Envelope keys, fixed here and referenced by name in deliverables 2 and 4:
`ok`, `error`, `found`, `opted_out`, `created`. (`ok`/`error` match
`set_report_subscription_by_phone:376`; `found` matches `report_recipient_by_inbound_phone`.)

Required behaviour, in this order:

- `v_key := public.chat_normalize_phone(p_phone)` and `v_canon := public.report_normalize_wa_phone(p_phone)`.
  If either is NULL, return `ok=false`, `error='A valid phone number is required.'`, `found=false`,
  `opted_out=false`, `created=false`.
- Resolve: `SELECT rr.id, rr.display_name INTO v_id, v_name FROM public.report_recipients rr
  WHERE public.chat_normalize_phone(rr.phone) = v_key LIMIT 1;` — **no `is_active` filter**
  (contract 9 / schema fact 2). Do not call `report_recipient_by_inbound_phone` here.
- **No row, and `p_opted_out` is false:** there is nothing to clear. Return `ok=true`,
  `found=false`, `opted_out=false`, `created=false`, and **create nothing**. (Creating a row in
  response to START would opt somebody out for asking to be resumed — the previous draft left this
  case undefined.)
- **No row, and `p_opted_out` is true:** insert one, so a number nobody has ever added to the
  roster can still opt out and stays opted out if somebody adds it later. This is the case that
  would otherwise silently do nothing.
  ```sql
  INSERT INTO public.report_recipients
      (display_name, phone, source, is_active, opted_out_at)
  VALUES
      (v_canon, v_canon, 'whatsapp_chat', false, now())
  RETURNING report_recipients.id, report_recipients.display_name INTO v_id, v_name;
  ```
  - `display_name = v_canon` (the canonical `+27…` form) because the column is `NOT NULL`
    (schema fact 1). It is honest — nobody has told us a name — and it sorts sanely in
    `list_report_recipients`' `ORDER BY r.display_name`.
  - `source = 'whatsapp_chat'` is one of the three values allowed by the CHECK at
    `20260822090000…sql:80` — read that CHECK before choosing.
  - `is_active = false`: they are not an active recipient. Because 1b and 1c resolve without the
    `is_active` filter, this row is still reachable by a second STOP and by START.
  - Columns are qualified in the `RETURNING` clause, matching `upsert_report_recipient:246`.
  - Wrap the INSERT in `BEGIN … EXCEPTION WHEN unique_violation THEN <re-resolve by v_key, no
    is_active filter> END;` so a race against `idx_report_recipients_phone_norm` becomes an update
    instead of an error. Do **not** rely on `ON CONFLICT` inference against an expression index.
- **Row found (or just inserted by the exception handler):**
  ```sql
  UPDATE public.report_recipients
  SET opted_out_at = CASE WHEN COALESCE(p_opted_out, false)
                          THEN COALESCE(opted_out_at, now())
                          ELSE NULL END,
      updated_at   = now()
  WHERE id = v_id;
  ```
  `COALESCE(opted_out_at, now())` preserves the FIRST time they asked — that timestamp is the
  audit record and a repeated STOP must not overwrite it.
- Setting `p_opted_out=false` clears `opted_out_at` **and nothing else**. It must **not**
  re-subscribe anybody and must not touch `is_active`: that is
  `set_report_subscription_by_phone`'s / `set_report_recipient_active`'s job.
- Return `ok=true`, `error=NULL`, `found=true`, `opted_out=COALESCE(p_opted_out,false)`,
  `created=<whether this call inserted the row>`.

**1c. `public.report_opt_out_status(p_phone text) RETURNS jsonb`**

`LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`. This is the read half, and it
exists because nothing in the checkout can answer "is this number opted out?" —
`report_recipient_by_inbound_phone` does not return the column and filters `is_active`. Both
deliverable 2's START and deliverable 3's refusal call this by name.

Envelope keys, fixed here: `ok`, `error`, `found`, `opted_out`, `opted_out_at`.

- `v_key := public.chat_normalize_phone(p_phone)`; NULL ⇒ `ok=false`, `error='A valid phone number
  is required.'`, `found=false`, `opted_out=false`, `opted_out_at=NULL`.
- Resolve with the same `chat_normalize_phone(rr.phone) = v_key`, `LIMIT 1`, **no `is_active`
  filter**. Normalising inside the RPC is what makes a browser-supplied `082…` match a stored
  `+2782…`.
- No row ⇒ `ok=true`, `found=false`, `opted_out=false`, `opted_out_at=NULL`.
- Row ⇒ `ok=true`, `found=true`, `opted_out = (opted_out_at IS NOT NULL)`, `opted_out_at` as
  stored. Select `rr.id` into the record alongside `rr.opted_out_at` and use the
  `IF v_row IS NULL THEN` idiom exactly as `report_recipient_by_inbound_phone:314` does — that is
  safe there and here because `rr.id` is never NULL when a row matched, so the record is NULL only
  when nothing matched.

**1d. Amend `report_daily_recipients()`**

`CREATE OR REPLACE` it with `AND rr.opted_out_at IS NULL` added. Keep **every other line
verbatim**, including `WHERE rr.is_active`, `AND rs.is_active`, the
`(rs.muted_until IS NULL OR rs.muted_until < public.report_sast_today())` clause and the
`ORDER BY rr.display_name`. Rewriting this function is exactly how the pause silently disappears;
deliverable 4 assertion 1 exists to catch that.

**1e. Grants**

Exactly as contract 8, with full signatures:

```sql
REVOKE ALL ON FUNCTION public.report_set_opt_out(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_opt_out_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_set_opt_out(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_opt_out_status(text) TO service_role;
```

`report_daily_recipients()` keeps its existing grants; re-state its REVOKE/GRANT pair after the
`CREATE OR REPLACE` only if you are certain replacing the body does not preserve them — if you
re-state it, copy `:398`/`:401` exactly.

**1f. House rules for this file**

- End with `NOTIFY pgrst, 'reload schema';` — `:418` does, and PostgREST will not see the new
  functions otherwise.
- Every statement re-runnable (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`), matching the
  idempotency note both sibling migrations open with.
- Must **not** contain the `regexp_replace(…, '\D', '', 'g')` idiom — it would become a fourth SQL
  candidate and break `report-whatsapp-parity:verify`'s exact count of 3.
- A header comment in this repo's migration style: what was wrong, what this changes, and an
  explicit **OUT OF SCOPE: applying this migration** line naming the file, because nothing in this
  repo can reach a database. Record in that header the two schema facts this file works around
  (`display_name NOT NULL` at `20260822090000…sql:77`; the `is_active` filter at
  `20260825090000…sql:311` and `:360`), with those file:line references, so the next reader does
  not re-derive them.

### 2. `whatsapp-inbound` — the pre-gate opt-out interceptor and one new verb

**2a. `handleOptOutVerbs` — the pre-gate path (contract 5)**

Add one new function, named exactly `handleOptOutVerbs`:

```ts
async function handleOptOutVerbs(
  sb: SupabaseClient,
  from: string,
  wamid: string,
  rawBody: string,
  replyId: string | null
): Promise<boolean>
```

It returns `true` when it has handled the message (and replied), `false` to fall through to the
existing behaviour unchanged. It takes plain arguments, **not** a `CommandContext`: that interface
requires `userId`/`roleId`/`displayName`, which only exist after `whatsapp_resolve_staff_user`
(`~:1425`, `~:1476-1485`), and contract 5 requires this to run before that call.

Behaviour:

- `if (replyId) return false;` — a tap is wa-flow-06's staged path, not this one. This mirrors the
  `!replyId` guard the 6-digit enrolment branch already uses.
- Derive the verb the same way `handleCommand` does:
  `const collapsed = rawBody.trim().replace(/\s+/g, ' ');`
  `const verb = (collapsed.split(' ')[0] || '').toUpperCase();`
  Only `'STOP'` and `'START'` are of interest; anything else ⇒ `return false`.
- `STOP`:
  - call `report_set_opt_out` with `{ p_phone: from, p_opted_out: true }`;
  - on success, `logCommand(sb, { phone: from, userId: null, wamid, rawBody, command: 'STOP',
    outcome: 'ok' })`, then `sendWhatsappText(from, …)` with a reply that names what stopped and
    how to reverse it. Word it so it is true for a number that was never on any list, e.g.
    "You will not receive any further report messages from Macavation. Text START if you want to
    allow them again." **Do not promise re-subscription** — clearing `opted_out_at` does not
    create a subscription;
  - on any failure — including `isMissingRpc(error)` (the migration is applied by a human later,
    see out-of-scope), in which case also `console.error` naming the new migration file, exactly as
    `~:1427-1431` does — log `command: 'STOP', outcome: 'error'` with the message in `detail`, and
    reply an honest fallback such as "I could not record that just now. Please reply STOP again
    shortly." Never reply as though it succeeded;
  - `return true` in every branch. STOP must never fall through into the silence path.
- `START`:
  - call `report_opt_out_status` with `{ p_phone: from }`;
  - if it errors: on `isMissingRpc`, `console.error` naming the migration and `return false`; on
    any other error, `logCommand(command: 'START', outcome: 'error')` and `return false`. Falling
    through is deliberate — the existing greeting must keep working when the opt-out read is
    unavailable;
  - if `opted_out` is not true (including `found === false`) ⇒ `return false`, so
    `START: commandMenu` keeps its existing meaning for everybody who is not opted out;
  - if `opted_out` is true: call `report_set_opt_out` with `{ p_phone: from, p_opted_out: false }`,
    log `command: 'START', outcome: 'ok'` (or `'error'` on failure, with an honest fallback reply),
    reply, and `return true`. Word the success reply without over-promising, e.g. "Your opt-out has
    been removed. If somebody has you on a report list, those messages can resume." An opted-out
    staff member gets this confirmation rather than the menu; they can text MENU next.
- `handleOptOutVerbs` must never throw: it is called inside `processCommandForMessage`'s existing
  `try` (below), and the 2xx rule stands.
- Do **not** register `STOP` in `COMMAND_HANDLERS`. The interceptor is the single STOP path; a
  `COMMAND_HANDLERS.STOP` entry would be unreachable dead code and would invite a second,
  divergent implementation. Deliverable 4 asserts the interceptor's position instead of the map
  entry.

**2b. The call site**

Inside `processCommandForMessage`, as the **first statement inside the existing `try` block**
(`~:1422`) — i.e. after the `rawBody`/`replyId` extraction and **before** the
`sb.rpc('whatsapp_resolve_staff_user', …)` call:

```ts
    if (await handleOptOutVerbs(sb, from, wamid, rawBody, replyId)) {
      return;
    }
```

Do not touch, reword or reindent the resolution block, the unenrolled branch, or the line
`if (!replyId && /^\d{6}$/.test(trimmedBody))` — `scripts/verify-wa-staff-menu.mjs` asserts that
last one verbatim.

**2c. `RESUME` — a daily-only, consent-preserving pause clear**

Add one handler, named exactly `commandResume`, registered as `RESUME: commandResume` in
`COMMAND_HANDLERS`. It is post-gate (an enrolled number only), which is what the current
architecture allows; extending pause/resume to non-staff subscribers is wa-flow-06's job and is
listed out of scope.

```
commandResume(ctx):
  1. rpc('report_recipient_by_inbound_phone', { p_phone: ctx.phone })
     - isMissingRpc  -> console.error naming migration 20260825090000; outcome 'error',
                        reply "I could not check that just now.", command 'RESUME'
     - other error   -> outcome 'error', same reply, detail = message
  2. found === false                      -> outcome 'ok', command 'RESUME',
                                             reply "There is no pause on this number."
  3. subscribed_daily !== true            -> outcome 'ok', command 'RESUME',
     OR muted_until is null/absent           reply "Nothing is paused on this number."
  4. otherwise: rpc('set_report_subscription_by_phone',
        { p_phone: ctx.phone, p_report_kind: 'daily', p_is_active: true, p_muted_until: null })
     - ok    -> outcome 'ok', reply "The pause on your daily report has been lifted."
     - error -> outcome 'error', honest failure reply
```

Step 3's guard is mandatory and is the whole reason RESUME is safe: `set_report_subscription_by_phone`
sets `is_active = true` on an `INSERT … ON CONFLICT DO UPDATE` (`:367-374`), so calling it when
`subscribed_daily` is false would either create a subscription or switch on one an administrator had
switched off — consent the person never gave. Only call it when a consented-to, paused daily row
already exists.

Two consequences to state plainly in the replies and in your report, not to code around:

- `report_recipient_by_inbound_phone` filters `rr.is_active`, so for an admin-deactivated roster
  row RESUME reports "There is no pause on this number." That is correct: there is nothing this
  verb can safely do for such a row.
- Do **no** date arithmetic in the bot. If `muted_until` is non-null, clear it and say the pause
  was lifted — true whether or not it had already expired. `public.report_sast_today()` is this
  repo's only "today" and the selector already applies it; a JS-side timezone comparison here would
  be a second, drifting answer.

**2d. `HELP_COMMAND_LIST`**

Add `STOP` and `RESUME` lines to `HELP_COMMAND_LIST` (`~:896-900`) — it is the single place that
list lives (`helpReplyText` and `handleCommand`'s unrecognised-verb reply both interpolate it); do
not write a second copy. Mention that `START` undoes a STOP. Keep lines short and WhatsApp-friendly,
matching the existing four.

**2e.** Every path added here replies. None of them fall into the silence path.

### 3. `send-report-whatsapp` — refuse an opted-out number

Per contract 3. Read the loop (`~:380-513`) before changing it.

- Immediately **before** the `begin_report_delivery` call (`~:392`), for the loop's current
  `phone`, call `report_opt_out_status` with `{ p_phone: phone }`. `phone` is the raw
  browser-supplied string; the RPC normalises internally, which is what makes `082…` match a
  stored `+2782…`. Do not build a phone comparison in TypeScript and do not query
  `report_recipients` directly.
- The existing `rpc()` helper (`~:83-89`) normalises a result into a row array and wraps a single
  jsonb object as `[obj]`, so `(await rpc(sb, 'report_opt_out_status', {…}))[0]` works — but read
  the helper and the `has_action` note at `~:118-125` before choosing, and if you call
  `sb.rpc` directly, handle `error` explicitly.
- If `opted_out === true`: write the refusal through the same two RPCs the rest of the loop uses,
  so the delivery history stays complete — `begin_report_delivery` with the same arguments the send
  path passes, then `complete_report_delivery` with `p_status: 'failed'` and a `p_error` that names
  opt-out (e.g. `'Recipient has opted out of WhatsApp report messages.'`). **Do not send.** Push a
  `results` entry with `status: 'failed'` and that error, `failed++`, and `continue`. The whole
  request must still return 200 with per-recipient detail (`~:515-519`).
- **Decide the unavailable-RPC case explicitly, and do not invert it.** This plan does not apply
  the migration (out of scope), so the deployed function will run against a database without
  `report_opt_out_status` until a human applies it:
  - RPC **missing** (PostgREST cannot find the function — the same condition
    `whatsapp-inbound`'s `isMissingRpc` at `~:184-188` detects: code `PGRST202`, or a message
    matching `could not find the function|does not exist`): `console.error` naming the new
    migration file, and **continue the send**. Refusing every recipient because a not-yet-applied
    migration is missing would break the only working report-send path.
  - Any **other** error (permission, timeout, transport): treat as a refusal — record the
    `failed` delivery row as above with an error naming the failed opt-out check, and skip the
    send for that recipient. A gate that cannot answer must not wave the message through.
  Write both branches with a comment stating which is fail-open and which is fail-closed, and why.
- Do not add `replace(/\D/g` anywhere new in this file (the existing `normalizePhone` at `~:148-153`
  is inventory row 3 and must stay byte-identical — `report-whatsapp-parity:verify` asserts its
  exact literal).

### 4. Verifier — `scripts/verify-wa-optout.mjs`

Registered in `package.json` as `wa-optout:verify` and appended to the **end** of the `test:fleet`
chain (`package.json:37`). Follow the `.ts` discipline of `scripts/verify-wa-plumbing.mjs` and
`scripts/verify-wa-role-features.mjs`: never evaluate a `.ts` file, assert textually, and make
every failure message name the file to fix. Pure `fs` reads, `node:assert`, no dependency, no
network — `test:fleet` must stay hermetic, per `package.json`'s own `//test:fleet` note. Do not
copy another verifier's path constants or allowlists without re-deriving them for this script.

Locate the new migration by globbing `migrations/*_report_opt_out.sql` (do not hard-code the
timestamp you picked into a second place beyond the failure messages).

Assert at least:

1. `report_daily_recipients()`'s definition in the new migration contains `opted_out_at IS NULL`
   **and** still contains both `rs.muted_until IS NULL` and `public.report_sast_today()` — the
   second half is the regression that matters, because rewriting the function is how the pause
   silently disappears. Assert `rr.is_active` and `rs.is_active` are still there too.
2. `report_set_opt_out` and `report_opt_out_status` are each `SECURITY DEFINER`, pin
   `SET search_path = public`, are `GRANT`ed to `service_role`, and are **not** granted to `anon`
   or `authenticated`.
3. The insert branch supplies a non-NULL `display_name`: the migration contains the column list
   `(display_name, phone, source, is_active, opted_out_at)` and a `VALUES` line supplying
   `v_canon, v_canon, 'whatsapp_chat', false, now()`. Failure message must cite
   `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:77` (`display_name text
   NOT NULL`) so the reason is not lost.
4. Neither new RPC resolves through the `is_active`-filtered bridge: the migration does **not**
   contain the string `report_recipient_by_inbound_phone`, and each of the two new function bodies
   contains `public.chat_normalize_phone(rr.phone) = v_key`. Failure message must cite
   `migrations/20260825090000_report_subscriptions_and_staff.sql:311`.
5. `RESUME: commandResume` is present in `COMMAND_HANDLERS`, and `START: commandMenu` is still
   present (proving the greeting was not dropped or repointed).
6. The `STOP` path is reachable for an unenrolled number, asserted as an **ordering** property:
   in `supabase/functions/whatsapp-inbound/index.ts`, `indexOf('handleOptOutVerbs(sb, from, wamid, rawBody, replyId)')`
   is greater than −1 and **less than** `indexOf("sb.rpc('whatsapp_resolve_staff_user'")`, which is
   in turn less than `indexOf("outcome: 'not_enrolled'")`. State in a comment that source order is
   what proves it here (this script never executes `.ts`), that the interceptor sits inside
   `processCommandForMessage`'s existing `try`, and that a `COMMAND_HANDLERS.STOP` entry is
   deliberately absent because `CommandContext` does not exist before resolution.
7. `commandResume`'s body (isolate it from `async function commandResume` to the next `\n}\n`, the
   idiom `verify-wa-staff-menu.mjs:553-557` uses) contains `subscribed_daily` and `muted_until`
   **before** its `set_report_subscription_by_phone` call site. Failure message must say that the
   guard is what stops the call creating or re-enabling a subscription
   (`…20260825090000…sql:367-374`).
8. `HELP_COMMAND_LIST` mentions `STOP` and `RESUME`, so the list the bot shows cannot drift from
   the verbs it answers.
9. `supabase/functions/send-report-whatsapp/index.ts` calls `report_opt_out_status`, and its first
   occurrence appears **before** the first `begin_report_delivery` occurrence. Also assert the file
   contains no direct `from('report_recipients')` table access — the failure mode this replaces is
   an invented raw-table filter that matches nobody.
10. No new normaliser and no new sweep candidate: the count of `function normalizePhone`
    declarations across `supabase/functions/` is exactly **3** (counted against this checkout on
    the day you write the script — put the number and the date in a comment beside the assertion:
    `send-whatsapp-message/index.ts:148`-style hits in `send-whatsapp-message`,
    `send-daily-digest-whatsapp`, `send-report-whatsapp`), and `whatsapp-inbound/index.ts` contains
    zero occurrences of `replace(/\D/g`. Note in a comment that
    `scripts/verify-report-whatsapp-parity.mjs` asserts the authoritative exact counts (6 JS/TS, 3
    SQL candidates) and that this is a cheaper early warning, not a replacement.
11. The new migration does not contain `'\D', '', 'g'` — which would make it a fourth SQL sweep
    candidate and break `report-whatsapp-parity:verify`.

**Before you finish, prove the verifier bites.** For at least assertions 1, 3 and 4, break the
thing deliberately, run the verifier, confirm it fails, restore it, confirm it passes. Say in your
report what you broke and quote the exact failure message each time. A verifier that cannot fail is
worse than none, because it converts an unverified change into a green tick.

## Verify before finishing

Every one of these is something you can run yourself in this checkout.

1. `npm run test:fleet` — the whole chain, green, including the new verifier. This is the fleet
   merge gate; if it is red, nothing merges.
2. `npm run wa-optout:verify` on its own.
3. `npm run report-whatsapp-parity:verify` — specifically, because contract 7 is about not adding a
   normaliser and this verifier asserts **exact counts** of files carrying the idiom, so a stray
   `regexp_replace(…'\D'…)` in the new migration or a `replace(/\D/g` in `whatsapp-inbound` fails
   it even though neither is a real normaliser.
4. `npm run migrations:verify` — proves the new migration's filename prefix is a real, unique UTC
   timestamp. This one fails on a badly-named file and is easy to trip. Note it never auto-heals
   and its baseline is read-only: fix the filename, never the baseline.
5. `npm run wa-staff-menu:verify` and `npm run wa-plumbing:verify` — both read
   `whatsapp-inbound/index.ts`; `wa-staff-menu` asserts the `hasOwnProperty` guard string, the
   `if (!replyId && /^\d{6}$/.test(trimmedBody))` line, `'0': commandMenu` / `'99': commandMenu`,
   the absence of a `'9'` handler, and scans the whole file for `action:/title:/feature:` menu
   triples. Expect both to pass; if one fails, you changed something this plan did not ask you to.
6. `npm run report-whatsapp-payload:verify` — it asserts exact regex and constant literals inside
   `send-report-whatsapp/index.ts`; deliverable 3 must not disturb them.
7. Do **not** attempt to run the edge functions. There is no Deno in this environment and no
   database to reach, and `node --check` does not accept `.ts`. Textual assertions plus the gate
   are the verification available, which is why deliverable 4 matters. Say so in your report rather
   than claiming any runtime behaviour was observed.

In your report, state explicitly: that you read the existing `START: commandMenu` binding rather
than overwriting it; that no INSERT this plan adds leaves `display_name` NULL; that neither new RPC
resolves through an `is_active`-filtered path; and which of the two unavailable-RPC branches in
deliverable 3 fails open and which fails closed.

## Out of scope — do not do these

- **Applying the migration.** Nothing here can reach a database. Say in your report that a human
  must run the new file against dev.
- **The "My reports" settings menu on WhatsApp**, including the staged "Stop everything" /
  "Stop daily messages" sheet rows and the tapped `Pause for 7 days`. That is wa-flow-06. This plan
  lands the RPCs, the pre-gate typed verbs and the daily RESUME only.
- **Weekly and monthly pause/resume, and any read RPC that would expose weekly/monthly pause
  state.** Not readable from this checkout; needs its own reviewed design in wa-flow-06. Do not
  invent one here, and do not call `set_report_subscription_by_phone` for `'weekly'` or
  `'monthly'` anywhere.
- **Pause/resume for numbers that are not enrolled staff.** The bot's only identity path is
  `whatsapp_resolve_staff_user`; widening it is not this plan's job. (STOP and START are the
  exception, and they need no identity — a phone number is the whole input.)
- **The weekly and monthly senders.** wa-flow-04.
- **Anything on the distribution panel.** No `WebPortal/` changes at all in this plan.
- **Any change under `docs/`.** Including correcting the missing
  `docs/mockups/whatsapp-simulator.html` reference or the claim in
  `docs/whatsapp/whatsapp-reports-rev2.html:676-678` that the menu works for everybody on the list
  (the current code admits only `whatsapp_resolve_staff_user`-resolved numbers). Those are separate,
  human-reviewed documentation follow-ups.
- **Submitting a template to Meta.** Impossible from here and not needed for this plan.
- **Changing any of the seven phone-normaliser implementations**, or the `test:fleet` chain beyond
  appending `wa-optout:verify` to its end.
