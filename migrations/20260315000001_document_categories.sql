-- Document categories for Document Management module. Users can add categories when uploading.
CREATE TABLE IF NOT EXISTS public.document_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL UNIQUE,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_categories_is_active ON public.document_categories(is_active) WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.get_document_categories()
RETURNS TABLE (
    id uuid,
    name varchar,
    description text,
    is_active boolean,
    created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.id, c.name, c.description, c.is_active, c.created_at
    FROM public.document_categories c
    WHERE c.is_active = true
    ORDER BY c.name;
$$;

CREATE OR REPLACE FUNCTION public.create_document_category_simple(
    p_name varchar,
    p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NULLIF(TRIM(p_name), '') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category name is required');
    END IF;
    INSERT INTO public.document_categories (name, description)
    VALUES (TRIM(p_name), NULLIF(TRIM(p_description), ''))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'message', 'Category created');
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'A category with this name already exists');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_document_categories', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'create_document_category_simple', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
