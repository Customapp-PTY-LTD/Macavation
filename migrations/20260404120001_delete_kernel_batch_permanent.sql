-- Permanent delete for a kernel batch (Batch Journey): removes batches + kernel row and cleans silos / dispatch lines.
-- Soft delete remains deactivate_kernel_batch; this is irreversible.

CREATE OR REPLACE FUNCTION public.delete_kernel_batch_permanent(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id uuid;
    v_bn       text;
    r          RECORD;
    v_new_lines jsonb;
    v_deleted  integer;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel id is required');
    END IF;

    SELECT k.batch_id, b.batch_id
    INTO v_batch_id, v_bn
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id;

    IF v_batch_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.batches WHERE id = v_batch_id AND batch_type = 'kernel') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not a kernel batch');
    END IF;

    UPDATE public.silo
    SET kernel_id = NULL,
        status = CASE WHEN oil_batch_id IS NULL THEN 'empty' ELSE status END,
        updated_at = NOW()
    WHERE kernel_id = p_kernel_id;

    FOR r IN
        SELECT o.id, o.lines
        FROM public.kernel_dispatch_orders o
        WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS e
            WHERE NULLIF(trim(e ->> 'kernel_id'), '') = p_kernel_id::text
        )
    LOOP
        SELECT COALESCE(
            (SELECT jsonb_agg(e)
             FROM jsonb_array_elements(COALESCE(r.lines, '[]'::jsonb)) AS e
             WHERE NULLIF(trim(e ->> 'kernel_id'), '') IS NULL
                OR NULLIF(trim(e ->> 'kernel_id'), '') <> p_kernel_id::text),
            '[]'::jsonb
        )
        INTO v_new_lines;

        IF v_new_lines IS NULL
           OR v_new_lines = '[]'::jsonb
           OR jsonb_array_length(v_new_lines) = 0
        THEN
            DELETE FROM public.kernel_dispatch_orders WHERE id = r.id;
        ELSE
            UPDATE public.kernel_dispatch_orders
            SET lines = v_new_lines, updated_at = NOW()
            WHERE id = r.id;
        END IF;
    END LOOP;

    DELETE FROM public.batches
    WHERE id = v_batch_id AND batch_type = 'kernel';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch could not be deleted');
    END IF;

    RETURN jsonb_build_object('success', true, 'batch_number', v_bn);
END;
$$;

COMMENT ON FUNCTION public.delete_kernel_batch_permanent(uuid) IS
    'Hard delete: removes kernel batch header (batches + kernel CASCADE), clears silos, strips or removes kernel_dispatch_orders lines. Irreversible.';

GRANT EXECUTE ON FUNCTION public.delete_kernel_batch_permanent(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_kernel_batch_permanent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_kernel_batch_permanent(uuid) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id,
       'function',
       'delete_kernel_batch_permanent',
       'EXECUTE',
       true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = 'delete_kernel_batch_permanent'
      AND x.operation = 'EXECUTE'
);

-- New roles: include permanent delete alongside other journey / silo functions
CREATE OR REPLACE FUNCTION public.grant_login_menu_permissions_for_new_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fn text;
    v_fns text[] := ARRAY[
        'get_users',
        'get_roles',
        'get_user_by_id',
        'get_features_for_role',
        'get_role_by_id',
        'get_features',
        'get_role_features',
        'get_contacts',
        'get_silos',
        'get_kernel_batches',
        'get_stock_items',
        'get_oil_stock_lots',
        'get_kernel_dispatch_orders',
        'get_kernel_dispatch_order',
        'set_silo_empty',
        'assign_kernel_to_silos',
        'delete_kernel_batch_permanent'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (NEW.id, 'function', v_fn, 'EXECUTE', true);
    END LOOP;
    RETURN NEW;
END;
$$;
