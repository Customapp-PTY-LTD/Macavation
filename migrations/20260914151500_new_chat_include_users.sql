-- ============================================================================
-- WhatsApp "New chat" picker: include portal Users, not only CRM Contacts.
--
-- WHY: get_contacts_for_messaging() (20260812100000) only ever read
-- public.contacts. A staff member with a WhatsApp number on file in
-- Users & Access (public.users.whatsapp_phone, the verified identity from
-- 20260815100000, or the unverified public.users.mobile_number from
-- 20260828120000) could never be picked from "New chat" - only external CRM
-- contacts could. This adds users as a second, clearly-tagged source in the
-- same picker and lets a conversation be started with one directly, mirroring
-- chat_start_contact_conversation's phone-normalisation logic.
--
-- chat_conversations already distinguishes 'internal' (staff-to-staff, no
-- WhatsApp) from 'whatsapp_contact' (external, over WhatsApp) conversations.
-- This is deliberately still a 'whatsapp_contact' conversation - the point is
-- to WhatsApp-message a colleague's phone, not to open the existing internal
-- chat - so it needs its own target column alongside contact_id rather than
-- reusing either existing type.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. SCHEMA -------------------------------------------------------------------

ALTER TABLE public.chat_conversations
    ADD COLUMN IF NOT EXISTS target_user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_chat_conversations_target_user ON public.chat_conversations (target_user_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_chat_conversations_one_target'
    ) THEN
        ALTER TABLE public.chat_conversations
            ADD CONSTRAINT ck_chat_conversations_one_target
            CHECK (contact_id IS NULL OR target_user_id IS NULL);
    END IF;
END $$;

-- 2. get_contacts_for_messaging: union in active users --------------------
-- p_current_user_id excludes the caller from the user half of the list (you
-- cannot WhatsApp-message yourself); NULL (the old zero-arg call shape)
-- applies no exclusion, so nothing already calling this without the new
-- argument breaks.
DROP FUNCTION IF EXISTS public.get_contacts_for_messaging();
CREATE FUNCTION public.get_contacts_for_messaging(p_current_user_id uuid DEFAULT NULL)
RETURNS TABLE (
    id                     uuid,
    source_type            text,
    contact_type           character varying,
    company_name           character varying,
    primary_contact_name   character varying,
    primary_contact_phone  character varying,
    primary_contact_mobile character varying
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        'contact'::text,
        c.contact_type,
        c.company_name,
        c.primary_contact_name,
        c.primary_contact_phone,
        c.primary_contact_mobile
    FROM public.contacts c
    WHERE c.status IS DISTINCT FROM 'inactive'

    UNION ALL

    SELECT
        u.id,
        'user'::text,
        NULL::character varying,
        NULL::character varying,
        NULLIF(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')::character varying,
        NULL::character varying,
        COALESCE(u.whatsapp_phone, u.mobile_number)::character varying
    FROM public.users u
    WHERE u.is_active IS TRUE
      AND (p_current_user_id IS NULL OR u.id <> p_current_user_id)

    ORDER BY COALESCE(company_name, primary_contact_name);
END;
$$;

-- 3. chat_start_user_conversation: find/create a WhatsApp conversation
--    targeting a portal user's own number instead of a CRM contact's.
DROP FUNCTION IF EXISTS public.chat_start_user_conversation(uuid, uuid);
CREATE FUNCTION public.chat_start_user_conversation(
    p_target_user_id uuid DEFAULT NULL,
    p_created_by     uuid DEFAULT NULL
)
RETURNS TABLE (
    success         int,
    error           text,
    conversation_id uuid,
    created         boolean,
    resolved_phone  text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_conv_id   uuid;
    v_created   boolean := false;
    v_phone     text;
    v_raw_phone text;
BEGIN
    IF p_target_user_id IS NULL OR p_created_by IS NULL THEN
        RETURN QUERY SELECT 0, 'p_target_user_id and p_created_by are required.', NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    IF p_target_user_id = p_created_by THEN
        RETURN QUERY SELECT 0, 'Cannot start a WhatsApp chat with yourself.', NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    -- Prefer the verified WhatsApp identity over the admin-typed mobile number.
    SELECT COALESCE(u.whatsapp_phone, u.mobile_number)
    INTO v_raw_phone
    FROM public.users u
    WHERE u.id = p_target_user_id;

    -- Reuse the existing guarded normaliser (20260813090000) rather than inlining
    -- another copy of the same regex - see scripts/verify-report-whatsapp-parity.mjs,
    -- which pins exactly which files are allowed to contain it.
    v_phone := public.chat_normalize_phone(v_raw_phone);
    IF v_phone IS NULL THEN
        RETURN QUERY SELECT 0, 'This user has no WhatsApp number on file.', NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    SELECT c.conversation_id INTO v_conv_id
    FROM public.chat_conversations c
    WHERE c.conversation_type = 'whatsapp_contact'
      AND c.target_user_id = p_target_user_id
      AND c.is_archived = false
    LIMIT 1;

    IF v_conv_id IS NULL THEN
        INSERT INTO public.chat_conversations (conversation_type, target_user_id, external_phone, created_by, created_at, last_message_at)
        VALUES ('whatsapp_contact', p_target_user_id, v_phone, p_created_by, now(), now())
        RETURNING conversation_id INTO v_conv_id;

        INSERT INTO public.chat_participants (conversation_id, user_id, joined_at)
        VALUES (v_conv_id, p_created_by, now());

        v_created := true;
    ELSE
        INSERT INTO public.chat_participants (conversation_id, user_id, joined_at)
        VALUES (v_conv_id, p_created_by, now())
        ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;

    RETURN QUERY SELECT 1, NULL::text, v_conv_id, v_created, v_phone;
END;
$$;

-- 4. chat_list_whatsapp_conversations: recognise target_user_id conversations
--    both for the display name and for the "not a saved CRM contact" flag,
--    which must NOT fire just because a user-started conversation has no
--    contact_id.
DROP FUNCTION IF EXISTS public.chat_list_whatsapp_conversations(uuid);
CREATE FUNCTION public.chat_list_whatsapp_conversations(
    p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    success            int,
    error              text,
    conversation_id    uuid,
    conversation_type  text,
    contact_id         uuid,
    target_user_id     uuid,
    external_phone     text,
    profile_name       text,
    other_party_name   text,
    last_message_at    timestamptz,
    last_message_body  text,
    last_message_direction text,
    unread_count       bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    IF p_user_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_user_id is required.', NULL::uuid, NULL::text, NULL::uuid, NULL::uuid,
                            NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text,
                            NULL::text, NULL::bigint;
        RETURN;
    END IF;

    IF NOT public.chat_has_whatsapp_inbox_access(p_user_id) THEN
        -- Empty result, not an error — matches chat_list_messages' idiom for "no access".
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        1,
        NULL::text,
        c.conversation_id,
        c.conversation_type,
        c.contact_id,
        c.target_user_id,
        c.external_phone,
        c.profile_name,
        -- Display label falls back: contact name -> target user's own name ->
        -- WhatsApp profile name -> phone. Never blank and never a bare 'Contact'.
        COALESCE(
            NULLIF(btrim(COALESCE(ct.company_name, '')), ''),
            NULLIF(btrim(COALESCE(ct.primary_contact_name, '')), ''),
            NULLIF(btrim(COALESCE(ut.first_name, '') || ' ' || COALESCE(ut.last_name, '')), ''),
            NULLIF(btrim(COALESCE(c.profile_name, '')), ''),
            public.chat_format_phone(c.external_phone),
            'Unknown number'
        ),
        c.last_message_at,
        (SELECT m.body FROM public.chat_messages m
          WHERE m.conversation_id = c.conversation_id ORDER BY m.message_id DESC LIMIT 1),
        (SELECT m.direction FROM public.chat_messages m
          WHERE m.conversation_id = c.conversation_id ORDER BY m.message_id DESC LIMIT 1),
        -- NULL-safe unread: inbound messages have sender_user_id NULL, so the existing
        -- `sender_user_id <> p_user_id` idiom evaluates NULL and silently drops every
        -- one of them. Count inbound messages with no read row for this user instead.
        (
            SELECT COUNT(*)
            FROM public.chat_messages m
            WHERE m.conversation_id = c.conversation_id
              AND m.direction = 'inbound_whatsapp'
              AND NOT EXISTS (
                  SELECT 1 FROM public.chat_message_reads r
                  WHERE r.message_id = m.message_id AND r.user_id = p_user_id
              )
        )
    FROM public.chat_conversations c
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id
    LEFT JOIN public.users ut ON ut.id = c.target_user_id
    WHERE c.conversation_type = 'whatsapp_contact'
      AND c.is_archived = false
    ORDER BY c.last_message_at DESC;
END;
$$;

-- 5. role_permissions: this repo's second (largely vestigial, Lambda-proxy-era)
-- RBAC layer. Every migration still seeds it for new functions, so this one
-- does too. get_contacts_for_messaging and chat_list_whatsapp_conversations
-- keep their existing rows (name-keyed, not signature-keyed); only the new
-- function needs a fresh row.
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'chat_start_user_conversation', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

-- 6. GRANTS -------------------------------------------------------------------

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'get_contacts_for_messaging(uuid)',
        'chat_start_user_conversation(uuid,uuid)',
        'chat_list_whatsapp_conversations(uuid)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
