-- ============================================================================
-- Fix get_contacts_for_messaging(): ORDER BY column reference was ambiguous.
--
-- WHY: 20260914151500 added `ORDER BY COALESCE(company_name, primary_contact_name)`
-- to the UNION ALL RETURN QUERY. Postgres accepted the CREATE FUNCTION (a
-- plpgsql body is not fully validated until first executed), but every call
-- failed at runtime with "column reference \"company_name\" is ambiguous" -
-- those bare names match both the function's own RETURNS TABLE OUT
-- parameters and the query's result columns of the same name. Caught
-- immediately when applying the migration and calling the function to
-- verify, before anyone hit it live.
--
-- FIX: wrap the UNION ALL in a derived table (aliased "combined") and
-- qualify the ORDER BY against it, which is unambiguous.
--
-- Same signature as 20260914151500's version - CREATE OR REPLACE is enough,
-- no DROP needed.
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
            NULLIF(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '')::character varying,
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
