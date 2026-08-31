-- CRM saves silently discarded fields the user typed.
--
-- 20260429160000 rewrote update_contact_simple on the belief that contacts had no
-- secondary_*, preferred_styles, physical_area or rate_* columns ("no ... columns on
-- hosted DB"), so it accepted those parameters and threw them away. Those columns DO
-- exist now (verified on prod 2026-08-13), so every CRM edit dropped the secondary
-- contact, preferred styles, physical area and all five oil-processor rates.
-- create_contact_simple never wrote them either, so an oil_processor created through the
-- modal lost its rates immediately.
--
-- This restores the writes on both functions. Column guards below keep it safe on any DB
-- that genuinely predates the columns, so the function bodies can assume they exist.
--
-- Semantics kept as-is elsewhere: COALESCE(p_x, x) on update, matching every other field
-- (the portal strips nulls/empty strings before sending, so a cleared field is not sent).

ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS secondary_contact_name varchar(255),
    ADD COLUMN IF NOT EXISTS secondary_contact_phone varchar(20),
    ADD COLUMN IF NOT EXISTS secondary_contact_mobile varchar(20),
    ADD COLUMN IF NOT EXISTS secondary_contact_email varchar(255),
    ADD COLUMN IF NOT EXISTS preferred_styles text,
    ADD COLUMN IF NOT EXISTS physical_area varchar(100),
    ADD COLUMN IF NOT EXISTS rate_crude_kernel numeric(10,2),
    ADD COLUMN IF NOT EXISTS rate_food_kernel numeric(10,2),
    ADD COLUMN IF NOT EXISTS rate_kernel_dust numeric(10,2),
    ADD COLUMN IF NOT EXISTS rate_cracker_dust numeric(10,2),
    ADD COLUMN IF NOT EXISTS rate_crush numeric(10,2);

CREATE OR REPLACE FUNCTION public.create_contact_simple(
    p_account_manager_id uuid DEFAULT NULL,
    p_company_name varchar DEFAULT NULL,
    p_contact_type varchar DEFAULT NULL,
    p_key_account boolean DEFAULT false,
    p_notes text DEFAULT NULL,
    p_physical_area varchar DEFAULT NULL,
    p_physical_city varchar DEFAULT NULL,
    p_physical_postal_code varchar DEFAULT NULL,
    p_physical_province varchar DEFAULT NULL,
    p_preferred_styles text DEFAULT NULL,
    p_primary_contact_email varchar DEFAULT NULL,
    p_primary_contact_mobile varchar DEFAULT NULL,
    p_primary_contact_name varchar DEFAULT NULL,
    p_primary_contact_phone varchar DEFAULT NULL,
    p_rate_cracker_dust decimal DEFAULT NULL,
    p_rate_crude_kernel decimal DEFAULT NULL,
    p_rate_crush decimal DEFAULT NULL,
    p_rate_food_kernel decimal DEFAULT NULL,
    p_rate_kernel_dust decimal DEFAULT NULL,
    p_secondary_contact_email varchar DEFAULT NULL,
    p_secondary_contact_mobile varchar DEFAULT NULL,
    p_secondary_contact_name varchar DEFAULT NULL,
    p_secondary_contact_phone varchar DEFAULT NULL,
    p_status varchar DEFAULT 'active',
    p_trading_name varchar DEFAULT NULL,
    p_supplier_number integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
        RETURN json_build_object('success', false, 'error', 'Company name is required');
    END IF;

    IF p_contact_type IS NULL OR btrim(p_contact_type) = '' THEN
        RETURN json_build_object('success', false, 'error', 'Contact type is required');
    END IF;

    INSERT INTO public.contacts (
        contact_type,
        company_name,
        trading_name,
        primary_contact_name,
        primary_contact_email,
        primary_contact_phone,
        primary_contact_mobile,
        secondary_contact_name,
        secondary_contact_phone,
        secondary_contact_mobile,
        secondary_contact_email,
        preferred_styles,
        physical_area,
        physical_city,
        physical_province,
        physical_postal_code,
        account_manager_id,
        status,
        key_account,
        notes,
        supplier_number,
        rate_crude_kernel,
        rate_food_kernel,
        rate_kernel_dust,
        rate_cracker_dust,
        rate_crush,
        created_at,
        updated_at
    )
    VALUES (
        p_contact_type,
        p_company_name,
        p_trading_name,
        p_primary_contact_name,
        p_primary_contact_email,
        p_primary_contact_phone,
        p_primary_contact_mobile,
        p_secondary_contact_name,
        p_secondary_contact_phone,
        p_secondary_contact_mobile,
        p_secondary_contact_email,
        p_preferred_styles,
        p_physical_area,
        p_physical_city,
        p_physical_province,
        p_physical_postal_code,
        p_account_manager_id,
        COALESCE(p_status, 'active'),
        COALESCE(p_key_account, false),
        p_notes,
        p_supplier_number,
        p_rate_crude_kernel,
        p_rate_food_kernel,
        p_rate_kernel_dust,
        p_rate_cracker_dust,
        p_rate_crush,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_id;

    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'message', 'Contact created successfully'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to create contact: ' || SQLERRM
        );
END;
$$;

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
        secondary_contact_name = COALESCE(p_secondary_contact_name, secondary_contact_name),
        secondary_contact_phone = COALESCE(p_secondary_contact_phone, secondary_contact_phone),
        secondary_contact_mobile = COALESCE(p_secondary_contact_mobile, secondary_contact_mobile),
        secondary_contact_email = COALESCE(p_secondary_contact_email, secondary_contact_email),
        preferred_styles = COALESCE(p_preferred_styles, preferred_styles),
        physical_area = COALESCE(p_physical_area, physical_area),
        physical_city = COALESCE(p_physical_city, physical_city),
        physical_province = COALESCE(p_physical_province, physical_province),
        physical_postal_code = COALESCE(p_physical_postal_code, physical_postal_code),
        account_manager_id = COALESCE(p_account_manager_id, account_manager_id),
        status = COALESCE(p_status, status),
        key_account = COALESCE(p_key_account, key_account),
        notes = COALESCE(p_notes, notes),
        rate_crude_kernel = COALESCE(p_rate_crude_kernel, rate_crude_kernel),
        rate_food_kernel = COALESCE(p_rate_food_kernel, rate_food_kernel),
        rate_kernel_dust = COALESCE(p_rate_kernel_dust, rate_kernel_dust),
        rate_cracker_dust = COALESCE(p_rate_cracker_dust, rate_cracker_dust),
        rate_crush = COALESCE(p_rate_crush, rate_crush),
        supplier_number = COALESCE(p_supplier_number, supplier_number),
        updated_at = NOW()
    WHERE id = p_contact_id;

    RETURN json_build_object('success', true, 'message', 'Contact updated successfully');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to update contact: ' || SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.create_contact_simple(
    uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text,
    varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal,
    varchar, varchar, varchar, varchar, varchar, varchar, integer
) IS 'Creates contact and persists every field the CRM modal sends, including secondary contact, preferred styles, physical area, oil-processor rates and p_supplier_number (NIS batch code 0-99).';

COMMENT ON FUNCTION public.update_contact_simple(
    uuid, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
    varchar, varchar, text, varchar, varchar, varchar, varchar, uuid, varchar, boolean,
    text, numeric, numeric, numeric, numeric, numeric, integer
) IS 'Updates contact and persists every field the CRM modal sends. COALESCE semantics: a parameter left NULL keeps the stored value.';
