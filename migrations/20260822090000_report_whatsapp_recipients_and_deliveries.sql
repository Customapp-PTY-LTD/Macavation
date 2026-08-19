-- WhatsApp distribution for Sales & Production reports — recipients + per-send delivery log.
--
-- Context. The report builder can already create, edit, PDF-export and publish a report
-- (migrations/20260817090000_report_builder_foundations.sql,
--  migrations/20260817100000_report_instances_and_targets.sql). public.report_instances already
-- carries pdf_storage_bucket / pdf_storage_path / pdf_sha256, which publish_report_instance
-- COALESCEs but which nothing has ever populated — no code in the checkout writes to Supabase
-- Storage. This migration adds the two things a "send this report to selected numbers on
-- WhatsApp" flow needs and the database does not yet have: a saved recipient list, and an
-- auditable record of every individual send attempt.
--
-- Recipient sources, per the operator's requirement ("selected numbers from WhatsApp and chat, or
-- added contacts"), are the three that already exist in this database:
--   * whatsapp_chat — public.chat_conversations.external_phone, surfaced by
--     chat_list_whatsapp_conversations (migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:325)
--   * crm_contact   — public.contacts.primary_contact_mobile / secondary_contact_mobile, surfaced by
--     get_contacts_for_messaging (migrations/20260812100000_crm_whatsapp_module.sql:516)
--   * manual        — typed in by an operator and saved for reuse
--
-- Idempotency. Every statement here is re-runnable: this repo's MCP apply path stamps its own
-- migration version, so a file can legitimately be executed more than once.
--
-- Conventions followed: UUID PKs, TIMESTAMPTZ, snake_case, idx_<table>_<cols> index names,
-- REVOKE-then-grant table privileges, SECURITY DEFINER RPCs with an explicit search_path, and a
-- role_permissions block scoped to named roles rather than looped over every role (CLAUDE.md
-- records "grant to every role" as the cause of this repo's existing permission drift).

-- ============================================================================
-- 1. Phone normalisation — ONE canonical implementation, mirrored in JS
--
-- This is a deliberate, documented duplication of the JS normalizePhone at
-- supabase/functions/send-whatsapp-message/index.ts:64-69 (character-for-character the same
-- algorithm, also copied in send-daily-digest-whatsapp/index.ts and whatsapp-inbound/index.ts).
-- The unique index below and the edge function that sends must agree on what "the same number"
-- means, or 0821234567 and +27821234567 become two recipients that both get the same report.
--
--   strip every non-digit
--   leading '0'                       -> replace with '27'
--   no leading '27' and length <= 11  -> prefix '27'
--   finally prefix '+'
--
-- scripts/verify-report-whatsapp-parity.mjs (added by a later plan) asserts the JS copies and this
-- SQL body stay in step. Change one, change all of them.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_normalize_wa_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
    v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
    IF v_digits = '' THEN
        RETURN NULL;
    END IF;

    IF left(v_digits, 1) = '0' THEN
        v_digits := '27' || substr(v_digits, 2);
    ELSIF left(v_digits, 2) <> '27' AND length(v_digits) <= 11 THEN
        v_digits := '27' || v_digits;
    END IF;

    RETURN '+' || v_digits;
END;
$fn$;

COMMENT ON FUNCTION public.report_normalize_wa_phone(text) IS
    'Canonical SA WhatsApp phone normaliser. Mirrors normalizePhone in supabase/functions/send-whatsapp-message/index.ts:64-69 exactly; kept in step by scripts/verify-report-whatsapp-parity.mjs.';

-- ============================================================================
-- 2. public.report_recipients — the saved WhatsApp distribution list
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_recipients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name    text NOT NULL,
    phone           text NOT NULL,
    source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('whatsapp_chat', 'crm_contact', 'manual')),
    contact_id      uuid NULL REFERENCES public.contacts (id) ON DELETE SET NULL,
    conversation_id uuid NULL REFERENCES public.chat_conversations (conversation_id) ON DELETE SET NULL,
    is_active       boolean NOT NULL DEFAULT true,
    notes           text NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NULL,
    updated_by      uuid NULL
);

-- One row per real number. Uniqueness is on the NORMALISED value, so 0821234567 and
-- +27821234567 collide instead of both being sent the same confidential report.
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_recipients_phone_norm
    ON public.report_recipients (public.report_normalize_wa_phone(phone));

CREATE INDEX IF NOT EXISTS idx_report_recipients_is_active
    ON public.report_recipients (is_active);
CREATE INDEX IF NOT EXISTS idx_report_recipients_contact_id
    ON public.report_recipients (contact_id);
CREATE INDEX IF NOT EXISTS idx_report_recipients_conversation_id
    ON public.report_recipients (conversation_id);

REVOKE ALL ON public.report_recipients FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_recipients TO service_role;

COMMENT ON TABLE public.report_recipients IS
    'Saved WhatsApp recipients for Sales & Production report distribution. Reached only through the RPCs below; no direct anon/authenticated table privileges.';

-- ============================================================================
-- 3. public.report_deliveries — one row per recipient per send attempt
--
-- Written in two steps (begin_ then complete_) rather than one, so that a send loop that dies
-- part-way leaves 'pending' rows behind instead of silently losing the attempt. A recipient that
-- shows 'pending' long after the fact is a visible fault; a missing row is not.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_deliveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_instance_id  uuid NOT NULL REFERENCES public.report_instances (id) ON DELETE CASCADE,
    recipient_id        uuid NULL REFERENCES public.report_recipients (id) ON DELETE SET NULL,
    phone               text NOT NULL,
    display_name        text NULL,
    channel             text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed')),
    external_message_id text NULL,
    error               text NULL,
    message_body        text NULL,
    pdf_storage_bucket  text NULL,
    pdf_storage_path    text NULL,
    link_expires_at     timestamptz NULL,
    sent_by             uuid NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_report_deliveries_report_instance_id
    ON public.report_deliveries (report_instance_id);
CREATE INDEX IF NOT EXISTS idx_report_deliveries_recipient_id
    ON public.report_deliveries (recipient_id);
CREATE INDEX IF NOT EXISTS idx_report_deliveries_status
    ON public.report_deliveries (status);

REVOKE ALL ON public.report_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_deliveries TO service_role;

COMMENT ON TABLE public.report_deliveries IS
    'Audit log of every WhatsApp send attempt for a report instance. status pending -> sent|failed; error holds the gateway message verbatim.';

-- ============================================================================
-- 4. RPCs — recipients
--
-- Every function returns a (success int, error text, ...) leading pair, matching the idiom the
-- report-builder and chat RPCs already use (e.g. chat_list_whatsapp_conversations,
-- migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:331-343), so the portal's existing
-- firstRpcRow / success-check helpers work unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_report_recipients(
    p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (
    success         int,
    error           text,
    id              uuid,
    display_name    text,
    phone           text,
    source          text,
    contact_id      uuid,
    conversation_id uuid,
    is_active       boolean,
    notes           text,
    last_sent_at    timestamptz,
    created_at      timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
    RETURN QUERY
    SELECT
        1,
        NULL::text,
        r.id,
        r.display_name,
        public.report_normalize_wa_phone(r.phone),
        r.source,
        r.contact_id,
        r.conversation_id,
        r.is_active,
        r.notes,
        (SELECT max(d.completed_at)
           FROM public.report_deliveries d
          WHERE d.recipient_id = r.id AND d.status = 'sent'),
        r.created_at
    FROM public.report_recipients r
    WHERE COALESCE(p_include_inactive, false) OR r.is_active
    ORDER BY r.display_name;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.upsert_report_recipient(
    p_display_name    text,
    p_phone           text,
    p_source          text DEFAULT 'manual',
    p_contact_id      uuid DEFAULT NULL,
    p_conversation_id uuid DEFAULT NULL,
    p_notes           text DEFAULT NULL,
    p_actor_user_id   uuid DEFAULT NULL
)
RETURNS TABLE (success int, error text, id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_name   text := NULLIF(TRIM(COALESCE(p_display_name, '')), '');
    v_phone  text := public.report_normalize_wa_phone(p_phone);
    v_source text := lower(TRIM(COALESCE(p_source, 'manual')));
    v_id     uuid;
BEGIN
    IF v_name IS NULL THEN
        RETURN QUERY SELECT 0, 'A display name is required.', NULL::uuid;
        RETURN;
    END IF;

    IF v_phone IS NULL OR length(v_phone) < 11 THEN
        RETURN QUERY SELECT 0, 'A valid phone number is required.', NULL::uuid;
        RETURN;
    END IF;

    IF v_source NOT IN ('whatsapp_chat', 'crm_contact', 'manual') THEN
        v_source := 'manual';
    END IF;

    -- Match on the normalised value, exactly as idx_report_recipients_phone_norm does. An existing
    -- row is reactivated and relabelled rather than duplicated or left dormant.
    SELECT r.id INTO v_id
    FROM public.report_recipients r
    WHERE public.report_normalize_wa_phone(r.phone) = v_phone
    LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO public.report_recipients
            (display_name, phone, source, contact_id, conversation_id, notes, created_by, updated_by)
        VALUES
            (v_name, v_phone, v_source, p_contact_id, p_conversation_id,
             NULLIF(TRIM(COALESCE(p_notes, '')), ''), p_actor_user_id, p_actor_user_id)
        RETURNING report_recipients.id INTO v_id;
    ELSE
        UPDATE public.report_recipients r
        SET display_name    = v_name,
            phone           = v_phone,
            source          = v_source,
            contact_id      = COALESCE(p_contact_id, r.contact_id),
            conversation_id = COALESCE(p_conversation_id, r.conversation_id),
            notes           = COALESCE(NULLIF(TRIM(COALESCE(p_notes, '')), ''), r.notes),
            is_active       = true,
            updated_at      = now(),
            updated_by      = p_actor_user_id
        WHERE r.id = v_id;
    END IF;

    RETURN QUERY SELECT 1, NULL::text, v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_report_recipient_active(
    p_recipient_id  uuid,
    p_is_active     boolean,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
    IF p_recipient_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_recipient_id is required.';
        RETURN;
    END IF;

    UPDATE public.report_recipients
    SET is_active  = COALESCE(p_is_active, true),
        updated_at = now(),
        updated_by = p_actor_user_id
    WHERE id = p_recipient_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Recipient not found.';
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text;
END;
$fn$;

-- ============================================================================
-- 5. RPCs — delivery log
-- ============================================================================

CREATE OR REPLACE FUNCTION public.begin_report_delivery(
    p_report_instance_id uuid,
    p_phone              text,
    p_display_name       text DEFAULT NULL,
    p_recipient_id       uuid DEFAULT NULL,
    p_message_body       text DEFAULT NULL,
    p_pdf_storage_bucket text DEFAULT NULL,
    p_pdf_storage_path   text DEFAULT NULL,
    p_link_expires_at    timestamptz DEFAULT NULL,
    p_actor_user_id      uuid DEFAULT NULL
)
RETURNS TABLE (success int, error text, id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_phone text := public.report_normalize_wa_phone(p_phone);
    v_id    uuid;
BEGIN
    IF p_report_instance_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_report_instance_id is required.', NULL::uuid;
        RETURN;
    END IF;

    -- ri.id must be alias-qualified: this function's RETURNS TABLE declares an OUT column named
    -- `id`, which otherwise shadows the table column and raises 42702 "column reference id is
    -- ambiguous" at call time (confirmed against the dev database, 2026-08-19).
    IF NOT EXISTS (SELECT 1 FROM public.report_instances ri WHERE ri.id = p_report_instance_id) THEN
        RETURN QUERY SELECT 0, 'Report not found.', NULL::uuid;
        RETURN;
    END IF;

    IF v_phone IS NULL THEN
        RETURN QUERY SELECT 0, 'A valid phone number is required.', NULL::uuid;
        RETURN;
    END IF;

    INSERT INTO public.report_deliveries
        (report_instance_id, recipient_id, phone, display_name, status, message_body,
         pdf_storage_bucket, pdf_storage_path, link_expires_at, sent_by)
    VALUES
        (p_report_instance_id, p_recipient_id, v_phone,
         NULLIF(TRIM(COALESCE(p_display_name, '')), ''), 'pending', p_message_body,
         p_pdf_storage_bucket, p_pdf_storage_path, p_link_expires_at, p_actor_user_id)
    RETURNING report_deliveries.id INTO v_id;

    RETURN QUERY SELECT 1, NULL::text, v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.complete_report_delivery(
    p_delivery_id         uuid,
    p_status              text,
    p_external_message_id text DEFAULT NULL,
    p_error               text DEFAULT NULL
)
RETURNS TABLE (success int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_status text := lower(TRIM(COALESCE(p_status, '')));
BEGIN
    IF p_delivery_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_delivery_id is required.';
        RETURN;
    END IF;

    IF v_status NOT IN ('sent', 'failed') THEN
        RETURN QUERY SELECT 0, 'p_status must be sent or failed.';
        RETURN;
    END IF;

    UPDATE public.report_deliveries
    SET status              = v_status,
        external_message_id = COALESCE(p_external_message_id, external_message_id),
        -- The gateway's own message is kept verbatim: a WhatsApp send can fail for reasons the
        -- portal cannot anticipate (falling outside Meta's 24-hour customer-service window being
        -- the likeliest), and a generic "failed" would hide the only actionable detail.
        error               = CASE WHEN v_status = 'failed'
                                   THEN COALESCE(NULLIF(TRIM(COALESCE(p_error, '')), ''), 'Send failed.')
                                   ELSE NULL END,
        completed_at        = now()
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Delivery not found.';
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_report_deliveries(
    p_report_instance_id uuid
)
RETURNS TABLE (
    success             int,
    error               text,
    id                  uuid,
    recipient_id        uuid,
    phone               text,
    display_name        text,
    channel             text,
    status              text,
    external_message_id text,
    delivery_error      text,
    sent_by             uuid,
    sent_by_name        text,
    created_at          timestamptz,
    completed_at        timestamptz,
    link_expires_at     timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
    IF p_report_instance_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_report_instance_id is required.', NULL::uuid, NULL::uuid,
                            NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
                            NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz,
                            NULL::timestamptz;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        1,
        NULL::text,
        d.id,
        d.recipient_id,
        d.phone,
        d.display_name,
        d.channel,
        d.status,
        d.external_message_id,
        d.error,
        d.sent_by,
        NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        d.created_at,
        d.completed_at,
        d.link_expires_at
    FROM public.report_deliveries d
    LEFT JOIN public.users u ON u.id = d.sent_by
    WHERE d.report_instance_id = p_report_instance_id
    ORDER BY d.created_at DESC;
END;
$fn$;

-- ============================================================================
-- 6. RPC — record where a report's PDF was stored
--
-- publish_report_instance (migrations/20260817100000_report_instances_and_targets.sql:804) already
-- COALESCEs pdf_storage_bucket / pdf_storage_path / pdf_sha256, but it only accepts them at the
-- moment of publishing and refuses a non-draft. A report is sent AFTER it is published, so the
-- storage columns need a separate writer. This one deliberately does NOT change status and does
-- NOT recompute content_sha256 — recording where a file landed must never re-issue a report.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_report_pdf_storage(
    p_report_instance_id uuid,
    p_bucket             text,
    p_path               text,
    p_sha256             text DEFAULT NULL
)
RETURNS TABLE (success int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
    IF p_report_instance_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_report_instance_id is required.';
        RETURN;
    END IF;

    IF NULLIF(TRIM(COALESCE(p_bucket, '')), '') IS NULL
       OR NULLIF(TRIM(COALESCE(p_path, '')), '') IS NULL THEN
        RETURN QUERY SELECT 0, 'Bucket and path are required.';
        RETURN;
    END IF;

    UPDATE public.report_instances
    SET pdf_storage_bucket = TRIM(p_bucket),
        pdf_storage_path   = TRIM(p_path),
        pdf_sha256         = COALESCE(NULLIF(TRIM(COALESCE(p_sha256, '')), ''), pdf_sha256),
        updated_at         = now()
    WHERE id = p_report_instance_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Report not found.';
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text;
END;
$fn$;

-- ============================================================================
-- 7. Grants
--
-- Read RPCs go to anon/authenticated (the portal calls PostgREST with the publishable key and its
-- own session token; see WebPortal/js/data-functions.js). The three write RPCs the send path uses
-- — begin_/complete_report_delivery and record_report_pdf_storage — are granted to service_role
-- ONLY: they are reached from supabase/functions/send-report-whatsapp with the service-role key
-- AFTER that function has validated the caller's portal session, never from the browser. Anything
-- the browser could call directly it could also call with a forged report id.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.report_normalize_wa_phone(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_report_recipients(boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_report_deliveries(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_report_recipient(text, text, text, uuid, uuid, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_report_recipient_active(uuid, boolean, uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.begin_report_delivery(uuid, text, text, uuid, text, text, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_report_delivery(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_report_pdf_storage(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_report_delivery(uuid, text, text, uuid, text, text, text, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_report_delivery(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_report_pdf_storage(uuid, text, text, text) TO service_role;

-- ============================================================================
-- 8. role_permissions — the API-side layer
--
-- Reading the recipient list and the delivery history, and editing the recipient list, are granted
-- to the same four roles that already hold the report-builder write RPCs
-- (migrations/20260817100000_report_instances_and_targets.sql:1294-1306). Not looped over every
-- role.
-- ============================================================================

DO $do$
DECLARE
    v_role RECORD;
    v_fn   text;
BEGIN
    FOR v_role IN
        SELECT id, role_name FROM public.roles
        WHERE role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
    LOOP
        FOREACH v_fn IN ARRAY ARRAY[
            'list_report_recipients',
            'list_report_deliveries',
            'upsert_report_recipient',
            'set_report_recipient_active'
        ] LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$do$;

NOTIFY pgrst, 'reload schema';
