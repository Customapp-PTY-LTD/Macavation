-- The CRM edit modal reads contact.secondary_contact_*, preferred_styles, physical_area and
-- rate_* (modal_crm_contact.js populate step), but get_contact_by_id never returned them, so
-- those inputs always rendered blank when editing an existing contact.
--
-- 20260818090200 made the write side persist these columns. Without this read-side change the
-- stored values stay invisible: the user opens a contact, sees empty rate/secondary fields, and
-- has no way to review or correct them. (No data was lost in that state — the portal strips
-- empty strings before sending, so update_contact_simple's COALESCE kept the stored value.)
--
-- Return type changes, so the function must be dropped and recreated rather than REPLACEd.

DROP FUNCTION IF EXISTS public.get_contact_by_id(uuid);

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
    secondary_contact_name character varying,
    secondary_contact_phone character varying,
    secondary_contact_mobile character varying,
    secondary_contact_email character varying,
    preferred_styles text,
    physical_address_line1 character varying,
    physical_area character varying,
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
    rate_crude_kernel numeric,
    rate_food_kernel numeric,
    rate_kernel_dust numeric,
    rate_cracker_dust numeric,
    rate_crush numeric,
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
        c.secondary_contact_name, c.secondary_contact_phone,
        c.secondary_contact_mobile, c.secondary_contact_email,
        c.preferred_styles,
        c.physical_address_line1, c.physical_area, c.physical_city,
        c.physical_province, c.physical_postal_code,
        c.account_manager_id, c.credit_limit, c.payment_terms,
        c.status, c.key_account, c.notes,
        c.supplier_number,
        c.rate_crude_kernel, c.rate_food_kernel, c.rate_kernel_dust,
        c.rate_cracker_dust, c.rate_crush,
        c.created_at
    FROM public.contacts c
    WHERE c.id = p_id AND c.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_contact_by_id(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_contact_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_by_id(uuid) TO service_role;

COMMENT ON FUNCTION public.get_contact_by_id(uuid) IS
'Returns one contact with every field the CRM edit modal binds, including secondary contact, preferred styles, physical area and oil-processor rates.';
