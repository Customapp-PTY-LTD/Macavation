-- ============================================================================
-- Fix: 20260914150000 accidentally re-opened assistant_session_upsert and
-- assistant_validate_session to anon/authenticated.
--
-- WHY THIS IS SERIOUS: 20260716160000_portal_assistant_chat.sql deliberately
-- locked both functions to service_role only - they take a raw token and
-- (for assistant_session_upsert) a user_id with NO password check, because
-- the only legitimate caller is auth_login_email (SECURITY DEFINER, runs as
-- its owner - callers don't need their own EXECUTE grant to be reached via
-- another SECURITY DEFINER function) and whatsapp-enrol-staff/index.ts,
-- which authenticates exclusively via SUPABASE_SERVICE_ROLE_KEY (confirmed:
-- supabase/functions/whatsapp-enrol-staff/index.ts:44,69-71 - it never uses
-- the anon key). Neither real caller needs a direct anon/authenticated
-- grant.
--
-- 20260914150000 (widening the session TTL) copied a GRANT EXECUTE ...
-- TO anon, authenticated, service_role line without noticing the original
-- function was anon/authenticated-REVOKED on purpose. With that grant in
-- place, anyone holding this project's public anon key could call
-- assistant_session_upsert(any_token, any_user_id) directly over PostgREST
-- and mint themselves a valid session for an arbitrary user - no password,
-- no prior session - then use it to pass assistant_validate_session on every
-- WhatsApp-adjacent action (enrolment code send, report/alert send). Caught
-- and revoked directly on both the dev and prod databases the same day this
-- was introduced, before reporting it here; this migration is the
-- corresponding fix to the migration file itself so a fresh environment
-- never gets the open grant in the first place.
--
-- Idempotent: REVOKE/GRANT are safe to re-run.
-- ============================================================================

REVOKE ALL ON FUNCTION public.assistant_session_upsert(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assistant_validate_session(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_session_upsert(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.assistant_validate_session(text) TO service_role;

NOTIFY pgrst, 'reload schema';
