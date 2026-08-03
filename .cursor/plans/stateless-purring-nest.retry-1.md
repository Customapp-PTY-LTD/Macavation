---
retry_of: 2c77f92d-e1c5-4ceb-aab2-df946ad6fe4f
---

# Macavation — WhatsApp module, consolidated under CRM (Part 1 of 2)

## Context

The client wants all of the WhatsApp-ish functionality currently scattered across three places —
the Scheduled Reports admin's WhatsApp tab, the Send Message (internal broadcast) screen, and
digest-related dashboard data — pulled into **one module that lives under CRM**, integrated with
Contacts via shortcuts, styled like WhatsApp on the inside. They want it built now, working end to
end except for actually reaching Meta (no Business API credentials yet) — every send must degrade
gracefully to a "not connected yet" state rather than error, matching the existing precedent in
`supabase/functions/send-daily-digest-whatsapp/index.ts` (returns HTTP 503 when
`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` are absent).

This is a two-part rollout because it is too much for one fleet run (the engine is capped at ~60
minutes of agent work per push): **Part 1 (this plan)** is the core module — real WhatsApp-styled
conversations with CRM contacts, a staff-to-staff internal tab, the module living under CRM in the
sidebar, and a "message this contact" shortcut on the Contacts screen. **Part 2** (a separate plan,
submitted once this one has landed on `dev`) adds the configurable daily report to selected contacts
and retires/redirects the old Scheduled Reports WhatsApp tab and Send Message screen into this
module, so the consolidation is complete.

This plan is self-contained against `origin/dev` — it does not depend on any other unmerged branch.

## Hard constraints from the previous (blocked) attempt — non-negotiable

A prior run of this plan was blocked in diff review. Each item below was verified against the
actual repo schema/code and must be followed exactly:

1. **Permission-seed column names.** The live tables are (verified in
   `migrations/20260302000001_create_features_tables.sql` and
   `migrations/20260602100000_create_actions_tables.sql`):
   - `public.features(id BIGSERIAL, key, name, description, is_active, created_at, updated_at)` —
     seed with `INSERT INTO public.features (key, name, description) VALUES (...) ON CONFLICT (key) DO NOTHING;`
     Never supply `id` (it is BIGSERIAL, not uuid) and never use `feature_key`/`feature_name`.
   - `public.role_features(role_id uuid, feature_id BIGINT, value TEXT NOT NULL DEFAULT 'true')` —
     insert `(role_id, feature_id, value)` with `'true'`, `ON CONFLICT (role_id, feature_id) DO NOTHING`,
     joining `features` on `f.key = '...'` (there is no `feature_key` column anywhere).
   - `public.actions(id BIGSERIAL, key, module, label, description, is_active)` with `module` and
     `label` NOT NULL — seed with `INSERT INTO public.actions (key, module, label, description)`.
     Never use `action_key`/`action_name`/`action_description` as column names.
   - `public.role_actions(role_id uuid, action_id BIGINT, value TEXT NOT NULL DEFAULT 'true')` —
     insert `(role_id, action_id, value)` with `'true'` explicitly (`get_actions_for_role` filters
     `ra.value = 'true'`), `ON CONFLICT (role_id, action_id) DO NOTHING`.
   Copy the seed idiom from `migrations/20260629120000_phase2_portal_features.sql` lines 137–158
   verbatim as the template. The repo auto-deploys migrations; a wrong column name jams the pipeline.
2. **`chat_list_conversations` must return `external_phone`.** The contacts-tab send flow needs the
   conversation's phone number; the previous diff read `conv.external_phone` from a RETURNS TABLE
   that didn't include it, so every contact send failed after inserting a stuck `'queued'` row. The
   returned column set must include `external_phone` (NULL for `internal` conversations), and the
   client must resolve the phone number **before** inserting the queued message — if it can't, show
   an error without inserting anything.
3. **No global DOM selectors shared across tabs.** Both tab panes coexist in the DOM (Bootstrap
   tabs hide, they don't remove). Every jQuery selector in the two tab files must be scoped to its
   own pane container (`#contactsTabPane`/`#contactsConversationList` vs
   `#internalTabPane`/`#internalConversationList`), including conversation-row click handlers and
   the search filter. Prefer delegated handlers bound once to the pane container
   (`$('#contactsConversationList').off('click', '.chat-list-item').on('click', '.chat-list-item', ...)`)
   over rebinding `$('.chat-list-item')` globally after each render — the global form lets one tab
   hijack the other's rows.
4. **Every write RPC re-validates the caller — no exceptions.** All browser calls reach Postgres as
   role `anon` (see architecture note below), so:
   - `chat_update_message_send_result` must take a `p_user_id uuid` parameter and verify that user
     is a `chat_participants` row for the message's conversation before updating anything.
   - `chat_send_message` must **not** accept a client-chosen direction or status. Derive both
     server-side from the conversation's `conversation_type`: `internal` → direction `'internal'`,
     status `'sent'`; `whatsapp_contact` → direction `'outbound_whatsapp'`, status `'queued'`.
     (Only the webhook-less future Part 2+ will ever write `'inbound_whatsapp'`, via service_role.)
     This closes the hole where any anon caller could forge inbound messages or rewrite statuses.
5. **Router registration is a SIX-touchpoint pattern, not five.** Verified in
   `WebPortal/js/appRouter.js`: `loadJSCode` loads each module script **once** (skips scripts whose
   generated id already exists in `<head>`), while `loadContent` re-fetches and re-injects the
   module HTML on **every** navigation and then calls `initializeModule(routeName)` against a
   hardcoded `moduleInitializers` map (~line 265). Therefore:
   - Add a `'crm-whatsapp-grid'` entry to that `moduleInitializers` map calling
     `_crmWhatsappGrid.init()` (guarded with `typeof`, matching the `'crm-grid'` entry's style).
   - `_crmWhatsappGrid.init()` must be **re-runnable** — no `initialized` early-return guard. Each
     run rebinds against the freshly injected DOM, re-consumes any pending handoff context, and
     clears any interval handles left from a previous visit before starting new ones.
   - Every `setInterval` poll callback must self-terminate (clearInterval) if its pane element is no
     longer connected to the document, so navigating away doesn't leave permanent background polling.

## What already exists that this builds on

- **`supabase/functions/send-daily-digest-whatsapp/index.ts`** — a real, working Meta Cloud API
  outbound call (phone normalization, 503-without-secrets guard) to copy the pattern from.
- **CRM contacts** (`public.contacts`, `WebPortal/modules/crm/`) — `get_contacts()` returns
  `id, contact_type, company_name, trading_name, primary_contact_name, primary_contact_email,
  primary_contact_phone, account_manager_id, account_manager_name, key_account, supplier_number,
  status, created_at`; only `get_contact_by_id()` additionally exposes `primary_contact_mobile`
  (confirmed in `migrations/20260429160000_fix_contact_rpc_live_schema_supplier_reads.sql`).
  `contacts` also has a `deleted_at` soft-delete column — all contact reads must filter
  `deleted_at IS NULL` (both existing contact RPCs do). `contact_type` values today: `customer,
  supplier, both, nis_supplier, oil_processor, kernel_customer, oil_ingredient_supplier,
  oil_protein_customer` — no `grower`/`shareholder` value.
- **`WebPortal/modules/assistant/mac-assistant-api.js`** — the one existing precedent in this repo
  for calling a Supabase **edge function** (not a PostgREST RPC) from the browser: build the URL as
  `window.MACAVATION_SUPABASE.url + '/functions/v1/<fn>'`, headers `Authorization: Bearer <anonKey>`
  + `apikey: <anonKey>`, POST JSON. The new WhatsApp send call must follow this, not
  `dataFunctions.callFunction` (that only talks to PostgREST RPCs).
- **`WebPortal/js/handoff-dialog.js`** (`HandoffDialog.navigateToRoute`/`applyPendingSearchForRoute`)
  — the proven "navigate to another module and hand it context via sessionStorage" pattern
  (storage key `macavation_pending_route_context`; consumer removes the key and restores it if the
  route doesn't match), already used by 5 modules. The Contacts-page shortcut re-uses this idiom
  rather than the dead `_appRouter.navigate` pattern found in `notifications.js`.
- **A load-bearing architecture fact that shapes every grant statement below:**
  `WebPortal/js/data-functions.js` calls every RPC with `{ useAnonAuth: true }` — the browser
  always calls Postgres as role `anon`, never `authenticated` (the Lambda RBAC proxy is retired, no
  fallback rung). So every new function must grant `EXECUTE` to `anon` directly, and — since
  Postgres-level RLS can't distinguish callers when everyone connects as `anon` — every write RPC
  must re-validate the caller itself (see hard constraint 4).
- **The 8 active roles** (verified in `migrations/20260709170000_cull_unused_roles_and_obsolete_users.sql`):
  `super_user, admin, Shareholder, Sales Exec, Factory Manager, Production Manager,
  Palladium Manager, Quality Assurance`. Don't reference culled roles (`General Manager`,
  `Office Administrator`, `Oil Plant Manager`, etc.) in role_name lists.

## Schema — one new migration, e.g. `migrations/20260812100000_crm_whatsapp_module.sql`

```sql
CREATE TABLE public.chat_conversations (
    conversation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_type text NOT NULL CHECK (conversation_type IN ('internal', 'whatsapp_contact')),
    contact_id        uuid NULL REFERENCES public.contacts(id),
    external_phone    text NULL,
    created_by        uuid NULL REFERENCES public.users(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_message_at   timestamptz NOT NULL DEFAULT now(),
    is_archived       boolean NOT NULL DEFAULT false
);

CREATE TABLE public.chat_participants (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES public.chat_conversations(conversation_id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id),
    joined_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, user_id)
);

CREATE TABLE public.chat_messages (
    message_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id      uuid NOT NULL REFERENCES public.chat_conversations(conversation_id) ON DELETE CASCADE,
    sender_user_id       uuid NULL REFERENCES public.users(id),
    direction            text NOT NULL DEFAULT 'internal'
                         CHECK (direction IN ('internal', 'outbound_whatsapp', 'inbound_whatsapp')),
    body                 text NOT NULL,
    external_message_id text NULL,
    send_status          text NOT NULL DEFAULT 'sent'
                         CHECK (send_status IN ('sent', 'queued', 'not_connected', 'failed')),
    send_error           text NULL,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.chat_message_reads (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id bigint NOT NULL REFERENCES public.chat_messages(message_id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES public.users(id),
    read_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (message_id, user_id)
);
```

(`conversation_type` deliberately omits `'shareholder_broadcast'` this round — Part 2 adds it, plus
a `chat_broadcast_recipients` table, without altering these four.)

RLS: enable on all four, `REVOKE ALL FROM PUBLIC/anon/authenticated`, `GRANT ALL TO service_role`
(mirrors `migrations/20260716160000_portal_assistant_chat.sql`'s per-table lockdown loop) — nobody
touches these tables directly, only through the SECURITY DEFINER functions below, which themselves
grant `EXECUTE` to `anon, authenticated, service_role` together (the fixed pattern already used for
notifications, per `migrations/20260610120000_grant_notification_rpcs_anon.sql`).

**plpgsql pitfall to avoid:** several RETURNS TABLE column names here (`conversation_id`,
`message_id`, `external_phone`, ...) collide with real column names. Fully qualify every table
column (`c.conversation_id`, `m.message_id`) inside function bodies, mirroring the OUT-param
disambiguation comments in `portal_assistant_chat.sql`, or the functions will fail at runtime with
ambiguous-reference errors.

## RPCs (same migration; SECURITY DEFINER, `SET search_path = public, extensions`, `p_`-prefixed,
`RETURNS TABLE(success int, error text, ...)` for writes, matching `portal_assistant_chat.sql`)

- `chat_start_internal_conversation(p_user_id uuid, p_other_user_id uuid)` → finds/creates a
  2-participant `internal` conversation.
- `chat_start_contact_conversation(p_contact_id uuid, p_created_by uuid)` → `TABLE(success int,
  error text, conversation_id uuid, created boolean, resolved_phone text)`. Resolves
  `coalesce(primary_contact_mobile, primary_contact_phone)` (with `deleted_at IS NULL`); fails
  clearly if both are null; else normalizes the number in SQL (port of
  `send-daily-digest-whatsapp`'s `normalizePhone()`: strip non-digits, `0→27` prefix, bare-number
  `27` prefix), finds/creates a `whatsapp_contact` conversation, and adds a `chat_participants` row
  for the staff member who started it (idempotently, so a second staff member can join an existing
  contact conversation) — there is no contact-side participant row; the contact is external.
- `chat_send_message(p_conversation_id uuid, p_sender_user_id uuid, p_body text)` — validates the
  sender is a real participant (this check **is** the access control, since every caller connects
  as `anon`) before inserting; **derives `direction` and initial `send_status` server-side from the
  conversation's `conversation_type`** (`internal` → `'internal'`/`'sent'`; `whatsapp_contact` →
  `'outbound_whatsapp'`/`'queued'`) — no direction/status parameters exposed to the browser (hard
  constraint 4); bumps `last_message_at`; auto-marks the sender's own message read; returns
  `TABLE(success int, error text, message_id bigint)`.
- `chat_update_message_send_result(p_message_id bigint, p_user_id uuid, p_send_status text,
  p_external_message_id text DEFAULT NULL, p_send_error text DEFAULT NULL)` — verifies `p_user_id`
  is a participant of the message's conversation before stamping the edge-function send result back
  onto the message row (hard constraint 4); restrict `p_send_status` to
  `('sent','not_connected','failed')`.
- `chat_list_conversations(p_user_id uuid, p_conversation_type text DEFAULT NULL)` → conversation
  list with unread count and last-message preview, **including `external_phone`** in the returned
  columns (hard constraint 2; NULL for internal conversations). `other_party_name` is a `CASE`: for
  `whatsapp_contact`, resolve from `contacts.company_name` (fallback `primary_contact_name`) via
  `contact_id`; for `internal`, resolve the other `chat_participants` row's user name from
  `users.first_name/last_name/email` — **both branches must exist from the start**. Unread-count
  subqueries must use `m.sender_user_id IS DISTINCT FROM p_user_id` (never `<>`), so future
  NULL-sender inbound WhatsApp messages still count as unread.
- `chat_list_messages(p_conversation_id uuid, p_requesting_user_id uuid, p_limit int DEFAULT 200)` —
  ownership-checks the requester against `chat_participants` first; returns empty (not an error) if
  they aren't one.
- `chat_mark_conversation_read(p_conversation_id uuid, p_user_id uuid)` — validates `p_user_id` is
  a participant before inserting read rows.
- `chat_get_unread_count(p_user_id uuid) RETURNS integer` (mirrors `get_unread_notification_count`;
  same `IS DISTINCT FROM` rule as above).
- `get_contacts_for_messaging()` — a **new, narrow** read RPC (don't touch `get_contacts()`/
  `get_contact_by_id()` — both already the site of a live-schema regression fix). Returns
  `id, contact_type, company_name, primary_contact_name, primary_contact_phone,
  primary_contact_mobile FROM public.contacts WHERE deleted_at IS NULL AND status IS DISTINCT FROM
  'inactive' ORDER BY company_name` — includes contacts with no phone number too, so the picker can
  show a "no WhatsApp number on file" state instead of silently hiding them.

No new "staff directory" RPC for the internal tab's "start new chat" — reuse the existing
`dataFunctions.getUsers()`.

## Edge function — `supabase/functions/send-whatsapp-message/index.ts` (new)

Stateless single-recipient send primitive, `POST { to, body }`. No DB access — the browser records
the result via `chat_update_message_send_result` after calling this. Mirrors
`send-daily-digest-whatsapp`'s exact 503-without-secrets guard and inlines the same
`normalizePhone()` (Deno functions here don't share modules). Returns `{ success: true,
external_message_id }` from Meta's response on success, `{ success: false, error }` at 503 (no
secrets) or 502 (Meta rejected it). The browser wrapper (`sendWhatsappMessageNow`, below) must
surface the **HTTP status code** to its caller so the client maps `503 → 'not_connected'` and other
failures → `'failed'` by status, not by matching error-message substrings.

> **Security note, not blocking this build:** reachable with the public anon key today — harmless
> because it always 503s with no secrets configured. Before real Meta credentials are ever wired
> (out of scope for this plan — no credentials exist yet), this needs a shared-secret or session
> check added; flag it for whoever does that work later.

## Module — new route nested under CRM, e.g. `crm-whatsapp-grid`

- `WebPortal/modules/crm-whatsapp/html/crm_whatsapp_grid.html` — WhatsApp-styled two-pane shell:
  tab strip ("Contacts" primary, "Internal" secondary), left pane = conversation list (search +
  "New chat"), right pane = thread + composer. Follow the `.module-content` / `macavation-help-link`
  / Bootstrap `.card` house style (see `WebPortal/modules/messaging-compose/html/messaging_compose_grid.html`
  for the exact idiom). Use `WebPortal/css/design-tokens.css` variables only, no raw hex (`ui:verify`
  fails the build on new raw-hex/`btn-success` violations — use `btn-primary` for filled buttons,
  never `btn-success`). Give the two panes fully distinct element ids (contacts vs internal) so tab
  code never needs a shared class selector (hard constraint 3).
- `WebPortal/modules/crm-whatsapp/js/crm_whatsapp_grid.js` — shell: tab wiring, self-init poll-for-
  `dataFunctions` loop (matching `_messagingComposeGrid`'s idiom) **plus** a re-runnable `init()`
  invoked from `appRouter.js`'s `moduleInitializers` on every navigation (hard constraint 5): no
  `initialized` early-return, clears prior tab poll intervals, re-inits both tabs against the fresh
  DOM, then reads/consumes any pending `macavation_pending_route_context` handoff (restore the key
  if `ctx.route !== 'crm-whatsapp-grid'`, mirroring `HandoffDialog.consumePendingRouteContext`).
  Calls `actionAccess.apply(document)` once per init (static markup only — CLAUDE.md warns this
  sweep never re-fires for dynamically rendered rows, so per-row action checks must call
  `hasAction()` inline at render time instead).
- `WebPortal/modules/crm-whatsapp/js/crm_whatsapp_contacts_tab.js` — contact conversation list/thread/
  composer, **all selectors scoped to `#contactsTabPane` / its own element ids** (hard constraint 3);
  "New chat" picks a CRM contact via `getContactsForMessaging()`, showing a disabled "no WhatsApp
  number on file" row for contacts lacking both phone fields; the send flow resolves the phone from
  the conversation's `external_phone` (now returned by `chat_list_conversations`) **before** calling
  `chat_send_message`, then calls the edge function, then stamps the result via
  `chat_update_message_send_result(messageId, currentUserId, statusFromHttpCode, ...)`; each
  outbound bubble shows a small status cue (queued/sent/not-connected/failed); a persistent banner
  reads *"WhatsApp Business API not yet connected — messages are saved but won't be delivered until
  connected."* Gate the composer/send on `hasAction('messaging.whatsapp.contact.send')`. The 5s
  thread poll self-clears when its pane leaves the document (hard constraint 5).
- `WebPortal/modules/crm-whatsapp/js/crm_whatsapp_internal_tab.js` — staff-to-staff chat: conversation
  list/thread/composer, "New chat" picks a colleague via `dataFunctions.getUsers()`; same scoping and
  poll-teardown rules as the contacts tab.
- `WebPortal/modules/crm-whatsapp/css/crm_whatsapp_grid.css` — bubble/list styling (outbound bubble
  `var(--mac-green-light)`/`var(--mac-green)` border, inbound `var(--mac-bg-secondary)`/`var(--mac-border)`,
  matching WhatsApp's visual grammar without inventing a new palette).
- `WebPortal/js/whatsapp-unread-badge.js` — 60s-poll unread badge (mirrors `notifications.js`'s
  `POLL_MS=60000`, no websockets), independent of the existing notification bell. Its `index.html`
  script tag must carry a `?v=` cache-buster like every sibling script.
- `WebPortal/js/data-functions.js` additions: `chatStartInternalConversation`, `chatStartContactConversation`,
  `chatSendMessage` (conversationId, senderUserId, body — no direction/status args),
  `chatListConversations`, `chatListMessages`, `chatMarkConversationRead`, `chatGetUnreadCount`,
  `getContactsForMessaging`, `chatUpdateMessageSendResult` (messageId, userId, status, ...) — thin
  `callFunction('chat_...', {p_...}, token, {useCache:false})` wrappers with the same defensive
  response-shape unwrap already used by `getMyNotifications`; plus **`sendWhatsappMessageNow(to,
  body)`** — the one exception that `fetch()`s the edge function directly (see `mac-assistant-api.js`
  pattern above), not through `callFunction`, and returns the HTTP status alongside the parsed body.

## Registration (must all agree on the same route key — SIX touchpoints, see hard constraint 5)

- `WebPortal/js/appRouteConfig.json`: new `"crm-whatsapp-grid"` entry (`path`, `html`, `js: [shell,
  contacts-tab, internal-tab]`, `css`).
- `WebPortal/js/appRouter.js`: new `'crm-whatsapp-grid'` entry in the `moduleInitializers` map
  calling `_crmWhatsappGrid.init()` (typeof-guarded, matching the `'crm-grid'` entry's style) — this
  is what re-initializes the module on every navigation, since module scripts load only once.
- `WebPortal/index.html`: new `<li data-route="crm-whatsapp-grid">` **nested inside the existing
  `<div class="collapse" id="crmCollapse">`** (alongside the current `data-route="crm-grid"`
  "Contacts" item), NOT a new top-level item — this is the "lives under CRM" placement the client
  asked for. Plus the `whatsapp-unread-badge.js?v=...` script tag.
- `WebPortal/js/role-menu-config.js`: `menuStructure['crm-whatsapp-grid']` entry (icon `fab
  fa-whatsapp`, `parent: 'crmCollapse'`, matching how `crm-grid` itself is declared),
  `portalModuleOrder` push next to `'crm-grid'`, and add `'crm-whatsapp-grid'` to whichever roles
  already see `'crm-grid'` in their `menus` array.
- Migration seeds `public.features`/`public.role_features` (key `'crm-whatsapp-grid'`, same roles as
  `'crm-grid'`), and `public.actions`/`public.role_actions` for `messaging.chat.use` (internal tab,
  all 8 active roles listed above) and `messaging.whatsapp.contact.send` (contact tab — default to
  whichever roles already hold the `crm-grid` feature, since that is this repo's existing proxy for
  "handles customer/supplier relationships") — **using exactly the verified column shapes in hard
  constraint 1.**

## Contacts-page shortcut (the actual "integrate with contacts" requirement)

- `WebPortal/modules/crm/js/crm_grid.js`: add a WhatsApp icon item
  (`icon: 'fab fa-whatsapp'`) to each contact row's `MacTableActions.render` item lists (there are
  several render sites — `contactActionsCell` plus the per-table renderers around lines 400–530 —
  cover them all), **only when `hasAction('messaging.whatsapp.contact.send')` is true at render
  time** (the router's `actionAccess.apply` sweep does not re-fire for dynamically rendered rows).
- Click handler (delegated `$(document).on('click', ...)`, matching the existing edit/delete
  handlers): call `dataFunctions.chatStartContactConversation(contactId, currentUserId)`; on a
  "no phone" error show a clear warning dialog; on success store
  `{route: 'crm-whatsapp-grid', openConversationId: <id>}` under the `HandoffDialog` sessionStorage
  key `macavation_pending_route_context` and call `_appRouter.routeTo('crm-whatsapp-grid')`;
  `crm_whatsapp_grid.js`'s (re-runnable) init reads and consumes that stashed conversation id on
  **every** navigation, not just the first (mirroring `HandoffDialog.applyPendingSearchForRoute`'s
  consumer-side pattern) and opens straight into that contact's thread instead of the empty list view.

## What Part 2 will add (separate plan, submitted once this one is confirmed on `dev`)

- Configurable daily report (which KPIs, free text) sendable to a **selected set of contacts** —
  not just the fixed `scheduled_reports` phone list — as a third tab in this same module, reusing
  `send-whatsapp-message` and `get_daily_digest()`.
- Retire/redirect the Scheduled Reports admin's WhatsApp tab and the Send Message
  (`messaging-compose-grid`) screen into this module, completing the "one module" consolidation.

## Effort / sizing note

This is already a fuller build than a typical single fleet push (new schema + 2 chat tabs + edge
function + a shortcut integrated into a different, existing module). If the fleet run times out or
the diff is too large to land cleanly in one pass, the natural next cut is: internal tab + contacts
tab + module registration in one push, Contacts-page shortcut in a second immediately-following push.

## Verification

Two portal users chat on the Internal tab; unread badge updates within 60s without a manual refresh.
Clicking a conversation row in one tab must never invoke the other tab's handlers (open a
conversation in each tab in the same session and confirm both threads render correctly). Click the
new WhatsApp icon on a Contacts row for a contact with a phone/mobile number on file; it opens the
WhatsApp module already inside that contact's thread; sending a message inserts
`send_status='queued'` then flips to `'not_connected'` once `send-whatsapp-message` 503s (no live
secrets yet), shown as a banner + per-message status cue, never a silent failure, a fake "sent"
state, or a message stuck in `'queued'`. A contact with no phone number shows a disabled "no
WhatsApp number on file" state in the picker. Navigate away from the module and back: the
conversation list re-renders, buttons still work, and no orphaned 5s polls keep firing (check the
network tab); a second "message this contact" click from Contacts also lands in the right thread.
The new nav item appears nested under CRM, not as a separate top-level entry, and only for roles
granted the `crm-whatsapp-grid` feature; the row-level WhatsApp icon only renders for roles holding
`messaging.whatsapp.contact.send`. The migration applies cleanly against the real schema (features/
actions seeds use `key/name/description` and `key/module/label/description` respectively).
