-- List kernel dispatch orders (baskets) and get one order with lines for Kernel Dispatch page
-- Applied via Supabase MCP 2026-02-20; kept in repo for version control.

-- List kernel dispatch orders (baskets) for Kernel Dispatch page
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_orders(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result json;
BEGIN
    SELECT json_build_object(
        'success', true,
        'data', COALESCE(
            (SELECT json_agg(row_to_json(t))
             FROM (
                 SELECT
                     o.id,
                     o.buyer_name,
                     o.buyer_contact_id,
                     o.delivery_date,
                     o.best_before_date,
                     o.status,
                     o.created_at,
                     o.updated_at,
                     (SELECT COUNT(*)::int FROM kernel_dispatch_order_lines l WHERE l.dispatch_order_id = o.id) AS line_count,
                     (SELECT COALESCE(SUM(l.quantity_kg), 0)::numeric FROM kernel_dispatch_order_lines l WHERE l.dispatch_order_id = o.id) AS total_kg
                 FROM kernel_dispatch_orders o
                 ORDER BY o.created_at DESC
                 LIMIT p_limit
                 OFFSET p_offset
             ) t),
            '[]'::json
        )
    ) INTO v_result;
    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM, 'data', '[]'::json);
END;
$$;

-- Get one kernel dispatch order with its lines (batch number, style, quantity) for "View basket"
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_order(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order json;
    v_lines json;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Order id is required');
    END IF;

    SELECT row_to_json(o) INTO v_order
    FROM (
        SELECT id, buyer_name, buyer_contact_id, delivery_date, best_before_date, status, created_at, updated_at
        FROM kernel_dispatch_orders
        WHERE id = p_order_id
        LIMIT 1
    ) o;

    IF v_order IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Order not found');
    END IF;

    SELECT json_agg(row_to_json(t)) INTO v_lines
    FROM (
        SELECT
            l.id,
            l.dispatch_order_id,
            l.production_batch_id,
            l.style,
            l.quantity_kg,
            pb.batch_number
        FROM kernel_dispatch_order_lines l
        LEFT JOIN production_batches pb ON pb.id = l.production_batch_id
        WHERE l.dispatch_order_id = p_order_id
        ORDER BY pb.batch_number, l.style
    ) t;

    RETURN json_build_object('success', true, 'order', v_order, 'lines', COALESCE(v_lines, '[]'::json));
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute to all roles (align with other kernel dispatch functions)
DO $$
DECLARE
    v_role_id uuid;
    v_func text;
BEGIN
    FOREACH v_func IN ARRAY ARRAY['get_kernel_dispatch_orders', 'get_kernel_dispatch_order']
    LOOP
        FOR v_role_id IN SELECT id FROM public.roles
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_func AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_func, 'EXECUTE', true);
            END IF;
        END LOOP;
    END LOOP;
END $$;
