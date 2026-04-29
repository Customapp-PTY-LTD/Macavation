-- Document Management: ensure every role has EXECUTE on all document RPCs used by WebPortal.
-- Fixes "operation EXECUTE is not allowed" when role_permissions is missing rows (e.g. new roles,
-- or delete_document_category_simple added after the bulk 20260218000001 grant).
-- Safe to re-run.

DO $$
DECLARE
    v_fn text;
    v_role_id uuid;
    v_functions text[] := ARRAY[
        'get_documents',
        'get_document_by_id',
        'create_document_simple',
        'update_document_simple',
        'delete_document_hard',
        'get_document_categories',
        'create_document_category_simple',
        'delete_document_category_simple'
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
