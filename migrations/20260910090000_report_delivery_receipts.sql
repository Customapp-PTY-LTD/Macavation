-- WhatsApp delivery receipts for report_deliveries — "did they get it", answered from data that
-- already arrives on every send.
--
-- WHAT IS MISSING TODAY (measured, not assumed):
--   * public.report_deliveries's own CHECK constraint, report_deliveries_status_check, is
--     currently `CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text]))`
--     (migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:124-125). There is
--     no 'delivered' or 'read' state to hold a receipt even if something tried to write one.
--   * Meta already sends a status webhook for both 'delivered' and 'read' — Control Room forwards
--     it to supabase/functions/whatsapp-inbound/index.ts's statuses[] loop, which already calls
--     public.chat_record_whatsapp_status(wamid, status, error) per entry
--     (migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:276-319) — but that function
--     only ever writes to public.chat_messages. NOTHING in this codebase calls any function that
--     writes a status update against public.report_deliveries. A report send's delivery/read
--     status is therefore unanswerable from the panel today, even though the exact same webhook
--     that could answer it already arrives on every send.
--
-- WHAT THIS ADDS:
--   1. Widens report_deliveries_status_check to also allow 'delivered' and 'read' (additive —
--      every existing row still satisfies it), matching the vocabulary
--      chat_record_whatsapp_status already normalises to (sent/delivered/read/failed —
--      20260813090000_whatsapp_inbound_shared_inbox.sql:298).
--   2. Adds report_deliveries.status_updated_at — when the last status change landed, so the panel
--      can show "read 07:12", not just a tick.
--   3. public.report_record_delivery_status(p_wamid, p_status) — modelled directly on
--      chat_record_whatsapp_status's shape: same wamid-keyed lookup, same "a status for a wamid
--      this table has never heard of is a no-op success, not an error" tolerance (the same
--      Meta webhook feeds both chat_messages and report_deliveries; a given wamid belongs to at
--      most one of them), same forward-only ranking (sent -> delivered -> read never regresses).
--      SECURITY DEFINER, service_role only — reached only from
--      supabase/functions/whatsapp-inbound/index.ts's statuses[] loop with the service-role key,
--      exactly like chat_record_whatsapp_status.
--   4. list_report_deliveries gains status_updated_at as a new final return column (same
--      "DROP FUNCTION then CREATE" idiom 20260825091000_daily_production_report.sql used to add
--      message_kind, since CREATE OR REPLACE cannot change an existing RETURNS TABLE shape). This
--      is the same, already-granted, already-called function the panel uses today
--      (WebPortal/modules/sales-reports/js/report-whatsapp-history.js) — extended, not forked.
--
-- IDEMPOTENCY GUARDS ARE NOT TOUCHED, ON PURPOSE, AND HERE IS THE KNOWN TRADE-OFF THAT LEAVES:
--   public.daily_report_already_sent(p_date) (migrations/20260825091000_daily_production_report.sql
--   :279-287) and public.period_report_already_sent(p_report_instance_id)
--   (migrations/20260908090000_period_report_senders.sql:153-163) both key their "already sent"
--   answer on `d.status = 'sent'` SPECIFICALLY — the former with no message_kind clause (a manual
--   send always defaults report_kind to 'weekly', so it can never masquerade as the daily
--   broadcast), the latter additionally on `d.message_kind = 'template'` (a manual send sharing
--   the same report_instance_id must not suppress the automatic broadcast to everyone else). This
--   migration's WHERE clauses for both are left byte-for-byte as they are — do not widen either to
--   `status IN ('sent','delivered','read')` here.
--
--   The trade-off that leaves: report_record_delivery_status can legitimately move a row's status
--   forward from 'sent' to 'delivered' or 'read' (contract: one lifecycle, forward-only, same
--   status column — there is no second table to hold a receipt separately). The instant that
--   happens, that row NO LONGER matches `status = 'sent'`, so a same-day RE-CHECK of either
--   idempotency function after a receipt has landed would no longer see it and could, in
--   principle, allow a second send. Both idempotency functions are consulted once, synchronously,
--   immediately before a new send attempt for that exact date/instance — in the ordinary case that
--   is long before Meta could plausibly deliver a receipt for a message the same invocation is
--   only just about to send. Fully closing a same-day re-trigger race (an admin manually
--   re-running a send hours later, after the original has already been read) would require
--   widening one of those two WHERE clauses, which this plan explicitly does not do — flagged here
--   for whoever picks this up next, not solved by this migration.
--
-- OUT OF SCOPE: applying this migration. This worktree has no database credentials and no network
-- path to any database — a human applies this file separately, after review, exactly like every
-- other migration in this repo.
--
-- Idempotency of the file itself: every statement here is re-runnable (ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE, DROP CONSTRAINT IF EXISTS) — this repo's MCP apply path stamps its own
-- migration version, so a file can legitimately be executed more than once.
--
-- Conventions followed: SECURITY DEFINER RPCs with an explicit search_path, REVOKE-then-grant
-- privileges scoped to service_role only for the new write RPC, and the house
-- "DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT" pattern for widening a CHECK
-- (migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:58-63).

-- ============================================================================
-- 1. Widen report_deliveries_status_check — additive only.
-- ============================================================================

DO $$
BEGIN
    ALTER TABLE public.report_deliveries DROP CONSTRAINT IF EXISTS report_deliveries_status_check;
    ALTER TABLE public.report_deliveries ADD CONSTRAINT report_deliveries_status_check
        CHECK (status IN ('pending', 'sent', 'failed', 'delivered', 'read'));
END $$;

-- ============================================================================
-- 2. status_updated_at — when the last status change landed.
-- ============================================================================

ALTER TABLE public.report_deliveries ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

COMMENT ON COLUMN public.report_deliveries.status_updated_at IS
    'When report_record_delivery_status last moved this row''s status forward (sent -> delivered '
    '-> read), or NULL if no receipt has ever arrived. NOT the same as completed_at, which is set '
    'once by complete_report_delivery at the moment of the original send/failure — this column can '
    'keep moving after that.';

-- ============================================================================
-- 3. report_record_delivery_status — apply a Meta delivery/read receipt to report_deliveries.
--    Modelled directly on chat_record_whatsapp_status
--    (migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:280-319): same wamid-keyed
--    lookup, same "unknown status / no matching row" tolerance, same forward-only ranking.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_record_delivery_status(
    p_wamid  text DEFAULT NULL,
    p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_wamid  text := NULLIF(btrim(COALESCE(p_wamid, '')), '');
    v_status text := lower(NULLIF(btrim(COALESCE(p_status, '')), ''));
    v_rows   int;
BEGIN
    IF v_wamid IS NULL OR v_status IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'p_wamid and p_status are required.', 'updated', false);
    END IF;

    IF v_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
        -- Unknown Meta status: ignore rather than violate the CHECK constraint — same tolerance as
        -- chat_record_whatsapp_status.
        RETURN jsonb_build_object('success', 1, 'error', NULL, 'updated', false);
    END IF;

    -- Only ever move forward: sent(2) -> delivered(3) -> read(4). A late 'sent' must not clobber an
    -- already-'delivered'/'read' row. 'failed' always applies, matching
    -- chat_record_whatsapp_status's own unconditional-for-failed behaviour.
    --
    -- A wamid this table has never heard of (it belongs to a chat_messages row instead, or to
    -- neither) matches zero rows here — that is NORMAL, not a fault: the same webhook loop in
    -- whatsapp-inbound/index.ts feeds both chat_record_whatsapp_status and this function for every
    -- status entry, and a given wamid belongs to at most one of the two tables.
    UPDATE public.report_deliveries d
    SET status             = v_status,
        status_updated_at  = now(),
        error              = CASE WHEN v_status = 'failed'
                                   THEN COALESCE(d.error, 'Delivery failed.')
                                   ELSE d.error END
    WHERE d.external_message_id = v_wamid
      AND (
          v_status = 'failed'
          OR CASE d.status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 ELSE 1 END
             < CASE v_status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 ELSE 1 END
      );

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN jsonb_build_object('success', 1, 'error', NULL, 'updated', (v_rows > 0));
END;
$fn$;

COMMENT ON FUNCTION public.report_record_delivery_status(text, text) IS
    'Applies a Meta WhatsApp status webhook (sent/delivered/read/failed) to report_deliveries, '
    'keyed on external_message_id. Forward-only: never regresses read -> delivered -> sent. A wamid '
    'not found here is a no-op success, not an error. service_role only — called from '
    'supabase/functions/whatsapp-inbound/index.ts, never from the browser. Does NOT change what '
    'daily_report_already_sent / period_report_already_sent treat as "already sent" — both still '
    'key on status = ''sent'' exactly (see this migration''s header for the known trade-off that '
    'leaves).';

REVOKE ALL ON FUNCTION public.report_record_delivery_status(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_record_delivery_status(text, text) TO service_role;

-- ============================================================================
-- 4. list_report_deliveries — gains status_updated_at as a new final column.
--    CREATE OR REPLACE cannot change an existing RETURNS TABLE shape (42P13), so the old one is
--    dropped first — same idiom 20260825091000_daily_production_report.sql used to add
--    message_kind. Every other column and the WHERE/ORDER BY are unchanged from that file's
--    definition (:235-277).
-- ============================================================================

DROP FUNCTION IF EXISTS public.list_report_deliveries(uuid);

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
    link_expires_at     timestamptz,
    message_kind        text,
    status_updated_at   timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
    IF p_report_instance_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_report_instance_id is required.', NULL::uuid, NULL::uuid,
                            NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
                            NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz,
                            NULL::timestamptz, NULL::text, NULL::timestamptz;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 1, NULL::text, d.id, d.recipient_id, d.phone, d.display_name, d.channel, d.status,
           d.external_message_id, d.error, d.sent_by,
           NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
           d.created_at, d.completed_at, d.link_expires_at, d.message_kind, d.status_updated_at
    FROM public.report_deliveries d
    LEFT JOIN public.users u ON u.id = d.sent_by
    WHERE d.report_instance_id = p_report_instance_id
    ORDER BY d.created_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.list_report_deliveries(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
