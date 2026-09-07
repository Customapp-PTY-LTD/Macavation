---
retry_of: 28254b6d-1b77-4e86-be54-0588979b19aa
---

# WhatsApp: an opt-out that every sender must pass, and a pause that expires itself

**This is a hand-corrected fourth attempt.** Three prior runs were blocked. Every claim below was
re-checked against this checkout before writing this version. The corrections from the last block
are called out at the point each is fixed, so the next reader does not have to diff four files to
find out what changed and why.

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

### The roster and its selectors

| Symbol | Approx. line | What it is |
|---|---|---|
| `report_recipients` | `20260822090000…sql:75-89` | The roster. `is_active`, `is_staff`, `phone`, **`display_name text NOT NULL`** (`:77`), `source` CHECK (`:80`) |
| unique index `idx_report_recipients_phone_norm` | `20260822090000…sql:93-95` | On `report_normalize_wa_phone(phone)`. Canonical `+27...` form, one row per number |
| `list_report_recipients(boolean)` | `20260822090000…sql:159-199` | Portal read. Returns `report_normalize_wa_phone(r.phone)`; widens to inactive rows on `p_include_inactive` at `:196`. **Granted to `anon`** at `:504` |
| `upsert_report_recipient(...)` | `20260822090000…sql:201-263` | Resolves by normalised phone with **no `is_active` filter** (`:235-238`) and sets `is_active = true` (`:255`); does not touch `opted_out_at`. Granted to `anon` at `:506` |
| `list_report_distribution(boolean)` | `20260825090000…sql:150-179` | Portal read. Returns `rr.phone` verbatim; widens to inactive rows on `p_include_inactive` at `:174`. **Granted to `anon`** at `:394`, and its body contains **no permission check** |
| `report_subscriptions` | `20260825090000…sql:98-112` | `report_kind` CHECK(daily/weekly/monthly), `is_active`, `muted_until` |
| `report_daily_recipients()` | `20260825090000…sql:260-277` | The recipient selector `send-daily-production-report` uses. **Not the only one that exists** — see the sender inventory below |
| `report_recipient_by_inbound_phone(p_phone)` | `20260825090000…sql:289-329` | Bridges bare-digit inbound to the roster form. **Zero callers.** Filters `AND rr.is_active` at `:311` |
| `set_report_subscription_by_phone(text, text, boolean, date)` | `20260825090000…sql:335-378` | Pause via `p_muted_until`. **Zero callers.** Filters `AND rr.is_active` at `:360`; its write is `INSERT … ON CONFLICT DO UPDATE SET is_active = COALESCE(p_is_active,false), muted_until = p_muted_until` at `:367-374` |
| grants block | `20260825090000…sql:393-403` | `report_daily_recipients`, `report_recipient_by_inbound_phone`, `set_report_subscription_by_phone` REVOKEd from PUBLIC/anon/authenticated and GRANTed to `service_role` (`:398-403`); the four screen RPCs GRANTed to `anon, authenticated, service_role` (`:393-396`) |

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

### THREE SCHEMA FACTS THAT KILLED AN EARLIER ATTEMPT — read them before writing any SQL

1. **`report_recipients.display_name` is `text NOT NULL`** (`20260822090000…sql:77`). Only two
   migrations touch that table and neither relaxes it. Any INSERT that leaves `display_name` NULL
   raises 23502 at runtime, the edge function swallows it, and the opt-out is silently not
   recorded while every textual check passes. **Every INSERT this plan adds must supply a
   non-NULL `display_name`.**

2. **`report_recipient_by_inbound_phone` filters `AND rr.is_active` (`:311`), and so does
   `set_report_subscription_by_phone` (`:360`).** A `report_recipients` row with
   `is_active = false` is invisible to both, forever. That matters at three places: a second STOP
   from the same number would fail to resolve and re-INSERT, colliding with
   `idx_report_recipients_phone_norm`; START could never clear `opted_out_at` for the rows this
   plan creates; and an admin-deactivated roster row could never be opted out either.
   **Therefore the new RPCs in deliverable 1 must NOT resolve through
   `report_recipient_by_inbound_phone`.** They resolve with
   `public.chat_normalize_phone(rr.phone) = public.chat_normalize_phone(p_phone)` and **no
   `is_active` filter** — the same comparison idiom `set_report_subscription_by_phone:360` uses,
   minus that filter. This is not a new normaliser: it calls the existing `chat_normalize_phone`.

3. **`set_report_subscription_by_phone` CREATES a subscription it did not find**
   (`INSERT … ON CONFLICT (recipient_id, report_kind) DO UPDATE SET is_active = COALESCE(p_is_active,false)`,
   `:367-374`). Calling it for a kind the person never subscribed to signs them up. The header of
   that same migration (`:22-26`) states the opposite principle for itself. **Never call it unless
   a subscription row for that kind already exists and is already consented-to** (see deliverable
   2's RESUME guard).

### Two phone canonical forms, and the bridge between them

They differ by the `+` and this is load-bearing:

- `chat_normalize_phone` produces `27821234567` (chat/staff side, and the form inbound `from`
  arrives in). Defined at `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92`; it
  strips non-digits, so it is idempotent on a `+27…` input. Read it before relying on that.
- `report_normalize_wa_phone` produces `+27821234567` (roster side), `20260822090000…sql:46-66`.

Both are existing functions and both may be called freely. `scripts/verify-report-whatsapp-parity.mjs`
is the guard against an eighth normaliser *implementation* appearing — **do not write one**, and run
that verifier before you finish.

**Blast radius you must respect** (this verifier asserts exact counts, not just presence):

- Its SQL sweep asserts there are **exactly 3** `migrations/*.sql` files containing both
  `'\D', '', 'g'` and `'27'`. The new migration must therefore **not** contain the
  `regexp_replace(…, '\D', '', 'g')` idiom at all.
- Its JS/TS sweep asserts there are **exactly 6** files under `supabase/functions/` (`.ts`) plus
  `WebPortal/` (`.js`) containing both `replace(/\D/g` and `27`. `whatsapp-inbound/index.ts` is
  not one of them today. Do **not** add `replace(/\D/g` to it. (`replace(/\s+/g, ' ')` is fine —
  that is `\s`, not `\D`.)
- It extracts each `normalizePhone` body by identifier and evaluates it against a truth table
  (`INVENTORY`, `:140-197`). **Do not touch any `normalizePhone` body**, including the digest
  sender's at `send-daily-digest-whatsapp/index.ts:48-53`.
- That script's own header cites the digest's normaliser as `:42-47` and
  `send-report-whatsapp/index.ts:143` cites `send-daily-digest-whatsapp/index.ts:42-47`; the real
  location is `:48-53`. Both are stale comments. **Do not correct them in this plan** — they are
  separate, human-reviewed follow-ups, and editing pinned regions risks tripping the verifier.

### The senders that must be gated

**Corrected inventory — the auth column is fixed in this version.**

| File | What it sends | Auth (verified) | Recipients from |
|---|---|---|---|
| `supabase/functions/send-daily-production-report/index.ts` | The daily template | Service-role bearer, constant-time compare at `~:155-162` | `report_daily_recipients()` — gated by deliverable 1d |
| `supabase/functions/send-report-whatsapp/index.ts` | A published report PDF, to **an arbitrary recipient list posted by the browser** | Portal session (`validateSession`, `:91-116`) plus `has_action(user,'reports.report.send')` at `~:224` | Whatever the browser posts — gated by deliverable 3 |
| `supabase/functions/send-daily-digest-whatsapp/index.ts` | A plain-text digest | **NO auth gate of any kind.** `Deno.serve` at `:68` goes straight to a presence check on `CONTROL_ROOM_FORWARD_SECRET` / `CONTROL_ROOM_CHANNEL_SLUG` at `:73-80` and then sends. There is no `Authorization` comparison, no `timingSafeEqual`, no session check anywhere in its 148 lines. **Do not describe it as having the service-role-bearer shape, and do not add one — adding auth to it is out of scope here.** | `scheduled_reports`, direct table read at `:93-97`, no gate today — gated by deliverable 3b |

The third is not scheduled anywhere in this repo today — its own header says so (`:5-8`: "Nothing
has ever been sent from here") — and this plan does not change that, does not investigate the
`docs/phase2/*` documents that still describe a schedule for it, and does not assert whether it is
otherwise reachable. **What this plan cannot leave alone is the STOP reply's promise.** If STOP
only gates two of the three functions that can send a report-shaped WhatsApp message, the words
"you will not receive any further report messages" are false for as long as this third function
exists and is ever invoked. Deliverable 3b closes it.

`send-report-whatsapp`'s per-recipient loop is `for (const recipient of recipients) {` at `~:380`;
the `begin_report_delivery` call is the first thing inside its `try` at `~:391-409`; the loop's own
outer `catch (loopErr)` is at `~:501-512`; the response is built at `~:520-527`.

### The bot's command router — `supabase/functions/whatsapp-inbound/index.ts`

- `COMMAND_HANDLERS` (`~:1223-1246`) — the verb map. `HELP`, `YES`/`Y`/`CONFIRM`, `NO`/`N`/`CANCEL`,
  `REPORT`, `ACK`, `MENU`/`HI`/`HELLO`/`START`, `'0'`, `'99'`.
- `handleCommand` (`~:1261`) — dispatch order documented in its own comment.
- `Object.prototype.hasOwnProperty.call(COMMAND_HANDLERS, verb)` (`~:1295`) — **keep byte-for-byte.**
  `verb` is attacker-controlled text off a public WhatsApp line. `scripts/verify-wa-staff-menu.mjs:97-104`
  asserts this exact string and asserts the unguarded form is absent.
- `CommandContext` (`~:323-341`) requires `userId: string`, `roleId`, `displayName`. It is built at
  `~:1476-1485` **only after** `whatsapp_resolve_staff_user` succeeds (`~:1425`). A handler in
  `COMMAND_HANDLERS` therefore **cannot** be the pre-enrolment STOP path.
- `processCommandForMessage` (`~:1388`) runs only for freshly-ingested messages from the
  `messages[]` loop (`~:1662`), **never** from `statuses[]`.
- The unenrolled path (`~:1450-1473`): silence, except a body that is exactly 6 digits. The line
  `if (!replyId && /^\d{6}$/.test(trimmedBody))` (`:1457`) is asserted verbatim by
  `scripts/verify-wa-staff-menu.mjs:137-142` — do not reword it.
- `isMissingRpc` (`:184-188`) — `code === 'PGRST202' || /could not find the function|does not exist/i.test(msg)`.
  Reuse it **inside this file only**; it is not exported.
- `logCommand` (`:280-314`) records every inbound with an `outcome` from
  CHECK(ok/unknown_command/not_enrolled/denied/error) and accepts `userId: null`.
- `sendWhatsappText(toPhone, text)` (`:230`) — the local text reply path. Never throws. Use it.
- `HELP_COMMAND_LIST` (`:896-900`) — four `'…\n' +` lines, interpolated by `helpReplyText` (`:908`)
  and by `handleCommand`'s unrecognised-verb reply (`:1305`).

### `START` is already taken — read this before you touch it

`START` is currently registered as `START: commandMenu` (`:1240`), a greeting that opens the menu,
alongside `HI` and `HELLO`. This plan gives it a second job **without changing that entry at all**:

- If the number is opted out, the pre-gate interceptor answers `START` and returns.
  `COMMAND_HANDLERS` is never reached.
- Otherwise the interceptor falls through and `START: commandMenu` keeps its existing meaning.

Write it in that order. `START: commandMenu` must still be present and unmodified when you finish.

### The 2xx rule — non-negotiable

`whatsapp-inbound` must return 2xx for anything that verifies. Control Room **never retries**.
Persist first, log failures loudly with the wamid, return 200. Everything you add inside
`processCommandForMessage` goes inside its existing `try` (`:1422`) so the backstop `catch` still
covers it.

### How the portal reaches PostgREST — why an `anon` grant cannot simply be revoked

`WebPortal/js/data-functions.js` `callFunction` (`:645`) routes **every** RPC through
`callSupabaseRpc(functionName, params, authToken, { useAnonAuth: true, … })` (`:756-765`), and
`callSupabaseRpc` (`:583-640`) sends the **anon key** as the bearer whenever `useAnonAuth` is set or
the token is not a Supabase Auth JWT — its own comment at `:581` records that the portal login JWT
is not a Supabase Auth token. So:

- Every RPC the browser calls must be granted to `anon`. That is why contract 8 exists: an `anon`
  grant on a phone-keyed RPC is reachable by anyone holding the committed key.
- Conversely, **do not revoke `anon` from `list_report_distribution` or `list_report_recipients`.**
  Doing so breaks `WebPortal/modules/sales-reports/js/report_list_grid.js:464` and
  `WebPortal/modules/sales-reports/js/report-whatsapp-send.js:472`. Deliverable 1g fixes the
  exposure by filtering rows, not by changing grants.

## FIXED contracts

These are decisions, not suggestions. Do not redesign them.

1. **Opt-out lives on `report_recipients`, as `opted_out_at timestamptz NULL`.** Not a boolean —
   the timestamp is the audit record of when they asked, and NULL means "never asked". Do not
   reuse `is_active`: that is the administrator's switch. Note the verified consequence: because
   `upsert_report_recipient` (`20260822090000…sql:248-258`) sets `is_active = true` and never
   touches `opted_out_at`, an administrator re-adding an opted-out number reactivates the roster
   row but the opt-out still holds. That is the intended behaviour — do not "fix" it.

2. **The gate goes in the SELECTORS, never in the senders.** Amend `report_daily_recipients()` to
   add `AND rr.opted_out_at IS NULL`.

3. **`send-report-whatsapp` is the exception and needs an explicit refusal**, because its recipient
   list comes from the browser rather than a selector. It must skip an opted-out number, record a
   `report_deliveries` row with `status='failed'` and an `error` naming opt-out, and carry on with
   the rest of the list. It must **not** fail the whole request because one number opted out. The
   lookup it uses is the named RPC `report_opt_out_status` from deliverable 1 — **never** a raw
   table filter comparing the browser's `phone` string against unnormalised
   `report_recipients.phone`, which would match nobody and silently refuse nobody.

4. **A typed `STOP` takes effect immediately, with no confirmation step.** Meta requires opt-out to
   be frictionless, and a person typing STOP has already decided. Reversal is one word, and the
   reply says so. **A "Stop everything" row tapped in a menu sheet DOES confirm first** — that
   sheet is wa-flow-06, not this plan. (The staged menu design lives in
   `docs/whatsapp/whatsapp-reports-rev2.html:640-678`. `docs/mockups/whatsapp-simulator.html` does
   **not** exist in this checkout — do not go looking for it, and do not create or edit any
   document under `docs/`.)

5. **`STOP` is honoured from any number, in any state** — enrolled or not, on the roster or not,
   mid-confirmation or not. It is checked before the enrolment gate and before any pending-command
   handling. It is the only thing an unenrolled number may do besides send an enrolment code, and
   it **replies**, because a person who asks to be left alone must be told they have been. Because
   it runs before `whatsapp_resolve_staff_user`, its audit row carries `userId: null` **even for an
   enrolled staff member** — accepted; the phone number in the row is the identifier. This
   deliberately makes the endpoint answer an unenrolled number, reversing the existing
   silence-for-strangers property at `:1462-1463`; that reversal is limited to exactly the STOP and
   opted-out-START cases and to nothing else.

6. **`START` reverses opt-out; `RESUME` clears a pause — and each stays in its own lane.**
   - `START` (pre-gate) clears `opted_out_at` and nothing else.
   - `RESUME` (post-gate verb) clears a **daily** pause and nothing else.
   Pause state for weekly and monthly is **not readable anywhere in this checkout**
   (`report_recipient_by_inbound_phone` returns only `subscribed_daily` and the daily `muted_until`,
   `:303-327`), and the only write RPC available creates consent where none existed (schema fact 3).
   Extending RESUME to weekly/monthly needs a read RPC that does not exist yet — wa-flow-06's job,
   out of scope below.

7. **No new phone normaliser.** Call the existing `chat_normalize_phone` and
   `report_normalize_wa_phone`. Do not add the digit-strip idiom to any new or edited file.
   `scripts/verify-report-whatsapp-parity.mjs` must still pass.

8. **Every RPC this adds is `service_role` only** — `REVOKE ALL ... FROM PUBLIC, anon,
   authenticated` then `GRANT EXECUTE ... TO service_role`, matching `20260825090000…sql:398-403`.

9. **Both new RPCs resolve a phone without an `is_active` filter** (schema fact 2), and **every
   INSERT supplies a non-NULL `display_name`** (schema fact 1).

10. **No new roster row this plan creates may be enumerable through an `anon`-granted RPC.**
    Creating an `is_active=false` roster row for a stranger who texted STOP would otherwise make
    that number readable by anyone holding the committed anon key, via
    `list_report_distribution(true)` (`20260825090000…sql:150-179`, granted `anon` at `:394`, no
    permission check in its body) **and** via `list_report_recipients(true)`
    (`20260822090000…sql:159-199`, granted `anon` at `:504`, widens on `p_include_inactive` at
    `:196`). Deliverable 1g closes **both** readers. A migration that adds the column and the
    INSERT without 1g must not be written.

11. **Every ordering assertion in the new verifier must be structurally sound.** It must (a)
    isolate the enclosing function or loop body before comparing positions, (b) assert each index
    is `!== -1` **before** any `<` comparison, and (c) compare on literals that exist verbatim in
    the target file. A whole-file `indexOf` on an RPC name is forbidden: RPC names appear in header
    prose in these files (`send-report-whatsapp/index.ts:26` and `:146` both mention
    `begin_report_delivery` in comments, well before the real call at `:392`).

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
person asked, and that `is_active` is not a substitute.

No new index: the roster is small and every selector over it already scans and orders by
`display_name`. Do not add one, and do not add a `LIMIT` to any selector.

**1b. `public.report_set_opt_out(p_phone text, p_opted_out boolean) RETURNS jsonb`**

`LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`.

Envelope keys, fixed here and referenced by name in deliverables 2 and 4:
`ok`, `error`, `found`, `opted_out`, `created`.

Required behaviour, in this order:

- `v_key := public.chat_normalize_phone(p_phone)` and `v_canon := public.report_normalize_wa_phone(p_phone)`.
  If either is NULL, return `ok=false`, `error='A valid phone number is required.'`, `found=false`,
  `opted_out=false`, `created=false`.
- Resolve: `SELECT rr.id, rr.display_name INTO v_id, v_name FROM public.report_recipients rr
  WHERE public.chat_normalize_phone(rr.phone) = v_key LIMIT 1;` — **no `is_active` filter**
  (contract 9 / schema fact 2). Do not call `report_recipient_by_inbound_phone` here.
- **No row, and `p_opted_out` is false:** nothing to clear. Return `ok=true`, `found=false`,
  `opted_out=false`, `created=false`, and **create nothing**.
- **No row, and `p_opted_out` is true:** insert one, so a number nobody has ever added to the
  roster can still opt out and stays opted out if somebody adds it later.
  ```sql
  INSERT INTO public.report_recipients
      (display_name, phone, source, is_active, opted_out_at)
  VALUES
      (v_canon, v_canon, 'whatsapp_chat', false, now())
  RETURNING report_recipients.id, report_recipients.display_name INTO v_id, v_name;
  ```
  - `display_name = v_canon` because the column is `NOT NULL` (schema fact 1).
  - `source = 'whatsapp_chat'` is one of the three values allowed by the CHECK at
    `20260822090000…sql:80` — read that CHECK before choosing.
  - `is_active = false`: they are not an active recipient. Because 1b and 1c resolve without the
    `is_active` filter, this row is still reachable by a second STOP and by START. Because of 1g it
    is not enumerable by `anon`.
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
  `COALESCE(opted_out_at, now())` preserves the FIRST time they asked.
- Setting `p_opted_out=false` clears `opted_out_at` **and nothing else**. It must **not**
  re-subscribe anybody and must not touch `is_active`.
- Return `ok=true`, `error=NULL`, `found=true`, `opted_out=COALESCE(p_opted_out,false)`,
  `created=<whether this call inserted the row>`.

**1c. `public.report_opt_out_status(p_phone text) RETURNS jsonb`**

`LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public`. This is the read half.
Deliverable 2's START, deliverable 3 and deliverable 3b all call it by this exact name.

Envelope keys, fixed here: `ok`, `error`, `found`, `opted_out`, `opted_out_at`.

- `v_key := public.chat_normalize_phone(p_phone)`; NULL ⇒ `ok=false`, `error='A valid phone number
  is required.'`, `found=false`, `opted_out=false`, `opted_out_at=NULL`.
- Resolve with the same `public.chat_normalize_phone(rr.phone) = v_key`, `LIMIT 1`, **no
  `is_active` filter**. Normalising inside the RPC is what makes a caller-supplied `082…` or
  `+2782…` match a stored `+2782…`.
- No row ⇒ `ok=true`, `found=false`, `opted_out=false`, `opted_out_at=NULL`.
- Row ⇒ `ok=true`, `found=true`, `opted_out = (opted_out_at IS NOT NULL)`, `opted_out_at` as
  stored. Select `rr.id` into the record alongside `rr.opted_out_at` and use the
  `IF v_row IS NULL THEN` idiom exactly as `report_recipient_by_inbound_phone:314` does.

**1d. Amend `report_daily_recipients()`**

`CREATE OR REPLACE` it with `AND rr.opted_out_at IS NULL` added. Keep **every other line
verbatim**, including `WHERE rr.is_active`, `AND rs.is_active`, the
`(rs.muted_until IS NULL OR rs.muted_until < public.report_sast_today())` clause and the
`ORDER BY rr.display_name`. Deliverable 4 assertion 1 exists to catch a rewrite that loses the
pause.

**1e. Grants — always re-state them, never `DROP FUNCTION`**

`CREATE OR REPLACE FUNCTION` preserves a function's ACL; `DROP FUNCTION` + `CREATE` does **not** —
the function comes back with Postgres' default `EXECUTE` for `PUBLIC`, which reaches `anon` and
would expose the whole daily recipient roster (or the two portal readers' bodies) to anyone with
the committed key. Therefore, in this migration:

- **`DROP FUNCTION` must not appear anywhere in the file.** Use `CREATE OR REPLACE` only. (Every
  function this migration touches keeps its exact existing signature and return type, so
  `CREATE OR REPLACE` is always available. If you believe it is not, stop and report — do not drop.)
- **Re-state the REVOKE/GRANT pair after every `CREATE OR REPLACE`, unconditionally**, copying the
  original lines verbatim:

```sql
-- new functions (contract 8)
REVOKE ALL ON FUNCTION public.report_set_opt_out(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_opt_out_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_set_opt_out(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_opt_out_status(text) TO service_role;

-- replaced selector, restated from migrations/20260825090000_report_subscriptions_and_staff.sql:398,:401
REVOKE ALL ON FUNCTION public.report_daily_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_daily_recipients() TO service_role;

-- replaced portal readers, restated UNCHANGED from :394 and 20260822090000…sql:504.
-- Do NOT revoke anon here: WebPortal/js/data-functions.js:756-765 sends every portal RPC with the
-- anon key as bearer, so revoking would break report_list_grid.js:464 and
-- report-whatsapp-send.js:472. The exposure is closed by the row filter in 1g instead.
GRANT EXECUTE ON FUNCTION public.list_report_distribution(boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_report_recipients(boolean) TO anon, authenticated, service_role;
```

**1f. House rules for this file**

- End with `NOTIFY pgrst, 'reload schema';` — `20260825090000…sql:418` does, and PostgREST will not
  see the new functions otherwise.
- Every statement re-runnable (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`).
- Must **not** contain the `regexp_replace(…, '\D', '', 'g')` idiom.
- A header comment in this repo's migration style: what was wrong, what this changes, and an
  explicit **OUT OF SCOPE: applying this migration** line naming the file, because nothing in this
  repo can reach a database. Record in that header the two schema facts this file works around
  (`display_name NOT NULL` at `20260822090000…sql:77`; the `is_active` filter at
  `20260825090000…sql:311` and `:360`), with those file:line references.
- Record, as its own paragraph, the exposure 1g closes **and what remains for a human**: that
  `list_report_distribution(boolean)` (`20260825090000…sql:150-179`, `anon` at `:394`) and
  `list_report_recipients(boolean)` (`20260822090000…sql:159-199`, `anon` at `:504`) are
  `SECURITY DEFINER` readers of `report_recipients.phone` with **no permission check in either
  body**, reachable by anyone holding the committed anon key; that 1b would otherwise have made
  them able to enumerate the numbers of strangers who contacted this business only to ask to be
  left alone; that 1g removes exactly that class of row from both readers; and that the broader
  question — an unauthenticated-reachable roster read at all — is **not** changed here and needs a
  reviewed portal/RBAC plan of its own.

**1g. Keep opt-out-only rows out of the two `anon`-granted readers (contract 10)**

`CREATE OR REPLACE` both readers in this migration, changing **only** their `WHERE` clause and
keeping every other line, column and the return type verbatim.

`list_report_recipients(boolean)` — its current clause is `WHERE COALESCE(p_include_inactive, false) OR r.is_active`
(`20260822090000…sql:196`). Replace with, exactly:

```sql
    WHERE (COALESCE(p_include_inactive, false) OR r.is_active)
      AND NOT (r.opted_out_at IS NOT NULL AND r.is_active = false)
```

`list_report_distribution(boolean)` — its current clause is `WHERE p_include_inactive OR rr.is_active`
(`20260825090000…sql:174`). Replace with, exactly:

```sql
        WHERE (p_include_inactive OR rr.is_active)
          AND NOT (rr.opted_out_at IS NOT NULL AND rr.is_active = false)
```

- **The parentheses around the existing OR are mandatory.** `AND` binds tighter than `OR`, so
  writing `p_include_inactive OR rr.is_active AND NOT (…)` parses as
  `p_include_inactive OR (rr.is_active AND NOT (…))` — which returns every row, opt-out rows
  included, whenever `p_include_inactive` is true. That is the silent no-op this deliverable exists
  to prevent, and assertion 6 checks for the parenthesised text.
- What this hides, stated plainly and not coded around: exactly the rows that are **both** opted
  out **and** inactive. Those are (i) the opt-out-only rows 1b creates for numbers nobody ever
  added — the whole point — and (ii) an existing roster row an administrator deactivated *and* who
  also opted out; for (ii) the distribution screen's "show inactive" tick-box no longer lists that
  row. A roster member who opted out but is still `is_active = true` remains fully visible, so an
  administrator still sees opt-outs on their own list.
- Blast radius on existing callers, checked at every call site:
  `report_list_grid.js:464` (`listReportDistribution(includeInactive)`) is display-only
  (`renderDistribution`, `:430-456`) and tolerates a shorter list; `report-whatsapp-send.js:472`
  calls `listReportRecipients(false, …)`, which never included `is_active=false` rows anyway. No
  `WebPortal/` file changes in this plan.
- Do not add an `opted_out` field to either reader's output, do not change either return type, and
  do not touch `report_subscription_json`, `upsert_report_recipient`, `set_report_recipient_active`
  or `list_report_deliveries`.

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
existing behaviour unchanged. It takes plain arguments, **not** a `CommandContext`.

Behaviour:

- `if (replyId) return false;` — a tap is wa-flow-06's staged path, not this one.
- Derive the verb the same way `handleCommand` does:
  `const collapsed = rawBody.trim().replace(/\s+/g, ' ');`
  `const verb = (collapsed.split(' ')[0] || '').toUpperCase();`
  Only `'STOP'` and `'START'` are of interest; anything else ⇒ `return false`.
- `STOP`:
  - call `report_set_opt_out` with `{ p_phone: from, p_opted_out: true }`;
  - on success, `logCommand(sb, { phone: from, userId: null, wamid, rawBody, command: 'STOP',
    outcome: 'ok' })`, then `sendWhatsappText(from, …)` with a reply that names what stopped and
    how to reverse it. **Scope the promise to reports only.** Do not say "you will not receive any
    further messages" (unscoped): alerts and staff-menu replies are not touched by this plan. Word
    it so it is true for a number that was never on any list, e.g. "You will not receive any
    further report messages from Macavation. Text START if you want to allow them again." **Do not
    promise re-subscription.**
  - on any failure — including `isMissingRpc(error)`, in which case also `console.error` naming the
    new migration file, exactly as `:1427-1431` does — log `command: 'STOP', outcome: 'error'` with
    the message in `detail`, and reply an honest fallback such as "I could not record that just
    now. Please reply STOP again shortly." Never reply as though it succeeded;
  - `return true` in every branch. STOP must never fall through into the silence path.
- `START`:
  - call `report_opt_out_status` with `{ p_phone: from }`;
  - if it errors: on `isMissingRpc`, `console.error` naming the migration and `return false`; on
    any other error, `logCommand(command: 'START', outcome: 'error')` and `return false`. Falling
    through is deliberate — the existing greeting must keep working when the opt-out read is
    unavailable, and START cannot cause a send;
  - if `opted_out` is not true (including `found === false`) ⇒ `return false`, so
    `START: commandMenu` keeps its existing meaning for everybody who is not opted out;
  - if `opted_out` is true: call `report_set_opt_out` with `{ p_phone: from, p_opted_out: false }`,
    log `command: 'START', outcome: 'ok'` (or `'error'` on failure, with an honest fallback reply),
    reply, and `return true`. Word the success reply without over-promising, e.g. "Your opt-out has
    been removed. If somebody has you on a report list, those messages can resume."
- `handleOptOutVerbs` must never throw.
- Do **not** register `STOP` in `COMMAND_HANDLERS`. The interceptor is the single STOP path.

**2b. The call site**

Inside `processCommandForMessage`, as the **first statement inside the existing `try` block**
(`:1422`) — i.e. after the `rawBody`/`replyId` extraction and **before** the
`sb.rpc('whatsapp_resolve_staff_user', …)` call (`:1425`):

```ts
    if (await handleOptOutVerbs(sb, from, wamid, rawBody, replyId)) {
      return;
    }
```

Write the argument list exactly as shown — assertion 8 matches this text. Do not touch, reword or
reindent the resolution block, the unenrolled branch, or the line
`if (!replyId && /^\d{6}$/.test(trimmedBody))`.

**2c. `RESUME` — a daily-only, consent-preserving pause clear**

Add one handler, named exactly `commandResume`, registered as `RESUME: commandResume` in
`COMMAND_HANDLERS`. It is post-gate (an enrolled number only).

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

Step 3's guard is mandatory: `set_report_subscription_by_phone` sets
`is_active = COALESCE(p_is_active,false)` on an `INSERT … ON CONFLICT DO UPDATE` (`:367-374`), so
calling it when `subscribed_daily` is false would either create a subscription or switch on one an
administrator had switched off.

Two consequences to state plainly in the replies and in your report, not to code around:

- `report_recipient_by_inbound_phone` filters `rr.is_active`, so for an admin-deactivated roster row
  RESUME reports "There is no pause on this number." That is correct.
- Do **no** date arithmetic in the bot. If `muted_until` is non-null, clear it and say the pause was
  lifted. `public.report_sast_today()` is this repo's only "today" and the selector already applies
  it.

**2d. `HELP_COMMAND_LIST`**

Add `STOP` and `RESUME` lines to `HELP_COMMAND_LIST` (`:896-900`) — the single place that list
lives. Mention that `START` undoes a STOP. Keep lines short and WhatsApp-friendly, matching the
existing four.

**2e.** Every path added here replies. None of them fall into the silence path.

### 3. `send-report-whatsapp` — refuse an opted-out number

Per contract 3. Read the loop (`~:380-513`) before changing it.

**`isMissingRpc` cannot be reused here — it is not exported and this file does not import
`_shared` or `whatsapp-inbound/index.ts`.** Confirm by reading this file's own `import` lines.
Declare a small local function in this file, named exactly `isMissingRpcError`, with the identical
detection logic `whatsapp-inbound/index.ts:184-188` uses (code `PGRST202`, or a message matching
`could not find the function|does not exist`) — a second, independent declaration, not an import.
**Do not write a bare call to `isMissingRpc` anywhere in this file; that identifier does not exist
here and would not compile.**

- Immediately **before** the `begin_report_delivery` call (`~:392`), for the loop's current `phone`,
  call `report_opt_out_status` with `{ p_phone: phone }`. `phone` is the raw browser-supplied
  string; the RPC normalises internally. Do not build a phone comparison in TypeScript and do not
  query `report_recipients` directly.
- The existing `rpc()` helper (`:83-89`) **throws** rather than returning an error object. Write the
  two outcomes as two textually distinct arms:

  ```ts
  let optOut: { opted_out?: boolean } | null = null;
  try {
    optOut = (await rpc(sb, 'report_opt_out_status', { p_phone: phone }))[0] ?? null;
  } catch (e) {
    if (isMissingRpcError(e)) {
      // FAIL OPEN: this plan does not apply its own migration (out of scope). Refusing every
      // recipient because a not-yet-applied migration is missing would break the ONLY live
      // report-send path in this repo, with an operator watching the result. console.error names
      // the migration so this is loud, not silent.
      console.error(
        '[send-report-whatsapp] report_opt_out_status is missing — migration <name> not applied. ' +
          'Sending without an opt-out check for this recipient.'
      );
      optOut = null; // treated as not-opted-out below — explicit, not a fallthrough default.
    } else {
      // FAIL CLOSED: any other failure (permission, timeout, transport) means the gate could not
      // answer, and a gate that cannot answer must not wave the message through.
      console.error('[send-report-whatsapp] opt-out check failed — not sending to this recipient:', e);
      // <begin_report_delivery with the SAME arguments the send path passes; if it returns
      //  success === 1, complete_report_delivery with p_status:'failed' and
      //  p_error:'Opt-out check unavailable; message not sent.'; wrap that pair in its own
      //  try/catch and console.error a throw there, so the results.push below cannot be skipped.>
      results.push({
        phone,
        display_name: displayName,
        status: 'failed',
        external_message_id: null,
        error: 'Opt-out check unavailable; message not sent.',
      });
      failed++;
      continue;
    }
  }
  if (optOut?.opted_out === true) {
    // <begin_report_delivery with the same arguments the send path passes; if it returns
    //  success === 1, complete_report_delivery with p_status:'failed' and
    //  p_error:'Recipient has opted out of WhatsApp report messages.'; same own-try/catch shape.>
    results.push({
      phone,
      display_name: displayName,
      status: 'failed',
      external_message_id: null,
      error: 'Recipient has opted out of WhatsApp report messages.',
    });
    failed++;
    continue; // do NOT send
  }
  ```

  This skeleton is the contract, not decoration:
  - The two arms must remain textually distinct (fail-open on `isMissingRpcError`, fail-closed on
    everything else); assertions 12 and 13 check that they were not merged behind one `catch`.
  - `results`, `failed`, `phone`, `displayName` are the loop's own existing identifiers (`:376-389`);
    use them, do not introduce parallel ones.
  - Each refusal pushes **exactly one** `results` entry for that recipient. If the
    `begin_report_delivery`/`complete_report_delivery` pair itself throws, its own `try/catch`
    swallows and logs it — do not let it reach the loop's outer `catch (loopErr)` (`:501`), which
    would push a second entry for the same recipient.
  - If `begin_report_delivery` returns `success !== 1`, skip the `complete_report_delivery` call
    (there is no delivery id) and still push the failed result with the same error string.
- The whole request must still return 200 with per-recipient detail (`:520-527`).
- Do not add `replace(/\D/g` anywhere new in this file, and leave `normalizePhone` (`:148-153`)
  byte-identical — `report-whatsapp-parity:verify` evaluates that body.

### 3b. `send-daily-digest-whatsapp` — gate the third sender, FAIL CLOSED

`supabase/functions/send-daily-digest-whatsapp/index.ts:93-97` reads `scheduled_reports` directly
and sends to every row with `is_active=true, channel='whatsapp'`, entirely outside
`report_recipients`. It is not scheduled anywhere in this repo (its own header, `:5-8`), but it
exists, it is deployed, and it can be invoked by hand — so the STOP promise is false while it is
ungated. Read the loop `for (const sub of subs || []) {` (`:101-136`) before changing it.

- Immediately inside the loop, **after** `const to = normalizePhone(raw);` (`:104`) and **before**
  the `fetch` to `meta-proxy` (`:114`), call `report_opt_out_status` with `{ p_phone: to }`.
  `report_opt_out_status` normalises again internally via `chat_normalize_phone`, which strips
  non-digits and is therefore idempotent on the `+27…` form — confirm that by reading
  `chat_normalize_phone` (`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92`)
  rather than assuming it. This function uses `supabase.rpc(...)` (which returns
  `{ data, error }`), not `send-report-whatsapp`'s throwing `rpc()` helper — read `:88` and `:134`
  for the shape it already uses.
- **This sender fails CLOSED on every failure, including a missing RPC.** Do **not** copy
  deliverable 3's fail-open arm here, and do **not** declare `isMissingRpcError` (or reference
  `isMissingRpc`) in this file at all — this file needs no such helper and an undeclared reference
  would not compile. Concretely: if the RPC returns an error, or throws, or returns no row,
  `console.error` the reason (including a note that a missing `report_opt_out_status` means the new
  migration has not been applied yet, naming the migration file) and `continue` — do not send, do
  not call `mark_scheduled_report_sent`, do not increment `sent`.
- Why the default differs from deliverable 3, deliberately: fail-open there protects the only live
  report-send path with an operator watching. Here nothing has ever been sent (`:5-8`), nothing
  schedules this function, and the live daily path is `send-daily-production-report`, which is gated
  in the selector by 1d and is unaffected by whether this function can answer. So the cost of
  failing closed is zero sends from a function that sends nothing today, and the benefit is that the
  STOP promise cannot be broken by an un-applied migration. Accept that until a human applies the
  migration, a hand-invocation of this function sends nothing and logs why.
- Mark the branch with this exact comment line, on its own line inside the loop, so assertion 14 can
  see it: `// FAIL CLOSED: no opt-out answer means no send.`
- If `opted_out === true`: `console.error`-free `continue` (or a plain `console.log`), without
  incrementing `sent` and without calling `mark_scheduled_report_sent` — an opted-out row must not
  be marked sent, because it was not.
- There is no `begin_report_delivery`/`complete_report_delivery` pair in this file. Do not add one;
  a `console.error` and a `continue` is the whole of it.
- Leave `normalizePhone` (`:48-53`) byte-identical. Note the pre-existing defect that an email-only
  subscriber normalises to `'+27'` (documented in `scripts/verify-report-whatsapp-parity.mjs:39-47`)
  — this plan does **not** fix it and must not change any of the seven normalisers.
- Do not add an auth gate to this function; it has none today (see the inventory table) and adding
  one is out of scope.

### 4. Verifier — `scripts/verify-wa-optout.mjs`

Registered in `package.json` as `wa-optout:verify` and appended to the **end** of the `test:fleet`
chain (`package.json:37`). Follow the `.ts` discipline of `scripts/verify-wa-plumbing.mjs` and
`scripts/verify-wa-role-features.mjs`: never evaluate a `.ts` file, assert textually, and make every
failure message name the file to fix. Pure `fs` reads, `node:assert`, no dependency, no network —
`test:fleet` must stay hermetic, per `package.json`'s own `//test:fleet` note (`:36`). Do not copy
another verifier's path constants or allowlists without re-deriving them.

Locate the new migration by globbing `migrations/*_report_opt_out.sql`.

**Mandatory isolation helper (contract 11).** Define one helper, named exactly `isolateBlock`:

```js
// Brace-walk isolation, modelled on scripts/verify-wa-role-features.mjs:69-89
// (loadFeatureKeysBody). Takes a declaration string — a function signature OR a loop header —
// finds it, then walks from its first '{' to the brace that returns depth to zero.
// Whole-file indexOf on an RPC name is NOT acceptable in this script: these files mention RPC
// names in header prose (send-report-whatsapp/index.ts:26 and :146 both name
// begin_report_delivery, hundreds of lines before the real call).
function isolateBlock(source, declaration, fileLabel) { … }
```

Every ordering assertion below must: isolate the enclosing block with `isolateBlock`, assert each
`indexOf` result is `!== -1` with a failure message naming the missing literal, and only then
compare positions. `-1 < anything` passing vacuously is the exact defect that blocked the previous
attempt.

Assert at least:

1. **The daily selector.** `report_daily_recipients()`'s definition in the new migration contains
   `opted_out_at IS NULL` **and** still contains `rr.is_active`, `rs.is_active`,
   `rs.muted_until IS NULL`, `public.report_sast_today()` and `ORDER BY rr.display_name`.
2. **New RPC hardening.** `report_set_opt_out` and `report_opt_out_status` are each
   `SECURITY DEFINER`, pin `SET search_path = public`, are `GRANT`ed to `service_role`, and are
   **not** granted to `anon` or `authenticated`.
3. **`display_name` is never NULL.** The migration contains the column list
   `(display_name, phone, source, is_active, opted_out_at)` and a `VALUES` line supplying
   `v_canon, v_canon, 'whatsapp_chat', false, now()`. Failure message must cite
   `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:77`
   (`display_name text NOT NULL`).
4. **No resolution through the `is_active`-filtered bridge.** The migration does **not** contain the
   string `report_recipient_by_inbound_phone`, and each of the two new function bodies (isolate each
   with `isolateBlock` on its `CREATE OR REPLACE FUNCTION public.<name>` line, or on `$fn$`
   boundaries) contains `public.chat_normalize_phone(rr.phone) = v_key`. Failure message must cite
   `migrations/20260825090000_report_subscriptions_and_staff.sql:311`.
5. **No ACL loss.** The migration contains **zero** occurrences of `DROP FUNCTION`, and contains all
   of these lines verbatim:
   `REVOKE ALL ON FUNCTION public.report_daily_recipients() FROM PUBLIC, anon, authenticated;`,
   `GRANT EXECUTE ON FUNCTION public.report_daily_recipients() TO service_role;`,
   `GRANT EXECUTE ON FUNCTION public.list_report_distribution(boolean) TO anon, authenticated, service_role;`,
   `GRANT EXECUTE ON FUNCTION public.list_report_recipients(boolean) TO anon, authenticated, service_role;`.
   Failure message must say that `DROP FUNCTION` + `CREATE` resets the ACL to `PUBLIC EXECUTE`,
   which reaches `anon`.
6. **Opt-out-only rows are not `anon`-enumerable (contract 10).** The migration contains, verbatim,
   all four strings:
   `(COALESCE(p_include_inactive, false) OR r.is_active)`,
   `NOT (r.opted_out_at IS NOT NULL AND r.is_active = false)`,
   `(p_include_inactive OR rr.is_active)`,
   `NOT (rr.opted_out_at IS NOT NULL AND rr.is_active = false)`.
   Also assert the migration contains `CREATE OR REPLACE FUNCTION public.list_report_distribution`
   and `CREATE OR REPLACE FUNCTION public.list_report_recipients`, and that it contains **no**
   `REVOKE` line naming either of those two functions. Failure message must name both `anon` grants
   (`20260825090000…sql:394`, `20260822090000…sql:504`), say that the parentheses are what stop the
   filter becoming a no-op when `p_include_inactive` is true, and say that revoking `anon` is not
   the fix because `WebPortal/js/data-functions.js:756-765` sends portal RPCs with the anon key.
7. **Verb map intact.** `RESUME: commandResume` is present in `COMMAND_HANDLERS`, and
   `START: commandMenu` is still present (proving the greeting was not dropped or repointed).
8. **The `STOP` path is reachable for an unenrolled number.** A whole-file `indexOf` is unsound
   here: `outcome: 'not_enrolled'` appears TWICE in `whatsapp-inbound/index.ts` — at `:1378` inside
   `tryConfirmEnrolment` and at `:1470` inside `processCommandForMessage` — and the first occurrence
   sits in a function declared earlier in the file, so a bare `indexOf` compares against the wrong
   one and can never catch a real regression. In this order:
   a. `const fnBody = isolateBlock(inboundSrc, 'async function processCommandForMessage', REL_INBOUND);`
   b. Sanity-check the isolation before trusting it:
      `(fnBody.match(/outcome: 'not_enrolled'/g) || []).length === 1`. If it is ever not exactly 1,
      fail loudly naming what changed.
   c. Compare **within `fnBody` only**, asserting each index `!== -1` first:
      `fnBody.indexOf('handleOptOutVerbs(sb, from, wamid, rawBody, replyId)')` <
      `fnBody.indexOf("sb.rpc('whatsapp_resolve_staff_user'")` <
      `fnBody.indexOf("outcome: 'not_enrolled'")`.
   d. State in a comment that source order is what proves it here (this script never executes
      `.ts`), that the interceptor sits inside `processCommandForMessage`'s existing `try`, and that
      a `COMMAND_HANDLERS.STOP` entry is deliberately absent because `CommandContext` does not exist
      before resolution.
   **Do not loosen, reorder, or remove any of steps a–d to make this pass.**
9. **RESUME's consent guard.** `isolateBlock(inboundSrc, 'async function commandResume', …)`
   contains `subscribed_daily` and `muted_until` **before** its `set_report_subscription_by_phone`
   call site (all indices `!== -1` first). Failure message must say the guard is what stops the call
   creating or re-enabling a subscription (`…20260825090000…sql:367-374`).
10. **Help text cannot drift.** `HELP_COMMAND_LIST` mentions `STOP` and `RESUME`.
11. **`send-report-whatsapp` checks opt-out before starting a delivery.** Isolate the loop:
    `const loop = isolateBlock(sendSrc, 'for (const recipient of recipients)', REL_SEND);` Then,
    inside `loop` only:
    - a sanity check first: `(loop.match(/rpc\(sb, 'begin_report_delivery'/g) || []).length === 1`
      — if it is not exactly 1, fail naming what changed;
    - `loop.indexOf("'report_opt_out_status'")` and `loop.indexOf("rpc(sb, 'begin_report_delivery'")`
      are both `!== -1`, and the first is less than the second.
    The failure message must state that `begin_report_delivery` also appears in this file's header
    prose at `:26` and `:146`, that this is why the check is scoped to the isolated loop and to the
    **quoted** RPC-name form, and that **making this assertion pass by mentioning
    `report_opt_out_status` in a comment is forbidden** — the fix is to move the real call.
    Also assert the file contains no `from('report_recipients')`.
12. **`isMissingRpcError` is declared, not assumed.** `send-report-whatsapp/index.ts` contains
    `function isMissingRpcError` (or a `const isMissingRpcError =` arrow — check for either form),
    **and** contains zero occurrences of the substring `isMissingRpc(` (which would be a call to the
    non-existent, non-imported `whatsapp-inbound` helper and would not compile). Failure message
    must say this is the bug that blocked two earlier attempts.
13. **The two arms are distinct.** Inside the isolated `loop` from assertion 11:
    `isMissingRpcError(` appears as a condition; the exact comment markers `// FAIL OPEN:` and
    `// FAIL CLOSED:` both appear; and there are at least **two** `continue;` statements between
    `loop.indexOf("'report_opt_out_status'")` and
    `loop.indexOf('rpc(sb, \'begin_report_delivery\'')`… — more precisely, between the opt-out call
    and the `meta-proxy` fetch inside the loop (`loop.indexOf('/meta-proxy`')`), asserting that
    index `!== -1` too. This is the guard against the fail-open and fail-closed branches being
    collapsed into one generic `catch`.
14. **`send-daily-digest-whatsapp` is gated, and fails closed.** Isolate the loop:
    `const digestLoop = isolateBlock(digestSrc, 'for (const sub of subs || [])', REL_DIGEST);`
    Then, inside `digestLoop` only, with every index asserted `!== -1` first:
    - `digestLoop.indexOf("report_opt_out_status")` is less than
      ``digestLoop.indexOf('fetch(`${CONTROL_ROOM_BASE_URL}/meta-proxy`,')``. **That literal is the
      real one** — the source at `:114` reads
      ``const res = await fetch(`${CONTROL_ROOM_BASE_URL}/meta-proxy`, {`` with a comma after the
      closing backtick, not `)`. A previous attempt asserted the `)` form, got `-1`, and the
      comparison passed vacuously; that is why every index here must be existence-checked.
    - `digestLoop` contains the exact line `// FAIL CLOSED: no opt-out answer means no send.`
    - `digestLoop.indexOf('mark_scheduled_report_sent')` is **greater** than the `/meta-proxy` index
      (an opted-out or unchecked row must never be marked sent).
    - the whole digest file contains **zero** occurrences of `isMissingRpc` (in any spelling): this
      sender fails closed unconditionally and declares no such helper, so any occurrence is either
      an undeclared reference or a reintroduced fail-open path.
15. **No new normaliser and no new sweep candidate.** The count of `function normalizePhone`
    declarations across `supabase/functions/` is exactly **3**, and `whatsapp-inbound/index.ts`
    contains zero occurrences of `replace(/\D/g`. Put the count, the date you checked it, and the
    **corrected** locations in a comment beside the assertion:
    `send-whatsapp-message/index.ts:65`, `send-report-whatsapp/index.ts:148`,
    `send-daily-digest-whatsapp/index.ts:48`. (An earlier draft of this plan paired `:148` with
    `send-whatsapp-message`; that was wrong — `:148` is `send-report-whatsapp`'s copy. Do not
    reintroduce the wrong pairing, and do not edit the stale line numbers in
    `scripts/verify-report-whatsapp-parity.mjs`'s header or in
    `send-report-whatsapp/index.ts:143` — those are separate human follow-ups.) Note in a comment
    that `scripts/verify-report-whatsapp-parity.mjs` asserts the authoritative exact counts (6 JS/TS,
    3 SQL candidates) and that this is a cheaper early warning, not a replacement.
16. **The migration is not a fourth SQL sweep candidate.** It does not contain `'\D', '', 'g'`.

**Before you finish, prove the verifier bites.** For assertions **1, 3, 4, 6, 8, 11 and 14**, break
the thing deliberately, run the verifier, confirm it fails, restore it, confirm it passes. Say in
your report what you broke and quote the exact failure message each time. For the three that
matter most, use these specific mutations — not merely deleting the code, which is a different
regression:

- **Assertion 8:** move the `handleOptOutVerbs(...)` call to AFTER the `not_enrolled` `logCommand`
  inside `processCommandForMessage` and confirm failure; then also delete step b's sanity check's
  premise by adding a second `outcome: 'not_enrolled'` inside the same function and confirm the
  isolation sanity check fails loudly.
- **Assertion 11:** move the `report_opt_out_status` call to AFTER the `begin_report_delivery`
  call and confirm failure; then, separately, restore the correct placement, add
  `report_opt_out_status` to the header comment at `:26`, and confirm the assertion still **passes**
  for the correct code and still **fails** for the moved-call version — i.e. prove the header
  mention cannot make a wrongly-placed gate green.
- **Assertion 14:** change the asserted fetch literal's target file by moving the opt-out call to
  after the `fetch`, confirm failure; and separately delete the `// FAIL CLOSED:` marker line,
  confirm failure.

A verifier that cannot fail is worse than none.

## Verify before finishing

Every one of these is something you can run yourself in this checkout.

1. `npm run test:fleet` — the whole chain, green, including the new verifier.
2. `npm run wa-optout:verify` on its own.
3. `npm run report-whatsapp-parity:verify` — it asserts **exact counts** of files carrying the
   digit-strip idiom and evaluates every `normalizePhone` body, so a stray
   `regexp_replace(…'\D'…)` in the new migration, a `replace(/\D/g` in `whatsapp-inbound`, or any
   edit to a `normalizePhone` body fails it.
4. `npm run migrations:verify` — proves the new migration's filename prefix is a real, unique UTC
   timestamp. It never auto-heals and its baseline is read-only: fix the filename, never the
   baseline.
5. `npm run wa-staff-menu:verify` and `npm run wa-plumbing:verify` — both read
   `whatsapp-inbound/index.ts`. Expect both to pass; if one fails, you changed something this plan
   did not ask you to.
6. `npm run report-whatsapp-payload:verify` — it asserts exact regex and constant literals near the
   top of `send-report-whatsapp/index.ts`; deliverable 3 must not disturb them.
7. Do **not** attempt to run the edge functions. There is no Deno in this environment and no
   database to reach, and `node --check` does not accept `.ts`. Textual assertions plus the gate are
   the verification available. Say so in your report rather than claiming any runtime behaviour was
   observed.

In your report, state explicitly: that you read the existing `START: commandMenu` binding rather
than overwriting it; that no INSERT this plan adds leaves `display_name` NULL; that neither new RPC
resolves through an `is_active`-filtered path; that the new migration contains no `DROP FUNCTION`
and re-states every grant it touches; which of deliverable 3's two unavailable-RPC branches fails
open and which fails closed, and why deliverable 3b fails closed in **both** cases instead of
copying deliverable 3's fail-open default; and that opt-out-only rows are filtered out of both
`anon`-granted readers (naming both) rather than the `anon` grants being revoked.

## Out of scope — do not do these

- **Applying the migration.** Nothing here can reach a database. Say in your report that a human
  must run the new file against dev.
- **Changing the `anon`/`authenticated` grants on any existing RPC**, including
  `list_report_distribution`, `list_report_recipients` and `upsert_report_recipient`. 1g changes
  their row filter only. The broader question of an unauthenticated-reachable roster read needs its
  own reviewed plan.
- **Adding a permission check inside `list_report_distribution` or `list_report_recipients`**, or
  adding an auth gate to `send-daily-digest-whatsapp`.
- **The "My reports" settings menu on WhatsApp**, including the staged "Stop everything" /
  "Stop daily messages" sheet rows and the tapped `Pause for 7 days`. That is wa-flow-06.
- **Weekly and monthly pause/resume, and any read RPC that would expose weekly/monthly pause
  state.** Do not call `set_report_subscription_by_phone` for `'weekly'` or `'monthly'` anywhere.
- **Pause/resume for numbers that are not enrolled staff.** (STOP and START are the exception.)
- **The weekly and monthly senders.** wa-flow-04.
- **Anything on the distribution panel.** No `WebPortal/` changes at all in this plan.
- **Any change under `docs/`.** Including the missing `docs/mockups/whatsapp-simulator.html`
  reference and the claim in `docs/whatsapp/whatsapp-reports-rev2.html:676-678`.
- **Correcting stale line-number comments** in `scripts/verify-report-whatsapp-parity.mjs`'s header
  or `send-report-whatsapp/index.ts:143`. Separate human follow-ups.
- **Changing any of the seven phone-normaliser implementations** (including the `'+27'`
  empty-input defect), or the `test:fleet` chain beyond appending `wa-optout:verify` to its end.
- **Adding an index or a `LIMIT` to any report selector.** `BluePrint/supabase-database-rules.md`
  advises both generically; the existing report selectors this plan must keep verbatim do neither,
  and reconciling that document with the code is a separate, human-reviewed action.
- **Submitting a template to Meta.**
