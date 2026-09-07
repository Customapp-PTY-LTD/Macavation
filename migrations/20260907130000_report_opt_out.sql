-- WhatsApp report opt-out — a compliance gate every sender must pass, and a pause that can be lifted.
--
-- Context. Macavation can already send report templates to a handset that has never replied, and
-- nothing anywhere lets the person on that handset stop them. Meta requires a working opt-out on a
-- business number, POPIA requires one locally, and a number that cannot say no is the fastest way
-- to lose the number's quality rating — which cuts the daily send limit for every message this
-- business sends, reports included.
--
-- public.report_subscriptions already carries muted_until date and
-- set_report_subscription_by_phone (migrations/20260825090000_report_subscriptions_and_staff.sql:335)
-- already exists, is service_role-granted, and has zero callers in this repo — the pause half is
-- mostly wiring, landed by a sibling change to supabase/functions/whatsapp-inbound/index.ts. The
-- opt-out half does not exist at all until this file: there is no column for it, and
-- report_recipients.is_active is NOT it — that is the administrator's switch on the distribution
-- panel, not the member's. See the COMMENT ON COLUMN below for why the two must never be conflated.
--
-- Two schema facts this file works around (read them before touching anything here, or in any
-- future migration that adds another INSERT into report_recipients or another caller of the
-- resolution idiom below):
--
--   1. report_recipients.display_name is `text NOT NULL`
--      (migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:77). Every INSERT
--      this file adds supplies a non-NULL display_name (the canonical phone form) — an INSERT that
--      left it NULL would raise 23502 at runtime, the calling edge function would swallow it, and
--      the opt-out would be silently NOT recorded while every textual check on the caller passed.
--
--   2. The existing inbound-phone-to-roster bridge RPC
--      (migrations/20260825090000_report_subscriptions_and_staff.sql:289-329) filters
--      `AND rr.is_active` (:311), and so does set_report_subscription_by_phone (:360). A
--      report_recipients row with is_active = false is invisible to both, forever. The two RPCs
--      below therefore do NOT resolve through that bridge RPC — they resolve with
--      `public.chat_normalize_phone(rr.phone) = public.chat_normalize_phone(p_phone)` (the same
--      comparison idiom set_report_subscription_by_phone:360 uses, minus the is_active filter) so a
--      second STOP, a START, and an admin-deactivated roster row are all still reachable.
--
-- Pre-existing exposure this migration's own design makes WORSE — flagged for a human, not fixed
-- here. public.list_report_distribution(boolean) is granted to anon
-- (migrations/20260825090000_report_subscriptions_and_staff.sql:394) and returns rr.phone for every
-- row, including inactive ones when called with p_include_inactive=true. Before this migration, that
-- grant only ever exposed the phone numbers of people someone had deliberately added to the roster.
-- After report_set_opt_out below, a number that has never been anything but a stranger who once
-- texted STOP now gets a roster row too (is_active=false, a real phone number) — so
-- list_report_distribution becomes newly capable of enumerating the phone numbers of people who
-- contacted this business only to ask to be left alone, to anyone holding the committed anon key.
-- This migration does NOT change that grant — that is list_report_recipients's and the portal's
-- concern, out of scope here — but it is recorded here so a reviewer sees it named rather than
-- discovering it later.
--
-- OUT OF SCOPE: applying this migration. This worktree has no database credentials and no network
-- path to any database — a human applies migrations/20260907130000_report_opt_out.sql separately,
-- after review, exactly like every other migration in this repo.
--
-- Idempotency. Every statement here is re-runnable (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE),
-- matching the idempotency note both sibling migrations open with — this repo's MCP apply path
-- stamps its own migration version, so a file can legitimately be executed more than once.
--
-- Conventions followed: snake_case, SECURITY DEFINER RPCs with an explicit search_path,
-- REVOKE-then-grant privileges scoped to service_role only (the two new RPCs take a bare phone
-- number, so an anon/authenticated grant would let anyone on the internet opt somebody else out, or
-- enumerate whether a given number is on a confidential distribution list).

-- ============================================================================
-- 1. The column
-- ============================================================================

ALTER TABLE public.report_recipients ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;

COMMENT ON COLUMN public.report_recipients.opted_out_at IS
    'When this number asked (via a typed WhatsApp STOP) not to receive report messages. NULL means '
    '"never asked". This is the audit record of the request, not a toggle — is_active is NOT a '
    'substitute: is_active is the administrator''s switch on the distribution panel, and an admin '
    're-activating a row must never silently re-subscribe somebody who opted out. Gated in the '
    'SELECTOR (report_daily_recipients), never in a sender, so a sender that forgets a check cannot '
    'reintroduce this bug. Written and cleared only by public.report_set_opt_out.';

-- No new index: the roster is small and every selector over it already scans and orders by
-- display_name.

-- ============================================================================
-- 2. public.report_set_opt_out — the write half
--
-- Resolves without the is_active filter (schema fact 2 above) and never calls the existing
-- inbound-phone-to-roster bridge RPC (schema fact 2, this file's header). Envelope keys,
-- referenced by name elsewhere in this repo: ok, error, found, opted_out, created.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_set_opt_out(
    p_phone      text,
    p_opted_out  boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_key     text := public.chat_normalize_phone(p_phone);
    v_canon   text := public.report_normalize_wa_phone(p_phone);
    v_id      uuid;
    v_name    text;
    v_created boolean := false;
BEGIN
    IF v_key IS NULL OR v_canon IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'error', 'A valid phone number is required.',
            'found', false, 'opted_out', false, 'created', false
        );
    END IF;

    -- Resolve on the same idiom set_report_subscription_by_phone:360 uses, minus the is_active
    -- filter — a report_recipients row with is_active = false must still be reachable here.
    SELECT rr.id, rr.display_name INTO v_id, v_name
    FROM public.report_recipients rr
    WHERE public.chat_normalize_phone(rr.phone) = v_key
    LIMIT 1;

    IF v_id IS NULL THEN
        IF COALESCE(p_opted_out, false) = false THEN
            -- Nothing to clear, and creating a row in response to START would opt somebody out for
            -- asking to be resumed. Leave the roster untouched.
            RETURN jsonb_build_object(
                'ok', true, 'error', NULL,
                'found', false, 'opted_out', false, 'created', false
            );
        END IF;

        -- STOP from a number nobody has ever added to the roster: insert a minimal, inactive row so
        -- the opt-out is remembered even if somebody adds this number to a distribution list later.
        BEGIN
            INSERT INTO public.report_recipients
                (display_name, phone, source, is_active, opted_out_at)
            VALUES
                (v_canon, v_canon, 'whatsapp_chat', false, now())
            RETURNING report_recipients.id, report_recipients.display_name INTO v_id, v_name;
            v_created := true;
        EXCEPTION WHEN unique_violation THEN
            -- Lost a race against idx_report_recipients_phone_norm — re-resolve rather than error.
            SELECT rr.id, rr.display_name INTO v_id, v_name
            FROM public.report_recipients rr
            WHERE public.chat_normalize_phone(rr.phone) = v_key
            LIMIT 1;
        END;
    END IF;

    UPDATE public.report_recipients
    SET opted_out_at = CASE WHEN COALESCE(p_opted_out, false)
                            THEN COALESCE(opted_out_at, now())
                            ELSE NULL END,
        updated_at   = now()
    WHERE id = v_id;

    RETURN jsonb_build_object(
        'ok', true, 'error', NULL,
        'found', true,
        'opted_out', COALESCE(p_opted_out, false),
        'created', v_created
    );
END;
$fn$;

COMMENT ON FUNCTION public.report_set_opt_out(text, boolean) IS
    'Sets or clears report_recipients.opted_out_at for the given phone number. Resolves WITHOUT the '
    'is_active filter (see this file''s header, schema fact 2) so a second STOP, a START, and an '
    'admin-deactivated roster row are all still reachable. Never touches is_active or any '
    'report_subscriptions row — that is set_report_subscription_by_phone''s / '
    'set_report_recipient_active''s job. service_role only.';

-- ============================================================================
-- 3. public.report_opt_out_status — the read half
--
-- Exists because nothing else in this checkout can answer "is this number opted out?" — the
-- existing inbound-phone-to-roster bridge RPC (schema fact 2, this file's header) does not return
-- the column and filters is_active. Envelope keys: ok, error, found, opted_out, opted_out_at.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_opt_out_status(
    p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_key text := public.chat_normalize_phone(p_phone);
    v_row record;
BEGIN
    IF v_key IS NULL THEN
        RETURN jsonb_build_object(
            'ok', false, 'error', 'A valid phone number is required.',
            'found', false, 'opted_out', false, 'opted_out_at', NULL
        );
    END IF;

    SELECT rr.id, rr.opted_out_at INTO v_row
    FROM public.report_recipients rr
    WHERE public.chat_normalize_phone(rr.phone) = v_key
    LIMIT 1;

    IF v_row IS NULL THEN
        RETURN jsonb_build_object(
            'ok', true, 'error', NULL,
            'found', false, 'opted_out', false, 'opted_out_at', NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'ok', true, 'error', NULL,
        'found', true,
        'opted_out', (v_row.opted_out_at IS NOT NULL),
        'opted_out_at', v_row.opted_out_at
    );
END;
$fn$;

COMMENT ON FUNCTION public.report_opt_out_status(text) IS
    'Reads report_recipients.opted_out_at for the given phone number, normalising internally so a '
    'browser-supplied 082... matches a stored +2782.... Resolves WITHOUT the is_active filter (see '
    'this file''s header, schema fact 2). Called by whatsapp-inbound''s START interceptor and by '
    'send-report-whatsapp''s per-recipient refusal check. service_role only.';

-- ============================================================================
-- 4. Amend report_daily_recipients() — the gate lives in the selector, never in a sender
--
-- Every other line is kept verbatim, including rr.is_active, rs.is_active, the muted_until /
-- report_sast_today() pause clause and the ORDER BY. Rewriting this function is exactly how the
-- pause would silently disappear.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_daily_recipients()
RETURNS TABLE (
    recipient_id uuid,
    display_name text,
    phone        text,
    is_staff     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT rr.id, rr.display_name, public.report_normalize_wa_phone(rr.phone), rr.is_staff
    FROM public.report_recipients rr
    JOIN public.report_subscriptions rs
      ON rs.recipient_id = rr.id AND rs.report_kind = 'daily'
    WHERE rr.is_active
      AND rs.is_active
      AND rr.opted_out_at IS NULL
      AND (rs.muted_until IS NULL OR rs.muted_until < public.report_sast_today())
    ORDER BY rr.display_name;
$fn$;

-- ============================================================================
-- 5. Grants — service_role only, matching
--    migrations/20260825090000_report_subscriptions_and_staff.sql:398-403 exactly.
-- ============================================================================

REVOKE ALL ON FUNCTION public.report_set_opt_out(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_opt_out_status(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_set_opt_out(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_opt_out_status(text) TO service_role;

-- report_daily_recipients() keeps its existing grants (:398, :401) — CREATE OR REPLACE does not
-- drop them, and this file does not touch them.

NOTIFY pgrst, 'reload schema';
