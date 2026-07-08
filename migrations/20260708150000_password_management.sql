-- Self-service password management for the portal's custom (public.users) auth:
--   * change_password           — logged-in user changes own password (verifies current)
--   * request/confirm reset     — forgot-password token flow (token created server-side,
--                                 emailed by the send-password-reset edge function)
-- All passwords are bcrypt via extensions.crypt(), same as auth_login_email /
-- create_user_simple. DEV-ONLY; prod migration later.

-- 1. change_password ---------------------------------------------------------
-- Safe to expose to anon: it REQUIRES the current password to succeed.
CREATE OR REPLACE FUNCTION public.change_password(
    p_email            text,
    p_current_password text,
    p_new_password     text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    u record;
BEGIN
    IF coalesce(btrim(p_email), '') = '' OR coalesce(p_current_password, '') = ''
       OR coalesce(p_new_password, '') = '' THEN
        RETURN json_build_object('success', false, 'message', 'All fields are required.');
    END IF;
    IF length(p_new_password) < 8 THEN
        RETURN json_build_object('success', false, 'message', 'New password must be at least 8 characters.');
    END IF;

    SELECT id, password_hash, is_active INTO u
    FROM public.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;

    IF u.id IS NULL OR u.password_hash IS NULL
       OR u.password_hash <> crypt(p_current_password, u.password_hash) THEN
        RETURN json_build_object('success', false, 'message', 'Current password is incorrect.');
    END IF;
    IF u.is_active IS DISTINCT FROM true THEN
        RETURN json_build_object('success', false, 'message', 'This account is inactive.');
    END IF;

    UPDATE public.users
    SET password_hash = crypt(p_new_password, gen_salt('bf')), updated_at = now()
    WHERE id = u.id;

    RETURN json_build_object('success', true, 'message', 'Password changed successfully.');
END;
$$;

-- 2. password_reset_tokens ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
    token       text PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email       text NOT NULL,
    expires_at  timestamptz NOT NULL,
    used        boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);
-- Lock the table down: only SECURITY DEFINER functions / service_role touch it.
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_tokens FROM anon, authenticated;

-- 3. create_password_reset_token — server-side only (edge fn / service role) --
-- Returns the raw token. NEVER expose this to the browser; the edge function
-- calls it and emails the link.
CREATE OR REPLACE FUNCTION public.create_password_reset_token(p_email text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_user record;
    v_token text;
BEGIN
    SELECT id, email, is_active INTO v_user
    FROM public.users WHERE lower(email) = lower(btrim(p_email)) LIMIT 1;

    -- Do not reveal whether the email exists.
    IF v_user.id IS NULL OR v_user.is_active IS DISTINCT FROM true THEN
        RETURN NULL;
    END IF;

    v_token := encode(gen_random_bytes(32), 'hex');
    INSERT INTO public.password_reset_tokens (token, user_id, email, expires_at)
    VALUES (v_token, v_user.id, v_user.email, now() + interval '1 hour');

    RETURN v_token;
END;
$$;

-- 4. confirm_password_reset — anon (holds a valid token) ---------------------
CREATE OR REPLACE FUNCTION public.confirm_password_reset(
    p_token        text,
    p_new_password text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    t record;
BEGIN
    IF coalesce(p_token, '') = '' OR coalesce(p_new_password, '') = '' THEN
        RETURN json_build_object('success', false, 'message', 'Invalid request.');
    END IF;
    IF length(p_new_password) < 8 THEN
        RETURN json_build_object('success', false, 'message', 'New password must be at least 8 characters.');
    END IF;

    SELECT * INTO t FROM public.password_reset_tokens WHERE token = p_token LIMIT 1;

    IF t.token IS NULL OR t.used OR t.expires_at < now() THEN
        RETURN json_build_object('success', false, 'message', 'This reset link is invalid or has expired.');
    END IF;

    UPDATE public.users
    SET password_hash = crypt(p_new_password, gen_salt('bf')), updated_at = now()
    WHERE id = t.user_id;

    UPDATE public.password_reset_tokens SET used = true WHERE token = p_token;

    RETURN json_build_object('success', true, 'message', 'Password has been reset. You can now sign in.');
END;
$$;

-- 5. Grants ------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.change_password(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_password_reset(text, text) TO anon, authenticated, service_role;
-- Token creation is server-side only.
REVOKE ALL ON FUNCTION public.create_password_reset_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_password_reset_token(text) TO service_role;

NOTIFY pgrst, 'reload schema';
