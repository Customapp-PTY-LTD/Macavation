# Close the shared-inbox spoofing hole: derive the user from the session, not the request

## Context

The WhatsApp shared inbox is gated by `public.chat_has_whatsapp_inbox_access(p_user_id uuid)`
(`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:116-137`), which checks that the user's
role holds the `messaging.whatsapp.contact.send` action. It is called from five RPCs in that migration:
`chat_list_whatsapp_conversations` (`:355`), `chat_list_whatsapp_messages` (`:437`),
`chat_mark_whatsapp_read` (`:486`), `chat_join_whatsapp_conversation` (`:527`), and
`chat_get_whatsapp_unread_count` (`:563`).

**The user id it checks is supplied by the caller**, and the browser calls RPCs as `anon` — 
`WebPortal/js/data-functions.js` hardcodes `useAnonAuth: true`, a fact the migration's own header
records at `:28-29`. So anyone holding the public anon key that ships in every browser can pass an
arbitrary UUID and read the shared WhatsApp inbox, which by design carries **every** customer
conversation on the line (`:14-18`). The gate reads as enforcement but checks a value the attacker
chooses.

This is pre-existing and independent of the WhatsApp command work — the command router derives its user
id server-side from a verified phone under `service_role`, so it is unaffected. This plan fixes the
browser path.

### Why this cannot be a one-step change

There is no Postgres session to read: no `auth.uid()`, because the browser is `anon`. Identity in this
portal is a **session token** minted at login and validated by
`public.assistant_validate_session(p_token)` — the mechanism
`supabase/functions/send-whatsapp-message/index.ts:46-63` already uses, and which
`migrations/20260716160000_portal_assistant_chat.sql` defines.

Switching the five RPCs to take a token instead of a user id would be a **breaking signature change**,
and `dev` deploys on merge *before* a human applies the migration — so a front end calling the new shape
against the old function, or vice versa, breaks the inbox. The fix therefore has to be additive and
tolerate both shapes for one release.

**This plan closes the hole for anyone using the portal, but does not remove the old path.** A
follow-up must delete the legacy parameter once the logs show nothing using it. Do not claim the
vulnerability is fully closed while the fallback exists — say so in the migration comment.

## Scope

**In:** an additive `p_session_token` parameter on the five RPCs, resolved server-side; the front end
switched to pass it; the legacy `p_user_id` path retained but deprecated.

**Out:** removing the legacy path (a later plan, once usage is confirmed zero).

**Out:** `public.has_action(uuid, text)` — that function is `service_role` only and unreachable from the
browser, so it is not affected. Do not change it.

**Out:** applying the migration.

## Work

### 1. `migrations/20260815150000_shared_inbox_session_auth.sql`

**A resolver:** `public.chat_user_from_session(p_token text) RETURNS uuid` — `SECURITY DEFINER`,
`STABLE`. Returns the active user id for a valid, unexpired token, else NULL. Implement it by selecting
through the same session table `assistant_validate_session` reads; **read that function's body first**
(`migrations/20260716160000_portal_assistant_chat.sql`) and match its validity conditions exactly —
expiry and active-user checks included. Do not invent a second notion of a valid session. Return NULL
rather than raising on a bad token.

**Then `CREATE OR REPLACE` each of the five RPCs**, adding `p_session_token text DEFAULT NULL` as the
**last** parameter so existing positional calls keep resolving, and beginning each body with:

```sql
    IF p_session_token IS NOT NULL AND p_session_token <> '' THEN
        v_user_id := public.chat_user_from_session(p_session_token);
        IF v_user_id IS NULL THEN
            RETURN;  -- or the function's established empty/failure result
        END IF;
    ELSE
        v_user_id := p_user_id;   -- DEPRECATED legacy path, spoofable
    END IF;
```

Then use `v_user_id` everywhere the body previously used the parameter, including the
`chat_has_whatsapp_inbox_access(v_user_id)` call. Note `chat_list_whatsapp_messages` names its parameter
`p_requesting_user_id` (`:437`) — keep each function's existing parameter name; do not rename.

Two hard rules:

- **A supplied-but-invalid token must fail closed** — never fall back to `p_user_id` when a token was
  provided and did not resolve. Falling back would make the fix bypassable by sending a junk token
  alongside a chosen UUID.
- **Preserve each function's exact return shape and its no-access behaviour.** These are
  `RETURNS TABLE`/`RETURNS jsonb` functions the UI already consumes; a changed shape breaks the inbox
  more surely than the bug does. Adding a parameter with a default keeps PostgREST resolution working
  for both shapes.

Add a comment on each stating the legacy path is deprecated and spoofable, and that it must be removed
once callers are confirmed migrated. Re-grant execute exactly as the original migration did — do not
widen. End with `NOTIFY pgrst, 'reload schema';`.

### 2. `WebPortal/js/data-functions.js` — pass the token

The five wrappers for these RPCs must send `p_session_token` from the session the portal already holds.
Find how the token is read for the existing `X-Portal-Session` header path (`session.js` /
`auth-service.js`) and reuse it — do not add a second way to obtain it.

Keep passing the user id as well for this release, so a browser running against an unmigrated database
still works. Bump the `data-functions.js` cache-bust in `WebPortal/index.html`; without it the change
ships to nobody.

**Degrade gracefully:** if the RPC is the old signature (the extra parameter causes a PostgREST
resolution error, typically `PGRST202`), the inbox must keep working via the legacy path rather than
showing an error. `data-functions.js` already has an RPC-fallback allow-list near its top — follow that
existing mechanism rather than inventing a retry.

## Guardrails

- **You cannot apply this migration.** Author it; a human applies with
  `npm run db:apply -- migrations/<file>.sql`.
- **`dev` deploys before the migration is applied.** The shared inbox must remain functional in that
  window — this is the single most likely way this plan causes an outage. Verify the fallback path by
  reading it, and state in the run summary which code path runs pre-migration.
- **Never fall back to `p_user_id` when a token was supplied.**
- **Do not change any of the five functions' return shapes, parameter names, or existing parameter
  order.** New parameter goes last, with a default.
- **Do not remove the legacy `p_user_id` parameter** in this plan.
- **Do not modify `chat_has_whatsapp_inbox_access` itself**, `has_action`, `assistant_validate_session`,
  or any edge function.
- **Forward-only.** Do not edit `20260813090000_whatsapp_inbound_shared_inbox.sql` or
  `20260716160000_portal_assistant_chat.sql`.
- **Do not widen any grant.** If a function was granted to `anon`, it stays as it was — the fix is that
  the *identity* is no longer caller-supplied, not a grant change.
- Do not touch the internal 1:1 chat RPCs in `20260812100000_crm_whatsapp_module.sql`. They are
  participant-scoped and out of scope; conflating them doubles the blast radius.
- No new dependency; no `package-lock.json`; do not weaken `npm run test:fleet`.

## Acceptance criteria

1. One new migration, `migrations/20260815150000_shared_inbox_session_auth.sql`, defining
   `chat_user_from_session` and re-creating exactly the five named RPCs.
2. Each of the five gains `p_session_token text DEFAULT NULL` as its **last** parameter; no existing
   parameter is renamed, removed or reordered.
3. **Grep-checkable:** in each body, `chat_has_whatsapp_inbox_access` is called with the resolved local
   variable, not with the raw `p_user_id`/`p_requesting_user_id` parameter.
4. A supplied-but-invalid token returns the no-access result. **Grep-checkable:** no branch assigns
   `p_user_id` to the resolved variable after a token resolution has failed.
5. `chat_user_from_session` returns NULL rather than raising on an invalid token, and applies the same
   expiry/active conditions as `assistant_validate_session` — the plan's run summary names the file:line
   it matched.
6. Each function carries a comment marking the legacy path deprecated and spoofable.
7. Grants are identical to the original migration's — `git diff` shows no widened `GRANT`.
8. `data-functions.js` sends `p_session_token` on all five wrappers, reusing the existing session-token
   accessor, and still sends the user id.
9. `WebPortal/index.html`'s `data-functions.js` `?v=` value has changed.
10. The shared inbox still functions when the migration is unapplied, via the existing RPC-fallback
    mechanism.
11. `chat_has_whatsapp_inbox_access`, `has_action`, `assistant_validate_session`, all edge functions and
    all `20260812100000_crm_whatsapp_module.sql` functions are unmodified.
12. `npm run test:fleet` passes, including `ui:verify` and `migrations:verify`.
