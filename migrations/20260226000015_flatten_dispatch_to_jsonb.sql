-- Migration: flatten kernel dispatch into JSONB columns on kernel_dispatch_orders.
-- Kills: kernel_dispatch_order_lines, kernel_dispatch_records (data migrated first).
-- Adds: lines jsonb, record jsonb, dispatched_at to kernel_dispatch_orders.

-- ============================================================
-- 1. Add new columns
-- ============================================================
ALTER TABLE public.kernel_dispatch_orders
    ADD COLUMN IF NOT EXISTS lines         jsonb       NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS record        jsonb       NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

-- ============================================================
-- 2. Migrate existing lines → lines JSONB
-- ============================================================
UPDATE public.kernel_dispatch_orders o
SET lines = COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'kernel_id',   l.production_batch_id::text,
        'batch_number', COALESCE(bt.batch_id, 'Unknown'),
        'style',        l.style,
        'quantity_kg',  l.quantity_kg
    ))
    FROM public.kernel_dispatch_order_lines l
    LEFT JOIN public.kernel k  ON k.id  = l.production_batch_id
    LEFT JOIN public.batches bt ON bt.id = k.batch_id
    WHERE l.dispatch_order_id = o.id),
    '[]'::jsonb
);

-- ============================================================
-- 3. Migrate existing records → record JSONB + set dispatched_at
-- ============================================================
UPDATE public.kernel_dispatch_orders o
SET
    record = COALESCE(
        (SELECT jsonb_build_object(
            'vehicle_clean_yn',     r.vehicle_clean_yn,
            'vehicle_enclosed_yn',  r.vehicle_enclosed_yn,
            'hazard_substances_yn', r.hazard_substances_yn,
            'pest_infestations_yn', r.pest_infestations_yn,
            'pallets_condition_yn', r.pallets_condition_yn,
            'truck_bin_locked_yn',  r.truck_bin_locked_yn,
            'dispatch_person',      r.dispatch_person,
            'transport_company',    r.transport_company,
            'delivery_note_number', r.delivery_note_number,
            'date_dispatched',      r.date_dispatched::text,
            'truck_registration',   r.truck_registration,
            'driver_name',          r.driver_name,
            'time_dispatched',      r.time_dispatched::text,
            'dispatched_to',        r.dispatched_to,
            'dispatch_signature',   r.dispatch_signature
        )
        FROM public.kernel_dispatch_records r
        WHERE r.dispatch_order_id = o.id
        LIMIT 1),
        '{}'::jsonb
    ),
    dispatched_at = (
        SELECT r.updated_at FROM public.kernel_dispatch_records r
        WHERE r.dispatch_order_id = o.id LIMIT 1
    )
WHERE o.status = 'dispatched';

-- ============================================================
-- 4. Drop old tables
-- ============================================================
DROP TABLE IF EXISTS public.kernel_dispatch_order_lines;
DROP TABLE IF EXISTS public.kernel_dispatch_records;

-- ============================================================
-- 5. create_kernel_dispatch_order
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_kernel_dispatch_order(
    p_buyer_name        text,
    p_delivery_date     date,
    p_lines             jsonb,
    p_buyer_contact_id  uuid  DEFAULT NULL,
    p_best_before_date  date  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_id uuid;
BEGIN
    IF p_buyer_name IS NULL OR trim(p_buyer_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Buyer name is required');
    END IF;
    IF p_delivery_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery date is required');
    END IF;

    INSERT INTO public.kernel_dispatch_orders (
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

-- ============================================================
-- 6. get_kernel_dispatch_orders (replace: total_kg from JSONB)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_orders(
    p_limit  integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
                FROM public.kernel_dispatch_orders o
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

-- ============================================================
-- 7. get_kernel_dispatch_order (replace: lines + record from JSONB, no JOIN)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_order(p_order_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
        FROM public.kernel_dispatch_orders
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

-- ============================================================
-- 8. save_kernel_dispatch_record (replace: writes to record JSONB column)
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_kernel_dispatch_record(
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
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_dispatch_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'dispatch_order_id is required');
    END IF;

    UPDATE public.kernel_dispatch_orders
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

-- ============================================================
-- 9. RBAC for create_kernel_dispatch_order
-- ============================================================
DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'create_kernel_dispatch_order', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
