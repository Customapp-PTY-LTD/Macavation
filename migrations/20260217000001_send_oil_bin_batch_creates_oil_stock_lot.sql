-- When an oil bin batch is sent to stock: also create an oil_stock_lots row so it appears
-- in Stock Management → Oil stream (oil ledger). Production UI lists only in_production batches (frontend filter).

CREATE OR REPLACE FUNCTION public.send_oil_bin_batch_to_stock(
    p_oil_bin_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_obb    RECORD;
    v_oil_id uuid;
    v_lot_id uuid;
    v_kg     numeric;
    v_notes  text;
BEGIN
    SELECT
        id, batch_number, shifts, ingredients, start_date, letrerage, ffa, oil_id, status,
        shift_id, raw_ingredient_audit
    INTO v_obb
    FROM public.oil_bin_batch
    WHERE id = p_oil_bin_batch_id;

    IF v_obb.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found');
    END IF;

    IF v_obb.status = 'sent_to_stock' AND v_obb.oil_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This batch has already been sent to stock');
    END IF;

    INSERT INTO public.oil (
        batch_id,
        production_date,
        status,
        total_oil_litre,
        production_data,
        is_active
    )
    VALUES (
        v_obb.batch_number,
        v_obb.start_date,
        'stock',
        v_obb.letrerage,
        jsonb_build_object(
            'shifts', v_obb.shifts,
            'ingredients', v_obb.ingredients,
            'ffa', v_obb.ffa,
            'oil_bin_batch_id', v_obb.id,
            'duty_shift_id', v_obb.shift_id,
            'raw_ingredient_audit', COALESCE(v_obb.raw_ingredient_audit, '[]'::jsonb)
        ),
        true
    )
    RETURNING id INTO v_oil_id;

    -- Approximate kg from recorded litreage (field is litres in UI); min 0.01 satisfies oil_stock_lots check
    IF v_obb.letrerage IS NOT NULL AND v_obb.letrerage > 0 THEN
        v_kg := ROUND((v_obb.letrerage * 0.92)::numeric, 3);
    ELSE
        v_kg := 0.01;
    END IF;

    v_notes := format(
        'From oil production. oil.id=%s, oil_bin_batch.id=%s. %s',
        v_oil_id,
        v_obb.id,
        CASE
            WHEN v_obb.letrerage IS NULL OR v_obb.letrerage <= 0
            THEN 'Update kilograms/volume in Stock Management if litreage was not entered before send.'
            ELSE ''
        END
    );

    INSERT INTO public.oil_stock_lots (
        location_code,
        stock_category,
        status,
        batch_number,
        product_description,
        ffa,
        kilograms,
        volume,
        manufacture_date,
        notes,
        created_at,
        updated_at
    )
    VALUES (
        '801',
        'finished_good',
        'on_hand',
        v_obb.batch_number,
        COALESCE(NULLIF(trim(COALESCE(v_obb.ingredients, '')), ''), 'Pressed oil — production'),
        v_obb.ffa,
        v_kg,
        v_obb.letrerage,
        v_obb.start_date,
        v_notes,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_lot_id;

    UPDATE public.oil_bin_batch
    SET status = 'sent_to_stock',
        oil_id = v_oil_id,
        updated_at = NOW()
    WHERE id = p_oil_bin_batch_id;

    RETURN jsonb_build_object(
        'success', true,
        'oil_id', v_oil_id,
        'oil_stock_lot_id', v_lot_id,
        'batch_number', v_obb.batch_number
    );
END;
$$;

COMMENT ON FUNCTION public.send_oil_bin_batch_to_stock(uuid) IS 'Creates oil (stock) row + oil_stock_lots finished_good lot at location 801 for Stock Management oil ledger.';
