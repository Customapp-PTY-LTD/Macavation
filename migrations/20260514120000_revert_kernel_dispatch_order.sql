-- Allow moving a kernel dispatch basket from "dispatched" back to awaiting dispatch (pending).
-- Clears saved inspection/dispatch record so the order can be corrected and re-dispatched.

CREATE OR REPLACE FUNCTION public.revert_kernel_dispatch_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order id is required');
    END IF;

    SELECT lower(trim(coalesce(status, ''))) INTO v_status
    FROM public.kernel_dispatch_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_status IS NULL OR v_status = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF v_status <> 'dispatched' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only dispatched orders can be returned to awaiting dispatch');
    END IF;

    UPDATE public.kernel_dispatch_orders
    SET
        status = 'pending',
        record = '{}'::jsonb,
        dispatched_at = NULL,
        updated_at = now()
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'message', 'Order returned to awaiting dispatch; dispatch paperwork was cleared.');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.revert_kernel_dispatch_order(uuid) IS
    'Sets a dispatched kernel_dispatch_orders row back to pending, clears record JSON and dispatched_at.';

GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'revert_kernel_dispatch_order', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.object_type = 'function'
      AND rp.object_name = 'revert_kernel_dispatch_order'
      AND rp.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true, updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'revert_kernel_dispatch_order'
  AND operation = 'EXECUTE';

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
        'save_kernel_dispatch_record',
        'revert_kernel_dispatch_order',
        'create_kernel_dispatch_order',
        'update_kernel_dispatch_order_cartons',
        'update_kernel_dispatch_order',
        'get_kernel_dispatch_orders',
        'get_kernel_dispatch_order',
        'update_kernel_stock_batch_info',
        'adjust_kernel_stock_on_hand'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        SELECT NEW.id, 'function', v_fn, 'EXECUTE', true
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.role_permissions rp
            WHERE rp.role_id = NEW.id
              AND rp.object_type = 'function'
              AND rp.object_name = v_fn
              AND rp.operation = 'EXECUTE'
        );
    END LOOP;
    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
