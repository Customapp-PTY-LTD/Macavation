-- Example Database Functions Template
-- Copy and modify for your new module

-- ============================================
-- 1. GET ALL ITEMS
-- ============================================
CREATE OR REPLACE FUNCTION get_example_items()
RETURNS TABLE (
    id uuid,
    name text,
    description text,
    code varchar,
    category_id uuid,
    is_active boolean,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.id,
        i.name,
        i.description,
        i.code,
        i.category_id,
        i.is_active,
        i.created_at,
        i.updated_at
    FROM public.example_items i
    WHERE i.is_active = true
    ORDER BY i.created_at DESC;
END;
$$;

-- ============================================
-- 2. GET ITEM BY ID
-- ============================================
CREATE OR REPLACE FUNCTION get_example_item_by_id(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item json;
BEGIN
    SELECT json_build_object(
        'id', i.id,
        'name', i.name,
        'description', i.description,
        'code', i.code,
        'category_id', i.category_id,
        'is_active', i.is_active,
        'created_at', i.created_at,
        'updated_at', i.updated_at
    ) INTO v_item
    FROM public.example_items i
    WHERE i.id = p_id;
    
    RETURN v_item;
END;
$$;

-- ============================================
-- 3. CREATE ITEM
-- ============================================
CREATE OR REPLACE FUNCTION create_example_item_simple(
    p_name text,
    p_description text DEFAULT NULL,
    p_code varchar DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    -- Validate input
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Name is required'
        );
    END IF;
    
    -- Insert record
    INSERT INTO public.example_items (name, description, code)
    VALUES (trim(p_name), p_description, p_code)
    RETURNING id INTO v_id;
    
    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'message', 'Item created successfully'
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item with this code already exists'
        );
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;

-- ============================================
-- 4. UPDATE ITEM
-- ============================================
CREATE OR REPLACE FUNCTION update_example_item_simple(
    p_id uuid,
    p_name text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_code varchar DEFAULT NULL,
    p_category_id uuid DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if record exists
    IF NOT EXISTS (SELECT 1 FROM public.example_items WHERE id = p_id) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item not found'
        );
    END IF;
    
    -- Update only provided fields
    UPDATE public.example_items
    SET 
        name = COALESCE(p_name, name),
        description = COALESCE(p_description, description),
        code = COALESCE(p_code, code),
        category_id = COALESCE(p_category_id, category_id),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Item updated successfully'
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item with this code already exists'
        );
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;

-- ============================================
-- 5. DELETE ITEM (HARD DELETE)
-- ============================================
CREATE OR REPLACE FUNCTION delete_example_item_hard(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if record exists
    IF NOT EXISTS (SELECT 1 FROM public.example_items WHERE id = p_id) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item not found'
        );
    END IF;
    
    -- Delete record
    DELETE FROM public.example_items WHERE id = p_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Item deleted successfully'
    );
EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cannot delete item: referenced by other records'
        );
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;

-- ============================================
-- 6. DEACTIVATE ITEM (SOFT DELETE)
-- ============================================
CREATE OR REPLACE FUNCTION deactivate_example_item(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.example_items
    SET 
        is_active = false,
        updated_at = now()
    WHERE id = p_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item not found'
        );
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Item deactivated successfully'
    );
END;
$$;

