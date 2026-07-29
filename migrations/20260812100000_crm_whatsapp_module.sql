-- CRM WhatsApp module — Part 1 of 2
-- Consolidated messaging: internal staff-to-staff chat + WhatsApp conversations with CRM contacts.
-- Graceful degradation: all outbound WhatsApp attempts fail soft to 'not_connected' state when
-- WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not yet provisioned.

-- ============================================================
-- 1. Schema
-- ============================================================

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
    external_message_id  text NULL,
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

-- ============================================================
-- 2. RLS — lockdown (SECURITY DEFINER RPCs only)
-- ============================================================

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_reads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chat_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.chat_participants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.chat_message_reads FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.chat_conversations TO service_role;
GRANT ALL ON TABLE public.chat_participants TO service_role;
GRANT ALL ON TABLE public.chat_messages TO service_role;
GRANT ALL ON TABLE public.chat_message_reads TO service_role;

-- ============================================================
-- 3. RPCs — SECURITY DEFINER, anon-callable
-- ============================================================

-- chat_start_internal_conversation
CREATE OR REPLACE FUNCTION public.chat_start_internal_conversation(
    p_user_id uuid,
    p_other_user_id uuid
)
RETURNS TABLE(success int, error text, conversation_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_conv_id uuid;
    v_created boolean := false;
BEGIN
    -- Validate both users exist
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
        RETURN QUERY SELECT 0, 'User not found'::text, NULL::uuid, false;
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_other_user_id) THEN
        RETURN QUERY SELECT 0, 'Other user not found'::text, NULL::uuid, false;
        RETURN;
    END IF;

    -- Find existing 2-participant internal conversation
    SELECT c.conversation_id INTO v_conv_id
    FROM public.chat_conversations c
    WHERE c.conversation_type = 'internal'
      AND c.is_archived = false
      AND EXISTS (
          SELECT 1 FROM public.chat_participants cp1
          WHERE cp1.conversation_id = c.conversation_id AND cp1.user_id = p_user_id
      )
      AND EXISTS (
          SELECT 1 FROM public.chat_participants cp2
          WHERE cp2.conversation_id = c.conversation_id AND cp2.user_id = p_other_user_id
      )
      AND (SELECT COUNT(*) FROM public.chat_participants cp3 WHERE cp3.conversation_id = c.conversation_id) = 2
    LIMIT 1;

    IF v_conv_id IS NULL THEN
        -- Create new conversation
        INSERT INTO public.chat_conversations (conversation_type, created_by)
        VALUES ('internal', p_user_id)
        RETURNING chat_conversations.conversation_id INTO v_conv_id;

        -- Add both participants
        INSERT INTO public.chat_participants (conversation_id, user_id)
        VALUES (v_conv_id, p_user_id), (v_conv_id, p_other_user_id);

        v_created := true;
    END IF;

    RETURN QUERY SELECT 1, NULL::text, v_conv_id, v_created;
END;
$$;

-- chat_start_contact_conversation
CREATE OR REPLACE FUNCTION public.chat_start_contact_conversation(
    p_contact_id uuid,
    p_created_by uuid
)
RETURNS TABLE(success int, error text, conversation_id uuid, created boolean, resolved_phone text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_conv_id uuid;
    v_created boolean := false;
    v_phone text;
    v_mobile text;
    v_resolved text;
BEGIN
    -- Validate contact exists and is not deleted
    SELECT primary_contact_phone, primary_contact_mobile
    INTO v_phone, v_mobile
    FROM public.contacts
    WHERE id = p_contact_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Contact not found or deleted'::text, NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    -- Resolve phone number (mobile first, fallback to phone)
    v_resolved := COALESCE(v_mobile, v_phone);
    IF v_resolved IS NULL OR TRIM(v_resolved) = '' THEN
        RETURN QUERY SELECT 0, 'Contact has no phone or mobile number on file'::text, NULL::uuid, false, NULL::text;
        RETURN;
    END IF;

    -- Normalize phone (strip non-digits, 0→27 prefix, bare-number 27 prefix)
    v_resolved := REGEXP_REPLACE(v_resolved, '[^0-9]', '', 'g');
    IF LEFT(v_resolved, 1) = '0' THEN
        v_resolved := '27' || SUBSTRING(v_resolved FROM 2);
    END IF;
    IF LEFT(v_resolved, 2) <> '27' AND LENGTH(v_resolved) <= 11 THEN
        v_resolved := '27' || v_resolved;
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
        INSERT INTO public.chat_conversations (conversation_type, contact_id, external_phone, created_by)
        VALUES ('whatsapp_contact', p_contact_id, v_resolved, p_created_by)
        RETURNING chat_conversations.conversation_id INTO v_conv_id;

        v_created := true;
    END IF;

    -- Ensure the staff member is a participant (idempotent)
    INSERT INTO public.chat_participants (conversation_id, user_id)
    VALUES (v_conv_id, p_created_by)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    RETURN QUERY SELECT 1, NULL::text, v_conv_id, v_created, v_resolved;
END;
$$;

-- chat_send_message
CREATE OR REPLACE FUNCTION public.chat_send_message(
    p_conversation_id uuid,
    p_sender_user_id uuid,
    p_body text
)
RETURNS TABLE(success int, error text, message_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_msg_id bigint;
    v_conv_type text;
    v_direction text;
    v_status text;
BEGIN
    -- Validate sender is a participant
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_participants
        WHERE conversation_id = p_conversation_id AND user_id = p_sender_user_id
    ) THEN
        RETURN QUERY SELECT 0, 'Sender is not a participant in this conversation'::text, NULL::bigint;
        RETURN;
    END IF;

    -- Fetch conversation type
    SELECT c.conversation_type INTO v_conv_type
    FROM public.chat_conversations c
    WHERE c.conversation_id = p_conversation_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Conversation not found'::text, NULL::bigint;
        RETURN;
    END IF;

    -- Derive direction and status from conversation type
    IF v_conv_type = 'internal' THEN
        v_direction := 'internal';
        v_status := 'sent';
    ELSIF v_conv_type = 'whatsapp_contact' THEN
        v_direction := 'outbound_whatsapp';
        v_status := 'queued';
    ELSE
        RETURN QUERY SELECT 0, 'Unknown conversation type'::text, NULL::bigint;
        RETURN;
    END IF;

    -- Insert message
    INSERT INTO public.chat_messages (conversation_id, sender_user_id, direction, body, send_status)
    VALUES (p_conversation_id, p_sender_user_id, v_direction, p_body, v_status)
    RETURNING chat_messages.message_id INTO v_msg_id;

    -- Bump last_message_at
    UPDATE public.chat_conversations
    SET last_message_at = now()
    WHERE conversation_id = p_conversation_id;

    -- Auto-mark sender's own message read
    INSERT INTO public.chat_message_reads (message_id, user_id)
    VALUES (v_msg_id, p_sender_user_id);

    RETURN QUERY SELECT 1, NULL::text, v_msg_id;
END;
$$;

-- chat_update_message_send_result
CREATE OR REPLACE FUNCTION public.chat_update_message_send_result(
    p_message_id bigint,
    p_user_id uuid,
    p_send_status text,
    p_external_message_id text DEFAULT NULL,
    p_send_error text DEFAULT NULL
)
RETURNS TABLE(success int, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_conv_id uuid;
BEGIN
    -- Restrict status to allowed values
    IF p_send_status NOT IN ('sent', 'not_connected', 'failed') THEN
        RETURN QUERY SELECT 0, 'Invalid send_status'::text;
        RETURN;
    END IF;

    -- Fetch conversation_id for the message
    SELECT m.conversation_id INTO v_conv_id
    FROM public.chat_messages m
    WHERE m.message_id = p_message_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Message not found'::text;
        RETURN;
    END IF;

    -- Validate user is a participant in the message's conversation
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_participants
        WHERE conversation_id = v_conv_id AND user_id = p_user_id
    ) THEN
        RETURN QUERY SELECT 0, 'User is not a participant in this conversation'::text;
        RETURN;
    END IF;

    -- Update the message
    UPDATE public.chat_messages
    SET send_status = p_send_status,
        external_message_id = COALESCE(p_external_message_id, external_message_id),
        send_error = p_send_error
    WHERE message_id = p_message_id;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- chat_list_conversations
CREATE OR REPLACE FUNCTION public.chat_list_conversations(
    p_user_id uuid,
    p_conversation_type text DEFAULT NULL
)
RETURNS TABLE(
    conversation_id uuid,
    conversation_type text,
    contact_id uuid,
    external_phone text,
    created_at timestamptz,
    last_message_at timestamptz,
    other_party_name text,
    last_message_body text,
    last_message_created_at timestamptz,
    unread_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.conversation_id,
        c.conversation_type,
        c.contact_id,
        c.external_phone,
        c.created_at,
        c.last_message_at,
        CASE
            WHEN c.conversation_type = 'whatsapp_contact' THEN
                COALESCE(ct.company_name, ct.primary_contact_name, 'Unknown Contact')
            WHEN c.conversation_type = 'internal' THEN
                (
                    SELECT COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown User')
                    FROM public.chat_participants cp
                    INNER JOIN public.users u ON u.id = cp.user_id
                    WHERE cp.conversation_id = c.conversation_id
                      AND cp.user_id IS DISTINCT FROM p_user_id
                    LIMIT 1
                )
            ELSE 'Unknown'
        END AS other_party_name,
        (SELECT m.body FROM public.chat_messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1),
        (SELECT m.created_at FROM public.chat_messages m WHERE m.conversation_id = c.conversation_id ORDER BY m.created_at DESC LIMIT 1),
        (
            SELECT COUNT(*)
            FROM public.chat_messages m
            WHERE m.conversation_id = c.conversation_id
              AND m.sender_user_id IS DISTINCT FROM p_user_id
              AND NOT EXISTS (
                  SELECT 1 FROM public.chat_message_reads r
                  WHERE r.message_id = m.message_id AND r.user_id = p_user_id
              )
        ) AS unread_count
    FROM public.chat_conversations c
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id
    WHERE EXISTS (
              SELECT 1 FROM public.chat_participants cp
              WHERE cp.conversation_id = c.conversation_id AND cp.user_id = p_user_id
          )
      AND c.is_archived = false
      AND (p_conversation_type IS NULL OR c.conversation_type = p_conversation_type)
    ORDER BY c.last_message_at DESC;
END;
$$;

-- chat_list_messages
CREATE OR REPLACE FUNCTION public.chat_list_messages(
    p_conversation_id uuid,
    p_requesting_user_id uuid,
    p_limit int DEFAULT 200
)
RETURNS TABLE(
    message_id bigint,
    conversation_id uuid,
    sender_user_id uuid,
    sender_name text,
    direction text,
    body text,
    external_message_id text,
    send_status text,
    send_error text,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Validate requester is a participant
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_participants
        WHERE conversation_id = p_conversation_id AND user_id = p_requesting_user_id
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        m.message_id,
        m.conversation_id,
        m.sender_user_id,
        COALESCE(u.first_name || ' ' || u.last_name, u.email, 'Unknown') AS sender_name,
        m.direction,
        m.body,
        m.external_message_id,
        m.send_status,
        m.send_error,
        m.created_at
    FROM public.chat_messages m
    LEFT JOIN public.users u ON u.id = m.sender_user_id
    WHERE m.conversation_id = p_conversation_id
    ORDER BY m.created_at ASC
    LIMIT p_limit;
END;
$$;

-- chat_mark_conversation_read
CREATE OR REPLACE FUNCTION public.chat_mark_conversation_read(
    p_conversation_id uuid,
    p_user_id uuid
)
RETURNS TABLE(success int, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Validate user is a participant
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_participants
        WHERE conversation_id = p_conversation_id AND user_id = p_user_id
    ) THEN
        RETURN QUERY SELECT 0, 'User is not a participant in this conversation'::text;
        RETURN;
    END IF;

    -- Mark all unread messages in this conversation as read
    INSERT INTO public.chat_message_reads (message_id, user_id)
    SELECT m.message_id, p_user_id
    FROM public.chat_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.sender_user_id IS DISTINCT FROM p_user_id
      AND NOT EXISTS (
          SELECT 1 FROM public.chat_message_reads r
          WHERE r.message_id = m.message_id AND r.user_id = p_user_id
      )
    ON CONFLICT (message_id, user_id) DO NOTHING;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- chat_get_unread_count
CREATE OR REPLACE FUNCTION public.chat_get_unread_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_count integer;
BEGIN
    SELECT COUNT(*)::integer INTO v_count
    FROM public.chat_messages m
    INNER JOIN public.chat_participants cp ON cp.conversation_id = m.conversation_id
    WHERE cp.user_id = p_user_id
      AND m.sender_user_id IS DISTINCT FROM p_user_id
      AND NOT EXISTS (
          SELECT 1 FROM public.chat_message_reads r
          WHERE r.message_id = m.message_id AND r.user_id = p_user_id
      );

    RETURN COALESCE(v_count, 0);
END;
$$;

-- get_contacts_for_messaging
CREATE OR REPLACE FUNCTION public.get_contacts_for_messaging()
RETURNS TABLE(
    id uuid,
    contact_type varchar,
    company_name varchar,
    primary_contact_name varchar,
    primary_contact_phone varchar,
    primary_contact_mobile varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

-- Grant EXECUTE to anon, authenticated, service_role
GRANT EXECUTE ON FUNCTION public.chat_start_internal_conversation TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_start_contact_conversation TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_send_message TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_update_message_send_result TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_list_conversations TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_list_messages TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_mark_conversation_read TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_get_unread_count TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_contacts_for_messaging TO anon, authenticated, service_role;

-- ============================================================
-- 4. Seed features and actions
-- ============================================================

-- Feature: crm-whatsapp-grid
INSERT INTO public.features (key, name, description) VALUES
    ('crm-whatsapp-grid', 'WhatsApp & Messaging', 'Consolidated WhatsApp conversations with contacts and internal staff messaging.')
ON CONFLICT (key) DO NOTHING;

-- Grant to roles that already have crm-grid (verified: super_user, admin, Sales Exec)
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN public.features f
WHERE f.key = 'crm-whatsapp-grid'
  AND r.role_name IN ('super_user', 'admin', 'Sales Exec')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- Actions: messaging.chat.use (internal tab) and messaging.whatsapp.contact.send (contact tab)
INSERT INTO public.actions (key, module, label, description) VALUES
    ('messaging.chat.use', 'Messaging', 'Use internal chat', 'Send and receive internal staff-to-staff messages'),
    ('messaging.whatsapp.contact.send', 'Messaging', 'Send WhatsApp to contacts', 'Send WhatsApp messages to CRM contacts')
ON CONFLICT (key) DO NOTHING;

-- Grant messaging.chat.use to all 8 active roles
INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN public.actions a
WHERE a.key = 'messaging.chat.use'
  AND r.role_name IN ('super_user', 'admin', 'Shareholder', 'Sales Exec', 'Factory Manager', 'Production Manager', 'Palladium Manager', 'Quality Assurance')
ON CONFLICT (role_id, action_id) DO NOTHING;

-- Grant messaging.whatsapp.contact.send to roles with crm-grid feature
INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN public.actions a
WHERE a.key = 'messaging.whatsapp.contact.send'
  AND r.role_name IN ('super_user', 'admin', 'Sales Exec')
ON CONFLICT (role_id, action_id) DO NOTHING;
