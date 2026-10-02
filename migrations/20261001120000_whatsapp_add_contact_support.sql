-- WhatsApp: add a CRM contact with /contact (guided questions).
--
-- WHY: the staff WhatsApp line (supabase/functions/whatsapp-inbound/index.ts) can already read
-- the business today (the main menu) and apply exactly one write (the "Stop everything" /
-- ACK <n> staged flows), but it cannot do the thing a field rep most often needs on their phone:
-- capture a new CRM contact on the spot, the way the portal's "Add contact" modal
-- (WebPortal/modules/modals/modal-crm-contact/html/modal_crm_contact.html) already does. This
-- adds the two RPCs the guided /contact flow needs; the flow itself (the state machine, the
-- questions, the YES/NO confirm) lives entirely in the edge function — see that file's ADD
-- CONTACT section for the rest of this feature.
--
-- Two new RPCs, service_role ONLY, same reasoning as every other WhatsApp RPC in this repo
-- (see migrations/20260815130000_whatsapp_pending_commands.sql's own header): PostgREST is
-- always called as anon from the browser, so anything granted to anon/authenticated is reachable
-- by anyone holding the public anon key, and a caller-supplied p_user_id is client-asserted, not
-- authenticated.
--
-- 1. whatsapp_peek_pending_command — a READ-ONLY sibling of whatsapp_take_pending_command
--    (20260815130000). The draft state machine needs to know WITHOUT consuming the row: is there
--    still a live ADD_CONTACT_DRAFT for this phone+user, and if so, what step is it on? Taking
--    (deleting) it just to look would discard the draft on every single typed answer. Mirrors
--    whatsapp_take_pending_command's body exactly, with SELECT in place of
--    DELETE ... RETURNING, and the same phone/user_id/expires_at > now() match.
--
-- 2. whatsapp_find_contacts_by_company — the "does this company already exist?" check the
--    company-name step runs before moving on, so staff do not accidentally create a duplicate
--    contact they could have found and used instead. A narrow, case-insensitive EXACT match
--    (not fuzzy/substring): a false positive here would block a legitimate new contact whose
--    name merely resembles an existing one, which is worse than occasionally missing a near-
--    duplicate. Returns at most 5 rows, deleted_at IS NULL only (soft-deleted contacts do not
--    count as existing).
--
-- create_contact_simple's service_role grant is NOT added here — it already exists, on the exact
-- 26-param signature this migration's companion edge-function code calls
-- (migrations/20260818090000_create_contact_simple_accepts_supplier_number.sql:125-129, carried
-- forward unchanged by 20260818090200). Re-granting it here would be a harmless no-op, but adding
-- it only if it were missing is what was asked for, and it is not missing.
--
-- OUT OF SCOPE (see the plan): applying this migration (a human runs
-- `npm run db:apply -- migrations/<this file>.sql`) and deploying the edge function.

-- ============================================================================
-- 1. whatsapp_peek_pending_command — service_role only. Read-only lookup, no delete.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_peek_pending_command(
    p_phone   text DEFAULT NULL,
    p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_phone text;
    v_row   record;
BEGIN
    v_phone := public.chat_normalize_phone(p_phone);
    IF v_phone IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Nothing pending.');
    END IF;

    SELECT command, payload, summary
      INTO v_row
      FROM public.whatsapp_pending_commands
     WHERE phone = v_phone
       AND user_id = p_user_id
       AND expires_at > now();

    IF v_row.command IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Nothing pending.');
    END IF;

    RETURN jsonb_build_object(
        'success', 1,
        'command', v_row.command,
        'payload', v_row.payload,
        'summary', v_row.summary
    );
END;
$$;

COMMENT ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) IS
    'SERVER-SIDE ONLY (service_role) — read-only sibling of whatsapp_take_pending_command. Used by the /contact draft state machine to check whether a draft is still live, and read its current step, WITHOUT consuming (deleting) it. Same phone/user_id/expires_at > now() match.';

-- ============================================================================
-- 2. whatsapp_find_contacts_by_company — service_role only. Duplicate-company check.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_find_contacts_by_company(
    p_company_name text DEFAULT NULL
)
RETURNS TABLE (
    id           uuid,
    company_name character varying,
    contact_type character varying
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT c.id, c.company_name, c.contact_type
    FROM public.contacts c
    WHERE c.deleted_at IS NULL
      AND lower(btrim(c.company_name)) = lower(btrim(p_company_name))
    ORDER BY c.created_at DESC
    LIMIT 5;
END;
$$;

COMMENT ON FUNCTION public.whatsapp_find_contacts_by_company(text) IS
    'SERVER-SIDE ONLY (service_role) — exact (case-insensitive, trimmed) company-name match, deleted_at IS NULL only, capped at 5 rows. Used by the /contact guided flow''s company-name step to warn staff before they create a contact that may already exist. Deliberately NOT fuzzy/substring: a false positive here would block a legitimate new contact.';

-- ============================================================================
-- 3. role_permissions seed — convention only, NOT the access control (see
--    20260815100000_staff_whatsapp_identity.sql header (d) and CLAUDE.md). super_user and admin
--    only — deliberately not every role.
-- ============================================================================

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_role_name text;
    v_full_access_roles text[] := ARRAY['super_user', 'admin'];
    v_fns text[] := ARRAY[
        'whatsapp_peek_pending_command', 'whatsapp_find_contacts_by_company'
    ];
BEGIN
    FOREACH v_role_name IN ARRAY v_full_access_roles
    LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_role_name;
        IF v_role_id IS NOT NULL THEN
            FOREACH v_fn IN ARRAY v_fns
            LOOP
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 4. GRANTS — service_role only. Never anon, never authenticated, never PUBLIC.
-- ============================================================================

REVOKE ALL ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_peek_pending_command(text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_find_contacts_by_company(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_find_contacts_by_company(text) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_find_contacts_by_company(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_find_contacts_by_company(text) TO service_role;

NOTIFY pgrst, 'reload schema';
