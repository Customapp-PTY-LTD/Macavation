-- WhatsApp confirm/cancel plumbing for commands that WRITE (Phase 2).
--
-- WHY: the command router (supabase/functions/whatsapp-inbound/index.ts,
-- 20260815120000_whatsapp_command_log.sql) handles read-only commands fine, but the command that
-- motivates this feature — capturing a production figure from the factory floor — writes a number
-- (kernel_day_kg) that feeds the dashboard's kg-cracked tiles, Production Trends, the raw-material
-- runway forecast, the kernel mass balance, and the daily digest. A mistyped 69000 instead of 6900
-- would quietly move all of them. So a write command must be staged, echoed back, and only applied
-- once the sender replies YES. This migration adds the generic staging table and RPCs; NO write
-- command is implemented here (see the plan) — the handler map in the edge function stays empty
-- until the next plan registers a real one.
--
-- WHY A TABLE, NOT IN-MEMORY STATE: edge functions are stateless and may serve consecutive messages
-- on different instances, so the pending command cannot live in a module variable. Keyed on phone
-- (not a surrogate id) for the same reason whatsapp_enrolment_codes.phone is its primary key: a
-- second pending command from the same handset replaces the first rather than leaving two live
-- confirmations outstanding.
--
-- service_role ONLY, same reasoning as every other WhatsApp RPC in this repo:
-- WebPortal/js/data-functions.js calls every RPC as PostgREST role anon (useAnonAuth: true), so any
-- function granted to anon/authenticated is reachable by anyone holding the public anon key, and a
-- caller-supplied p_user_id is client-asserted, not authenticated.
--
-- OUT OF SCOPE (see the plan): any actual write command, applying this migration (a human runs
-- `npm run db:apply -- migrations/<this file>.sql`), and deploying the edge function. Also out of
-- scope: a sweep/cron for expired rows — the table is tiny, keyed by phone, and self-replacing on
-- the next stage; if a sweep is ever wanted that is its own decision, not this one's.

-- ============================================================================
-- 1. whatsapp_pending_commands — one row per phone, short-lived.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_pending_commands (
    phone        text PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    command      text NOT NULL,
    payload      jsonb NOT NULL,
    summary      text NOT NULL,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_pending_commands IS
    'A staged WhatsApp write command awaiting YES/NO confirmation from the sender. phone is the '
    'primary key: staging a second command for the same number replaces the first rather than '
    'leaving two live confirmations. summary is the exact sentence shown to the user, so what they '
    'confirmed and what they were shown can never drift apart. payload holds the parsed arguments '
    'the eventual handler acts on. Rows are taken (deleted) by whatsapp_take_pending_command or '
    'cleared by whatsapp_clear_pending_command; there is no sweep job — the table is tiny, keyed by '
    'phone, and self-replacing.';

ALTER TABLE public.whatsapp_pending_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_pending_commands FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. whatsapp_stage_pending_command — service_role only. Upserts the pending row.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_stage_pending_command(
    p_phone   text DEFAULT NULL,
    p_user_id uuid DEFAULT NULL,
    p_command text DEFAULT NULL,
    p_payload jsonb DEFAULT NULL,
    p_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_phone   text;
    v_expires timestamptz;
BEGIN
    v_phone := public.chat_normalize_phone(p_phone);
    IF v_phone IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Invalid phone number.');
    END IF;

    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Missing user.');
    END IF;

    IF COALESCE(btrim(p_command), '') = '' THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Missing command.');
    END IF;

    IF COALESCE(btrim(p_summary), '') = '' THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Missing summary.');
    END IF;

    v_expires := now() + interval '10 minutes';

    INSERT INTO public.whatsapp_pending_commands (
        phone, user_id, command, payload, summary, expires_at, created_at
    )
    VALUES (
        v_phone, p_user_id, upper(btrim(p_command)), COALESCE(p_payload, '{}'::jsonb), p_summary,
        v_expires, now()
    )
    ON CONFLICT (phone) DO UPDATE
    SET user_id    = EXCLUDED.user_id,
        command    = EXCLUDED.command,
        payload    = EXCLUDED.payload,
        summary    = EXCLUDED.summary,
        expires_at = EXCLUDED.expires_at,
        created_at = EXCLUDED.created_at;

    RETURN jsonb_build_object('success', 1, 'summary', p_summary, 'expires_at', v_expires);
END;
$$;

COMMENT ON FUNCTION public.whatsapp_stage_pending_command(text, uuid, text, jsonb, text) IS
    'SERVER-SIDE ONLY (service_role) — stages a write command awaiting YES/NO. Upserts on phone: a '
    'second staged command for the same number replaces the first.';

-- ============================================================================
-- 3. whatsapp_take_pending_command — service_role only. Fetch-and-delete in ONE
--    statement so a duplicate inbound webhook delivery can never apply a command twice
--    (Control Room warns duplicates are possible; whatsapp-inbound/index.ts:36).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_take_pending_command(
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

    DELETE FROM public.whatsapp_pending_commands
     WHERE phone = v_phone
       AND user_id = p_user_id
       AND expires_at > now()
    RETURNING command, payload, summary INTO v_row;

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

COMMENT ON FUNCTION public.whatsapp_take_pending_command(text, uuid) IS
    'SERVER-SIDE ONLY (service_role) — the confirmation path for YES. Fetch-and-delete in a SINGLE '
    'DELETE ... RETURNING statement (never SELECT then DELETE) so a duplicate inbound webhook '
    'delivery cannot take — and therefore apply — the same pending command twice. Matches on phone, '
    'user_id AND expires_at > now(); an expired row is simply never taken. Matching on user_id as '
    'well as phone means a re-enrolled number cannot inherit the previous user''s pending command.';

-- ============================================================================
-- 4. whatsapp_clear_pending_command — service_role only. Cancels (NO).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_clear_pending_command(
    p_phone   text DEFAULT NULL,
    p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_phone   text;
    v_deleted integer;
BEGIN
    v_phone := public.chat_normalize_phone(p_phone);
    IF v_phone IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'cleared', 0, 'error', 'Nothing pending.');
    END IF;

    DELETE FROM public.whatsapp_pending_commands
     WHERE phone = v_phone
       AND user_id = p_user_id
       AND expires_at > now();
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    IF v_deleted = 0 THEN
        RETURN jsonb_build_object('success', 0, 'cleared', 0, 'error', 'Nothing pending.');
    END IF;

    RETURN jsonb_build_object('success', 1, 'cleared', v_deleted);
END;
$$;

COMMENT ON FUNCTION public.whatsapp_clear_pending_command(text, uuid) IS
    'SERVER-SIDE ONLY (service_role) — the cancellation path for NO. Deletes the pending row for '
    'this phone + user_id if one is still live (expires_at > now()); reports whether there was '
    'anything to cancel.';

-- ============================================================================
-- 5. role_permissions seed — convention only, NOT the access control (see
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
        'whatsapp_stage_pending_command', 'whatsapp_take_pending_command',
        'whatsapp_clear_pending_command'
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
-- 6. GRANTS — service_role only. Never anon, never authenticated, never PUBLIC.
-- ============================================================================

REVOKE ALL ON FUNCTION public.whatsapp_stage_pending_command(text, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_stage_pending_command(text, uuid, text, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_stage_pending_command(text, uuid, text, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_stage_pending_command(text, uuid, text, jsonb, text) TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_take_pending_command(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_take_pending_command(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_take_pending_command(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_take_pending_command(text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_clear_pending_command(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_clear_pending_command(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_clear_pending_command(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_clear_pending_command(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
