-- Kill the users.username column: rewrite the 5 functions that still read it to
-- show first/last name instead, then DROP the column. Completes the username ->
-- first/last name change (migration 20260708130000). DEV-ONLY; prod later.

CREATE OR REPLACE FUNCTION public.get_contacts()
 RETURNS TABLE(id uuid, contact_type character varying, company_name character varying, trading_name character varying, primary_contact_name character varying, primary_contact_email character varying, primary_contact_phone character varying, account_manager_id uuid, account_manager_name text, key_account boolean, supplier_number integer, status character varying, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, 'N/A') AS account_manager_name,
        c.key_account,
        c.supplier_number,
        c.status,
        c.created_at
    FROM public.contacts c
    LEFT JOIN public.users u ON c.account_manager_id = u.id
    WHERE c.deleted_at IS NULL
    ORDER BY c.company_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_documents()
 RETURNS TABLE(id uuid, document_name character varying, category_id uuid, category_name character varying, folder_path text, file_name character varying, file_id character varying, file_link text, uploaded_by uuid, uploaded_by_name text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH RECURSIVE folder_ancestors AS (
        SELECT c.id, c.name, c.parent_id, c.name::text AS path
        FROM public.document_categories c
        WHERE c.is_active = true
        UNION ALL
        SELECT c.id, c.name, c.parent_id,
               p.path || ' / ' || c.name
        FROM public.document_categories c
        INNER JOIN folder_ancestors p ON c.parent_id = p.id
        WHERE c.is_active = true
    ),
    folder_paths AS (
        SELECT DISTINCT ON (id) id, path
        FROM folder_ancestors
        ORDER BY id, length(path) DESC
    )
    SELECT d.id, d.document_name, d.category_id, c.name::varchar AS category_name,
           fp.path AS folder_path,
           d.file_name, d.file_id, d.file_link, d.uploaded_by,
           (SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, '') FROM public.users u WHERE u.id = d.uploaded_by) AS uploaded_by_name,
           d.created_at
    FROM public.documents d
    LEFT JOIN public.document_categories c ON c.id = d.category_id AND c.is_active = true
    LEFT JOIN folder_paths fp ON fp.id = d.category_id
    WHERE d.is_active = true
    ORDER BY d.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_oil_batch_by_id(p_oil_id uuid)
 RETURNS TABLE(id uuid, batch_id character varying, production_date date, status character varying, total_oil_litre numeric, name_of_product character varying, shift_supervisor character varying, shift character varying, intake_completed_at timestamp with time zone, production_completed_at timestamp with time zone, stock_completed_at timestamp with time zone, dispatch_completed_at timestamp with time zone, intake_data jsonb, production_data jsonb, stock_data jsonb, dispatch_data jsonb, created_at timestamp with time zone, created_by uuid, updated_by uuid, created_by_name text, updated_by_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        o.id,
        o.batch_id,
        o.production_date,
        o.status,
        o.total_oil_litre,
        (o.production_data->>'name_of_product')::varchar,
        (o.production_data->>'shift_supervisor')::varchar,
        (o.production_data->>'shift')::varchar,
        o.intake_completed_at,
        o.production_completed_at,
        o.stock_completed_at,
        o.dispatch_completed_at,
        o.intake_data,
        o.production_data,
        o.stock_data,
        o.dispatch_data,
        o.created_at,
        o.created_by,
        o.updated_by,
        (SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u_c.first_name, u_c.last_name)), ''), NULLIF(trim(u_c.email), ''), '') FROM public.users u_c WHERE u_c.id = o.created_by)::text,
        (SELECT COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u_u.first_name, u_u.last_name)), ''), NULLIF(trim(u_u.email), ''), '') FROM public.users u_u WHERE u_u.id = o.updated_by)::text
    FROM public.oil o
    WHERE o.id = p_oil_id AND o.is_active = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_raw_material_issued()
 RETURNS TABLE(id uuid, shift character varying, issue_date date, best_before date, production_date date, product_description character varying, batch_details character varying, quantity_required_kg numeric, total_issued_kg numeric, issued_by uuid, issued_by_name text, issued_to_department character varying, status character varying, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        rmi.id,
        rmi.shift,
        rmi.issue_date,
        rmi.best_before,
        rmi.production_date,
        rmi.product_description,
        rmi.batch_details,
        rmi.quantity_required_kg,
        rmi.total_issued_kg,
        rmi.issued_by,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, 'Unknown') as issued_by_name,
        rmi.issued_to_department,
        rmi.status,
        rmi.created_at,
        rmi.updated_at
    FROM raw_material_issued rmi
    LEFT JOIN users u ON rmi.issued_by = u.id
    ORDER BY rmi.issue_date DESC, rmi.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_password(p_email text, p_password text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user RECORD;
    v_password_valid BOOLEAN;
BEGIN
    -- Get user by email (don't check is_active - let the application decide)
    SELECT 
        id,
        email,
        first_name,
        last_name,
        password_hash,
        role,
        role_id,
        is_active,
        created_at,
        updated_at
    INTO v_user
    FROM public.users
    WHERE LOWER(email) = LOWER(p_email);
    
    -- Check if user exists
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'User not found'
        );
    END IF;
    
    -- Check if password_hash exists
    IF v_user.password_hash IS NULL OR v_user.password_hash = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'No password set for this user'
        );
    END IF;
    
    -- Verify password
    -- If it's a bcrypt hash, use crypt to verify
    IF v_user.password_hash LIKE '$2a$%' OR v_user.password_hash LIKE '$2b$%' OR v_user.password_hash LIKE '$2y$%' THEN
        -- Use crypt to verify bcrypt hash
        v_password_valid := (crypt(p_password, v_user.password_hash) = v_user.password_hash);
    ELSE
        -- For other hash types (like plain text or other algorithms)
        -- Note: This assumes the Lambda hashes the password before calling
        -- If Lambda passes plain text for comparison, this will work
        v_password_valid := (v_user.password_hash = p_password);
    END IF;
    
    IF v_password_valid THEN
        RETURN json_build_object(
            'success', true,
            'user_id', v_user.id,
            'email', v_user.email,
            'first_name', v_user.first_name,
            'last_name', v_user.last_name,
            'role', v_user.role,
            'role_id', v_user.role_id,
            'is_active', v_user.is_active
        );
    ELSE
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid password'
        );
    END IF;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to verify password: ' || SQLERRM
        );
END;
$function$;

ALTER TABLE public.users DROP COLUMN IF EXISTS username;

NOTIFY pgrst, 'reload schema';
