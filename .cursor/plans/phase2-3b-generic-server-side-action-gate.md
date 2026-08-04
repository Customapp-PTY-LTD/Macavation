---
depends_on: phase2-3a-staff-whatsapp-phone-identity.md
---

# A generic server-side action gate: `has_action(user_id, action_key)`

## Context

Permissions in this portal are two layers that must move together (`CLAUDE.md`):
`actions`/`role_actions` gate the buttons, `role_permissions` gates what the API will execute. The
button layer has been **UI-only** almost everywhere — `WebPortal/js/action-access.js` decides what to
render, and nothing re-checks it server-side, so a denied button does not prevent the operation.

There is exactly **one** precedent for checking an action key inside the database:
`public.chat_has_whatsapp_inbox_access(p_user_id uuid)`
(`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:116-137`). It joins
`users → role_actions → actions` and tests one hardcoded key,
`messaging.whatsapp.contact.send`, requiring `ra.value = 'true'` and `u.is_active IS TRUE`. It is
called from five RPCs in that migration (`:355`, `:437`, `:486`, `:527`, `:563`).

That function proves the pattern works, but it is **single-purpose** — the action key is baked into its
body. The WhatsApp command router in the next plan has to authorise a *different* action before it
writes anything, and every future server-side check will need another key again. Copying a new
one-key function per action is how the existing drift happened.

This plan generalises it into one reusable gate. It is small on purpose: it adds a function and changes
no caller, so nothing can regress.

### What this plan does NOT fix — stated plainly

`chat_has_whatsapp_inbox_access` takes the user id it checks as a **caller-supplied parameter**, and
the browser calls RPCs as `anon` (`WebPortal/js/data-functions.js` hardcodes `useAnonAuth: true`, noted
at `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:28-29`). So anyone holding the public
anon key that ships in the browser can pass an arbitrary UUID and read the shared inbox. **The new
function inherits that same shape and does not close that hole.**

That is deliberate, and safe for its intended caller: the WhatsApp router runs as `service_role` and
derives the user id from a *verified phone number* via `whatsapp_resolve_staff_user`, never from
client input. Closing the browser-side hole needs an additive session-token parameter on those five
RPCs plus a front-end change plus a deprecation pass — a separate plan
(`phase2-3g-close-browser-action-gate-spoofing.md`), because it is a pre-existing issue independent of
this chain, and bundling it here would make both harder to review.

**So: `has_action` is `service_role` only.** The grant is the control that keeps this honest.

## Scope

**In:** one new function plus its grants.

**Out:** the five existing call sites are **not** touched. `chat_has_whatsapp_inbox_access` keeps
working exactly as today. No caller changes, so this migration is inert until the next plan uses it.

**Out:** any front-end change. Out: applying the migration.

## Work

### `migrations/20260815110000_generic_has_action_gate.sql`

**`public.has_action(p_user_id uuid, p_action_key text) RETURNS boolean`** —
`LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions`, mirroring
`chat_has_whatsapp_inbox_access` exactly except that the key is a parameter.

Semantics, all three of which matter and must match the existing function:

- Return **false** when `p_user_id IS NULL` or `p_action_key` is null/blank — fail closed, never throw.
  A gate that raises on bad input becomes a denial-of-service on the caller.
- Require `u.is_active IS TRUE`. A deactivated user holds no actions.
- Require `COALESCE(ra.value, '') = 'true'`. `role_actions.value` is text, and anything other than the
  exact string `'true'` is a deny. Do not loosen this to a truthy test.

```sql
    RETURN EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.role_actions ra ON ra.role_id = u.role_id
        JOIN public.actions a ON a.id = ra.action_id
        WHERE u.id = p_user_id
          AND u.is_active IS TRUE
          AND a.key = p_action_key
          AND COALESCE(ra.value, '') = 'true'
    );
```

**Do not add a `super_user`/`admin` bypass.** `WebPortal/js/action-access.js` hard-codes those two roles
as always-allowed in the *front end*, and it is tempting to mirror that here. Do not: a server-side gate
whose answer depends on role *name* rather than on a granted action is exactly the coupling that makes
the two layers drift apart. If `super_user` should hold an action, that belongs in `role_actions` as
data, where it is visible and auditable. Note this reasoning in the function comment so nobody "fixes"
it later.

**Grants:**

```sql
REVOKE ALL ON FUNCTION public.has_action(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_action(uuid, text) TO service_role;
```

The function comment must state why: the browser calls as `anon`, so a gate that both accepts a
caller-supplied user id **and** is reachable from `anon` is not a gate at all. Only trusted
service_role callers that derive the user id server-side may use it.

Follow `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` for the `role_permissions` bookkeeping, but **grant it to
no role** — it is not callable from the portal. Do not follow the `docs/RBAC_GUIDE.md` pattern of
granting a new function to every role; `CLAUDE.md` records that pattern as the cause of the current
drift.

End with `NOTIFY pgrst, 'reload schema';`.

## Guardrails

- **You cannot apply this migration.** No database credential or network path to a database exists here.
  Author the file; a human applies it with `npm run db:apply -- migrations/<file>.sql`. Do not treat
  "unapplied" as a failure.
- **Forward-only.** Do not edit `20260813090000_whatsapp_inbound_shared_inbox.sql` or any other applied
  migration.
- **Do not modify `chat_has_whatsapp_inbox_access`**, and do not re-point any of its five call sites at
  the new function. That refactor belongs with the browser-spoofing plan, which has to change those
  signatures anyway; doing it here would collide.
- **Do not grant `has_action` to `anon` or `authenticated`.**
- **Do not add a role-name bypass** for `super_user`, `admin`, or anything else.
- Do not touch any file under `WebPortal/` or `supabase/functions/`. This plan is one `.sql` file.
- Do not add an npm dependency; do not weaken `npm run test:fleet`.

## Acceptance criteria

1. Exactly one new file, `migrations/20260815110000_generic_has_action_gate.sql`, and **no other file in
   the repo is modified**. `git diff --stat` lists one path.
2. It defines `public.has_action(p_user_id uuid, p_action_key text) RETURNS boolean` as
   `STABLE SECURITY DEFINER` with `SET search_path`.
3. It returns false rather than raising when `p_user_id` is NULL or the key is blank.
4. The `EXISTS` body checks `u.is_active IS TRUE` and `COALESCE(ra.value, '') = 'true'`.
5. **Grep-checkable:** the file contains `GRANT EXECUTE ON FUNCTION public.has_action(uuid, text) TO service_role`
   and contains no `GRANT` of `has_action` to `anon`, `authenticated`, or `PUBLIC`.
6. **Grep-checkable:** the file contains no occurrence of `super_user` or `'admin'` — no role-name
   bypass.
7. The function comment states that it is service_role-only because the browser calls as `anon`, and
   states why there is no role-name bypass.
8. `grep -c "CREATE OR REPLACE FUNCTION" ` on the file returns 1 — it creates one function and replaces
   nothing else.
9. The file ends with `NOTIFY pgrst, 'reload schema';`.
10. `npm run test:fleet` passes, including `migrations:verify` — so the prefix must be unique and a valid
    timestamp.
