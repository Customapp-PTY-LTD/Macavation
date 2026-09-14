-- ============================================================================
-- Assistant sessions: stop expiring on a much shorter clock than the portal
-- session they are supposed to shadow.
--
-- WHY: assistant_sessions (20260716160000) gates every WhatsApp-adjacent
-- action (send enrolment code, send a WhatsApp report/alert, portal
-- assistant chat) behind its own token, minted once at login and expiring
-- 24h later. It only slides forward when one of those SAME actions is used
-- again. The main portal login has no expiry of its own and never prompts a
-- re-login, so a user who logs in once and doesn't happen to touch a
-- WhatsApp action for a day silently loses this shadow session — then the
-- next enrolment-code send fails with "Invalid or expired session. Please
-- sign in again." even though they are still fully logged in. Confirmed
-- live: every row in assistant_sessions was already expired, the newest
-- over a week stale, while the portal itself was in daily use.
--
-- The 24h TTL was never protecting anything the main session doesn't already
-- allow unchallenged, so widen it instead of trying to keep the two in sync.
-- 30 days keeps a revoked/inactive user's access from lingering forever
-- while removing the day-to-day false failures. is_active on the user is
-- still checked on every validation, so deactivating someone still cuts
-- them off immediately regardless of this TTL.
--
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assistant_session_upsert(p_token text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success integer, error text, token_hash text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_token   text        := NULLIF(btrim(coalesce(p_token, '')), '');
    v_hash    text;
    v_expires timestamptz := now() + interval '30 days';
BEGIN
    IF v_token IS NULL OR p_user_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_token and p_user_id are required.', NULL::text, NULL::timestamptz;
        RETURN;
    END IF;

    v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

    -- ON CONSTRAINT (not the column-list form) because this function's
    -- RETURNS TABLE also declares a token_hash OUT param, which otherwise
    -- makes the ON CONFLICT column reference ambiguous.
    INSERT INTO public.assistant_sessions (user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at)
    VALUES (p_user_id, v_hash, now(), now(), v_expires, NULL)
    ON CONFLICT ON CONSTRAINT uq_assistant_sessions_token_hash DO UPDATE SET
        user_id      = EXCLUDED.user_id,
        last_seen_at = now(),
        expires_at   = v_expires,
        revoked_at   = NULL;

    RETURN QUERY SELECT 1, NULL::text, v_hash, v_expires;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assistant_validate_session(p_token text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, role_name text, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_token text := NULLIF(btrim(coalesce(p_token, '')), '');
    v_hash  text;
BEGIN
    IF v_token IS NULL THEN
        RETURN;
    END IF;

    v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

    UPDATE public.assistant_sessions s
    SET last_seen_at = now(), expires_at = now() + interval '30 days'
    WHERE s.token_hash = v_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now();

    RETURN QUERY
    SELECT u.id, r.role_name::text, u.email
    FROM public.assistant_sessions s
    JOIN public.users u ON u.id = s.user_id
    LEFT JOIN public.roles r ON r.id = u.role_id
    WHERE s.token_hash = v_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.is_active IS TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assistant_session_upsert(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assistant_validate_session(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
