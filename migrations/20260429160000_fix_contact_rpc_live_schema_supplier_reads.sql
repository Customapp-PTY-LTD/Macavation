-- Align update_contact_simple with live public.contacts columns (no secondary_*, preferred_styles,
-- physical_area, or rate_* columns on hosted DB). Previous body raised SQL errors on every update,
-- so CRM saves and supplier_number edits never persisted.
-- Expose supplier_number from get_contacts / get_contact_by_id for Grower Intake + CRM.

DROP FUNCTION IF EXISTS public.get_contacts();
DROP FUNCTION IF EXISTS public.get_contact_by_id(uuid);

CREATE OR REPLACE FUNCTION public.update_contact_simple(
    p_contact_id uuid,
    p_contact_type varchar DEFAULT NULL,
    p_company_name varchar DEFAULT NULL,
    p_trading_name varchar DEFAULT NULL,
    p_primary_contact_name varchar DEFAULT NULL,
    p_primary_contact_email varchar DEFAULT NULL,
    p_primary_contact_phone varchar DEFAULT NULL,
    p_primary_contact_mobile varchar DEFAULT NULL,
    p_secondary_contact_name varchar DEFAULT NULL,
    p_secondary_contact_phone varchar DEFAULT NULL,
    p_secondary_contact_mobile varchar DEFAULT NULL,
    p_secondary_contact_email varchar DEFAULT NULL,
    p_preferred_styles text DEFAULT NULL,
    p_physical_area varchar DEFAULT NULL,
    p_physical_city varchar DEFAULT NULL,
    p_physical_province varchar DEFAULT NULL,
    p_physical_postal_code varchar DEFAULT NULL,
    p_account_manager_id uuid DEFAULT NULL,
    p_status varchar DEFAULT NULL,
    p_key_account boolean DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_rate_crude_kernel numeric DEFAULT NULL,
    p_rate_food_kernel numeric DEFAULT NULL,
    p_rate_kernel_dust numeric DEFAULT NULL,
    p_rate_cracker_dust numeric DEFAULT NULL,
    p_rate_crush numeric DEFAULT NULL,
    p_supplier_number integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact_id) THEN
        RETURN json_build_object('success', false, 'error', 'Contact not found');
    END IF;

    UPDATE public.contacts SET
        contact_type = COALESCE(p_contact_type, contact_type),
        company_name = COALESCE(p_company_name, company_name),
        trading_name = COALESCE(p_trading_name, trading_name),
        primary_contact_name = COALESCE(p_primary_contact_name, primary_contact_name),
        primary_contact_email = COALESCE(p_primary_contact_email, primary_contact_email),
        primary_contact_phone = COALESCE(p_primary_contact_phone, primary_contact_phone),
        primary_contact_mobile = COALESCE(p_primary_contact_mobile, primary_contact_mobile),
        physical_city = COALESCE(p_physical_city, physical_city),
        physical_province = COALESCE(p_physical_province, physical_province),
        physical_postal_code = COALESCE(p_physical_postal_code, physical_postal_code),
        account_manager_id = COALESCE(p_account_manager_id, account_manager_id),
        status = COALESCE(p_status, status),
        key_account = COALESCE(p_key_account, key_account),
        notes = COALESCE(p_notes, notes),
        supplier_number = CASE WHEN p_supplier_number IS NOT NULL THEN p_supplier_number ELSE supplier_number END,
        updated_at = NOW()
    WHERE id = p_contact_id;

    RETURN json_build_object('success', true, 'message', 'Contact updated successfully');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to update contact: ' || SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.update_contact_simple(
    uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
    text, varchar, varchar, varchar, varchar, uuid, varchar, boolean, text, numeric, numeric, numeric, numeric, numeric, integer
) IS 'Updates contact fields that exist on contacts; secondary/rates/preferred_styles params accepted for API compatibility but not stored (no columns).';

CREATE OR REPLACE FUNCTION public.get_contacts()
RETURNS TABLE(
    id uuid,
    contact_type character varying,
    company_name character varying,
    trading_name character varying,
    primary_contact_name character varying,
    primary_contact_email character varying,
    primary_contact_phone character varying,
    account_manager_id uuid,
    account_manager_name text,
    key_account boolean,
    supplier_number integer,
    status character varying,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.contact_type,
        c.company_name,
        c.trading_name,
        c.primary_contact_name,
        c.primary_contact_email,
        c.primary_contact_phone,
        c.account_manager_id,
        COALESCE(u.username, u.email, 'N/A') AS account_manager_name,
        c.key_account,
        c.supplier_number,
        c.status,
        c.created_at
    FROM public.contacts c
    LEFT JOIN public.users u ON c.account_manager_id = u.id
    WHERE c.deleted_at IS NULL
    ORDER BY c.company_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_contact_by_id(p_id uuid)
RETURNS TABLE(
    id uuid,
    contact_type character varying,
    company_name character varying,
    trading_name character varying,
    registration_number character varying,
    vat_number character varying,
    primary_contact_name character varying,
    primary_contact_title character varying,
    primary_contact_email character varying,
    primary_contact_phone character varying,
    primary_contact_mobile character varying,
    physical_address_line1 character varying,
    physical_city character varying,
    physical_province character varying,
    physical_postal_code character varying,
    account_manager_id uuid,
    credit_limit numeric,
    payment_terms integer,
    status character varying,
    key_account boolean,
    notes text,
    supplier_number integer,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id, c.contact_type, c.company_name, c.trading_name,
        c.registration_number, c.vat_number,
        c.primary_contact_name, c.primary_contact_title,
        c.primary_contact_email, c.primary_contact_phone, c.primary_contact_mobile,
        c.physical_address_line1, c.physical_city, c.physical_province, c.physical_postal_code,
        c.account_manager_id, c.credit_limit, c.payment_terms,
        c.status, c.key_account, c.notes,
        c.supplier_number,
        c.created_at
    FROM public.contacts c
    WHERE c.id = p_id AND c.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contacts() TO anon;
GRANT EXECUTE ON FUNCTION public.get_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contacts() TO service_role;

GRANT EXECUTE ON FUNCTION public.get_contact_by_id(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_contact_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_by_id(uuid) TO service_role;
