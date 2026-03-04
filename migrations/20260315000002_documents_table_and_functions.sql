-- Documents table: name, category, file storage ref. Used by Document Management module.
CREATE TABLE IF NOT EXISTS public.documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_name varchar(500) NOT NULL,
    category_id uuid REFERENCES public.document_categories(id) ON DELETE SET NULL,
    file_name varchar(500) NOT NULL,
    file_id varchar(500),
    file_link text,
    uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_category_id ON public.documents(category_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON public.documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_is_active ON public.documents(is_active) WHERE is_active = true;

CREATE OR REPLACE FUNCTION public.get_documents()
RETURNS TABLE (
    id uuid,
    document_name varchar,
    category_id uuid,
    category_name varchar,
    file_name varchar,
    file_id varchar,
    file_link text,
    uploaded_by uuid,
    uploaded_by_name text,
    created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT d.id, d.document_name, d.category_id, c.name::varchar AS category_name,
           d.file_name, d.file_id, d.file_link, d.uploaded_by,
           (SELECT COALESCE(u.username, u.email, '') FROM public.users u WHERE u.id = d.uploaded_by) AS uploaded_by_name,
           d.created_at
    FROM public.documents d
    LEFT JOIN public.document_categories c ON c.id = d.category_id AND c.is_active = true
    WHERE d.is_active = true
    ORDER BY d.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_document_by_id(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row record;
BEGIN
    SELECT d.id, d.document_name, d.category_id, c.name AS category_name,
           d.file_name, d.file_id, d.file_link, d.uploaded_by, d.created_at
    INTO v_row
    FROM public.documents d
    LEFT JOIN public.document_categories c ON c.id = d.category_id
    WHERE d.id = p_id AND d.is_active = true;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_document_simple(
    p_document_name varchar,
    p_file_name varchar,
    p_category_id uuid DEFAULT NULL,
    p_file_id varchar DEFAULT NULL,
    p_file_link text DEFAULT NULL,
    p_uploaded_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NULLIF(TRIM(p_document_name), '') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Document name is required');
    END IF;
    IF NULLIF(TRIM(p_file_name), '') IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'File name is required');
    END IF;
    INSERT INTO public.documents (document_name, category_id, file_name, file_id, file_link, uploaded_by)
    VALUES (TRIM(p_document_name), p_category_id, TRIM(p_file_name), NULLIF(TRIM(p_file_id), ''), NULLIF(TRIM(p_file_link), ''), p_uploaded_by)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'message', 'Document created');
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_document_simple(
    p_id uuid,
    p_document_name varchar DEFAULT NULL,
    p_category_id uuid DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.documents
    SET document_name = COALESCE(NULLIF(TRIM(p_document_name), ''), document_name),
        category_id = COALESCE(p_category_id, category_id),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Document not found');
    END IF;
    RETURN jsonb_build_object('success', true, 'message', 'Document updated');
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_document_hard(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.documents WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Document not found');
    END IF;
    RETURN jsonb_build_object('success', true, 'message', 'Document deleted');
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_documents', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_document_by_id', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'create_document_simple', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'update_document_simple', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'delete_document_hard', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
