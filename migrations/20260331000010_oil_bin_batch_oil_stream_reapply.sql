-- Re-apply oil_stream on oil_bin_batch and related functions.
-- Earlier migration 20260218000001 was overwritten by 20260322000001 and 20260324000001.

ALTER TABLE public.oil_bin_batch
    ADD COLUMN IF NOT EXISTS oil_stream varchar(30);

COMMENT ON COLUMN public.oil_bin_batch.oil_stream IS 'food_grade | cosmetic — chosen when starting the oil bin batch.';

-- Drop all start_oil_bin_batch overloads (PostgREST resolves by param names sorted A–Z:
-- p_oil_stream sorts before p_start_date and wrongly expects (varchar, date). Use p_stream.)
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(date);
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(varchar);
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(date, varchar);

CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(
    p_start_date   date    DEFAULT NULL,
    p_stream       varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id           uuid;
    v_date         date := COALESCE(p_start_date, CURRENT_DATE);
    v_batch_number varchar;
    v_shift        uuid;
    v_stream       varchar;
BEGIN
    v_stream := lower(trim(COALESCE(p_stream, '')));
    IF v_stream = '' THEN
        v_stream := NULL;
    ELSIF v_stream NOT IN ('food_grade', 'cosmetic') THEN
        RETURN jsonb_build_object('success', false, 'error', 'oil_stream must be food_grade or cosmetic');
    END IF;

    v_batch_number := public.get_next_oil_batch_number(v_date);

    INSERT INTO public.oil_bin_batch (batch_number, start_date, status, oil_stream)
    VALUES (v_batch_number, v_date, 'in_production', v_stream)
    RETURNING id INTO v_id;

    SELECT s.id
    INTO v_shift
    FROM public.shift s
    WHERE s.shift_date = v_date
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1;

    IF v_shift IS NOT NULL THEN
        UPDATE public.oil_bin_batch
        SET shift_id = v_shift,
            raw_ingredient_audit = public.get_oil_production_raw_ingredients_snapshot(),
            updated_at = NOW()
        WHERE id = v_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_id,
        'batch_number', v_batch_number,
        'start_date', v_date,
        'oil_stream', v_stream,
        'shift_linked', v_shift IS NOT NULL
    );
END;
$$;

DROP FUNCTION IF EXISTS public.get_oil_bin_batches(character varying, integer, integer);

CREATE OR REPLACE FUNCTION public.get_oil_bin_batches(
    p_status varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_number varchar,
    shifts varchar,
    ingredients varchar,
    start_date date,
    letrerage numeric,
    ffa numeric,
    status varchar,
    oil_id uuid,
    created_at timestamptz,
    shift_id uuid,
    raw_ingredient_audit jsonb,
    duty_shift_date date,
    duty_shift_supervisor varchar,
    duty_shift_name varchar,
    oil_stream varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        obb.id,
        obb.batch_number,
        obb.shifts,
        obb.ingredients,
        obb.start_date,
        obb.letrerage,
        obb.ffa,
        obb.status,
        obb.oil_id,
        obb.created_at,
        obb.shift_id,
        obb.raw_ingredient_audit,
        s.shift_date,
        s.shift_supervisor,
        s.shift_name,
        obb.oil_stream
    FROM public.oil_bin_batch obb
    LEFT JOIN public.shift s ON s.id = obb.shift_id
    WHERE (p_status IS NULL OR obb.status = p_status)
    ORDER BY obb.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

DROP FUNCTION IF EXISTS public.update_oil_bin_batch(uuid, character varying, character varying, numeric, numeric);
DROP FUNCTION IF EXISTS public.update_oil_bin_batch(uuid, character varying, character varying, numeric, numeric, character varying);

CREATE OR REPLACE FUNCTION public.update_oil_bin_batch(
    p_id            uuid,
    p_shifts        varchar DEFAULT NULL,
    p_ingredients   varchar DEFAULT NULL,
    p_letrerage     numeric DEFAULT NULL,
    p_ffa           numeric DEFAULT NULL,
    p_oil_stream    varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stream varchar;
BEGIN
    v_stream := CASE
        WHEN p_oil_stream IS NULL THEN NULL
        ELSE lower(trim(p_oil_stream))
    END;
    IF v_stream IS NOT NULL AND v_stream != '' AND v_stream NOT IN ('food_grade', 'cosmetic') THEN
        RETURN jsonb_build_object('success', false, 'error', 'oil_stream must be food_grade or cosmetic');
    END IF;

    UPDATE public.oil_bin_batch
    SET shifts        = COALESCE(p_shifts, shifts),
        ingredients   = COALESCE(p_ingredients, ingredients),
        letrerage     = COALESCE(p_letrerage, letrerage),
        ffa           = COALESCE(p_ffa, ffa),
        oil_stream    = CASE
            WHEN p_oil_stream IS NULL THEN oil_stream
            WHEN trim(COALESCE(p_oil_stream, '')) = '' THEN oil_stream
            ELSE v_stream
        END,
        updated_at    = NOW()
    WHERE id = p_id AND status = 'in_production';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found or already sent to stock');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

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
        shift_id, raw_ingredient_audit, oil_stream
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
            'raw_ingredient_audit', COALESCE(v_obb.raw_ingredient_audit, '[]'::jsonb),
            'oil_stream', v_obb.oil_stream
        ),
        true
    )
    RETURNING id INTO v_oil_id;

    IF v_obb.letrerage IS NOT NULL AND v_obb.letrerage > 0 THEN
        v_kg := ROUND((v_obb.letrerage * 0.92)::numeric, 3);
    ELSE
        v_kg := 0.01;
    END IF;

    v_notes := format(
        'From oil production. oil.id=%s, oil_bin_batch.id=%s. Stream=%s. %s',
        v_oil_id,
        v_obb.id,
        COALESCE(v_obb.oil_stream, '—'),
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

-- Refresh PostgREST schema cache so new signatures appear (Supabase)
NOTIFY pgrst, 'reload schema';
