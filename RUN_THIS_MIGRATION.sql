-- ============================================
-- FIX CONTACT FUNCTION PARAMETER ORDER
-- ============================================
-- Copy and paste this entire file into Supabase SQL Editor and run it
-- This will fix the contact creation error

-- Fix create_contact_simple function parameter order to match Lambda proxy expectations
-- Lambda proxy alphabetizes parameters, so we need to match that order

DROP FUNCTION IF EXISTS public.create_contact_simple CASCADE;

CREATE OR REPLACE FUNCTION create_contact_simple(
    p_account_manager_id uuid DEFAULT NULL,
    p_company_name varchar,
    p_contact_type varchar,
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
    p_trading_name varchar DEFAULT NULL
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.create_contact_simple(uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text, varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal, varchar, varchar, varchar, varchar, varchar, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contact_simple(uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text, varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal, varchar, varchar, varchar, varchar, varchar, varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_contact_simple(uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text, varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal, varchar, varchar, varchar, varchar, varchar, varchar) TO anon;

-- Add RBAC permissions
DO $$
DECLARE
    v_admin_role_id uuid := '9c69485d-0116-4cf6-b7e6-2ff6c025478e';
    v_super_user_role_id uuid := 'f8c7989a-cdf4-4804-952a-47565acd9c4c';
BEGIN
    -- Grant to admin role
    INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
    VALUES (v_admin_role_id, 'function', 'create_contact_simple', 'EXECUTE', true)
    ON CONFLICT DO NOTHING;
    
    -- Grant to super_user role
    INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
    VALUES (v_super_user_role_id, 'function', 'create_contact_simple', 'EXECUTE', true)
    ON CONFLICT DO NOTHING;
END;
$$;
