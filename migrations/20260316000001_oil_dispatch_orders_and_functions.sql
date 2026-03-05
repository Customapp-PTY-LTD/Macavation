-- Oil Dispatch: mirror of kernel dispatch. INV from W/House Finished (OIL PROTEIN R YES) → FEED+OIL+PROTEIN CUSTOMERS → DEBTORS.
-- Table and RPCs: get list, get one with lines, create order, update cartons/quantity, save dispatch record.

CREATE TABLE IF NOT EXISTS public.oil_dispatch_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_name text,
    buyer_contact_id uuid,
    delivery_date date NOT NULL,
    best_before_date date,
    status character varying,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    lines jsonb NOT NULL DEFAULT '[]',
    record jsonb NOT NULL DEFAULT '{}',
    dispatched_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_oil_dispatch_orders_created ON public.oil_dispatch_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oil_dispatch_orders_status ON public.oil_dispatch_orders(status);

-- List oil dispatch orders
CREATE OR REPLACE FUNCTION public.get_oil_dispatch_orders(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN json_build_object(
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
                    o.dispatched_at,
                    o.created_at,
                    o.updated_at,
                    jsonb_array_length(COALESCE(o.lines, '[]'::jsonb)) AS line_count,
                    (SELECT COALESCE(SUM((el->>'quantity_kg')::numeric), 0)
                     FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS el) AS total_kg
                FROM public.oil_dispatch_orders o
                ORDER BY o.created_at DESC
                LIMIT p_limit OFFSET p_offset
             ) t),
            '[]'::json
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM, 'data', '[]'::json);
END;
$$;

-- Get one oil dispatch order with lines
CREATE OR REPLACE FUNCTION public.get_oil_dispatch_order(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_order json;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Order id is required');
    END IF;

    SELECT row_to_json(o) INTO v_order
    FROM (
        SELECT id, buyer_name, buyer_contact_id, delivery_date, best_before_date,
               status, dispatched_at, created_at, updated_at,
               COALESCE(lines,  '[]'::jsonb) AS lines,
               COALESCE(record, '{}'::jsonb) AS record
        FROM public.oil_dispatch_orders
        WHERE id = p_order_id
        LIMIT 1
    ) o;

    IF v_order IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Order not found');
    END IF;

    RETURN json_build_object('success', true, 'order', v_order);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Create oil dispatch order (lines: [{ oil_batch_id?, batch_number?, style?, cartons?, quantity_kg? }])
CREATE OR REPLACE FUNCTION public.create_oil_dispatch_order(
    p_buyer_name        text,
    p_delivery_date     date,
    p_lines             jsonb,
    p_buyer_contact_id  uuid  DEFAULT NULL,
    p_best_before_date  date  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_order_id uuid;
BEGIN
    IF p_buyer_name IS NULL OR trim(p_buyer_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Buyer name is required');
    END IF;
    IF p_delivery_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery date is required');
    END IF;

    INSERT INTO public.oil_dispatch_orders (
        buyer_name, buyer_contact_id, delivery_date, best_before_date, lines, status
    ) VALUES (
        p_buyer_name, p_buyer_contact_id, p_delivery_date, p_best_before_date,
        COALESCE(p_lines, '[]'::jsonb), 'pending'
    )
    RETURNING id INTO v_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Update oil dispatch order lines (quantity/cartons)
CREATE OR REPLACE FUNCTION public.update_oil_dispatch_order_cartons(p_order_id uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_cur_lines jsonb;
    v_new_lines jsonb := '[]'::jsonb;
    v_line jsonb;
    v_update jsonb;
    v_quantity_kg numeric;
    i int;
    j int;
    v_oid text;
    v_style text;
    v_updated boolean;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order id is required');
    END IF;
    IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'At least one line is required');
    END IF;

    SELECT lines INTO v_cur_lines FROM public.oil_dispatch_orders WHERE id = p_order_id;
    IF v_cur_lines IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    FOR i IN 0 .. jsonb_array_length(v_cur_lines) - 1 LOOP
        v_line := v_cur_lines->i;
        v_updated := false;
        FOR j IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
            v_update := p_lines->j;
            v_oid := v_update->>'oil_batch_id';
            IF v_oid IS NULL OR v_oid = '' THEN v_oid := v_update->>'kernel_id'; END IF;
            v_style := v_update->>'style';
            IF (v_line->>'oil_batch_id') = v_oid AND (v_line->>'style') = v_style THEN
                v_quantity_kg := (v_update->>'quantity_kg')::numeric;
                IF v_quantity_kg IS NULL OR v_quantity_kg < 0 THEN v_quantity_kg := 0; END IF;
                v_new_lines := v_new_lines || jsonb_build_object(
                    'oil_batch_id', v_line->>'oil_batch_id',
                    'batch_number', v_line->>'batch_number',
                    'style', v_line->>'style',
                    'quantity_kg', v_quantity_kg
                );
                v_updated := true;
                EXIT;
            END IF;
        END LOOP;
        IF NOT v_updated THEN
            v_new_lines := v_new_lines || v_line;
        END IF;
    END LOOP;

    UPDATE public.oil_dispatch_orders SET lines = v_new_lines, updated_at = NOW() WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'message', 'Lines updated');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Save oil dispatch record (inspection + dispatch details), mark order as dispatched
CREATE OR REPLACE FUNCTION public.save_oil_dispatch_record(
    p_dispatch_order_id      uuid,
    p_vehicle_clean_yn       text DEFAULT NULL,
    p_vehicle_enclosed_yn    text DEFAULT NULL,
    p_hazard_substances_yn   text DEFAULT NULL,
    p_pest_infestations_yn   text DEFAULT NULL,
    p_pallets_condition_yn   text DEFAULT NULL,
    p_truck_bin_locked_yn    text DEFAULT NULL,
    p_dispatch_person        text DEFAULT NULL,
    p_transport_company      text DEFAULT NULL,
    p_delivery_note_number   text DEFAULT NULL,
    p_date_dispatched        date DEFAULT NULL,
    p_truck_registration     text DEFAULT NULL,
    p_driver_name            text DEFAULT NULL,
    p_time_dispatched        time DEFAULT NULL,
    p_dispatched_to          text DEFAULT NULL,
    p_dispatch_signature     text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_dispatch_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'dispatch_order_id is required');
    END IF;

    UPDATE public.oil_dispatch_orders
    SET
        record = jsonb_build_object(
            'vehicle_clean_yn',     p_vehicle_clean_yn,
            'vehicle_enclosed_yn',  p_vehicle_enclosed_yn,
            'hazard_substances_yn', p_hazard_substances_yn,
            'pest_infestations_yn', p_pest_infestations_yn,
            'pallets_condition_yn', p_pallets_condition_yn,
            'truck_bin_locked_yn',  p_truck_bin_locked_yn,
            'dispatch_person',      p_dispatch_person,
            'transport_company',    p_transport_company,
            'delivery_note_number', p_delivery_note_number,
            'date_dispatched',      p_date_dispatched::text,
            'truck_registration',   p_truck_registration,
            'driver_name',          p_driver_name,
            'time_dispatched',      p_time_dispatched::text,
            'dispatched_to',        p_dispatched_to,
            'dispatch_signature',   p_dispatch_signature
        ),
        status        = 'dispatched',
        dispatched_at = NOW(),
        updated_at    = NOW()
    WHERE id = p_dispatch_order_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Dispatch order not found');
    END IF;

    RETURN json_build_object('success', true, 'message', 'Dispatch record saved; order marked as dispatched');
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- RBAC: grant execute to all roles
DO $$
DECLARE v_role_id uuid; v_func text;
BEGIN
    FOREACH v_func IN ARRAY ARRAY['get_oil_dispatch_orders', 'get_oil_dispatch_order', 'create_oil_dispatch_order', 'update_oil_dispatch_order_cartons', 'save_oil_dispatch_record']
    LOOP
        FOR v_role_id IN SELECT id FROM public.roles
        LOOP
            IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_func AND operation = 'EXECUTE') THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed) VALUES (v_role_id, 'function', v_func, 'EXECUTE', true);
            END IF;
        END LOOP;
    END LOOP;
END $$;
