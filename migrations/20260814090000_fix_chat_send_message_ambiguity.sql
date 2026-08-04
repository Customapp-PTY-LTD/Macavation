-- Fix: chat_send_message failed with 42702 "column reference message_id is ambiguous",
-- so sending a WhatsApp message from CRM -> WhatsApp could never succeed.
--
-- Cause: the function is declared RETURNS TABLE (success int, error text, message_id
-- bigint). RETURNS TABLE creates an implicit OUT variable for each column, so inside the
-- body `message_id` names both a PL/pgSQL variable and a chat_message_reads column. The
-- final statement used ON CONFLICT (message_id, user_id), and PL/pgSQL substitutes
-- variables into the index-inference expression, so `message_id` was genuinely
-- unresolvable:
--
--     INSERT INTO public.chat_message_reads (message_id, user_id, read_at)
--     VALUES (v_mid, p_sender_user_id, now())
--     ON CONFLICT (message_id, user_id) DO NOTHING;   -- 42702 here
--
-- The column list of an INSERT is fine (target column names are never treated as
-- variables) — only the ON CONFLICT inference clause breaks. This is why the failure was
-- latent: the row insert itself is valid, and the error came from the auto-mark-read step
-- at the very end.
--
-- Fix: name the constraint explicitly with ON CONFLICT ON CONSTRAINT, which takes a
-- constraint name rather than a column expression and so is never variable-substituted.
-- Renaming the OUT parameter would also work but would change the JSON key the browser
-- reads (result.message_id in data-functions.js chatSendMessage), so the signature and
-- return shape here are deliberately byte-identical to
-- migrations/20260812100000_crm_whatsapp_module.sql — only the conflict clause changes.

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

    -- Validate sender is a participant (this check IS the access control).
    -- For the WhatsApp shared inbox, chat_join_whatsapp_conversation is what puts a user
    -- here: conversations created by an inbound message start with no participants.
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

    -- Auto-mark sender's own message read.
    -- ON CONSTRAINT (not a column list) — see the header comment: a column list here is
    -- variable-substituted against the RETURNS TABLE OUT parameter of the same name.
    INSERT INTO public.chat_message_reads (message_id, user_id, read_at)
    VALUES (v_mid, p_sender_user_id, now())
    ON CONFLICT ON CONSTRAINT chat_message_reads_message_id_user_id_key DO NOTHING;

    RETURN QUERY SELECT 1, NULL::text, v_mid;
END;
$$;

-- Re-grant: DROP FUNCTION discarded the grants from the baseline migration.
DO $$
BEGIN
    EXECUTE 'REVOKE ALL ON FUNCTION public.chat_send_message(uuid,uuid,text,text,text,text,text) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.chat_send_message(uuid,uuid,text,text,text,text,text) TO anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.chat_send_message(uuid,uuid,text,text,text,text,text) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.chat_send_message(uuid,uuid,text,text,text,text,text) TO service_role';
END;
$$;

NOTIFY pgrst, 'reload schema';
