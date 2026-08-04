-- WhatsApp command audit log + logging RPC (Phase 2).
--
-- WHY: the command router this plan wires up in supabase/functions/whatsapp-inbound/index.ts
-- dispatches commands for enrolled staff (via whatsapp_resolve_staff_user and has_action, both
-- 20260815100000_staff_whatsapp_identity.sql / 20260815110000_generic_has_action_gate.sql), but
-- nothing records that any of this happened. Without an audit trail there is no way to answer
-- "did someone try to run X", including refused attempts — those are exactly the ones worth
-- being able to see. This migration adds the table and the one insert RPC the webhook calls.
--
-- service_role ONLY, same reasoning as the two migrations above: WebPortal/js/data-functions.js
-- calls every RPC as anon (useAnonAuth: true), so anything granted to anon/authenticated is
-- reachable by anyone holding the public anon key. whatsapp_log_command takes a caller-supplied
-- p_user_id, which is exactly the shape that must never be reachable from the browser.
--
-- OUT OF SCOPE: applying this migration (a human runs `npm run db:apply -- migrations/<this
-- file>.sql` — no database credential exists in the authoring environment), and any edit to
-- chat_ingest_inbound_whatsapp or the shared-inbox RPCs.

-- ============================================================================
-- 1. whatsapp_command_log — one row per dispatch attempt, refusals included.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_command_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text NOT NULL,
    user_id       uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    wamid         text NULL,
    raw_body      text NULL,
    command       text NULL,
    outcome       text NOT NULL,
    detail        text NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT whatsapp_command_log_outcome_check
        CHECK (outcome IN ('ok', 'unknown_command', 'not_enrolled', 'denied', 'error'))
);

COMMENT ON TABLE public.whatsapp_command_log IS
    'Audit trail for the WhatsApp command router (supabase/functions/whatsapp-inbound). Every '
    'dispatch attempt gets a row, including refusals (not_enrolled, denied, unknown_command) — '
    'an audit trail that only records successes cannot answer "did someone try". user_id is '
    'nullable because a not_enrolled attempt has no resolved user.';

ALTER TABLE public.whatsapp_command_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_command_log FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS ix_whatsapp_command_log_created ON public.whatsapp_command_log (created_at DESC);

-- ============================================================================
-- 2. whatsapp_log_command — service_role only. One insert per dispatch attempt.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_log_command(
    p_phone     text DEFAULT NULL,
    p_user_id   uuid DEFAULT NULL,
    p_wamid     text DEFAULT NULL,
    p_raw_body  text DEFAULT NULL,
    p_command   text DEFAULT NULL,
    p_outcome   text DEFAULT NULL,
    p_detail    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    INSERT INTO public.whatsapp_command_log (
        phone, user_id, wamid, raw_body, command, outcome, detail
    )
    VALUES (
        COALESCE(p_phone, ''), p_user_id, p_wamid, p_raw_body, p_command,
        COALESCE(p_outcome, 'error'), p_detail
    );
END;
$$;

COMMENT ON FUNCTION public.whatsapp_log_command(text, uuid, text, text, text, text, text) IS
    'SERVER-SIDE ONLY (service_role) — inserts one audit row for a WhatsApp command dispatch '
    'attempt. Called by the inbound webhook for every attempt, including refusals. NOT granted '
    'to anon/authenticated — see the header comment on why a client-asserted p_user_id cannot '
    'be treated as authenticated.';

-- role_permissions: this repo's second (largely vestigial, Lambda-proxy-era) RBAC layer
-- (see 20260813090000_whatsapp_inbound_shared_inbox.sql:586-587 and CLAUDE.md). This function
-- is not callable from the portal at all (see grants below), so per
-- docs/RBAC_NEW_FUNCTION_CHECKLIST.md it is granted to NO role — not every role. CLAUDE.md
-- records seeding a new function to every role as the exact pattern that caused this repo's
-- current permission drift; this migration does not repeat it.

-- ============================================================================
-- 3. GRANTS — service_role only. Never anon, never authenticated, never PUBLIC.
-- ============================================================================

REVOKE ALL ON FUNCTION public.whatsapp_log_command(text, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_log_command(text, uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_log_command(text, uuid, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_log_command(text, uuid, text, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
