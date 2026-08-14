-- Adding a contact failed with "p_rows must be a JSON array".
--
-- Why: 20260429140000_contact_supplier_number_rpc.sql was never applied under that version
-- (dev + prod both recorded an earlier 20260429080945 variant instead), and the follow-up
-- 20260429160000 only re-created update_contact_simple. Result: update_contact_simple gained
-- p_supplier_number but create_contact_simple never did.
--
-- The portal always sends p_supplier_number when a supplier code is entered, so PostgREST
-- could not resolve the function (PGRST202) and dataFunctions.createContact fell through to
-- its import_table_rows fallback, whose unrelated error was the message users actually saw.
--
-- Scope kept deliberately narrow: create_contact_simple only. Re-applying the whole
-- 20260429140000 file would regress update_contact_simple back to the body that
-- 20260429160000 fixed.

DROP FUNCTION IF EXISTS public.create_contact_simple(
    uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text,
    varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal,
    varchar, varchar, varchar, varchar, varchar, varchar
);

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
        physical_city,
        physical_province,
        physical_postal_code,
        account_manager_id,
        status,
        key_account,
        notes,
        supplier_number,
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
        p_physical_city,
        p_physical_province,
        p_physical_postal_code,
        p_account_manager_id,
        COALESCE(p_status, 'active'),
        COALESCE(p_key_account, false),
        p_notes,
        p_supplier_number,
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

GRANT EXECUTE ON FUNCTION public.create_contact_simple(
    uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text,
    varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal,
    varchar, varchar, varchar, varchar, varchar, varchar, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_contact_simple(
    uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text,
    varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal,
    varchar, varchar, varchar, varchar, varchar, varchar, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_contact_simple(
    uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text,
    varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal,
    varchar, varchar, varchar, varchar, varchar, varchar, integer
) TO anon;

COMMENT ON FUNCTION public.create_contact_simple(
    uuid, varchar, varchar, boolean, text, varchar, varchar, varchar, varchar, text,
    varchar, varchar, varchar, varchar, decimal, decimal, decimal, decimal, decimal,
    varchar, varchar, varchar, varchar, varchar, varchar, integer
) IS 'Creates contact; optional p_supplier_number for NIS supplier batch codes (0-99). secondary_*/rate_*/preferred_styles/physical_area params are accepted for API compatibility but not stored.';

-- Keep RBAC rows in place for every role (function name is unchanged, but be idempotent).
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'create_contact_simple', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
