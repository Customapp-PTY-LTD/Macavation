# Macavation — WhatsApp module Part 2: configurable report + retire old screens

## Context

Part 1 is merged and live on `dev`: the `crm-whatsapp-grid` module (nested under CRM in the sidebar)
with "Contacts" (real WhatsApp conversations) and "Internal" (staff chat) tabs, plus a WhatsApp
shortcut on the CRM Contacts screen. The client's ask isn't fully satisfied yet: the daily-report
config still lives on the separate "Scheduled Reports" screen, and internal broadcast messaging
still lives on the separate "Send Message" screen — both need to move into this one module, and the
daily report needs to become **configurable and sendable to selected contacts**, not just the fixed
`scheduled_reports` phone list.

**This plan adds two more tabs to the existing module** and **removes the two old standalone nav
items**, so everything really does live in one place.

## A hard lesson from Part 1, restated so it isn't repeated

Part 1's first fleet run was blocked because the generated migration invented column names for the
existing `features` and `actions` tables instead of using the real ones. **The real schemas, copied
verbatim from `migrations/20260302000001_create_features_tables.sql` and
`migrations/20260602100000_create_actions_tables.sql`, confirmed still correct as of this plan:**

```sql
-- public.features: id, key, name, description, is_active, created_at, updated_at
-- public.role_features: id, role_id, feature_id, value DEFAULT 'true', created_at, updated_at
-- public.actions: id, key, module (NOT NULL, no default), label, description, is_active, ...
-- public.role_actions: id, role_id, action_id, value DEFAULT 'true', created_at, updated_at
```

Any new migration in this plan **must** use `key`/`name`/`description` on `features` and
`key`/`module`/`label`/`description` on `actions` — never `feature_key`/`action_key`/etc. No new
`features`/`role_features` rows are needed this round (the module's visibility gate,
`crm-whatsapp-grid`, already exists from Part 1) — only two new `actions` rows.

## Part 2a — "Reports" tab: configurable report to selected contacts

Reuses the existing `scheduled_reports` table/RPCs for the recurring subscriber list (unchanged —
no reason to touch what already works), and adds a new **ad-hoc** path: pick specific CRM contacts
and send a report to them right now, instead of only the fixed phone list.

### Schema (new migration, e.g. `migrations/20260901100000_crm_whatsapp_reports_tab.sql`)

```sql
ALTER TABLE public.chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_conversation_type_check;
ALTER TABLE public.chat_conversations ADD CONSTRAINT chat_conversations_conversation_type_check
    CHECK (conversation_type IN ('internal', 'whatsapp_contact', 'report_broadcast'));

CREATE TABLE public.chat_report_recipients (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id          bigint NOT NULL REFERENCES public.chat_messages(message_id) ON DELETE CASCADE,
    contact_id          uuid NOT NULL REFERENCES public.contacts(id),
    phone               text NOT NULL,
    send_status         text NOT NULL DEFAULT 'queued' CHECK (send_status IN ('queued', 'sent', 'failed', 'not_connected')),
    external_message_id text NULL,
    send_error          text NULL,
    sent_at             timestamptz NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);
```

RLS lockdown on `chat_report_recipients` matches Part 1's four tables exactly (enable RLS,
`REVOKE ALL FROM PUBLIC/anon/authenticated`, `GRANT ALL TO service_role`).

### RPCs (same migration; same conventions as Part 1 — SECURITY DEFINER,
`SET search_path = public, extensions`, `RETURNS TABLE(success int, error text, ...)`)

- `chat_get_or_create_report_conversation()` → singleton `conversation_type='report_broadcast'`
  conversation, created once and reused (this is what makes the tab's history list free — it reuses
  Part 1's unchanged `chat_list_conversations`/`chat_list_messages`).
- `chat_send_report(p_created_by uuid, p_body text, p_contact_ids uuid[])` → `TABLE(success int,
  error text, message_id bigint, recipient_count int)`. Inserts one `chat_messages` row
  (`direction='outbound_whatsapp'`) into the singleton conversation via the **existing**
  `chat_send_message` (no signature change needed — it already takes `p_direction`), then for each
  `p_contact_ids` element resolves `coalesce(primary_contact_mobile, primary_contact_phone)` (same
  normalization as `chat_start_contact_conversation`) and inserts one `chat_report_recipients` row
  per contact with a phone number, skipping (not erroring on) any without one.
- `chat_update_report_recipient_send_result(p_recipient_id bigint, p_send_status text,
  p_external_message_id text DEFAULT NULL, p_send_error text DEFAULT NULL)` — stamps one recipient
  row after the client calls the existing `send-whatsapp-message` edge function for them.
- `chat_list_report_recipients(p_message_id bigint)` → per-recipient status list for the sent-report
  history view (contact name joined from `contacts`).

**No new edge function** — reuses Part 1's `send-whatsapp-message` exactly as-is (the client loops
one call per selected contact).

### Actions

```sql
INSERT INTO public.actions (key, module, label, description) VALUES
    ('messaging.report.send', 'Messaging', 'Send Configurable Report', 'Compose and send a report to selected CRM contacts')
ON CONFLICT (key) DO NOTHING;
```
Grant to the same roles Part 1 granted `messaging.whatsapp.contact.send` to (roles with `crm-grid`).

### UI — `WebPortal/modules/crm-whatsapp/js/crm_whatsapp_reports_tab.js` (new) + a "Reports" tab
button in `crm_whatsapp_grid.html`/`.js` (same tab-registration pattern Part 1 already established)

- Fetches `get_daily_digest()` (existing RPC, already used by `scheduled_reports_grid.js`'s preview)
  and pre-fills an editable textarea with the formatted digest text (same wording style as
  `send-daily-digest-whatsapp`'s `formatWhatsAppText()`), so the "configurable" part is: edit this
  text freely before sending.
- Contact multi-select sourced from `get_contacts_for_messaging()` (Part 1's existing RPC) —
  contacts without a phone/mobile shown disabled with a "no WhatsApp number" tag, exactly like the
  Contacts tab's picker.
- "Send Now" → `chat_send_report` → loop `sendWhatsappMessageNow(phone, body)` per recipient (same
  client wrapper Part 1 already built) → `chat_update_report_recipient_send_result` per result →
  render a per-recipient status list (reusing the Contacts tab's status-cue styling).
- Below the composer: the recurring-subscriber management UI, relocated from
  `WebPortal/modules/scheduled-reports/html/scheduled_reports_grid.html` (both the Email and WhatsApp
  subscriber tables), reusing the same `dataFunctions.getScheduledReports`/`upsertScheduledReport`
  calls — **but fixed, not copied as-is**. The old screen has a known, already-diagnosed defect: the
  WhatsApp tab shows a green **"Live"** badge (`scheduled_reports_grid.html` line 28) directly next to
  a banner reading *"WhatsApp delivery is not live yet"* (line 69), and every WhatsApp-subscription
  input on that tab (`#srWhatsAppPhone`, `#srWhatsAppName`, `#srWhatsAppActive`, `#srWhatsAppSaveBtn`)
  is `disabled` and wired to nothing — `scheduled_reports_grid.js` has no click handler referencing
  any of them at all. The **only** way to actually create a working WhatsApp subscription today is
  through the Email tab's shared table, picking `channel = WhatsApp` from its row dropdown
  (`saveRow()` in `scheduled_reports_grid.js`, lines 105-134, already handles this channel correctly).
  When relocating this UI into the Reports tab:
  - Drop the disabled, dead WhatsApp-only sub-form entirely (`#srWhatsAppPhone`/`#srWhatsAppName`/
    `#srWhatsAppActive`/`#srWhatsAppSaveBtn` and their card) — it has never worked and duplicates the
    one form that does.
  - Keep **one** subscriber table (the current Email tab's shared grid), with its existing
    channel-picker dropdown (Email/WhatsApp) per row — this is already the single real, functional
    path for both channels; there is no need for two separate tables once this move happens.
  - Remove the "Live" badge inconsistency and replace it with an honest status line reflecting
    reality: WhatsApp subscriptions can be added and saved right now (functional), but delivery itself
    is dormant until Meta credentials exist — word it like the Contacts tab's existing "not connected
    yet" banner, not as a fake "Live" claim.
  - Keep the digest preview button (`previewDigest()`/`renderWhatsAppSample()`) — it already works and
    is genuinely useful for confirming what a subscriber will receive.

## Part 2b — "Announcements" tab: fold in the broadcast compose screen

No new schema or RPCs at all — `create_notification`/`notify_role` already exist and already work.
- `WebPortal/modules/crm-whatsapp/js/crm_whatsapp_announcements_tab.js` (new) — the compose form and
  recent-sent list markup relocated verbatim from
  `WebPortal/modules/messaging-compose/html/messaging_compose_grid.html` /
  `.../js/messaging_compose_grid.js`, wired into the new module's tab strip the same way Part 1's
  tabs are.
- Existing `messaging.broadcast` action key already gates the send button — reuse it unchanged.

## Retire the two old screens

- `WebPortal/index.html`: remove the `<li data-route="scheduled-reports-grid">` and
  `<li data-route="messaging-compose-grid">` sidebar items entirely.
- `WebPortal/js/role-menu-config.js`: remove `'scheduled-reports-grid'` and
  `'messaging-compose-grid'` from every role's `menus` array and from `menuStructure`/
  `portalModuleOrder`.
- **Do not delete** `WebPortal/modules/scheduled-reports/` or `WebPortal/modules/messaging-compose/`
  files, their routes in `appRouteConfig.json`, or any of their RPCs — only remove them from
  navigation. Their functionality now lives in the new tabs, which call the same underlying RPCs;
  deleting the old module files risks breaking something that still references them and buys nothing
  the nav removal doesn't already achieve.

## Registration touchpoints for the two new tabs

- `WebPortal/js/appRouteConfig.json`: add `"js/crm_whatsapp_reports_tab.js"` and
  `"js/crm_whatsapp_announcements_tab.js"` to the existing `"crm-whatsapp-grid"` entry's `js` array
  (same multi-file-route pattern already in use).
- `crm_whatsapp_grid.html`/`.js`: add two more tab buttons and `switchTab()` branches, following the
  exact pattern Part 1 used for "Contacts"/"Internal".

## Effort estimate

| Task | Est. |
|---|---|
| Schema: `chat_report_recipients` + CHECK constraint alter + 4 RPCs (Reports tab) | 1.5 days |
| Reports tab UI: digest preview/edit, contact multi-select, send-now loop, status list | 2.5 days |
| Relocate + fix subscriber management: drop the dead disabled WhatsApp sub-form, keep the one working channel-picker table, replace the stale "Live" badge with an honest status line | 1.5 days |
| Announcements tab: relocate broadcast compose UI, wire into shell | 1 day |
| Remove old nav items (index.html, role-menu-config.js) | 0.5 day |
| Action-key seeding (`messaging.report.send`) | 0.25 day |
| User guide + QA | 0.75 day |
| **Total** | **~8 days** |

## Open items to flag back to the client (not blocking the start of the build)

- Email digest subscriber management is being relocated into the new "Reports" tab alongside
  WhatsApp — not deleted, not changed in behavior, just moved so there's genuinely one screen left.
- Who can send the configurable report — defaulted to the same roles as WhatsApp-contact messaging
  (roles with CRM access); not explicitly specified by the client.
- Still no live Meta credentials — every WhatsApp send in the new Reports tab degrades to
  `not_connected` exactly like the Contacts tab already does.

## Verification

Open the Reports tab; confirm the digest preview text matches what the old Scheduled Reports preview
showed; select two contacts with phone numbers and one without; send; confirm two
`chat_report_recipients` rows are created (`queued`→`not_connected`, no live secrets) and the one
without a phone number was silently skipped, not attempted. Confirm the relocated subscriber table
has exactly one working form (no disabled dead WhatsApp-only inputs left over), that a WhatsApp-channel
row can actually be added and saved from it, and that the status line honestly says delivery is
dormant rather than showing a "Live" badge. Open the Announcements tab; send a broadcast to a role;
confirm it still lands in the recipient's notification bell exactly as it did on the old Send Message
screen. Confirm "Scheduled Reports" and "Send Message" no longer appear anywhere in the sidebar for
any role.
