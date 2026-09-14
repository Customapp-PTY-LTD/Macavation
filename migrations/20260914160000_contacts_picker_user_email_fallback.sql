-- ============================================================================
-- get_contacts_for_messaging(): fall back to email, not "Unnamed Contact",
-- for a portal user with no first_name/last_name saved.
--
-- WHY: most Macavation user accounts were created with only an email address
-- - first_name/last_name were never required to be filled in. Once the
-- "New chat" picker started listing users (20260914151500), every one of
-- those accounts rendered as a bare "Unnamed Contact" in the Staff group,
-- indistinguishable from every other one. Contacts keep the same fallback
-- (a real edge case there); users always have an email, so use it instead of
-- showing a wall of identical unlabelled rows.
--
-- Same signature as 20260914152500's version - CREATE OR REPLACE is enough.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_contacts_for_messaging(p_current_user_id uuid DEFAULT NULL)
RETURNS TABLE (
    id                     uuid,
    source_type            text,
    contact_type           character varying,
    company_name           character varying,
    primary_contact_name   character varying,
    primary_contact_phone  character varying,
    primary_contact_mobile character varying
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT combined.* FROM (
        SELECT
            c.id,
            'contact'::text AS source_type,
            c.contact_type,
            c.company_name,
            c.primary_contact_name,
            c.primary_contact_phone,
            c.primary_contact_mobile
        FROM public.contacts c
        WHERE c.status IS DISTINCT FROM 'inactive'

        UNION ALL

        SELECT
            u.id,
            'user'::text,
            NULL::character varying,
            NULL::character varying,
            COALESCE(
                NULLIF(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                u.email
            )::character varying,
            NULL::character varying,
            COALESCE(u.whatsapp_phone, u.mobile_number)::character varying
        FROM public.users u
        WHERE u.is_active IS TRUE
          AND (p_current_user_id IS NULL OR u.id <> p_current_user_id)
    ) combined
    ORDER BY COALESCE(combined.company_name, combined.primary_contact_name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contacts_for_messaging(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
