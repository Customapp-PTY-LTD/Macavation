-- Enhance contacts table for NIS Suppliers, Oil Processors, and Kernel Customers

-- Add new contact types
ALTER TABLE contacts 
DROP CONSTRAINT IF EXISTS contacts_contact_type_check;

ALTER TABLE contacts
ADD CONSTRAINT contacts_contact_type_check 
CHECK (contact_type IN ('customer', 'supplier', 'both', 'nis_supplier', 'oil_processor', 'kernel_customer'));

-- Add Area field (physical_area)
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS physical_area VARCHAR(100);

-- Add Secondary Contact fields
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS secondary_contact_name VARCHAR(255);
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS secondary_contact_phone VARCHAR(20);
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS secondary_contact_mobile VARCHAR(20);
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS secondary_contact_email VARCHAR(255);

-- Add Kernel Customer Preferences
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS preferred_styles TEXT;

-- Add Oil Processor Rates
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS rate_crude_kernel DECIMAL(10,2);
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS rate_food_kernel DECIMAL(10,2);
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS rate_kernel_dust DECIMAL(10,2);
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS rate_cracker_dust DECIMAL(10,2);
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS rate_crush DECIMAL(10,2);

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_contacts_physical_area ON contacts(physical_area);
CREATE INDEX IF NOT EXISTS idx_contacts_contact_type_new ON contacts(contact_type);

-- Update create_contact_simple function to include new fields
CREATE OR REPLACE FUNCTION create_contact_simple(
    p_contact_type varchar,
    p_company_name varchar,
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
    p_status varchar DEFAULT 'active',
    p_key_account boolean DEFAULT false,
    p_notes text DEFAULT NULL,
    p_rate_crude_kernel decimal DEFAULT NULL,
    p_rate_food_kernel decimal DEFAULT NULL,
    p_rate_kernel_dust decimal DEFAULT NULL,
    p_rate_cracker_dust decimal DEFAULT NULL,
    p_rate_crush decimal DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
BEGIN
    -- Validate required fields
    IF p_company_name IS NULL OR p_company_name = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Company name is required'
        );
    END IF;
    
    IF p_contact_type IS NULL OR p_contact_type = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Contact type is required'
        );
    END IF;
    
    -- Insert new contact
    INSERT INTO contacts (
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

-- Update update_contact_simple function to include new fields
CREATE OR REPLACE FUNCTION update_contact_simple(
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
    p_rate_crude_kernel decimal DEFAULT NULL,
    p_rate_food_kernel decimal DEFAULT NULL,
    p_rate_kernel_dust decimal DEFAULT NULL,
    p_rate_cracker_dust decimal DEFAULT NULL,
    p_rate_crush decimal DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Validate contact exists
    IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_contact_id) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Contact not found'
        );
    END IF;
    
    -- Update contact
    UPDATE contacts SET
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
        updated_at = NOW()
    WHERE id = p_contact_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Contact updated successfully'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to update contact: ' || SQLERRM
        );
END;
$$;
