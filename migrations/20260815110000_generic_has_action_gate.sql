-- Generic server-side action gate: public.has_action(p_user_id, p_action_key).
--
-- Permissions in this portal are two layers that must move together (CLAUDE.md):
-- actions/role_actions gate the buttons (WebPortal/js/action-access.js decides what to
-- render), role_permissions gates what the API will execute. The button layer is
-- UI-only almost everywhere: nothing re-checks it server-side, so a denied button does
-- not prevent the operation.
--
-- The only existing precedent for checking an action key inside the database is
-- public.chat_has_whatsapp_inbox_access(p_user_id uuid), added in
-- 20260813090000_whatsapp_inbound_shared_inbox.sql. It proves the pattern works but is
-- single-purpose: the action key ('messaging.whatsapp.contact.send') is hardcoded in
-- its body, so every future server-side check would need another copy of the same
-- function with a different key baked in. That is exactly the kind of drift CLAUDE.md
-- already records for role_permissions.
--
-- This migration generalises the pattern into one reusable gate. It is additive only:
-- it adds one function and changes no existing caller. chat_has_whatsapp_inbox_access
-- keeps working exactly as today and is NOT re-pointed at this function here — that
-- refactor, if it happens at all, belongs with whichever plan next needs to touch those
-- five call sites, not this one.
--
-- SECURITY NOTE — what this does NOT fix. chat_has_whatsapp_inbox_access takes the user
-- id it checks as a caller-supplied parameter, and the browser calls RPCs as anon
-- (WebPortal/js/data-functions.js hardcodes useAnonAuth: true). So anyone holding the
-- public anon key can pass an arbitrary UUID into a function shaped like this one. This
-- function inherits that exact same shape and does not close that hole — it is safe
-- only because it is granted to service_role alone, never to anon or authenticated.
-- Trusted service_role callers (e.g. a WhatsApp command router) must derive the user id
-- server-side (e.g. from a verified phone number), never from client input, before
-- calling this. Closing the equivalent hole for the five existing whatsapp RPCs is a
-- separate, later concern and is intentionally out of scope here.
--
-- Deliberately NO always-allowed-role bypass. The front-end button layer
-- (WebPortal/js/action-access.js) hardcodes a couple of role names as always-allowed,
-- and it is tempting to mirror that here. Do not: a server-side gate whose answer
-- depends on role NAME rather than on a granted action is exactly the coupling that let
-- the button layer and the API layer drift apart (see CLAUDE.md's role_permissions
-- note). If any role should hold an action, grant it in role_actions as data, where it
-- is visible and auditable.

CREATE OR REPLACE FUNCTION public.has_action(
    p_user_id    uuid DEFAULT NULL,
    p_action_key text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Fail closed on bad input, never throw: a gate that raises on a null/blank
    -- argument becomes a denial-of-service on every caller that passes one.
    IF p_user_id IS NULL OR NULLIF(btrim(COALESCE(p_action_key, '')), '') IS NULL THEN
        RETURN false;
    END IF;

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
END;
$$;

COMMENT ON FUNCTION public.has_action(uuid, text) IS
    'Generic server-side action gate: true when the active user''s role holds action_key '
    'with role_actions.value = ''true''. service_role ONLY - the browser calls RPCs as '
    'anon (WebPortal/js/data-functions.js useAnonAuth: true), and this function accepts a '
    'caller-supplied user id, so a caller reachable from anon could pass an arbitrary '
    'UUID. Only a trusted service_role caller that derives p_user_id itself (never from '
    'client input) may use this. Deliberately has NO always-allowed-role bypass: a '
    'server-side gate keyed on role NAME rather than on a granted action is the coupling '
    'that let the button layer (action-access.js) and the API layer (role_permissions) '
    'drift apart - see CLAUDE.md. Grant any such role the action in role_actions instead.';

-- role_permissions: this repo's second (largely vestigial, Lambda-proxy-era) RBAC
-- layer. Per docs/RBAC_NEW_FUNCTION_CHECKLIST.md every new function gets a row here -
-- but this function is not callable from the portal at all (see grants below), so it is
-- granted to NO role. Do not follow the docs/RBAC_GUIDE.md pattern of granting a new
-- function to every role; CLAUDE.md records that pattern as the cause of the current
-- drift between role_actions and role_permissions.

REVOKE ALL ON FUNCTION public.has_action(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_action(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
