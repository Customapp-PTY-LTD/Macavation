-- ============================================================================
-- Users: persist the Mobile Number captured in the Add/Edit User modal.
--
-- WHY: WebPortal/modules/modals/modal-user/html/modal_user.html has carried a
-- "Mobile Number" input (#txtMobile) since the modal was written, but nothing
-- downstream ever read it: the modal JS never populated or collected it,
-- dataFunctions.createUser/updateUser never sent it, create_user_simple /
-- update_user_simple had no parameter for it, and public.users had no column
-- to hold it. Admins typed a number, pressed Save, and it was silently
-- dropped. This migration builds the missing storage and plumbing.
--
-- DELIBERATELY NOT whatsapp_phone: that column (20260815100000) is the
-- verified WhatsApp *identity*, written only by whatsapp_confirm_enrolment,
-- carries a unique index, and must not be trusted unless
-- whatsapp_phone_verified_at IS NOT NULL. An admin-typed contact number is a
-- different fact with a different level of trust; writing it there would fake
-- enrolment, and two staff sharing a handset would fail the unique index on
-- save.
--
-- CLEARING: the existing update_user_simple treats a NULL parameter as "leave
-- unchanged". That is precisely the behaviour that would stop an admin from
-- ever removing a wrong number, so p_mobile_number uses a blank string as the
-- explicit "clear it" signal: NULL = leave alone, blank = set NULL.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. SCHEMA ------------------------------------------------------------------
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS mobile_number text;

COMMENT ON COLUMN public.users.mobile_number IS
    'Free-text contact mobile number as captured by an admin in the Add/Edit User modal. '
    'Stored trimmed, NULL when blank. NOT an identity: it is unverified and must never be '
    'used to authorise anything - see users.whatsapp_phone for the verified WhatsApp identity.';

-- 2. create_user_simple: accept the mobile number ----------------------------
DROP FUNCTION IF EXISTS public.create_user_simple(text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.create_user_simple(text, text, text, uuid, text, text);
CREATE OR REPLACE FUNCTION public.create_user_simple(
    p_email         text,
    p_first_name    text DEFAULT NULL,
    p_last_name     text DEFAULT NULL,
    p_role_id       uuid DEFAULT NULL,
    p_password      text DEFAULT NULL,
    p_mobile_number text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_id uuid;
    v_role_name varchar;
    v_password_hash text;
BEGIN
    IF p_role_id IS NOT NULL THEN
        SELECT role_name INTO v_role_name FROM public.roles WHERE id = p_role_id;
    END IF;
    IF p_password IS NOT NULL AND p_password <> '' THEN
        v_password_hash := crypt(p_password, gen_salt('bf'));
    END IF;

    INSERT INTO public.users (email, first_name, last_name, role_id, role, password_hash, mobile_number)
    VALUES (
        p_email,
        initcap(nullif(btrim(p_first_name), '')),
        initcap(nullif(btrim(p_last_name), '')),
        p_role_id, v_role_name, v_password_hash,
        nullif(btrim(coalesce(p_mobile_number, '')), '')
    )
    RETURNING id INTO v_id;

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'User created successfully');
END;
$$;

-- 3. update_user_simple: accept the mobile number, and allow clearing it -----
DROP FUNCTION IF EXISTS public.update_user_simple(uuid, text, text, text, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.update_user_simple(uuid, text, text, text, uuid, boolean, text, text);
CREATE OR REPLACE FUNCTION public.update_user_simple(
    p_user_id       uuid,
    p_email         text    DEFAULT NULL,
    p_first_name    text    DEFAULT NULL,
    p_last_name     text    DEFAULT NULL,
    p_role_id       uuid    DEFAULT NULL,
    p_is_active     boolean DEFAULT NULL,
    p_password      text    DEFAULT NULL,
    p_mobile_number text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_role_name varchar;
    v_password_hash text;
BEGIN
    IF p_role_id IS NOT NULL THEN
        SELECT role_name INTO v_role_name FROM public.roles WHERE id = p_role_id;
    END IF;
    IF p_password IS NOT NULL AND p_password <> '' THEN
        v_password_hash := crypt(p_password, gen_salt('bf'));
    END IF;

    UPDATE public.users
    SET email         = COALESCE(p_email, email),
        first_name    = COALESCE(initcap(nullif(btrim(p_first_name), '')), first_name),
        last_name     = COALESCE(initcap(nullif(btrim(p_last_name), '')), last_name),
        role_id       = COALESCE(p_role_id, role_id),
        role          = COALESCE(v_role_name, role),
        is_active     = COALESCE(p_is_active, is_active),
        password_hash = COALESCE(v_password_hash, password_hash),
        -- NULL = caller sent nothing, leave as-is. Blank = caller cleared the box.
        mobile_number = CASE
                            WHEN p_mobile_number IS NULL     THEN mobile_number
                            WHEN btrim(p_mobile_number) = '' THEN NULL
                            ELSE btrim(p_mobile_number)
                        END,
        updated_at    = now()
    WHERE id = p_user_id;

    RETURN json_build_object('success', true, 'id', p_user_id, 'message', 'User updated successfully');
END;
$$;

-- 4. get_users / get_user_by_id: return the mobile number so the Edit modal
--    can show what is already stored. The users grid feeds the modal from
--    get_users, so without this the box would reopen blank every time.
DROP FUNCTION IF EXISTS public.get_users();
CREATE OR REPLACE FUNCTION public.get_users()
RETURNS TABLE(id uuid, email text, first_name text, last_name text,
              mobile_number text, role text,
              role_id uuid, role_name character varying, is_active boolean,
              created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.first_name, u.last_name, u.mobile_number, u.role, u.role_id,
           r.role_name, u.is_active, u.created_at, u.updated_at
    FROM public.users u
    LEFT JOIN public.roles r ON u.role_id = r.id
    ORDER BY u.created_at DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.get_user_by_id(uuid);
CREATE OR REPLACE FUNCTION public.get_user_by_id(p_id uuid)
RETURNS TABLE(id uuid, email text, first_name text, last_name text,
              mobile_number text, role text,
              role_id uuid, role_name character varying, is_active boolean,
              created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.first_name, u.last_name, u.mobile_number, u.role, u.role_id,
           r.role_name, u.is_active, u.created_at, u.updated_at
    FROM public.users u
    LEFT JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = p_id;
END;
$$;

-- 5. Re-grant EXECUTE (dropped functions lose their grants) ------------------
GRANT EXECUTE ON FUNCTION public.create_user_simple(text, text, text, uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_user_simple(uuid, text, text, text, uuid, boolean, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_users() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_by_id(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
