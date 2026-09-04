-- ============================================================================
-- Users: expose WhatsApp enrolment status to the Add/Edit User modal.
--
-- WHY: 20260815100000_staff_whatsapp_identity.sql added public.users.whatsapp_phone
-- and whatsapp_phone_verified_at as the VERIFIED WhatsApp identity, but no read
-- path ever returned them. get_users / get_user_by_id (last replaced by
-- 20260828120000_users_mobile_number.sql) return mobile_number and nothing about
-- enrolment, so the modal cannot tell an admin whether a user's handset is
-- enrolled, enrolled on a different number than the one typed in Mobile Number,
-- or not enrolled at all. Without that, the "Send enrolment code" action added
-- alongside this migration is a button with no state next to it: the admin
-- presses it, has no idea whether it already succeeded, and presses it again.
--
-- WHAT THIS DOES NOT DO: it adds no column, changes no write path, and grants
-- nothing new. whatsapp_phone is still written ONLY by
-- whatsapp_confirm_enrolment; mobile_number is still the admin-typed,
-- unverified contact number. This migration only widens two SELECT-only
-- readers.
--
-- BOTH NEW COLUMNS ARE APPENDED AT THE END of each RETURNS TABLE, deliberately.
-- A DROP + CREATE of a set-returning function renumbers its output columns, and
-- appending rather than inserting means no existing positional consumer shifts.
-- Every consumer in this repo reads by key (_normalizeListResponse in
-- WebPortal/js/data-functions.js), so this is belt-and-braces, not a fix.
--
-- SAFE TO EXPOSE: whatsapp_phone is a staff member's work contact number, shown
-- to an admin who can already read mobile_number and reset the same user's
-- password in the same modal. It is not a secret. The enrolment CODE is the
-- secret, and it lives in whatsapp_enrolment_codes, which this migration does
-- not touch and no read path returns.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. get_users: append whatsapp_phone + whatsapp_phone_verified_at ------------
DROP FUNCTION IF EXISTS public.get_users();
CREATE OR REPLACE FUNCTION public.get_users()
RETURNS TABLE(id uuid, email text, first_name text, last_name text,
              mobile_number text, role text,
              role_id uuid, role_name character varying, is_active boolean,
              created_at timestamptz, updated_at timestamptz,
              whatsapp_phone text, whatsapp_phone_verified_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.first_name, u.last_name, u.mobile_number, u.role, u.role_id,
           r.role_name, u.is_active, u.created_at, u.updated_at,
           u.whatsapp_phone, u.whatsapp_phone_verified_at
    FROM public.users u
    LEFT JOIN public.roles r ON u.role_id = r.id
    ORDER BY u.created_at DESC;
END;
$$;

-- 2. get_user_by_id: the same two columns ------------------------------------
DROP FUNCTION IF EXISTS public.get_user_by_id(uuid);
CREATE OR REPLACE FUNCTION public.get_user_by_id(p_id uuid)
RETURNS TABLE(id uuid, email text, first_name text, last_name text,
              mobile_number text, role text,
              role_id uuid, role_name character varying, is_active boolean,
              created_at timestamptz, updated_at timestamptz,
              whatsapp_phone text, whatsapp_phone_verified_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.first_name, u.last_name, u.mobile_number, u.role, u.role_id,
           r.role_name, u.is_active, u.created_at, u.updated_at,
           u.whatsapp_phone, u.whatsapp_phone_verified_at
    FROM public.users u
    LEFT JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = p_id;
END;
$$;

-- 3. Re-grant EXECUTE (dropped functions lose their grants) ------------------
--    Same grantee set the two functions already carried before this migration
--    (20260828120000_users_mobile_number.sql:5). No widening.
GRANT EXECUTE ON FUNCTION public.get_users() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_by_id(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
