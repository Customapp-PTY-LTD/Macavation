-- Add SECURITY DEFINER to functions that are missing it
-- Per RBAC_GUIDE.md requirements

-- Fix create_inspection_simple
CREATE OR REPLACE FUNCTION create_inspection_simple(
    p_inspection_code text,
    p_vehicle_code text,
    p_driver_name text,
    p_inspection_date date,
    p_status text,
    p_critical_issues integer DEFAULT 0,
    p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO inspections (
        inspection_code,
        vehicle_code,
        driver_name,
        inspection_date,
        status,
        critical_issues,
        notes
    ) VALUES (
        p_inspection_code,
        p_vehicle_code,
        p_driver_name,
        p_inspection_date,
        p_status,
        p_critical_issues,
        p_notes
    )
    RETURNING id INTO v_id;
    
    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'message', 'Inspection created successfully'
    );
END;
$$;

-- Fix get_driver_by_user_id
CREATE OR REPLACE FUNCTION get_driver_by_user_id(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN (
        SELECT json_build_object(
            'id', d.id,
            'full_name', d.full_name,
            'employee_id', d.employee_id,
            'email', d.email,
            'contact_number', d.contact_number,
            'license_status', d.license_status,
            'status', d.status
        )
        FROM drivers d
        WHERE d.user_id = p_user_id
        LIMIT 1
    );
END;
$$;

-- Fix get_inspection_template (drop and recreate with SECURITY DEFINER)
DROP FUNCTION IF EXISTS get_inspection_template() CASCADE;

CREATE OR REPLACE FUNCTION get_inspection_template()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result json;
BEGIN
    SELECT json_agg(
        json_build_object(
            'id', id,
            'category', category,
            'section_name', section_name,
            'item_name', item_name,
            'item_order', item_order,
            'column_position', column_position,
            'special_instructions', special_instructions
        ) ORDER BY category, item_order
    ) INTO v_result
    FROM public.inspection_items_template;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- Fix update_company (the one without SECURITY DEFINER)
CREATE OR REPLACE FUNCTION update_company(
    p_id bigint,
    p_name character varying DEFAULT NULL,
    p_company_code character varying DEFAULT NULL,
    p_legal_name character varying DEFAULT NULL,
    p_trading_name character varying DEFAULT NULL,
    p_registration_number character varying DEFAULT NULL,
    p_tax_id character varying DEFAULT NULL,
    p_duns_number character varying DEFAULT NULL,
    p_phone_primary character varying DEFAULT NULL,
    p_phone_secondary character varying DEFAULT NULL,
    p_email_primary character varying DEFAULT NULL,
    p_email_secondary character varying DEFAULT NULL,
    p_website character varying DEFAULT NULL,
    p_address_line1 character varying DEFAULT NULL,
    p_address_line2 character varying DEFAULT NULL,
    p_city character varying DEFAULT NULL,
    p_state_province character varying DEFAULT NULL,
    p_postal_code character varying DEFAULT NULL,
    p_country character varying DEFAULT NULL,
    p_industry character varying DEFAULT NULL,
    p_business_size character varying DEFAULT NULL,
    p_annual_revenue numeric DEFAULT NULL,
    p_employee_count integer DEFAULT NULL,
    p_founded_date date DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_currency_code character varying DEFAULT NULL,
    p_credit_rating character varying DEFAULT NULL,
    p_payment_terms character varying DEFAULT NULL,
    p_status character varying DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE "Company"
    SET 
        name = COALESCE(p_name, name),
        company_code = COALESCE(p_company_code, company_code),
        legal_name = COALESCE(p_legal_name, legal_name),
        trading_name = COALESCE(p_trading_name, trading_name),
        registration_number = COALESCE(p_registration_number, registration_number),
        tax_id = COALESCE(p_tax_id, tax_id),
        duns_number = COALESCE(p_duns_number, duns_number),
        phone_primary = COALESCE(p_phone_primary, phone_primary),
        phone_secondary = COALESCE(p_phone_secondary, phone_secondary),
        email_primary = COALESCE(p_email_primary, email_primary),
        email_secondary = COALESCE(p_email_secondary, email_secondary),
        website = COALESCE(p_website, website),
        address_line1 = COALESCE(p_address_line1, address_line1),
        address_line2 = COALESCE(p_address_line2, address_line2),
        city = COALESCE(p_city, city),
        state_province = COALESCE(p_state_province, state_province),
        postal_code = COALESCE(p_postal_code, postal_code),
        country = COALESCE(p_country, country),
        industry = COALESCE(p_industry, industry),
        business_size = COALESCE(p_business_size, business_size),
        annual_revenue = COALESCE(p_annual_revenue, annual_revenue),
        employee_count = COALESCE(p_employee_count, employee_count),
        founded_date = COALESCE(p_founded_date, founded_date),
        description = COALESCE(p_description, description),
        currency_code = COALESCE(p_currency_code, currency_code),
        credit_rating = COALESCE(p_credit_rating, credit_rating),
        payment_terms = COALESCE(p_payment_terms, payment_terms),
        status = COALESCE(p_status, status),
        notes = COALESCE(p_notes, notes),
        updated_at = now()
    WHERE id = p_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'message', 'Company not found'
        );
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'id', p_id,
        'message', 'Company updated successfully'
    );
END;
$$;
