# WhatsApp inbound receiving + shared-inbox UI

## Goal

A customer messaged Macavation's WhatsApp number (+27 71 463 9643) and their conversation is
invisible in the portal. Outbound sending already works and is verified in production-like use.
The gap is that **nothing receives inbound messages**: there is no webhook endpoint, so Control Room
forwards nothing into our database, `public.chat_messages` has 0 rows, and the CRM → WhatsApp screen
has nothing to display.

Build the inbound path end to end: an edge function that receives Control Room's forwards, RPCs that
persist them idempotently, and the UI changes needed to see and reply to those conversations.

## What is already in place (do not rebuild)

- **Outbound send via Control Room** — `supabase/functions/send-whatsapp-message/index.ts` and
  `send-daily-digest-whatsapp/index.ts` already POST to Control Room's `meta-proxy` with
  `X-Control-Room-Signature` HMAC signing. Read `send-whatsapp-message/index.ts` first: its
  `signBody()` and `normalizePhone()` are the patterns to reuse. Do not change these files.
- **Chat schema and RPCs** — `migrations/20260812100000_crm_whatsapp_module.sql` defines
  `public.chat_conversations`, `chat_participants`, `chat_messages`, `chat_message_reads` plus 9
  `chat_*` RPCs. **This migration is already applied to the dev database.** Treat it as an immutable
  baseline.
- **UI module** — `WebPortal/modules/crm-whatsapp/` (grid, contacts tab, internal tab), registered as
  route `crm-whatsapp-grid` in `WebPortal/js/role-menu-config.js` and `WebPortal/index.html`.
- **Secrets** — `CONTROL_ROOM_FORWARD_SECRET` and `CONTROL_ROOM_CHANNEL_SLUG` are already set on the
  dev Supabase project. Do not add them to any committed file.

## Hard constraints

- **You cannot apply migrations and you cannot reach any database or network.** Author the migration
  file only. A human applies it out of band, **after** this plan merges.
- **Therefore every code path you write must degrade gracefully until the migration is applied.**
  This plan merges to `dev` and `dev` may deploy immediately, so for a period the new front-end and
  edge function will run against the OLD schema. Concretely: if a new RPC is missing, the WhatsApp
  screen must behave exactly as it does today (no thrown errors, no blank screen, no console spam) —
  feature-detect and fall back. This is a correctness requirement, not a nicety.
- **`npm run test:fleet` must pass.** It is
  `npm run routing:verify && npm run username:verify && node scripts/verify-phase2-migrations.mjs`.
  Do not add anything to `test:fleet` that needs a network, a browser, a login, or a service-role
  key — see the `//test:fleet` comment in `package.json`.
- Do not add npm dependencies. This repo is deliberately zero-dependency, vanilla JS, no build step.
- Do not touch `.claude/worktrees/` (other branches), and do not reference the production Supabase
  project.

## Architectural decision: additive only

**Do not modify or replace any of the 9 existing `chat_*` RPCs.** Add new ones alongside them.

This is deliberate. The existing `chat_list_conversations` / `chat_list_messages` are participant-
gated and back internal 1:1 staff chat. Rewriting them to also serve a shared WhatsApp inbox risks
leaking private internal conversations to non-participants, and it breaks the graceful-degradation
requirement above. Instead:

- New RPCs serve the WhatsApp shared inbox.
- The internal-chat tab keeps calling the existing RPCs, unchanged.
- The UI feature-detects the new RPCs and falls back to today's behaviour when they are absent.

## Product decision: the WhatsApp line is a shared team inbox

An inbound message from an unrecognised number must still be visible — it has no participant rows and
may match no CRM contact.

- Inbound from an unknown number creates a `conversation_type='whatsapp_contact'` conversation with
  `contact_id` NULL and `external_phone` set.
- Any user holding the existing `messaging.whatsapp.contact.send` action can see and reply to **all**
  `whatsapp_contact` conversations, regardless of `chat_participants` rows.
- **Internal (`conversation_type='internal'`) conversations keep participant-based privacy exactly as
  today.** Do not weaken this. A reviewer will check specifically for this.

## Deliverable 1 — migration

New file `migrations/<YYYYMMDDHHMMSS>_whatsapp_inbound_shared_inbox.sql`, timestamped later than
`20260812100000`. Mirror the header-comment style and the grant/seed `DO`-block idioms of
`migrations/20260812100000_crm_whatsapp_module.sql`.

Contents:

1. **Dedupe guarantee.** A partial unique index on `public.chat_messages (external_message_id)`
   `WHERE external_message_id IS NOT NULL`. Control Room can re-deliver a webhook, so idempotency
   must be enforced by the database, not by a race-prone `SELECT`-then-`INSERT`.

2. **`chat_ingest_inbound_whatsapp`** — records one inbound message idempotently. Params (all
   `DEFAULT NULL`): sender phone (bare digits as Control Room sends them), wamid, message body,
   message type, WhatsApp profile name, and the Meta timestamp. Behaviour:
   - Normalise the phone to a single canonical form and **use that same form for both inbound and
     outbound** so both directions land on one conversation. Outbound currently sends `+27…`;
     inbound arrives as `27…`. Pick one canonical representation, document it in a comment, and make
     the find-or-create match on it. A mismatch here silently creates duplicate conversations — this
     is the single most likely bug in this plan.
   - Find or create the `whatsapp_contact` conversation for that phone. Link `contact_id` when
     exactly one `public.contacts` row matches on `primary_contact_mobile` / `primary_contact_phone`
     (verify the real column names against the baseline migration); leave NULL when zero match, and
     when **more than one** matches leave NULL rather than guessing.
   - Insert into `chat_messages` with `direction='inbound_whatsapp'`, `sender_user_id` NULL,
     `external_message_id` = wamid. Respect the existing CHECK constraints on `direction` and
     `send_status`.
   - On duplicate wamid: succeed idempotently, returning the existing `message_id`. Do not error and
     do not insert twice.
   - Bump `chat_conversations.last_message_at`.

3. **`chat_record_whatsapp_status`** — records a Meta delivery-status callback (sent / delivered /
   read / failed) against an existing outbound message matched by `external_message_id`. A status for
   a wamid we never sent must be a no-op success, not an error.

4. **`chat_list_whatsapp_conversations`** — shared-inbox conversation list for a user. Returns only
   `conversation_type='whatsapp_contact'`. Display label falls back: contact name → stored WhatsApp
   profile name → formatted phone number. Include an unread count that is **NULL-safe** — the
   existing `sender_user_id <> p_user_id` idiom silently drops rows for inbound messages, which have
   `sender_user_id` NULL. Count any inbound message with no `chat_message_reads` row for that user.

5. **`chat_list_whatsapp_messages`** — messages in one `whatsapp_contact` conversation, for a user
   with shared-inbox access. Must not return internal conversations under any argument.

6. **`chat_mark_whatsapp_read`** and **`chat_get_whatsapp_unread_count`** — read-marking and total
   unread for the shared inbox, NULL-safe in the same way.

Every new RPC: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions`,
`RETURNS TABLE (success int, error text, …)`, params `DEFAULT NULL` with explicit validation
returning `success=0` and a message rather than raising, `DROP FUNCTION IF EXISTS` with the full
argument signature first. Seed `role_permissions` (`object_type='function'`, `operation='EXECUTE'`),
then `REVOKE ALL … FROM PUBLIC` and `GRANT EXECUTE` to `anon`, `authenticated`, `service_role`, per
`docs/RBAC_NEW_FUNCTION_CHECKLIST.md`. Idempotent and re-runnable throughout. End with
`NOTIFY pgrst, 'reload schema';`.

Consider whether the profile name needs a column on `chat_conversations` (additive `ALTER TABLE …
ADD COLUMN IF NOT EXISTS`) so unknown numbers can show a human name.

## Deliverable 2 — inbound webhook edge function

New `supabase/functions/whatsapp-inbound/index.ts`.

Control Room's contract, which you cannot look up (no network) — implement exactly this:

- Control Room POSTs **Meta's raw webhook envelope, byte-for-byte**: the
  `whatsapp_business_account` object, with `entry[].changes[].value.messages[]` for inbound messages,
  `value.statuses[]` for delivery receipts, `value.contacts[0].profile.name` for the sender's display
  name, and `value.metadata.phone_number_id`.
- Headers on every forward: `X-Control-Room-Signature: sha256=<hex HMAC-SHA256 of the raw body>`,
  `X-Control-Room-Channel`, `X-Control-Room-Channel-Code`, `X-Control-Room-Phone-Number-ID`,
  `X-Control-Room-Signature-Verified: true`.
- Verify with `CONTROL_ROOM_FORWARD_SECRET` — the same secret used for outbound signing; it signs
  both directions.
- Inbound phone numbers are **bare digits, no leading `+`** (e.g. `27725755178`).
- **There is no GET challenge.** No `hub.challenge` handshake reaches us; handle POST only.
- **There are no retries.** Control Room always acks Meta `200` regardless of what we return. A
  non-2xx or a timeout is logged as failed on their side and **dropped forever**.
- Duplicates are possible; dedupe on wamid.
- Media is referenced by Meta **id**, not a URL, and the access token lives in Control Room — we
  cannot download bytes. Do not attempt to.

Implementation requirements:

1. Read the raw body **once** via `await req.text()` and use that exact string for **both** signature
   verification and `JSON.parse`. Any parse-then-re-stringify before hashing breaks the HMAC. This is
   the most common way to get this wrong.
2. Compare signatures without early-exit on the first differing byte.
3. Missing secret → `503`, matching the fail-safe wording style of the sibling functions. Invalid or
   missing signature → `401`. Never process an unverified payload.
4. Iterate **all** of `entry[]`, `changes[]`, `value.messages[]`, `value.statuses[]`. Never assume a
   single element.
5. **Persist first**, via the new RPCs using a service-role client (`SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY`); do any other work afterwards. Because there are no retries, a
   message we accept but fail to persist is lost permanently — `console.error` failures loudly,
   including the wamid.
6. Return `200` for payloads that verify but contain nothing usable, so Control Room does not record
   a false failure. Only credential/signature problems return non-2xx.
7. **Graceful degradation:** if the new RPCs do not exist yet (migration not applied), log clearly and
   return `200`. Do not 500 in a loop.
8. Store a sensible placeholder body for non-text types (image / video / audio / document / sticker /
   location / interactive / contacts / reaction) recording the type and media id.
9. Header comment documenting: the deploy command, required secrets, that **`verify_jwt` must be
   disabled** (Control Room sends no Supabase JWT — the HMAC signature is the auth), and the URL to
   register in Control Room.

## Deliverable 3 — UI

Change only what is needed in `WebPortal/modules/crm-whatsapp/` and `WebPortal/js/data-functions.js`
(plus `whatsapp-unread-badge.js` if that is where the badge lives). Match the surrounding code's
idiom exactly — vanilla JS, no framework, no build step; check what neighbouring files actually use
rather than introducing newer syntax.

1. The WhatsApp tab lists conversations from `chat_list_whatsapp_conversations`, so inbound
   conversations from unknown numbers appear **without** anyone having started them from a CRM
   contact. Today a conversation can only be opened by picking an existing contact — that is the main
   reason an inbound message would be invisible even once stored.
2. Inbound messages render visually distinct from outbound. Follow the existing patterns in
   `css/crm_whatsapp_grid.css`; do not introduce a new design language.
3. Conversations with `contact_id` NULL show profile name, else a formatted phone number — never
   blank or a bare "Contact".
4. An open thread polls for new messages. Follow the ~60s poll precedent in
   `WebPortal/js/notifications.js`; no websockets. Use a shorter interval only if it is cheap.
5. Unread badges count inbound messages.
6. **Feature-detect** the new RPCs. When absent, the tab behaves exactly as it does today. Follow the
   error-swallowing/return-shape conventions of the neighbouring `chat*` helpers in
   `data-functions.js` (browser calls RPCs as role `anon`, `useAnonAuth: true`).
7. Leave the internal-chat tab's behaviour untouched.

## Acceptance criteria

- Migration file exists, is timestamped after `20260812100000`, is re-runnable, and grants every new
  RPC per the RBAC checklist. No existing `chat_*` RPC is modified or dropped.
- Duplicate wamid delivery cannot create two `chat_messages` rows — enforced by a unique index.
- Inbound and outbound to the same number resolve to **one** conversation (canonical phone form).
- A signature-less or wrongly-signed POST to the webhook is rejected `401` and persists nothing.
- With the migration NOT applied, the WhatsApp screen still loads and behaves as it does today, and
  the webhook returns 2xx rather than erroring repeatedly.
- Internal 1:1 conversations remain visible only to their participants. State explicitly in the PR
  description how this was verified.
- `npm run test:fleet` passes.

## Out of scope

- Applying the migration, deploying functions, and registering the webhook URL in Control Room — all
  human steps, sequenced after merge.
- Media download/proxying (Control Room holds the token; no proxy exists).
- Changing outbound send behaviour.
- Backfilling conversation history: Meta does not replay past messages, so existing conversations
  will not appear retroactively. Only messages received after the webhook is registered will show.

## Notes for the human, to include in the PR description

1. Apply the migration to dev: `npm run db:apply -- migrations/<new file>.sql`
2. Deploy: `supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa`
3. Disable `verify_jwt` for `whatsapp-inbound` (Control Room sends no Supabase JWT).
4. Register in Control Room → Channels → `macavation-9349` → Overview → Product destination: the
   product Supabase project ref (`nmdmddugxclpqrwylyfa`) plus function name `whatsapp-inbound`, or
   the equivalent webhook URL override. Until this is set, Control Room logs inbound events on its
   side and forwards nothing.
5. Test by sending a WhatsApp message **to** +27 71 463 9643 and confirming it appears in
   CRM → WhatsApp.
