-- Edit kernel dispatch orders (buyer, dates, line cartons) before the order is marked dispatched.
-- RPC used by Kernel Dispatch "Edit" modal.

CREATE OR REPLACE FUNCTION public.update_kernel_dispatch_order(
    p_order_id          uuid,
    p_buyer_name        text DEFAULT NULL,
    p_delivery_date     date DEFAULT NULL,
    p_best_before_date  date DEFAULT NULL,
    p_lines             jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
    v_normalized jsonb := '[]'::jsonb;
    v_line jsonb;
    v_cartons numeric;
    v_quantity_kg numeric;
    v_kg_per_carton constant numeric := 11.34;
    i int;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order id is required');
    END IF;

    SELECT status INTO v_status
    FROM public.kernel_dispatch_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF lower(trim(coalesce(v_status, ''))) = 'dispatched' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot edit an order that has already been dispatched');
    END IF;

    IF p_buyer_name IS NOT NULL AND trim(p_buyer_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Buyer name cannot be empty');
    END IF;

    IF p_lines IS NOT NULL THEN
        IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'At least one line is required');
        END IF;
        FOR i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
            v_line := p_lines->i;
            v_cartons := (v_line->>'cartons')::numeric;
            IF v_cartons IS NULL OR v_cartons < 0 THEN
                v_cartons := (v_line->>'quantity_kg')::numeric / NULLIF(v_kg_per_carton, 0);
                IF v_cartons IS NULL OR v_cartons < 0 THEN
                    v_cartons := 0;
                END IF;
            END IF;
            v_quantity_kg := ROUND(v_cartons * v_kg_per_carton, 2);
            v_normalized := v_normalized || jsonb_build_object(
                'kernel_id',    v_line->>'kernel_id',
                'batch_number', v_line->>'batch_number',
                'style',        v_line->>'style',
                'cartons',      v_cartons,
                'quantity_kg',  v_quantity_kg
            );
        END LOOP;
    END IF;

    UPDATE public.kernel_dispatch_orders
    SET
        buyer_name = CASE WHEN p_buyer_name IS NOT NULL THEN trim(p_buyer_name) ELSE buyer_name END,
        delivery_date = COALESCE(p_delivery_date, delivery_date),
        best_before_date = CASE WHEN p_best_before_date IS NOT NULL THEN p_best_before_date ELSE best_before_date END,
        lines = CASE WHEN p_lines IS NOT NULL THEN v_normalized ELSE lines END,
        updated_at = NOW()
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'message', 'Dispatch order updated');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_kernel_dispatch_order(uuid, text, date, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_kernel_dispatch_order(uuid, text, date, date, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_kernel_dispatch_order(uuid, text, date, date, jsonb) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id,
       'function',
       'update_kernel_dispatch_order',
       'EXECUTE',
       true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = 'update_kernel_dispatch_order'
      AND x.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true
WHERE object_type = 'function'
  AND object_name = 'update_kernel_dispatch_order'
  AND operation = 'EXECUTE';

-- Extend new-role trigger (same pattern as save_kernel_dispatch_record migration).
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
        'create_kernel_dispatch_order',
        'update_kernel_dispatch_order_cartons',
        'update_kernel_dispatch_order',
        'get_kernel_dispatch_orders',
        'get_kernel_dispatch_order'
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
