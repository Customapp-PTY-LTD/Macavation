-- WhatsApp module under CRM (Part 2 of 2) — inbound receiving + shared team inbox.
--
-- Part 1 (20260812100000_crm_whatsapp_module.sql) built outbound send and internal
-- staff chat. Nothing received inbound messages: Control Room had no destination to
-- forward to, so chat_messages held 0 rows and the CRM -> WhatsApp screen had nothing
-- to show. This migration adds the inbound half.
--
-- ADDITIVE ONLY. None of the 9 existing chat_* RPCs are modified or dropped. The
-- existing chat_list_conversations / chat_list_messages stay participant-gated and keep
-- backing internal 1:1 staff chat; new chat_*_whatsapp_* RPCs serve the shared inbox.
-- Rewriting the existing ones to also serve a shared inbox would risk leaking private
-- internal conversations to non-participants.
--
-- Product decision: the WhatsApp line (+27 71 463 9643) is a SHARED TEAM INBOX. An
-- inbound message from an unrecognised number has no chat_participants rows and may
-- match no CRM contact, but must still be visible. Any user holding the existing
-- messaging.whatsapp.contact.send action sees and can reply to all whatsapp_contact
-- conversations. Internal conversations keep participant-based privacy exactly as before.
--
-- CANONICAL PHONE FORM: bare digits, country code, no '+' and no spaces — e.g.
-- '27714639643'. This is deliberately the form Part 1's chat_start_contact_conversation
-- already writes into chat_conversations.external_phone, AND the form Control Room
-- delivers inbound sender numbers in. Both directions therefore find the same
-- conversation row. The '+' is added only at the edge, by the send-whatsapp-message
-- edge function's normalizePhone(), because Meta's API wants E.164.
--
-- Convention: SECURITY DEFINER, SET search_path = public, extensions;
-- RETURNS TABLE(success int, error text, ...) for multi-value RPCs. Browser calls RPCs
-- as role anon (data-functions.js hardcodes useAnonAuth: true).

-- ============================================================================
-- 1. SCHEMA — additive changes to Part 1's tables
-- ============================================================================

-- WhatsApp profile name of the far end, captured from the inbound webhook
-- (value.contacts[0].profile.name). Lets an unknown number show a human name
-- instead of a bare phone number.
ALTER TABLE public.chat_conversations
    ADD COLUMN IF NOT EXISTS profile_name text NULL;

-- Idempotency for webhook re-delivery. Control Room can forward the same Meta event
-- more than once, so dedupe must be enforced by the database rather than by a
-- race-prone SELECT-then-INSERT inside the ingest RPC.
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_messages_external_message_id
    ON public.chat_messages (external_message_id)
    WHERE external_message_id IS NOT NULL;

-- Shared-inbox conversation list orders by last_message_at within a type, and the
-- inbound find-or-create looks conversations up by phone.
CREATE INDEX IF NOT EXISTS ix_chat_conversations_type_last_message
    ON public.chat_conversations (conversation_type, last_message_at DESC);
CREATE INDEX IF NOT EXISTS ix_chat_conversations_external_phone
    ON public.chat_conversations (external_phone);

-- Widen send_status to carry Meta delivery receipts. Part 1 allowed only
-- sent/queued/not_connected/failed; delivered and read arrive on value.statuses[].
-- Widening a CHECK is additive — every existing row still satisfies it.
DO $$
BEGIN
    ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_send_status_check;
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_send_status_check
        CHECK (send_status IN ('sent', 'queued', 'not_connected', 'failed', 'delivered', 'read'));
END $$;

-- ============================================================================
-- 2. HELPERS
-- ============================================================================

-- chat_normalize_phone: reduce any phone spelling to the canonical bare-digit form
-- documented in the header. Mirrors the inline normalisation in Part 1's
-- chat_start_contact_conversation exactly, so both agree on what row to find.
CREATE OR REPLACE FUNCTION public.chat_normalize_phone(p_phone text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
    v_phone text;
BEGIN
    v_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    IF v_phone = '' THEN
        RETURN NULL;
    END IF;
    IF v_phone ~ '^0' THEN
        v_phone := '27' || substring(v_phone from 2);
    END IF;
    IF NOT (v_phone ~ '^27') AND length(v_phone) <= 11 THEN
        v_phone := '27' || v_phone;
    END IF;
    RETURN v_phone;
END;
$$;

-- chat_format_phone: display form for a canonical number, e.g. '+27 71 463 9643'.
CREATE OR REPLACE FUNCTION public.chat_format_phone(p_phone text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
    v text := NULLIF(btrim(COALESCE(p_phone, '')), '');
BEGIN
    IF v IS NULL THEN
        RETURN NULL;
    END IF;
    IF v ~ '^27[0-9]{9}$' THEN
        RETURN '+27 ' || substr(v, 3, 2) || ' ' || substr(v, 5, 3) || ' ' || substr(v, 8, 4);
    END IF;
    RETURN '+' || v;
END;
$$;

-- chat_has_whatsapp_inbox_access: shared-inbox gate. True when the user's role holds
-- the messaging.whatsapp.contact.send action seeded by Part 1. Deliberately NOT
-- participant-based — that is the whole point of a shared inbox.
CREATE OR REPLACE FUNCTION public.chat_has_whatsapp_inbox_access(p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_user_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.role_actions ra ON ra.role_id = u.role_id
        JOIN public.actions a ON a.id = ra.action_id
        WHERE u.id = p_user_id
          AND u.is_active IS TRUE
          AND a.key = 'messaging.whatsapp.contact.send'
          AND COALESCE(ra.value, '') = 'true'
    );
END;
$$;

-- ============================================================================
-- 3. INBOUND INGEST
-- ============================================================================

-- chat_ingest_inbound_whatsapp: record one inbound WhatsApp message, idempotently.
-- Called by the whatsapp-inbound edge function with a service-role client.
DROP FUNCTION IF EXISTS public.chat_ingest_inbound_whatsapp(text, text, text, text, text, timestamptz);
CREATE FUNCTION public.chat_ingest_inbound_whatsapp(
    p_from_phone   text        DEFAULT NULL,
    p_wamid        text        DEFAULT NULL,
    p_body         text        DEFAULT NULL,
    p_message_type text        DEFAULT NULL,
    p_profile_name text        DEFAULT NULL,
    p_sent_at      timestamptz DEFAULT NULL
)
RETURNS TABLE (
    success         int,
    error           text,
    conversation_id uuid,
    message_id      bigint,
    deduped         boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_phone        text;
    v_wamid        text;
    v_body         text;
    v_profile      text;
    v_sent_at      timestamptz;
    v_conv_id      uuid;
    v_mid          bigint;
    v_contact_id   uuid;
    v_match_count  int;
    v_existing_cid uuid;
BEGIN
    v_phone := public.chat_normalize_phone(p_from_phone);
    v_wamid := NULLIF(btrim(COALESCE(p_wamid, '')), '');
    v_profile := NULLIF(btrim(COALESCE(p_profile_name, '')), '');
    v_sent_at := COALESCE(p_sent_at, now());

    IF v_phone IS NULL THEN
        RETURN QUERY SELECT 0, 'p_from_phone is required.', NULL::uuid, NULL::bigint, false;
        RETURN;
    END IF;

    IF v_wamid IS NULL THEN
        RETURN QUERY SELECT 0, 'p_wamid is required.', NULL::uuid, NULL::bigint, false;
        RETURN;
    END IF;

    -- body is NOT NULL on chat_messages; non-text types arrive with a placeholder body
    -- built by the edge function, but never trust that it did.
    v_body := COALESCE(
        NULLIF(btrim(COALESCE(p_body, '')), ''),
        '[' || COALESCE(NULLIF(btrim(COALESCE(p_message_type, '')), ''), 'unsupported') || ']'
    );

    -- Already ingested? Succeed idempotently with the row we already have.
    SELECT m.message_id, m.conversation_id INTO v_mid, v_existing_cid
    FROM public.chat_messages m
    WHERE m.external_message_id = v_wamid
    LIMIT 1;

    IF v_mid IS NOT NULL THEN
        RETURN QUERY SELECT 1, NULL::text, v_existing_cid, v_mid, true;
        RETURN;
    END IF;

    -- Resolve the CRM contact only when exactly one matches. Zero matches or an
    -- ambiguous multi-match both leave contact_id NULL rather than guessing wrong.
    SELECT COUNT(*) INTO v_match_count
    FROM public.contacts c
    WHERE public.chat_normalize_phone(c.primary_contact_mobile) = v_phone
       OR public.chat_normalize_phone(c.primary_contact_phone) = v_phone;

    IF v_match_count = 1 THEN
        SELECT c.id INTO v_contact_id
        FROM public.contacts c
        WHERE public.chat_normalize_phone(c.primary_contact_mobile) = v_phone
           OR public.chat_normalize_phone(c.primary_contact_phone) = v_phone
        LIMIT 1;
    END IF;

    -- Find-or-create on the CANONICAL phone, so an inbound reply lands on the same
    -- conversation an outbound send created (and vice versa).
    SELECT c.conversation_id INTO v_conv_id
    FROM public.chat_conversations c
    WHERE c.conversation_type = 'whatsapp_contact'
      AND c.is_archived = false
      AND public.chat_normalize_phone(c.external_phone) = v_phone
    ORDER BY c.last_message_at DESC
    LIMIT 1;

    IF v_conv_id IS NULL THEN
        INSERT INTO public.chat_conversations (
            conversation_type, contact_id, external_phone, profile_name, created_by, created_at, last_message_at
        )
        VALUES ('whatsapp_contact', v_contact_id, v_phone, v_profile, NULL, v_sent_at, v_sent_at)
        RETURNING chat_conversations.conversation_id INTO v_conv_id;
    ELSE
        -- Adopt newly-resolvable details onto the existing row: a number that was
        -- unknown when it first messaged may since have been added as a CRM contact.
        UPDATE public.chat_conversations
        SET contact_id   = COALESCE(contact_id, v_contact_id),
            profile_name = COALESCE(v_profile, profile_name),
            external_phone = v_phone
        WHERE chat_conversations.conversation_id = v_conv_id;
    END IF;

    -- sender_user_id NULL: the far end is not a portal user.
    INSERT INTO public.chat_messages (
        conversation_id, sender_user_id, direction, body, external_message_id, send_status, created_at
    )
    VALUES (v_conv_id, NULL, 'inbound_whatsapp', v_body, v_wamid, 'sent', v_sent_at)
    ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
    RETURNING chat_messages.message_id INTO v_mid;

    IF v_mid IS NULL THEN
        -- Lost a race against a concurrent duplicate delivery. Still a success.
        SELECT m.message_id INTO v_mid
        FROM public.chat_messages m
        WHERE m.external_message_id = v_wamid
        LIMIT 1;

        RETURN QUERY SELECT 1, NULL::text, v_conv_id, v_mid, true;
        RETURN;
    END IF;

    UPDATE public.chat_conversations
    SET last_message_at = GREATEST(last_message_at, v_sent_at)
    WHERE chat_conversations.conversation_id = v_conv_id;

    RETURN QUERY SELECT 1, NULL::text, v_conv_id, v_mid, false;
END;
$$;

-- chat_record_whatsapp_status: apply a Meta delivery receipt to an outbound message.
-- A status for a wamid we never sent is a no-op success, not an error — Control Room
-- forwards statuses for the whole channel and does not retry on our errors.
DROP FUNCTION IF EXISTS public.chat_record_whatsapp_status(text, text, text);
CREATE FUNCTION public.chat_record_whatsapp_status(
    p_wamid  text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_error  text DEFAULT NULL
)
RETURNS TABLE (success int, error text, updated boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_wamid  text := NULLIF(btrim(COALESCE(p_wamid, '')), '');
    v_status text := lower(NULLIF(btrim(COALESCE(p_status, '')), ''));
    v_rows   int;
BEGIN
    IF v_wamid IS NULL OR v_status IS NULL THEN
        RETURN QUERY SELECT 0, 'p_wamid and p_status are required.', false;
        RETURN;
    END IF;

    IF v_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
        -- Unknown Meta status: ignore rather than violate the CHECK constraint.
        RETURN QUERY SELECT 1, NULL::text, false;
        RETURN;
    END IF;

    -- Only ever move forward: a late 'sent' must not clobber an already-'read' row.
    UPDATE public.chat_messages m
    SET send_status = v_status,
        send_error  = CASE WHEN v_status = 'failed' THEN COALESCE(p_error, m.send_error) ELSE m.send_error END
    WHERE m.external_message_id = v_wamid
      AND m.direction = 'outbound_whatsapp'
      AND (
          v_status = 'failed'
          OR CASE m.send_status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 ELSE 1 END
             < CASE v_status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 ELSE 1 END
      );

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, (v_rows > 0);
END;
$$;

-- ============================================================================
-- 4. SHARED-INBOX READ RPCs
-- ============================================================================

-- chat_list_whatsapp_conversations: the shared inbox. Returns ONLY
-- conversation_type='whatsapp_contact' — internal conversations can never appear here.
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
        RETURN QUERY SELECT 0, 'p_user_id is required.', NULL::uuid, NULL::text, NULL::uuid,
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
        c.external_phone,
        c.profile_name,
        -- Display label falls back: contact name -> WhatsApp profile name -> phone.
        -- Never blank and never a bare 'Contact'.
        COALESCE(
            NULLIF(btrim(COALESCE(ct.company_name, '')), ''),
            NULLIF(btrim(COALESCE(ct.primary_contact_name, '')), ''),
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
    WHERE c.conversation_type = 'whatsapp_contact'
      AND c.is_archived = false
    ORDER BY c.last_message_at DESC;
END;
$$;

-- chat_list_whatsapp_messages: messages in one whatsapp_contact conversation.
-- Guards on conversation_type, so no argument can make this return internal chat.
DROP FUNCTION IF EXISTS public.chat_list_whatsapp_messages(uuid, uuid, int);
CREATE FUNCTION public.chat_list_whatsapp_messages(
    p_conversation_id    uuid DEFAULT NULL,
    p_requesting_user_id uuid DEFAULT NULL,
    p_limit              int  DEFAULT 200
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
        RETURN QUERY SELECT 0, 'p_conversation_id and p_requesting_user_id are required.',
                            NULL::bigint, NULL::uuid, NULL::text, NULL::text, NULL::text,
                            NULL::text, NULL::text, NULL::text, NULL::timestamptz;
        RETURN;
    END IF;

    IF NOT public.chat_has_whatsapp_inbox_access(p_requesting_user_id) THEN
        RETURN;
    END IF;

    -- Hard type guard: this RPC serves the WhatsApp inbox only.
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_conversations c
        WHERE c.conversation_id = p_conversation_id
          AND c.conversation_type = 'whatsapp_contact'
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        1,
        NULL::text,
        m.message_id,
        m.sender_user_id,
        COALESCE(u.first_name || ' ' || u.last_name, u.email, NULL::text),
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

-- chat_mark_whatsapp_read: mark a shared-inbox conversation read for this user.
DROP FUNCTION IF EXISTS public.chat_mark_whatsapp_read(uuid, uuid);
CREATE FUNCTION public.chat_mark_whatsapp_read(
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

    IF NOT public.chat_has_whatsapp_inbox_access(p_user_id) THEN
        RETURN QUERY SELECT 0, 'No WhatsApp inbox access.';
        RETURN;
    END IF;

    INSERT INTO public.chat_message_reads (message_id, user_id, read_at)
    SELECT m.message_id, p_user_id, now()
    FROM public.chat_messages m
    JOIN public.chat_conversations c ON c.conversation_id = m.conversation_id
    WHERE m.conversation_id = p_conversation_id
      AND c.conversation_type = 'whatsapp_contact'
    ON CONFLICT (message_id, user_id) DO NOTHING;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- chat_join_whatsapp_conversation: add a shared-inbox user to a whatsapp_contact
-- conversation as a participant.
--
-- Required because Part 1's chat_send_message gates on chat_participants membership
-- ("Sender is not a participant in this conversation"), but a conversation created by
-- inbound ingest has NO participant rows — nobody started it from a CRM contact. Without
-- this, the team could see a message from an unknown number but could never reply to it.
-- Joining here, rather than relaxing chat_send_message's check, keeps internal 1:1
-- privacy exactly as Part 1 left it: this RPC refuses any non-whatsapp_contact
-- conversation, so it can never be used to join a private internal thread.
DROP FUNCTION IF EXISTS public.chat_join_whatsapp_conversation(uuid, uuid);
CREATE FUNCTION public.chat_join_whatsapp_conversation(
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

    IF NOT public.chat_has_whatsapp_inbox_access(p_user_id) THEN
        RETURN QUERY SELECT 0, 'No WhatsApp inbox access.';
        RETURN;
    END IF;

    -- Hard type guard: WhatsApp conversations only, never internal.
    IF NOT EXISTS (
        SELECT 1 FROM public.chat_conversations c
        WHERE c.conversation_id = p_conversation_id
          AND c.conversation_type = 'whatsapp_contact'
          AND c.is_archived = false
    ) THEN
        RETURN QUERY SELECT 0, 'Conversation not found or not a WhatsApp conversation.';
        RETURN;
    END IF;

    INSERT INTO public.chat_participants (conversation_id, user_id, joined_at)
    VALUES (p_conversation_id, p_user_id, now())
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- chat_get_whatsapp_unread_count: total unread inbound WhatsApp messages for a user,
-- across the whole shared inbox. NULL-safe in the same way as the list RPC.
DROP FUNCTION IF EXISTS public.chat_get_whatsapp_unread_count(uuid);
CREATE FUNCTION public.chat_get_whatsapp_unread_count(
    p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_count integer;
BEGIN
    IF p_user_id IS NULL OR NOT public.chat_has_whatsapp_inbox_access(p_user_id) THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*)::integer INTO v_count
    FROM public.chat_messages m
    JOIN public.chat_conversations c ON c.conversation_id = m.conversation_id
    WHERE c.conversation_type = 'whatsapp_contact'
      AND c.is_archived = false
      AND m.direction = 'inbound_whatsapp'
      AND NOT EXISTS (
          SELECT 1 FROM public.chat_message_reads r
          WHERE r.message_id = m.message_id AND r.user_id = p_user_id
      );

    RETURN COALESCE(v_count, 0);
END;
$$;

-- ============================================================================
-- 5. PERMISSIONS SEEDS
-- ============================================================================

-- role_permissions: this repo's second (largely vestigial, Lambda-proxy-era) RBAC
-- layer. Every migration still seeds it for new functions, so this one does too.
DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'chat_ingest_inbound_whatsapp', 'chat_record_whatsapp_status',
        'chat_list_whatsapp_conversations', 'chat_list_whatsapp_messages',
        'chat_mark_whatsapp_read', 'chat_get_whatsapp_unread_count',
        'chat_join_whatsapp_conversation',
        'chat_normalize_phone', 'chat_format_phone', 'chat_has_whatsapp_inbox_access'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- ============================================================================
-- 6. GRANTS
-- ============================================================================

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'chat_normalize_phone(text)',
        'chat_format_phone(text)',
        'chat_has_whatsapp_inbox_access(uuid)',
        'chat_list_whatsapp_conversations(uuid)',
        'chat_list_whatsapp_messages(uuid,uuid,int)',
        'chat_mark_whatsapp_read(uuid,uuid)',
        'chat_get_whatsapp_unread_count(uuid)',
        'chat_join_whatsapp_conversation(uuid,uuid)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    END LOOP;
END;
$$;

-- Ingest and delivery-status writes are service_role ONLY: they are called by the
-- whatsapp-inbound edge function, never by a browser. Granting these to anon would
-- let anyone holding the public anon key forge inbound messages.
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'chat_ingest_inbound_whatsapp(text,text,text,text,text,timestamptz)',
        'chat_record_whatsapp_status(text,text,text)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
