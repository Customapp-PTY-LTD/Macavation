-- Allow manual stock corrections for kernel stock.
-- Appends a packing_data adjustment row so get_kernel_batches totals include it.

CREATE OR REPLACE FUNCTION public.adjust_kernel_stock_on_hand(
    p_kernel_id uuid,
    p_style varchar,
    p_qty_delta numeric DEFAULT 0,
    p_cartons_delta numeric DEFAULT 0,
    p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_style text := upper(trim(coalesce(p_style, '')));
    v_qty_key text;
    v_cartons_key text;
    v_qty_delta numeric := coalesce(p_qty_delta, 0);
    v_cartons_delta numeric := coalesce(p_cartons_delta, 0);
    v_current_packed_qty numeric := 0;
    v_current_packed_cartons numeric := 0;
    v_current_dispatched_qty numeric := 0;
    v_current_dispatched_cartons numeric := 0;
    v_adjustment jsonb;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch is required');
    END IF;

    IF v_qty_delta = 0 AND v_cartons_delta = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a non-zero kg or cartons adjustment');
    END IF;

    CASE v_style
        WHEN 'SP' THEN v_qty_key := 'sk_sp_qty'; v_cartons_key := 'sk_sp_cartons';
        WHEN '0' THEN v_qty_key := 'sk_0_qty'; v_cartons_key := 'sk_0_cartons';
        WHEN '1' THEN v_qty_key := 'sk_1_qty'; v_cartons_key := 'sk_1_cartons';
        WHEN '1S' THEN v_qty_key := 'sk_1s_qty'; v_cartons_key := 'sk_1s_cartons';
        WHEN '4L' THEN v_qty_key := 'sk_4l_qty'; v_cartons_key := 'sk_4l_cartons';
        WHEN '5' THEN v_qty_key := 'sk_5_qty'; v_cartons_key := 'sk_5_cartons';
        WHEN '6' THEN v_qty_key := 'sk_6_qty'; v_cartons_key := 'sk_6_cartons';
        WHEN '7/8' THEN v_qty_key := 'bt_78_qty'; v_cartons_key := 'bt_78_cartons';
        WHEN 'BUTTER HIGH OIL' THEN v_qty_key := 'bt_high_qty'; v_cartons_key := 'bt_high_cartons';
        WHEN 'BUTTER LOW OIL' THEN v_qty_key := 'bt_low_qty'; v_cartons_key := 'bt_low_cartons';
        ELSE
            RETURN jsonb_build_object('success', false, 'error', 'Unsupported style: ' || coalesce(p_style, ''));
    END CASE;

    SELECT coalesce(sum(nullif(elem ->> v_qty_key, '')::numeric), 0),
           coalesce(sum(nullif(elem ->> v_cartons_key, '')::numeric), 0)
      INTO v_current_packed_qty, v_current_packed_cartons
    FROM public.kernel k
    LEFT JOIN LATERAL jsonb_array_elements(coalesce(nullif(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem ON true
    WHERE k.id = p_kernel_id
    GROUP BY k.id;

    IF NOT EXISTS (SELECT 1 FROM public.kernel WHERE id = p_kernel_id AND is_active = true) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    SELECT coalesce(sum(
               CASE v_style
                   WHEN 'SP' THEN coalesce(line.quantity_kg, 0)
                   WHEN '0' THEN coalesce(line.quantity_kg, 0)
                   WHEN '1' THEN coalesce(line.quantity_kg, 0)
                   WHEN '1S' THEN coalesce(line.quantity_kg, 0)
                   WHEN '4L' THEN coalesce(line.quantity_kg, 0)
                   WHEN '5' THEN coalesce(line.quantity_kg, 0)
                   WHEN '6' THEN coalesce(line.quantity_kg, 0)
                   WHEN '7/8' THEN coalesce(line.quantity_kg, 0)
                   WHEN 'BUTTER HIGH OIL' THEN coalesce(line.quantity_kg, 0)
                   WHEN 'BUTTER LOW OIL' THEN coalesce(line.quantity_kg, 0)
               END
           ), 0),
           coalesce(sum(coalesce(line.cartons, 0)), 0)
      INTO v_current_dispatched_qty, v_current_dispatched_cartons
    FROM public.kernel_dispatch_orders o
    CROSS JOIN LATERAL jsonb_to_recordset(coalesce(o.lines, '[]'::jsonb)) AS line(
        kernel_id uuid,
        style text,
        quantity_kg numeric,
        cartons numeric
    )
    WHERE line.kernel_id = p_kernel_id
      AND upper(coalesce(line.style, '')) = v_style;

    IF (v_current_packed_qty + v_qty_delta) < v_current_dispatched_qty THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Adjustment would reduce packed kg below already dispatched kg for this style'
        );
    END IF;

    IF (v_current_packed_cartons + v_cartons_delta) < v_current_dispatched_cartons THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Adjustment would reduce packed cartons below already dispatched cartons for this style'
        );
    END IF;

    v_adjustment := jsonb_build_object(
        'date', current_date,
        'stock_adjustment', true,
        'adjustment_reason', nullif(trim(coalesce(p_reason, '')), ''),
        v_qty_key, v_qty_delta,
        v_cartons_key, v_cartons_delta
    );

    UPDATE public.kernel
       SET packing_data = coalesce(nullif(packing_data, 'null'::jsonb), '[]'::jsonb) || jsonb_build_array(v_adjustment),
           updated_at = now()
     WHERE id = p_kernel_id;

    RETURN jsonb_build_object(
        'success', true,
        'kernel_id', p_kernel_id,
        'style', p_style,
        'qty_delta', v_qty_delta,
        'cartons_delta', v_cartons_delta
    );
END;
$$;

COMMENT ON FUNCTION public.adjust_kernel_stock_on_hand(uuid, varchar, numeric, numeric, text) IS
    'Manually adjusts kernel stock on hand by appending a packing_data adjustment row for one style.';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'adjust_kernel_stock_on_hand', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
