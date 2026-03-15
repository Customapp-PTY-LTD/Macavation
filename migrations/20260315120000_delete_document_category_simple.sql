-- Soft-delete a document category (set is_active = false). Documents in that category keep category_id but category no longer appears in lists.
CREATE OR REPLACE FUNCTION public.delete_document_category_simple(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category id is required');
    END IF;
    UPDATE public.document_categories SET is_active = false, updated_at = now() WHERE id = p_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Category not found');
    END IF;
    RETURN jsonb_build_object('success', true, 'message', 'Category deleted');
END;
$$;

DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'delete_document_category_simple', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
