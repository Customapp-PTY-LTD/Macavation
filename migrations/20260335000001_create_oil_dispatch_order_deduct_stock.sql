-- When creating an oil dispatch order from stock, deduct oil_stock_lots (kg / litres).
-- Fully depleted lots: status = dispatched, kg and volume zeroed. Partial: reduced balances, stays on_hand.

CREATE OR REPLACE FUNCTION public.create_oil_dispatch_order(
    p_buyer_name        text,
    p_delivery_date     date,
    p_lines             jsonb,
    p_buyer_contact_id  uuid  DEFAULT NULL,
    p_best_before_date  date  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_order_id uuid;
    el jsonb;
    v_lot_id uuid;
    v_qty_kg numeric;
    v_qty_l numeric;
    v_new_kg numeric;
    v_new_vol numeric;
    v_row public.oil_stock_lots%ROWTYPE;
    eps numeric := 0.005;
    v_full boolean;
BEGIN
    IF p_buyer_name IS NULL OR trim(p_buyer_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Buyer name is required');
    END IF;
    IF p_delivery_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery date is required');
    END IF;

    IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'At least one line is required');
    END IF;

    FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
    LOOP
        IF el->>'oil_batch_id' IS NULL OR trim(el->>'oil_batch_id') = '' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Each line must include oil_batch_id (stock lot id)');
        END IF;

        BEGIN
            v_lot_id := trim(el->>'oil_batch_id')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RETURN jsonb_build_object('success', false, 'error', 'Invalid oil_batch_id on a line');
        END;

        v_qty_kg := COALESCE(NULLIF(trim(el->>'quantity_kg'), '')::numeric, 0);
        v_qty_l := COALESCE(NULLIF(trim(el->>'quantity_litres'), '')::numeric, 0);

        IF v_qty_kg <= 0 AND v_qty_l <= 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Each line must have quantity_kg or quantity_litres');
        END IF;

        SELECT * INTO v_row FROM public.oil_stock_lots WHERE id = v_lot_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', format('Stock lot %s not found', v_lot_id));
        END IF;
        IF NOT COALESCE(v_row.is_active, true) THEN
            RETURN jsonb_build_object('success', false, 'error', format('Stock lot %s is inactive', v_lot_id));
        END IF;
        IF v_row.status NOT IN ('on_hand', 'hold') THEN
            RETURN jsonb_build_object('success', false, 'error',
                format('Stock lot %s is not available for dispatch (status %s)', v_lot_id, v_row.status));
        END IF;

        IF v_qty_l > eps THEN
            -- Oil: litres + kg equivalent
            IF v_qty_kg <= 0 THEN
                RETURN jsonb_build_object('success', false, 'error', 'Oil lines require quantity_kg (kg equivalent)');
            END IF;
            v_new_vol := COALESCE(v_row.volume, 0) - v_qty_l;
            v_new_kg := COALESCE(v_row.kilograms, 0) - v_qty_kg;
        ELSE
            -- Protein / kg-only
            IF v_qty_kg <= 0 THEN
                RETURN jsonb_build_object('success', false, 'error', 'Protein lines require quantity_kg');
            END IF;
            v_new_vol := COALESCE(v_row.volume, 0);
            v_new_kg := COALESCE(v_row.kilograms, 0) - v_qty_kg;
        END IF;

        IF v_new_kg < -eps OR v_new_vol < -eps THEN
            RETURN jsonb_build_object('success', false, 'error',
                format('Insufficient stock for lot %s', COALESCE(v_row.batch_number, v_lot_id::text)));
        END IF;

        IF v_new_kg < 0 THEN v_new_kg := 0; END IF;
        IF v_new_vol < 0 THEN v_new_vol := 0; END IF;

        IF v_qty_l > eps THEN
            v_full := (v_new_kg <= eps AND v_new_vol <= eps);
        ELSE
            v_full := (v_new_kg <= eps);
        END IF;

        IF v_full THEN
            UPDATE public.oil_stock_lots SET
                kilograms = 0,
                volume = 0,
                status = 'dispatched',
                updated_at = now()
            WHERE id = v_lot_id;
        ELSE
            UPDATE public.oil_stock_lots SET
                kilograms = v_new_kg,
                volume = CASE WHEN v_qty_l > eps THEN v_new_vol ELSE v_row.volume END,
                updated_at = now()
            WHERE id = v_lot_id;
        END IF;
    END LOOP;

    INSERT INTO public.oil_dispatch_orders (
        buyer_name, buyer_contact_id, delivery_date, best_before_date, lines, status
    ) VALUES (
        trim(p_buyer_name), p_buyer_contact_id, p_delivery_date, p_best_before_date,
        COALESCE(p_lines, '[]'::jsonb), 'pending'
    )
    RETURNING id INTO v_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.create_oil_dispatch_order(text, date, jsonb, uuid, date) IS
  'Creates oil_dispatch_orders row and deducts oil_stock_lots (oil: L+kg; protein: kg). Full dispatch sets status dispatched.';

NOTIFY pgrst, 'reload schema';
