-- WhatsApp module under CRM (Part 1 of 2) — contact conversations + internal staff chat.
--
-- Adds chat_conversations, chat_participants, chat_messages, chat_message_reads tables
-- plus RPCs for starting conversations (both internal and WhatsApp-contact), sending
-- messages, listing conversations/messages, marking read, and a narrow CRM contacts
-- read RPC for the messaging picker.
--
-- Convention: SECURITY DEFINER, SET search_path = public, extensions; RETURNS TABLE(success int, error text, ...)
-- for multi-value RPCs. RLS enabled on all four tables, service_role-only direct access;
-- all browser calls go through RPCs as role anon (data-functions.js hardcodes useAnonAuth: true).

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chat_conversations (
    conversation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_type text NOT NULL CHECK (conversation_type IN ('internal', 'whatsapp_contact')),
    contact_id        uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
    external_phone    text NULL,
    created_by        uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_message_at   timestamptz NOT NULL DEFAULT now(),
    is_archived       boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_chat_conversations_contact ON public.chat_conversations (contact_id);
CREATE INDEX IF NOT EXISTS ix_chat_conversations_last_message ON public.chat_conversations (last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_participants (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES public.chat_conversations(conversation_id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    joined_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_chat_participants_user ON public.chat_participants (user_id);
CREATE INDEX IF NOT EXISTS ix_chat_participants_conversation ON public.chat_participants (conversation_id);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    message_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id      uuid NOT NULL REFERENCES public.chat_conversations(conversation_id) ON DELETE CASCADE,
    sender_user_id       uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
    direction            text NOT NULL DEFAULT 'internal'
                         CHECK (direction IN ('internal', 'outbound_whatsapp', 'inbound_whatsapp')),
    body                 text NOT NULL,
    external_message_id  text NULL,
    send_status          text NOT NULL DEFAULT 'sent'
                         CHECK (send_status IN ('sent', 'queued', 'not_connected', 'failed')),
    send_error           text NULL,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_chat_messages_conversation ON public.chat_messages (conversation_id, message_id);
CREATE INDEX IF NOT EXISTS ix_chat_messages_sender ON public.chat_messages (sender_user_id);

CREATE TABLE IF NOT EXISTS public.chat_message_reads (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id bigint NOT NULL REFERENCES public.chat_messages(message_id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    read_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_chat_message_reads_user ON public.chat_message_reads (user_id);
CREATE INDEX IF NOT EXISTS ix_chat_message_reads_message ON public.chat_message_reads (message_id);

-- ============================================================================
-- 2. RLS LOCKDOWN — service_role only on all four chat_* tables
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'chat_conversations', 'chat_participants', 'chat_messages', 'chat_message_reads'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
        EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END LOOP;
END;
$$;

-- ============================================================================
-- 3. RPCs
-- ============================================================================

-- chat_start_internal_conversation: find/create a 2-participant internal conversation.
DROP FUNCTION IF EXISTS public.chat_start_internal_conversation(uuid, uuid);
CREATE FUNCTION public.chat_start_internal_conversation(
    p_user_id       uuid DEFAULT NULL,
    p_other_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    success         int,
    error           text,
    conversation_id uuid,
    created         boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_conv_id uuid;
    v_created boolean := false;
BEGIN
    IF p_user_id IS NULL OR p_other_user_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_user_id and p_other_user_id are required.', NULL::uuid, false;
        RETURN;
    END IF;

    IF p_user_id = p_other_user_id THEN
        RETURN QUERY SELECT 0, 'Cannot create conversation with yourself.', NULL::uuid, false;
        RETURN;
    END IF;

    -- Find existing internal conversation with exactly these two participants
    SELECT c.conversation_id INTO v_conv_id
    FROM public.chat_conversations c
    WHERE c.conversation_type = 'internal'
      AND c.is_archived = false
      AND EXISTS (
          SELECT 1 FROM public.chat_participants p1
          WHERE p1.conversation_id = c.conversation_id AND p1.user_id = p_user_id
      )
      AND EXISTS (
          SELECT 1 FROM public.chat_participants p2
          WHERE p2.conversation_id = c.conversation_id AND p2.user_id = p_other_user_id
      )
      AND (
          SELECT COUNT(*) FROM public.chat_participants p3
          WHERE p3.conversation_id = c.conversation_id
      ) = 2
    LIMIT 1;

    IF v_conv_id IS NULL THEN
        -- Create new conversation
        INSERT INTO public.chat_conversations (conversation_type, created_by, created_at, last_message_at)
        VALUES ('internal', p_user_id, now(), now())
        RETURNING conversation_id INTO v_conv_id;

        -- Add both participants
        INSERT INTO public.chat_participants (conversation_id, user_id, joined_at)
        VALUES (v_conv_id, p_user_id, now()), (v_conv_id, p_other_user_id, now());

        v_created := true;
    END IF;

    RETURN QUERY SELECT 1, NULL::text, v_conv_id, v_created;
END;
$$;

-- chat_start_contact_conversation: find/create WhatsApp contact conversation.
DROP FUNCTION IF EXISTS public.chat_start_contact_conversation(uuid, uuid);
CREATE FUNCTION public.chat_start_contact_conversation(
    p_contact_id uuid DEFAULT NULL,
    p_created_by uuid DEFAULT NULL
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
    v_conv_id      uuid;
    v_created      boolean := false;
    v_phone        text;
    v_raw_phone    text;
    v_mobile       text;
    v_phone_field  text;
BEGIN
    IF p_contact_id IS NULL OR p_created_by IS NULL THEN
        RETURN QUERY SELECT 0, 'p_contact_id and p_created_by are required.', NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    -- Resolve phone number: coalesce(primary_contact_mobile, primary_contact_phone)
    SELECT c.primary_contact_mobile, c.primary_contact_phone
    INTO v_mobile, v_phone_field
    FROM public.contacts c
    WHERE c.id = p_contact_id AND c.deleted_at IS NULL;

    IF v_mobile IS NULL AND v_phone_field IS NULL THEN
        RETURN QUERY SELECT 0, 'Contact has no phone or mobile number on file.', NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    v_raw_phone := COALESCE(NULLIF(btrim(v_mobile), ''), NULLIF(btrim(v_phone_field), ''));

    -- Normalize phone: strip non-digits, 0→27 prefix, bare-number 27 prefix
    v_phone := regexp_replace(v_raw_phone, '\D', '', 'g');
    IF v_phone ~ '^0' THEN
        v_phone := '27' || substring(v_phone from 2);
    END IF;
    IF NOT (v_phone ~ '^27') AND length(v_phone) <= 11 THEN
        v_phone := '27' || v_phone;
    END IF;

    -- Find existing conversation for this contact
    SELECT c.conversation_id INTO v_conv_id
    FROM public.chat_conversations c
    WHERE c.conversation_type = 'whatsapp_contact'
      AND c.contact_id = p_contact_id
      AND c.is_archived = false
    LIMIT 1;

    IF v_conv_id IS NULL THEN
        -- Create new conversation
        INSERT INTO public.chat_conversations (conversation_type, contact_id, external_phone, created_by, created_at, last_message_at)
        VALUES ('whatsapp_contact', p_contact_id, v_phone, p_created_by, now(), now())
        RETURNING conversation_id INTO v_conv_id;

        -- Add only the staff member as participant (contact is external)
        INSERT INTO public.chat_participants (conversation_id, user_id, joined_at)
        VALUES (v_conv_id, p_created_by, now());

        v_created := true;
    ELSE
        -- Ensure this user is a participant (idempotent)
        INSERT INTO public.chat_participants (conversation_id, user_id, joined_at)
        VALUES (v_conv_id, p_created_by, now())
        ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;

    RETURN QUERY SELECT 1, NULL::text, v_conv_id, v_created, v_phone;
END;
$$;

-- chat_send_message: insert a message (validates sender is participant).
DROP FUNCTION IF EXISTS public.chat_send_message(uuid, uuid, text, text, text, text, text);
CREATE FUNCTION public.chat_send_message(
    p_conversation_id      uuid DEFAULT NULL,
    p_sender_user_id       uuid DEFAULT NULL,
    p_body                 text DEFAULT NULL,
    p_direction            text DEFAULT 'internal',
    p_send_status          text DEFAULT 'sent',
    p_external_message_id  text DEFAULT NULL,
    p_send_error           text DEFAULT NULL
)
RETURNS TABLE (
    success    int,
    error      text,
    message_id bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_mid bigint;
BEGIN
    IF p_conversation_id IS NULL OR p_sender_user_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_conversation_id and p_sender_user_id are required.', NULL::bigint;
        RETURN;
    END IF;

    IF NULLIF(btrim(COALESCE(p_body, '')), '') IS NULL THEN
        RETURN QUERY SELECT 0, 'p_body is required.', NULL::bigint;
        RETURN;
    END IF;

    -- Validate sender is a participant (this check IS the access control)
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_participants
        WHERE conversation_id = p_conversation_id AND user_id = p_sender_user_id
    ) THEN
        RETURN QUERY SELECT 0, 'Sender is not a participant in this conversation.', NULL::bigint;
        RETURN;
    END IF;

    -- Insert message
    INSERT INTO public.chat_messages (conversation_id, sender_user_id, direction, body, external_message_id, send_status, send_error, created_at)
    VALUES (p_conversation_id, p_sender_user_id, p_direction, p_body, p_external_message_id, p_send_status, p_send_error, now())
    RETURNING chat_messages.message_id INTO v_mid;

    -- Update conversation last_message_at
    UPDATE public.chat_conversations
    SET last_message_at = now()
    WHERE conversation_id = p_conversation_id;

    -- Auto-mark sender's own message read
    INSERT INTO public.chat_message_reads (message_id, user_id, read_at)
    VALUES (v_mid, p_sender_user_id, now())
    ON CONFLICT (message_id, user_id) DO NOTHING;

    RETURN QUERY SELECT 1, NULL::text, v_mid;
END;
$$;

-- chat_update_message_send_result: stamp send result back onto a message.
DROP FUNCTION IF EXISTS public.chat_update_message_send_result(bigint, text, text, text);
CREATE FUNCTION public.chat_update_message_send_result(
    p_message_id          bigint DEFAULT NULL,
    p_send_status         text   DEFAULT NULL,
    p_external_message_id text   DEFAULT NULL,
    p_send_error          text   DEFAULT NULL
)
RETURNS TABLE (success int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    IF p_message_id IS NULL OR p_send_status IS NULL THEN
        RETURN QUERY SELECT 0, 'p_message_id and p_send_status are required.';
        RETURN;
    END IF;

    UPDATE public.chat_messages
    SET send_status = p_send_status,
        external_message_id = COALESCE(p_external_message_id, external_message_id),
        send_error = COALESCE(p_send_error, send_error)
    WHERE message_id = p_message_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Message not found.';
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- chat_list_conversations: list conversations for a user with unread count and preview.
DROP FUNCTION IF EXISTS public.chat_list_conversations(uuid, text);
CREATE FUNCTION public.chat_list_conversations(
    p_user_id          uuid DEFAULT NULL,
    p_conversation_type text DEFAULT NULL
)
RETURNS TABLE (
    success            int,
    error              text,
    conversation_id    uuid,
    conversation_type  text,
    contact_id         uuid,
    other_party_name   text,
    last_message_at    timestamptz,
    last_message_body  text,
    unread_count       bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    IF p_user_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_user_id is required.', NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, NULL::bigint;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        1,
        NULL::text,
        c.conversation_id,
        c.conversation_type,
        c.contact_id,
        CASE
            WHEN c.conversation_type = 'whatsapp_contact' THEN COALESCE(ct.company_name, ct.primary_contact_name, 'Contact')
            WHEN c.conversation_type = 'internal' THEN (
                SELECT COALESCE(u.first_name || ' ' || u.last_name, u.email, 'User')
                FROM public.chat_participants p
                JOIN public.users u ON u.id = p.user_id
                WHERE p.conversation_id = c.conversation_id AND p.user_id <> p_user_id
                LIMIT 1
            )
            ELSE 'Unknown'
        END,
        c.last_message_at,
        (SELECT m.body FROM public.chat_messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.message_id DESC LIMIT 1),
        (
            SELECT COUNT(*)
            FROM public.chat_messages m
            WHERE m.conversation_id = c.conversation_id
              AND m.sender_user_id <> p_user_id
              AND NOT EXISTS (
                  SELECT 1 FROM public.chat_message_reads r
                  WHERE r.message_id = m.message_id AND r.user_id = p_user_id
              )
        )
    FROM public.chat_conversations c
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id
    WHERE c.is_archived = false
      AND EXISTS (
          SELECT 1 FROM public.chat_participants p
          WHERE p.conversation_id = c.conversation_id AND p.user_id = p_user_id
      )
      AND (p_conversation_type IS NULL OR c.conversation_type = p_conversation_type)
    ORDER BY c.last_message_at DESC;
END;
$$;

-- chat_list_messages: list messages in a conversation (validates requester is participant).
DROP FUNCTION IF EXISTS public.chat_list_messages(uuid, uuid, int);
CREATE FUNCTION public.chat_list_messages(
    p_conversation_id   uuid DEFAULT NULL,
    p_requesting_user_id uuid DEFAULT NULL,
    p_limit             int  DEFAULT 200
)
RETURNS TABLE (
    success             int,
    error               text,
    message_id          bigint,
    sender_user_id      uuid,
    sender_name         text,
    direction           text,
    body                text,
    external_message_id text,
    send_status         text,
    send_error          text,
    created_at          timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_limit int := GREATEST(1, COALESCE(p_limit, 200));
BEGIN
    IF p_conversation_id IS NULL OR p_requesting_user_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_conversation_id and p_requesting_user_id are required.', NULL::bigint, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
        RETURN;
    END IF;

    -- Validate requester is participant
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_participants
        WHERE conversation_id = p_conversation_id AND user_id = p_requesting_user_id
    ) THEN
        -- Empty result (not an error) if they aren't one
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        1,
        NULL::text,
        m.message_id,
        m.sender_user_id,
        COALESCE(u.first_name || ' ' || u.last_name, u.email, 'User'),
        m.direction,
        m.body,
        m.external_message_id,
        m.send_status,
        m.send_error,
        m.created_at
    FROM public.chat_messages m
    LEFT JOIN public.users u ON u.id = m.sender_user_id
    WHERE m.conversation_id = p_conversation_id
    ORDER BY m.message_id ASC
    LIMIT v_limit;
END;
$$;

-- chat_mark_conversation_read: mark all messages in a conversation as read.
DROP FUNCTION IF EXISTS public.chat_mark_conversation_read(uuid, uuid);
CREATE FUNCTION public.chat_mark_conversation_read(
    p_conversation_id uuid DEFAULT NULL,
    p_user_id         uuid DEFAULT NULL
)
RETURNS TABLE (success int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    IF p_conversation_id IS NULL OR p_user_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_conversation_id and p_user_id are required.';
        RETURN;
    END IF;

    -- Mark all unread messages in this conversation as read
    INSERT INTO public.chat_message_reads (message_id, user_id, read_at)
    SELECT m.message_id, p_user_id, now()
    FROM public.chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND NOT EXISTS (
          SELECT 1 FROM public.chat_message_reads r
          WHERE r.message_id = m.message_id AND r.user_id = p_user_id
      )
    ON CONFLICT (message_id, user_id) DO NOTHING;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- chat_get_unread_count: total unread message count for a user.
DROP FUNCTION IF EXISTS public.chat_get_unread_count(uuid);
CREATE FUNCTION public.chat_get_unread_count(
    p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_count integer;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*)::integer INTO v_count
    FROM public.chat_messages m
    JOIN public.chat_participants p ON p.conversation_id = m.conversation_id
    WHERE p.user_id = p_user_id
      AND m.sender_user_id <> p_user_id
      AND NOT EXISTS (
          SELECT 1 FROM public.chat_message_reads r
          WHERE r.message_id = m.message_id AND r.user_id = p_user_id
      );

    RETURN COALESCE(v_count, 0);
END;
$$;

-- get_contacts_for_messaging: narrow CRM contacts read for the WhatsApp picker.
DROP FUNCTION IF EXISTS public.get_contacts_for_messaging();
CREATE FUNCTION public.get_contacts_for_messaging()
RETURNS TABLE (
    id                     uuid,
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
        c.contact_type,
        c.company_name,
        c.primary_contact_name,
        c.primary_contact_phone,
        c.primary_contact_mobile
    FROM public.contacts c
    WHERE c.deleted_at IS NULL
      AND c.status IS DISTINCT FROM 'inactive'
    ORDER BY c.company_name;
END;
$$;

-- ============================================================================
-- 4. PERMISSIONS & FEATURES SEEDS
-- ============================================================================

-- Features: crm-whatsapp-grid module (grant to roles that already see crm-grid)
INSERT INTO public.features (id, feature_key, feature_name, feature_description, is_active, created_at, updated_at)
VALUES (
    gen_random_uuid(),
    'crm-whatsapp-grid',
    'WhatsApp & Internal Chat',
    'WhatsApp contact messaging and internal staff chat under CRM',
    true,
    now(),
    now()
)
ON CONFLICT (feature_key) DO UPDATE SET
    feature_name = EXCLUDED.feature_name,
    feature_description = EXCLUDED.feature_description,
    updated_at = now();

-- Grant crm-whatsapp-grid to roles that already have crm-grid
INSERT INTO public.role_features (role_id, feature_id)
SELECT r.id, f.id
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE feature_key = 'crm-whatsapp-grid') f
WHERE EXISTS (
    SELECT 1 FROM public.role_features rf
    JOIN public.features f2 ON f2.id = rf.feature_id
    WHERE rf.role_id = r.id AND f2.feature_key = 'crm-grid'
)
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- Actions: messaging.chat.use (internal tab), messaging.whatsapp.contact.send (contact tab)
INSERT INTO public.actions (action_key, action_name, action_description)
VALUES
    ('messaging.chat.use', 'Use Internal Chat', 'Access the internal staff chat tab'),
    ('messaging.whatsapp.contact.send', 'Send WhatsApp to Contacts', 'Send WhatsApp messages to CRM contacts')
ON CONFLICT (action_key) DO NOTHING;

-- Grant messaging.chat.use to all 8 active roles (everyone can use internal chat)
INSERT INTO public.role_actions (role_id, action_id)
SELECT r.id, a.id
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE action_key = 'messaging.chat.use') a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Factory Manager', 'Quality Assurance', 'Palladium Manager', 'Production Manager', 'Shareholder')
ON CONFLICT (role_id, action_id) DO NOTHING;

-- Grant messaging.whatsapp.contact.send to roles that already have crm-grid access
INSERT INTO public.role_actions (role_id, action_id)
SELECT r.id, a.id
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE action_key = 'messaging.whatsapp.contact.send') a
WHERE EXISTS (
    SELECT 1 FROM public.role_features rf
    JOIN public.features f ON f.id = rf.feature_id
    WHERE rf.role_id = r.id AND f.feature_key = 'crm-grid'
)
ON CONFLICT (role_id, action_id) DO NOTHING;

-- ============================================================================
-- 5. GRANTS
-- ============================================================================

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'chat_start_internal_conversation(uuid,uuid)',
        'chat_start_contact_conversation(uuid,uuid)',
        'chat_send_message(uuid,uuid,text,text,text,text,text)',
        'chat_update_message_send_result(bigint,text,text,text)',
        'chat_list_conversations(uuid,text)',
        'chat_list_messages(uuid,uuid,int)',
        'chat_mark_conversation_read(uuid,uuid)',
        'chat_get_unread_count(uuid)',
        'get_contacts_for_messaging()'
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
