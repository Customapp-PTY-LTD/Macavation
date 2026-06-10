-- Document Management: add hierarchical folder support to document_categories.
-- Existing categories become root-level folders; existing documents stay linked.
-- Safe to re-run (all statements use IF NOT EXISTS / OR REPLACE / ON CONFLICT).

-- 1. Add parent_id (nullable) to document_categories
ALTER TABLE public.document_categories
    ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.document_categories(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_document_categories_parent_id
    ON public.document_categories(parent_id);

-- 2. Scope the uniqueness constraint: name unique within parent (or at root)
--    The original global UNIQUE(name) is replaced by two partial indexes.
ALTER TABLE public.document_categories
    DROP CONSTRAINT IF EXISTS document_categories_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_document_categories_root_name
    ON public.document_categories(name)
    WHERE parent_id IS NULL AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_document_categories_child_name
    ON public.document_categories(parent_id, name)
    WHERE parent_id IS NOT NULL AND is_active = true;

-- 3. Update get_document_categories to include parent_id (must drop first — return type changes)
DROP FUNCTION IF EXISTS public.get_document_categories();
CREATE OR REPLACE FUNCTION public.get_document_categories()
RETURNS TABLE (
    id uuid,
    name varchar,
    description text,
    parent_id uuid,
    is_active boolean,
    created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.id, c.name, c.description, c.parent_id, c.is_active, c.created_at
    FROM public.document_categories c
    WHERE c.is_active = true
    ORDER BY c.parent_id NULLS FIRST, c.name;
$$;

-- 4. Update create_document_category_simple to accept optional parent_id
CREATE OR REPLACE FUNCTION public.create_document_category_simple(
    p_name varchar,
    p_description text DEFAULT NULL,
    p_parent_id uuid DEFAULT NULL
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
    INSERT INTO public.document_categories (name, description, parent_id)
    VALUES (TRIM(p_name), NULLIF(TRIM(p_description), ''), p_parent_id)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'message', 'Category created');
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'A folder with this name already exists at this location');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 5. New: get_or_create_document_category — idempotent folder creation for upload
CREATE OR REPLACE FUNCTION public.get_or_create_document_category(
    p_name varchar,
    p_parent_id uuid DEFAULT NULL
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
        RETURN jsonb_build_object('success', false, 'error', 'Folder name is required');
    END IF;
    -- Try to find an existing active folder with this name at this level
    IF p_parent_id IS NULL THEN
        SELECT id INTO v_id
        FROM public.document_categories
        WHERE name = TRIM(p_name) AND parent_id IS NULL AND is_active = true
        LIMIT 1;
    ELSE
        SELECT id INTO v_id
        FROM public.document_categories
        WHERE name = TRIM(p_name) AND parent_id = p_parent_id AND is_active = true
        LIMIT 1;
    END IF;
    IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'id', v_id, 'created', false);
    END IF;
    -- Create it
    INSERT INTO public.document_categories (name, parent_id)
    VALUES (TRIM(p_name), p_parent_id)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'created', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 6. New: delete_document_folder_recursive — soft-delete folder tree + documents
CREATE OR REPLACE FUNCTION public.delete_document_folder_recursive(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_folder_count int := 0;
    v_doc_count int := 0;
BEGIN
    -- Collect all descendant folder ids (including root)
    WITH RECURSIVE descendants AS (
        SELECT id FROM public.document_categories WHERE id = p_id
        UNION ALL
        SELECT c.id FROM public.document_categories c
        INNER JOIN descendants d ON c.parent_id = d.id
    )
    -- Soft-delete documents in those folders
    UPDATE public.documents
    SET is_active = false, updated_at = now()
    WHERE category_id IN (SELECT id FROM descendants) AND is_active = true;

    GET DIAGNOSTICS v_doc_count = ROW_COUNT;

    -- Soft-delete all folders in the tree
    WITH RECURSIVE descendants AS (
        SELECT id FROM public.document_categories WHERE id = p_id
        UNION ALL
        SELECT c.id FROM public.document_categories c
        INNER JOIN descendants d ON c.parent_id = d.id
    )
    UPDATE public.document_categories
    SET is_active = false, updated_at = now()
    WHERE id IN (SELECT id FROM descendants) AND is_active = true;

    GET DIAGNOSTICS v_folder_count = ROW_COUNT;

    IF v_folder_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Folder not found');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'folders_deleted', v_folder_count,
        'documents_deleted', v_doc_count
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 7. Update get_documents to include folder_path computed via recursive CTE (must drop first — return type changes)
DROP FUNCTION IF EXISTS public.get_documents();
CREATE OR REPLACE FUNCTION public.get_documents()
RETURNS TABLE (
    id uuid,
    document_name varchar,
    category_id uuid,
    category_name varchar,
    folder_path text,
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
           (SELECT COALESCE(u.username, u.email, '') FROM public.users u WHERE u.id = d.uploaded_by) AS uploaded_by_name,
           d.created_at
    FROM public.documents d
    LEFT JOIN public.document_categories c ON c.id = d.category_id AND c.is_active = true
    LEFT JOIN folder_paths fp ON fp.id = d.category_id
    WHERE d.is_active = true
    ORDER BY d.created_at DESC;
$$;

-- 8. Grant new functions to all roles
DO $$
DECLARE
    v_fn text;
    v_role_id uuid;
    v_functions text[] := ARRAY[
        'get_or_create_document_category',
        'delete_document_folder_recursive'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_functions
    LOOP
        FOR v_role_id IN SELECT id FROM public.roles
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = v_role_id
                  AND object_type = 'function'
                  AND object_name = v_fn
                  AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true);
            END IF;
        END LOOP;
    END LOOP;
END $$;
