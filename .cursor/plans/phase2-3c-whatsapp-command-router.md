---
depends_on: phase2-3b-generic-server-side-action-gate.md
---

# WhatsApp command router: dispatch, audit log, and a HELP reply

## Context

`supabase/functions/whatsapp-inbound/index.ts` currently **stores** inbound messages and nothing more.
For each message it calls `chat_ingest_inbound_whatsapp` (`:255-262`) and moves on. This plan gives it
a second job: when the sender is an enrolled staff member, interpret the message as a command, authorise
it, act, and reply.

The two preceding plans supplied the parts this needs:
`whatsapp_resolve_staff_user(p_phone)` turns a verified number into a `user_id` + `role_id`, and
`has_action(p_user_id, p_action_key)` answers whether that user may do a thing — both `service_role`
only, which is exactly what this function is.

This plan deliberately ships **only the `HELP` command** plus the dispatch scaffolding and the audit
trail. The production-capture command that actually motivates the feature arrives in a later plan, on
top of the confirm/cancel flow. Splitting it that way keeps each run inside the ~60-minute engine cap
and means the risky write lands on a router that is already proven to route.

### Constraints from the existing webhook that shape the design

Read `supabase/functions/whatsapp-inbound/index.ts` before starting; its header comment (`:22-39`)
documents Control Room's contract, and three points are load-bearing:

1. **There are no retries.** *"Control Room always acks Meta 200 regardless of what we return; a
   non-2xx or timeout on our side is logged as failed and DROPPED FOREVER"* (`:32-33`). So command
   handling must never turn a successful ingest into a non-2xx. **Persist first, reply second**, and
   swallow command errors into a reply rather than an exception.
2. **The HMAC over the raw body is the authentication** (`:7-9`, `:195-206`). Read the raw body once
   and hash that exact string. Do not restructure that code.
3. **Only `value.messages[]` are inbound.** `value.statuses[]` are delivery receipts for messages *we*
   sent (`:293-322`). **Never dispatch a command from a status entry** — that is the loop risk, because
   our own replies generate statuses.

### Outbound: why this needs its own send path

`supabase/functions/send-whatsapp-message/index.ts` cannot be reused. It requires an `X-Portal-Session`
header validated via `assistant_validate_session` and fails closed (`:13-19`, `:91-98`), for a
documented reason: *"without this, anyone holding the public anon key (which ships in the browser) could
send WhatsApp messages through this channel."* The webhook has no portal session — it is a
server-to-server call authenticated by HMAC.

**Do not add a service-role bypass to `send-whatsapp-message`.** That would punch a hole in a control
someone deliberately added. Instead inline a small text-send helper in `whatsapp-inbound`, posting to
Control Room's `meta-proxy` with the same signed-body shape `send-whatsapp-message` uses (`:123-138`):

```ts
{ action: 'send_message', channelSlug, to: <bare digits>, type: 'text', content: { text } }
```

signed with `X-Control-Room-Signature: sha256=<hex HMAC>` over the exact JSON string. The ~25 lines of
duplication are the right trade against either a network hop or a weakened auth check. Note in a comment
that the shape is duplicated from `send-whatsapp-message` and that the two must stay in step.

**New secret required.** `whatsapp-inbound` currently reads only `CONTROL_ROOM_FORWARD_SECRET`; sending
also needs `CONTROL_ROOM_CHANNEL_SLUG` (as `send-whatsapp-message` does, `:101`). If it is unset, log
loudly, skip the reply, and still return 2xx — the message is already stored, and a missing secret must
not lose it. State this in the function header alongside the existing secrets note.

**Unverified external contract — do not design around it.** Only `type: 'text'` is ever sent by any
function in this repo. Whether `meta-proxy` accepts `type: 'interactive'` for reply buttons cannot be
confirmed from this checkout, so **v1 is plain text only**. The receive side already parses button and
list replies (`bodyForMessage`, `:102-108`), so buttons are a clean follow-up once someone confirms the
contract with Control Room. Do not attempt an interactive send.

## Scope

**In:** an audit table; staff resolution and command dispatch in `whatsapp-inbound`; an inline text-send
helper; enrolment confirmation for unenrolled numbers; the `HELP` command; a reply for an unrecognised
command.

**Out:** every other command, including production capture. Out: multi-step/confirm flows (next plan).
Out: any change to `chat_ingest_inbound_whatsapp`, to `send-whatsapp-message`, or to the shared-inbox
RPCs. Out: any front-end change. Out: applying the migration.

## Work

### 1. `migrations/20260815120000_whatsapp_command_log.sql`

```sql
CREATE TABLE IF NOT EXISTS public.whatsapp_command_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text NOT NULL,
    user_id       uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    wamid         text NULL,
    raw_body      text NULL,
    command       text NULL,
    outcome       text NOT NULL,
    detail        text NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_command_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_command_log FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS ix_whatsapp_command_log_created ON public.whatsapp_command_log (created_at DESC);
```

`outcome` is a short controlled vocabulary — use a CHECK constraint with exactly:
`'ok'`, `'unknown_command'`, `'not_enrolled'`, `'denied'`, `'error'`.

`user_id` is nullable because a `not_enrolled` attempt has no user, and that is precisely the case worth
logging. **Every dispatch attempt gets a row, including refusals** — an audit trail that only records
successes cannot answer "did someone try".

Then **`whatsapp_log_command(...) RETURNS void`**, `SECURITY DEFINER`, `service_role` only, inserting
one row. Grant it to `service_role` and nothing else, with the same
`REVOKE ALL … FROM PUBLIC, anon, authenticated` treatment as the other WhatsApp functions and the same
reasoning in its comment. Follow `docs/RBAC_NEW_FUNCTION_CHECKLIST.md`; grant to no portal role.

End with `NOTIFY pgrst, 'reload schema';`.

### 2. `supabase/functions/whatsapp-inbound/index.ts`

Extend, do not restructure. The existing signature verification, raw-body handling, dedup and
always-2xx behaviour stay exactly as they are.

**Add three helpers:**

- `sendWhatsappText(toPhone, text)` — the meta-proxy call described above. Returns success/failure;
  **never throws to the caller**. Reuse the existing `hmacHex` helper (`:66-76`) for signing rather
  than writing a second one.
- `logCommand(sb, fields)` — calls `whatsapp_log_command`, swallowing any error after a
  `console.error`. Audit logging must never break message handling. Treat a missing RPC
  (`isMissingRpc`, already at `:146-150`) as "migration not applied yet" and carry on.
- `handleCommand(sb, ctx)` — parses and dispatches. See below.

**Wire it into the message loop**, immediately after the existing ingest succeeds (after the
`row.success !== 1` check at `:278-284`), and **only** inside the `value.messages[]` loop — never the
`statuses` loop:

1. Skip entirely unless the message type is `text`. Non-text messages (`image`, `location`, …) already
   store a placeholder body; do not try to command off one.
2. `whatsapp_resolve_staff_user(from)`. If it returns no user, this is an **unenrolled** number — see
   the enrolment-confirmation step below before falling through. If that does not apply, log
   `not_enrolled` and **send no reply**. This matters: the number may well be a customer, and an
   unsolicited "you are not enrolled" to a customer is worse than silence. Behaviour for unenrolled
   numbers is otherwise **identical to today**.
3. Otherwise dispatch, then reply with whatever the handler returns.

**Enrolment confirmation — the one thing an unenrolled number may do.** Without this the chain cannot be
used at all: `whatsapp_start_enrolment` issues a code, but nothing consumes it.

Before treating an unenrolled sender as `not_enrolled`, test whether the trimmed body is **exactly six
digits**. If it is, call `whatsapp_confirm_enrolment(from, body)`:

- On success, reply confirming enrolment by the returned display name and pointing at `HELP`. Log `ok`
  with the now-known `user_id`.
- On failure — no pending code, expired, wrong code, or attempts exhausted — **send no reply** and log
  `not_enrolled`. Silence is deliberate: replying "wrong code" to an arbitrary number that happens to
  have texted six digits both confirms this endpoint is live and leaks that an enrolment is in progress.
  The person enrolling is standing with the admin who issued the code and will simply not receive the
  success message.

A six-digit body from an **already-enrolled** number is not an enrolment attempt — it falls through to
normal dispatch and lands on `unknown_command`.

Wrap the whole block in `try/catch`; on an unexpected error, `console.error` with the wamid, log
`error`, and continue to the next message. **The function must still return 2xx.**

**Parsing.** Trim, collapse internal whitespace, take the first token case-insensitively as the verb.
Keep the raw text for the audit row. Recognise:

- `HELP` (also treat an empty body and `?` as HELP) → the reply below.
- Anything else → `unknown_command`, replying with a short "not recognised" plus the same command list.

Keep the verb table a single `switch`/map with one entry, so the next plan adds a command by adding one
entry rather than restructuring.

**The HELP reply.** Plain text, WhatsApp-friendly: short lines, no markdown tables, no links (no screen
in this portal is deep-linkable — the router never reads the URL — so a link could only ever land on the
app root and would be worse than useless). Address the user by the display name
`whatsapp_resolve_staff_user` returns. List only commands that actually exist. Since `HELP` is the only
one in this plan, the reply must say so honestly rather than advertising commands that are not built —
e.g. that more commands are coming and HELP will always list the current set.

**Update the function header comment** to record: the new `CONTROL_ROOM_CHANNEL_SLUG` secret, that
commands are dispatched only for enrolled staff, that unenrolled numbers are untouched, and that
`statuses[]` never dispatch.

## Guardrails

- **You cannot apply the migration**, and you cannot deploy an edge function. Author both; a human
  applies with `npm run db:apply -- migrations/<file>.sql` and deploys with
  `supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`
  (the `--no-verify-jwt` is mandatory — `:7-9` explains that Control Room sends no Supabase JWT).
- **Degrade gracefully before the migration is applied.** `dev` deploys on merge, which is *before* a
  human migrates. If `whatsapp_resolve_staff_user`, `has_action` or `whatsapp_log_command` is missing,
  the webhook must behave **exactly as it does today**: ingest the message, log a single warning, send
  no reply, return 2xx. Use the existing `isMissingRpc` helper. A missing RPC must never produce a 5xx
  or a lost message.
- **Never make the webhook return non-2xx for a command failure.** There are no retries; a non-2xx
  discards the message forever.
- **Never dispatch from `value.statuses[]`.** Our own replies generate statuses, and that is an
  infinite loop.
- **Do not modify `supabase/functions/send-whatsapp-message/index.ts`** and do not add a service-role
  bypass to it.
- **Do not modify `chat_ingest_inbound_whatsapp`** or any function in
  `20260813090000_whatsapp_inbound_shared_inbox.sql` / `20260812100000_crm_whatsapp_module.sql`.
  Forward-only.
- **Do not attempt an interactive/button send.** Unconfirmed external contract.
- **Do not add a third-party dependency.** Use the existing `esm.sh/@supabase/supabase-js@2` import
  already at `:41` and Deno's built-in `crypto.subtle`. No new npm package, no `package-lock.json`.
- **Do not log message bodies or phone numbers to `console` beyond what is already done.** The audit
  table is the record; console output goes to a shared log.
- Do not touch anything under `WebPortal/`.

## Acceptance criteria

1. One new migration, `migrations/20260815120000_whatsapp_command_log.sql`, creating
   `whatsapp_command_log` with RLS enabled, `REVOKE ALL … FROM anon, authenticated`, a CHECK constraint
   listing exactly `ok`, `unknown_command`, `not_enrolled`, `denied`, `error`, and a nullable `user_id`.
2. `whatsapp_log_command` exists, is `SECURITY DEFINER`, and is granted **only** to `service_role` —
   the file contains no `GRANT` of it to `anon`, `authenticated` or `PUBLIC`.
3. Exactly two files change: that migration and
   `supabase/functions/whatsapp-inbound/index.ts`. No other path in `git diff --stat`.
4. The dispatch call site is inside the `value.messages[]` loop. **Grep-checkable:** no call to
   `handleCommand` or `whatsapp_resolve_staff_user` appears anywhere in the `statuses` handling.
5. An unenrolled sender whose body is not exactly six digits produces a `not_enrolled` log row and **no
   outbound message**.
5b. A six-digit body from an unenrolled number calls `whatsapp_confirm_enrolment`. On success it replies
   by display name and logs `ok`; on any failure it sends **no reply** and logs `not_enrolled`. A
   six-digit body from an already-enrolled number does **not** call `whatsapp_confirm_enrolment`.
6. `HELP` returns a plain-text reply listing only commands implemented in this plan, addressed by the
   resolved display name. **No markdown table and no URL** appears in any reply string.
7. Every dispatch path writes exactly one audit row, refusals included.
8. When any of the three new RPCs is missing, the handler logs once and the function still returns 2xx
   with the message ingested — the `isMissingRpc` helper at `:146-150` is used, not a new one.
9. `sendWhatsappText` posts `type: 'text'` only. **Grep-checkable:** the string `interactive` does not
   appear in any outbound payload construction.
10. The existing HMAC verification, raw-body read, dedup logic and `hmacHex` helper are unchanged —
    `git diff` on the edge function shows additions plus the one wiring block, with no edit to
    `:185-206`.
11. `send-whatsapp-message/index.ts` is byte-identical. `git diff --stat` does not list it.
12. The function header documents the new `CONTROL_ROOM_CHANNEL_SLUG` secret.
13. No new dependency; no `package-lock.json`; nothing under `WebPortal/` modified.
14. `npm run test:fleet` passes, including `migrations:verify`.
