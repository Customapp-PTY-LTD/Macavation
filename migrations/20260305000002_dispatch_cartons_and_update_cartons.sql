-- Store cartons on dispatch order lines; quantity_kg is ALWAYS cartons * 11.34.
-- 1. create_kernel_dispatch_order: normalize incoming lines to cartons + quantity_kg (quantity_kg = cartons * 11.34).
-- 2. update_kernel_dispatch_order_cartons: update cartons for given lines; quantity_kg = cartons * 11.34.

-- Constant: kg per carton (must match frontend KG_PER_CARTON)
-- In PL/pgSQL we use a variable for clarity.
CREATE OR REPLACE FUNCTION public.create_kernel_dispatch_order(
    p_buyer_name        text,
    p_delivery_date     date,
    p_lines             jsonb,
    p_buyer_contact_id  uuid  DEFAULT NULL,
    p_best_before_date  date  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_order_id   uuid;
    v_lines      jsonb := '[]'::jsonb;
    v_line       jsonb;
    v_cartons    numeric;
    v_quantity_kg numeric;
    v_kg_per_carton constant numeric := 11.34;
    i            int;
BEGIN
    IF p_buyer_name IS NULL OR trim(p_buyer_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Buyer name is required');
    END IF;
    IF p_delivery_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery date is required');
    END IF;

    -- Normalize lines: cartons is source of truth; quantity_kg = cartons * 11.34
    IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) > 0 THEN
        FOR i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
            v_line := p_lines->i;
            -- Prefer cartons; if missing, derive from quantity_kg
            v_cartons := (v_line->>'cartons')::numeric;
            IF v_cartons IS NULL OR v_cartons < 0 THEN
                v_cartons := (v_line->>'quantity_kg')::numeric / NULLIF(v_kg_per_carton, 0);
                IF v_cartons IS NULL OR v_cartons < 0 THEN
                    v_cartons := 0;
                END IF;
            END IF;
            v_quantity_kg := ROUND(v_cartons * v_kg_per_carton, 2);

            v_lines := v_lines || jsonb_build_object(
                'kernel_id',    v_line->>'kernel_id',
                'batch_number', v_line->>'batch_number',
                'style',        v_line->>'style',
                'cartons',      v_cartons,
                'quantity_kg',  v_quantity_kg
            );
        END LOOP;
    END IF;

    INSERT INTO public.kernel_dispatch_orders (
        buyer_name, buyer_contact_id, delivery_date, best_before_date, lines, status
    ) VALUES (
        p_buyer_name, p_buyer_contact_id, p_delivery_date, p_best_before_date,
        v_lines, 'pending'
    )
    RETURNING id INTO v_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Update cartons taken out for specific lines on an existing dispatch order.
-- p_lines: array of { "kernel_id": "uuid", "style": "SP", "cartons": 5 }.
-- quantity_kg is always set to ROUND(cartons * 11.34, 2).
CREATE OR REPLACE FUNCTION public.update_kernel_dispatch_order_cartons(
    p_order_id uuid,
    p_lines    jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cur_lines jsonb;
    v_new_lines jsonb := '[]'::jsonb;
    v_line      jsonb;
    v_update    jsonb;
    v_cartons   numeric;
    v_quantity_kg numeric;
    v_kg_per_carton constant numeric := 11.34;
    i           int;
    j           int;
    v_kid       text;
    v_style     text;
    v_updated   boolean;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order id is required');
    END IF;
    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'At least one line (kernel_id, style, cartons) is required');
    END IF;

    SELECT lines INTO v_cur_lines
    FROM public.kernel_dispatch_orders
    WHERE id = p_order_id;

    IF v_cur_lines IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    -- Build map of (kernel_id, style) -> cartons from p_lines
    -- Then rebuild v_cur_lines, replacing cartons/quantity_kg for matching lines
    FOR i IN 0 .. jsonb_array_length(v_cur_lines) - 1 LOOP
        v_line := v_cur_lines->i;
        v_updated := false;

        FOR j IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
            v_update := p_lines->j;
            v_kid   := v_update->>'kernel_id';
            v_style := v_update->>'style';
            IF (v_line->>'kernel_id') = v_kid AND (v_line->>'style') = v_style THEN
                v_cartons := (v_update->>'cartons')::numeric;
                IF v_cartons IS NULL OR v_cartons < 0 THEN
                    v_cartons := 0;
                END IF;
                v_quantity_kg := ROUND(v_cartons * v_kg_per_carton, 2);
                v_new_lines := v_new_lines || jsonb_build_object(
                    'kernel_id',    v_line->>'kernel_id',
                    'batch_number', v_line->>'batch_number',
                    'style',        v_line->>'style',
                    'cartons',      v_cartons,
                    'quantity_kg',  v_quantity_kg
                );
                v_updated := true;
                EXIT;
            END IF;
        END LOOP;

        IF NOT v_updated THEN
            -- Keep existing line; ensure quantity_kg = cartons * 11.34 if cartons present
            v_cartons := (v_line->>'cartons')::numeric;
            IF v_cartons IS NOT NULL AND v_cartons >= 0 THEN
                v_quantity_kg := ROUND(v_cartons * v_kg_per_carton, 2);
                v_new_lines := v_new_lines || jsonb_build_object(
                    'kernel_id',    v_line->>'kernel_id',
                    'batch_number', v_line->>'batch_number',
                    'style',        v_line->>'style',
                    'cartons',      v_cartons,
                    'quantity_kg',  v_quantity_kg
                );
            ELSE
                v_new_lines := v_new_lines || v_line;
            END IF;
        END IF;
    END LOOP;

    UPDATE public.kernel_dispatch_orders
    SET lines = v_new_lines, updated_at = NOW()
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Cartons updated; quantity_kg = cartons × 11.34');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- RBAC for new function
DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.role_permissions
            WHERE role_id = v_role_id AND object_type = 'function'
              AND object_name = 'update_kernel_dispatch_order_cartons' AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'update_kernel_dispatch_order_cartons', 'EXECUTE', true);
        END IF;
    END LOOP;
END;
$$;
