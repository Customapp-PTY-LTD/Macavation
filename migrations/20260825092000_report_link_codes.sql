-- Short codes for report PDF links, and the "latest report" answer for the WhatsApp menu.
--
-- Context. A published report is currently sent as a 30-day signed Supabase Storage URL pasted into
-- the message body (supabase/functions/send-report-whatsapp/index.ts:62, :359-361). Two problems:
--
--   1. It cannot go on a Meta template URL button. A template's button URL has a base fixed at
--      approval time and takes only the short suffix replacing {{1}} — a signed URL full of '/' and
--      '?token=' cannot be that suffix. Reaching a recipient who has not messaged in 24 hours needs
--      a template, which needs a button, which needs a short code.
--   2. It is a working link to a confidential report sitting in a WhatsApp chat for a month,
--      forwardable, and impossible to withdraw. Superseding a report does not stop the old link.
--
-- So the message carries a code, and the code is exchanged for a SHORT-LIVED signed URL at the
-- moment somebody taps it. The confidential URL never sits anywhere, and a code can be revoked.
--
-- The code is a bearer credential: anyone holding it can read the report. That drives three choices
-- below — it is generated from a CSPRNG, it is never logged in full by the endpoint that resolves
-- it, and unknown/expired/revoked are deliberately indistinguishable to the caller.
--
-- Idempotency. Every statement is re-runnable: this repo's MCP apply path stamps its own migration
-- version, so a file can legitimately be executed more than once.

-- ============================================================================
-- 1. public.report_link_codes
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_link_codes (
    code               text PRIMARY KEY,
    report_instance_id uuid NOT NULL REFERENCES public.report_instances (id) ON DELETE CASCADE,
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz NULL,
    hit_count          integer NOT NULL DEFAULT 0,
    last_hit_at        timestamptz NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    CONSTRAINT report_link_codes_code_shape CHECK (code ~ '^[A-Za-z0-9_-]{8,64}$')
);

CREATE INDEX IF NOT EXISTS idx_report_link_codes_report_instance_id
    ON public.report_link_codes (report_instance_id);
CREATE INDEX IF NOT EXISTS idx_report_link_codes_expires_at
    ON public.report_link_codes (expires_at);

REVOKE ALL ON public.report_link_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.report_link_codes TO service_role;

COMMENT ON TABLE public.report_link_codes IS
    'Short codes standing in for a report PDF link. The code is a bearer credential — anyone holding it can read that report. Reached only through the RPCs below.';
COMMENT ON COLUMN public.report_link_codes.code IS
    'URL-safe, CSPRNG-generated. The CHECK mirrors the validation in supabase/functions/r, which rejects anything else before touching the database.';

-- ============================================================================
-- 2. mint_report_link_code
--
-- gen_random_bytes (pgcrypto) rather than md5(random()): random() is a PRNG seeded per session and
-- is guessable, and this code is the only thing standing between a URL and a confidential report.
-- 16 bytes base64url-encoded gives a 22-character code with 128 bits of entropy.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mint_report_link_code(
    p_report_instance_id uuid,
    p_ttl_days           int DEFAULT 30,
    p_actor_user_id      uuid DEFAULT NULL
)
RETURNS TABLE (success int, error text, code text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
    v_code    text;
    v_expires timestamptz;
    v_ttl     int := GREATEST(COALESCE(p_ttl_days, 30), 1);
BEGIN
    IF p_report_instance_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_report_instance_id is required.', NULL::text, NULL::timestamptz;
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.report_instances ri WHERE ri.id = p_report_instance_id) THEN
        RETURN QUERY SELECT 0, 'Report not found.', NULL::text, NULL::timestamptz;
        RETURN;
    END IF;

    -- base64 then made URL-safe and stripped of '=' padding, so the code is safe as a bare path
    -- segment and as a Meta template button parameter.
    v_code := translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=', '-_');
    v_expires := now() + make_interval(days => v_ttl);

    INSERT INTO public.report_link_codes (code, report_instance_id, expires_at, created_by)
    VALUES (v_code, p_report_instance_id, v_expires, p_actor_user_id);

    RETURN QUERY SELECT 1, NULL::text, v_code, v_expires;
END;
$fn$;

-- ============================================================================
-- 3. resolve_report_link_code
--
-- Called by the public supabase/functions/r endpoint. Returns the storage location so the endpoint
-- can mint a short-lived signed URL; it does NOT return a URL itself.
--
-- reason is for the server log only. The endpoint renders ONE generic 404 for not_found, expired and
-- revoked alike: a distinguishable "expired" tells someone probing codes that they found a real one.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_report_link_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_row     record;
    v_label   text;
    v_filename text;
BEGIN
    IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9_-]{8,64}$' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    SELECT c.code, c.expires_at, c.revoked_at,
           ri.id AS instance_id, ri.pdf_storage_bucket, ri.pdf_storage_path,
           ri.period_type, ri.period_start
    INTO v_row
    FROM public.report_link_codes c
    JOIN public.report_instances ri ON ri.id = c.report_instance_id
    WHERE c.code = p_code;

    IF v_row IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    IF v_row.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'revoked');
    END IF;

    IF v_row.expires_at <= now() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    END IF;

    -- A code can only ever be minted for a published report, but the PDF is uploaded by the send
    -- path — so a code whose report has no stored object is a real, reportable fault, not a 404.
    IF v_row.pdf_storage_bucket IS NULL OR v_row.pdf_storage_path IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'no_stored_pdf');
    END IF;

    UPDATE public.report_link_codes
    SET hit_count = hit_count + 1, last_hit_at = now()
    WHERE code = p_code;

    v_label := public.report_period_label(v_row.period_type, v_row.period_start);
    v_filename := 'Macavation-' || regexp_replace(COALESCE(v_label, 'report'), '[^A-Za-z0-9]+', '-', 'g') || '.pdf';

    RETURN jsonb_build_object(
        'ok',       true,
        'bucket',   v_row.pdf_storage_bucket,
        'path',     v_row.pdf_storage_path,
        'filename', v_filename
    );
END;
$fn$;

-- ============================================================================
-- 4. revoke_report_link_codes — switch off a withdrawn report's links
--
-- The reason the short code exists at all: a superseded report's old link should stop working. Not
-- wired to supersede_report_instance automatically, because re-issuing a report for a typo should
-- not necessarily kill a link somebody is mid-download on. Called deliberately.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.revoke_report_link_codes(p_report_instance_id uuid)
RETURNS TABLE (success int, error text, revoked int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_n int;
BEGIN
    IF p_report_instance_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_report_instance_id is required.', 0;
        RETURN;
    END IF;

    UPDATE public.report_link_codes
    SET revoked_at = now()
    WHERE report_instance_id = p_report_instance_id AND revoked_at IS NULL;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_n;
END;
$fn$;

-- ============================================================================
-- 5. get_latest_published_report_for_phone — the "Latest report link" menu answer
--
-- Only ever returns a report this phone ALREADY received: it looks for a 'sent' delivery row to that
-- number. It re-sends what somebody was given; it never grants access to something they were not
-- sent. A fresh code is minted per request with a short TTL, so an old chat message cannot be
-- replayed into a working link.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_latest_published_report_for_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_key  text := public.chat_normalize_phone(p_phone);
    v_row  record;
    v_code record;
BEGIN
    IF v_key IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    SELECT ri.id, ri.period_type, ri.period_start, ri.published_at
    INTO v_row
    FROM public.report_deliveries d
    JOIN public.report_instances ri ON ri.id = d.report_instance_id
    WHERE d.status = 'sent'
      AND public.chat_normalize_phone(d.phone) = v_key
      AND ri.status = 'published'
    ORDER BY ri.published_at DESC NULLS LAST
    LIMIT 1;

    IF v_row IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    SELECT * INTO v_code FROM public.mint_report_link_code(v_row.id, 7, NULL);

    IF v_code.success <> 1 THEN
        RETURN jsonb_build_object('found', false, 'error', v_code.error);
    END IF;

    RETURN jsonb_build_object(
        'found',        true,
        'period_label', public.report_period_label(v_row.period_type, v_row.period_start),
        'published_at', v_row.published_at,
        'link_code',    v_code.code,
        'expires_at',   v_code.expires_at
    );
END;
$fn$;

-- ============================================================================
-- 6. Grants
--
-- All service_role only. Every one of these either mints or redeems a bearer credential for a
-- confidential report, and the browser authenticates to PostgREST as anon with a publicly committed
-- key — an anon-reachable mint_report_link_code would hand anyone on the internet a working link to
-- any report whose id they could guess or enumerate.
-- ============================================================================

REVOKE ALL ON FUNCTION public.mint_report_link_code(uuid, int, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_report_link_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_report_link_codes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_latest_published_report_for_phone(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mint_report_link_code(uuid, int, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_report_link_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_report_link_codes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_latest_published_report_for_phone(text) TO service_role;

NOTIFY pgrst, 'reload schema';
