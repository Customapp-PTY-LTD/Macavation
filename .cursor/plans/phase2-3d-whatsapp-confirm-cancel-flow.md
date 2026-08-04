---
depends_on: phase2-3c-whatsapp-command-router.md
---

# A confirm/cancel step for WhatsApp commands that write

## Context

The router from the previous plan handles single-message read-only commands fine. The command that
actually motivates this feature — capturing production figures from the factory floor — **writes a
number that propagates widely**: `kernel_day_kg` feeds the dashboard's kg-cracked tiles, Production
Trends, the raw-material runway forecast, the kernel mass balance, and the daily digest. A mistyped
`69000` instead of `6900` would quietly move all of them.

So a write command must echo back what it understood and wait for agreement. This plan adds that
mechanism, generically, with no write command attached yet — the capture command lands next, on top of
it.

Keeping it separate is deliberate: a confirm/cancel state machine is easy to get subtly wrong (stale
confirmations applying to the wrong thing being the classic failure), and it is far easier to review on
its own than tangled with batch resolution and JSONB merging.

### Why a table rather than in-memory state

Edge functions are stateless and may serve consecutive messages on different instances, so the pending
command cannot live in a module variable. It needs a row. Keep it small and short-lived, and key it on
the **phone**, so a second pending command from the same handset replaces the first rather than leaving
two live confirmations — the same reasoning behind `whatsapp_enrolment_codes.phone` being its primary
key.

## Scope

**In:** a `whatsapp_pending_commands` table, RPCs to stage/fetch/consume a pending command, and the
`YES`/`NO` verbs in the router.

**Out:** any actual write command. This plan's `CONFIRM` path has nothing to confirm yet, so it must
behave sensibly when invoked with no pending row ("nothing to confirm") — that is the only reachable
behaviour until the next plan, and it is a real acceptance criterion, not a placeholder.

**Out:** applying the migration or deploying the function.

## Work

### 1. `migrations/20260815130000_whatsapp_pending_commands.sql`

```sql
CREATE TABLE IF NOT EXISTS public.whatsapp_pending_commands (
    phone        text PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    command      text NOT NULL,
    payload      jsonb NOT NULL,
    summary      text NOT NULL,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_pending_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_pending_commands FROM anon, authenticated;
```

`summary` holds the exact human-readable sentence that was sent to the user, so the confirmation and
what they were shown can never drift apart. `payload` holds the parsed arguments the eventual handler
will act on.

**Three functions, all `SECURITY DEFINER` and `service_role` only** — same grant treatment and same
reasoning comment as the other WhatsApp functions (the browser calls as `anon`, so a caller-supplied
`user_id` plus an `anon` grant is not a gate):

- **`whatsapp_stage_pending_command(p_phone text, p_user_id uuid, p_command text, p_payload jsonb, p_summary text) RETURNS jsonb`**
  — upsert on `phone`, `expires_at = now() + interval '10 minutes'`. Returns success plus the summary.
- **`whatsapp_take_pending_command(p_phone text, p_user_id uuid) RETURNS jsonb`** — the important one.
  It must **fetch and delete in one statement** so a command can never be applied twice:

  ```sql
  DELETE FROM public.whatsapp_pending_commands
   WHERE phone = v_phone
     AND user_id = p_user_id
     AND expires_at > now()
  RETURNING command, payload, summary
  ```

  Use `DELETE … RETURNING`, not `SELECT` then `DELETE` — two statements leave a window where a
  duplicate inbound webhook (Control Room warns duplicates are possible, `whatsapp-inbound/index.ts:36`)
  could apply the same write twice. Return a clear "nothing pending" result when no row comes back.
  Matching on `user_id` as well as `phone` means a re-enrolled number cannot inherit the previous
  user's pending command.
- **`whatsapp_clear_pending_command(p_phone text, p_user_id uuid) RETURNS jsonb`** — for `NO`/cancel.

Expiry is enforced in the `WHERE` clause, so an expired row is simply never taken. Do not add a cron to
sweep the table — it is tiny, keyed by phone, and self-replacing. If a sweep is ever wanted it is its
own decision.

End with `NOTIFY pgrst, 'reload schema';`.

### 2. `supabase/functions/whatsapp-inbound/index.ts`

Add two verbs to the existing dispatch map — one entry each, no restructuring:

- **`YES`** (accept `Y` and `CONFIRM` as synonyms) → `whatsapp_take_pending_command`. With no pending
  row, reply "There is nothing waiting for confirmation." With a row, this plan has no handler to run
  it, so dispatch on `command` through a map that is **empty for now** and reply "That request has
  expired or is no longer supported — please send it again." The next plan registers the real handler
  in that map.
- **`NO`** (accept `N` and `CANCEL`) → `whatsapp_clear_pending_command`, replying that it was cancelled,
  or that there was nothing pending.

Both write an audit row via the existing `logCommand`, with `outcome` `'ok'` or `'unknown_command'` as
appropriate — the vocabulary from the previous plan's CHECK constraint. **Do not add a new `outcome`
value**; that would need a constraint change and this plan does not alter that table.

Update `HELP` to mention that write commands ask for confirmation and that `YES`/`NO` answer them.

Keep the missing-RPC degradation from the previous plan: if the new RPCs are absent because the
migration is unapplied, `isMissingRpc` catches it, one warning is logged, no reply is sent, and the
function still returns 2xx.

## Guardrails

- **You cannot apply the migration or deploy the function.** Author both; a human applies with
  `npm run db:apply -- migrations/<file>.sql` and deploys with
  `supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`.
- **`whatsapp_take_pending_command` must be a single `DELETE … RETURNING`.** Not `SELECT` then
  `DELETE`. Duplicate webhook deliveries are documented as possible, and this is the only thing
  standing between a duplicate and a double write.
- **Never make the webhook return non-2xx**, and never dispatch from `value.statuses[]`.
- **Do not grant any of the three new functions to `anon` or `authenticated`.**
- **Do not add a new `whatsapp_command_log.outcome` value** and do not alter that table.
- **Do not implement any write command here.** If it is tempting to add the capture handler while the
  plumbing is fresh — do not; it is the next plan, and it needs batch resolution and conflict handling
  that do not belong in this diff.
- Forward-only: do not edit any existing migration. Do not modify `send-whatsapp-message`,
  `chat_ingest_inbound_whatsapp`, or anything under `WebPortal/`.
- No new dependency; no `package-lock.json`; do not weaken `npm run test:fleet`.

## Acceptance criteria

1. One new migration, `migrations/20260815130000_whatsapp_pending_commands.sql`, creating the table with
   `phone` as primary key, `summary` and `payload` columns, RLS enabled, and
   `REVOKE ALL … FROM anon, authenticated`.
2. Three functions exist: `whatsapp_stage_pending_command`, `whatsapp_take_pending_command`,
   `whatsapp_clear_pending_command`, each `SECURITY DEFINER`.
3. **Grep-checkable:** each is granted `TO service_role`, and the file contains no `GRANT` of any of them
   to `anon`, `authenticated` or `PUBLIC`.
4. **Grep-checkable:** `whatsapp_take_pending_command`'s body contains `DELETE` with `RETURNING` and
   does **not** contain a `SELECT … INTO` against `whatsapp_pending_commands`.
5. Its `WHERE` clause filters on `phone`, `user_id` **and** `expires_at > now()`.
6. Exactly two files change: the migration and `supabase/functions/whatsapp-inbound/index.ts`.
7. `YES`/`Y`/`CONFIRM` and `NO`/`N`/`CANCEL` are all recognised, case-insensitively.
8. With no pending row, `YES` replies that nothing is awaiting confirmation and writes an audit row.
9. The handler map for staged commands exists and is **empty** in this plan; an unrecognised staged
   command replies gracefully rather than throwing.
10. `whatsapp_command_log`'s CHECK constraint is unchanged — `git diff` does not touch
    `20260815120000_whatsapp_command_log.sql`.
11. Missing RPCs still yield an ingested message, one warning, no reply, and a 2xx.
12. No new dependency; nothing under `WebPortal/` modified; `send-whatsapp-message` byte-identical.
13. `npm run test:fleet` passes, including `migrations:verify`.
