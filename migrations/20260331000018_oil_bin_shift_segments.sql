-- Structured shifts + per-shift ingredients on oil_bin_batch.
-- sync_oil_production_duty_audit appends a new segment when person-on-duty shift changes,
-- or updates the last segment if the same shift is saved again.

ALTER TABLE public.oil_bin_batch
    ADD COLUMN IF NOT EXISTS shift_segments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.oil_bin_batch.shift_segments IS 'JSON array: [{ shift_id, shift_name, shift_date, ingredients[], raw_ingredient_audit }].';

-- Backfill legacy free-text into one segment when segments empty
UPDATE public.oil_bin_batch obb
SET shift_segments = jsonb_build_array(
    jsonb_build_object(
        'shift_name', COALESCE(NULLIF(trim(COALESCE(obb.shifts, '')), ''), 'Shift 1'),
        'ingredients', CASE
            WHEN obb.ingredients IS NOT NULL AND trim(obb.ingredients) <> '' THEN
                jsonb_build_array(jsonb_build_object('description', trim(obb.ingredients)))
            ELSE '[]'::jsonb
        END,
        'shift_id', NULL,
        'shift_date', obb.start_date,
        'raw_ingredient_audit', COALESCE(obb.raw_ingredient_audit, '[]'::jsonb)
    )
)
WHERE jsonb_array_length(COALESCE(obb.shift_segments, '[]'::jsonb)) = 0
  AND (
      (obb.shifts IS NOT NULL AND trim(obb.shifts) <> '')
      OR (obb.ingredients IS NOT NULL AND trim(obb.ingredients) <> '')
      OR jsonb_array_length(COALESCE(obb.raw_ingredient_audit, '[]'::jsonb)) > 0
  );

-- Duty sync: append or merge shift segment per oil bin batch
CREATE OR REPLACE FUNCTION public.sync_oil_production_duty_audit(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_snapshot   jsonb;
    v_ing_lines  jsonb;
    v_new_seg    jsonb;
    v_shift_name varchar;
    v_shift_date date;
    v_n          integer := 0;
    obb          RECORD;
    v_seg        jsonb;
    v_len        int;
    v_last       jsonb;
BEGIN
    IF p_shift_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_shift_id is required');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.shift WHERE id = p_shift_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    SELECT s.shift_name, s.shift_date
    INTO v_shift_name, v_shift_date
    FROM public.shift s
    WHERE s.id = p_shift_id;

    v_snapshot := public.get_oil_production_raw_ingredients_snapshot();

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'batch_id', e ->> 'batch_id',
                'qty_kg', CASE
                    WHEN (e ->> 'quantity_kg') IS NOT NULL AND trim(e ->> 'quantity_kg') <> ''
                    THEN (e ->> 'quantity_kg')::numeric
                    ELSE NULL
                END,
                'product_type', NULLIF(trim(COALESCE(e ->> 'product_type', '')), ''),
                'description', COALESCE(
                    NULLIF(trim(COALESCE(e ->> 'product_type', '')), ''),
                    e ->> 'batch_id'
                )
            )
            ORDER BY e ->> 'batch_id'
        ),
        '[]'::jsonb
    )
    INTO v_ing_lines
    FROM jsonb_array_elements(v_snapshot) AS e;

    v_new_seg := jsonb_build_object(
        'shift_id', p_shift_id::text,
        'shift_name', COALESCE(v_shift_name, ''),
        'shift_date', v_shift_date,
        'ingredients', COALESCE(v_ing_lines, '[]'::jsonb),
        'raw_ingredient_audit', COALESCE(v_snapshot, '[]'::jsonb)
    );

    FOR obb IN
        SELECT id, shift_segments
        FROM public.oil_bin_batch
        WHERE status = 'in_production'
    LOOP
        v_seg := COALESCE(obb.shift_segments, '[]'::jsonb);
        IF jsonb_typeof(v_seg) <> 'array' THEN
            v_seg := '[]'::jsonb;
        END IF;

        v_len := jsonb_array_length(v_seg);
        IF v_len > 0 THEN
            v_last := v_seg -> (v_len - 1);
            IF (v_last ->> 'shift_id') IS NOT NULL
               AND trim(COALESCE(v_last ->> 'shift_id', '')) <> ''
               AND (v_last ->> 'shift_id')::uuid = p_shift_id
            THEN
                v_seg := jsonb_set(v_seg, ARRAY [(v_len - 1)::text], v_new_seg, true);
            ELSE
                v_seg := v_seg || jsonb_build_array(v_new_seg);
            END IF;
        ELSE
            v_seg := jsonb_build_array(v_new_seg);
        END IF;

        UPDATE public.oil_bin_batch obu
        SET shift_id = p_shift_id,
            raw_ingredient_audit = v_snapshot,
            shift_segments = v_seg,
            shifts = (
                SELECT string_agg(seg ->> 'shift_name', ' | ' ORDER BY ord)
                FROM jsonb_array_elements(v_seg) WITH ORDINALITY AS t(seg, ord)
            ),
            ingredients = (
                SELECT string_agg(
                    COALESCE(
                        NULLIF(trim(ing ->> 'description'), ''),
                        ing ->> 'batch_id'
                    ),
                    '; '
                )
                FROM jsonb_array_elements(v_seg) seg,
                     LATERAL jsonb_array_elements(COALESCE(seg -> 'ingredients', '[]'::jsonb)) AS ing
            ),
            updated_at = NOW()
        WHERE obu.id = obb.id;

        v_n := v_n + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'linked_bin_batches', v_n,
        'raw_ingredient_count', jsonb_array_length(COALESCE(v_snapshot, '[]'::jsonb))
    );
END;
$$;

DROP FUNCTION IF EXISTS public.update_oil_bin_batch(uuid, character varying, character varying, numeric, numeric, character varying);
DROP FUNCTION IF EXISTS public.update_oil_bin_batch(uuid, character varying, character varying, numeric, numeric, character varying, jsonb);

CREATE OR REPLACE FUNCTION public.update_oil_bin_batch(
    p_id             uuid,
    p_shifts         varchar DEFAULT NULL,
    p_ingredients    varchar DEFAULT NULL,
    p_letrerage      numeric DEFAULT NULL,
    p_ffa            numeric DEFAULT NULL,
    p_oil_stream     varchar DEFAULT NULL,
    p_shift_segments jsonb   DEFAULT NULL
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
    IF v_stream IS NOT NULL AND v_stream <> '' AND v_stream NOT IN ('food_grade', 'cosmetic') THEN
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
        shift_segments = CASE
            WHEN p_shift_segments IS NULL THEN shift_segments
            ELSE p_shift_segments
        END,
        updated_at    = NOW()
    WHERE id = p_id AND status = 'in_production';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found or already sent to stock');
    END IF;

    RETURN jsonb_build_object('success', true);
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
    oil_stream varchar,
    grade varchar,
    ffa_test_at timestamptz,
    ffa_test_pass boolean,
    shift_segments jsonb
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
        obb.oil_stream,
        obb.oil_stream AS grade,
        obb.ffa_test_at,
        obb.ffa_test_pass,
        COALESCE(obb.shift_segments, '[]'::jsonb) AS shift_segments
    FROM public.oil_bin_batch obb
    LEFT JOIN public.shift s ON s.id = obb.shift_id
    WHERE (p_status IS NULL OR obb.status = p_status)
    ORDER BY obb.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- Include structured shifts on stock oil row
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
        shift_id, raw_ingredient_audit, oil_stream, shift_segments
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
            'oil_stream', v_obb.oil_stream,
            'shift_segments', COALESCE(v_obb.shift_segments, '[]'::jsonb)
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

NOTIFY pgrst, 'reload schema';
