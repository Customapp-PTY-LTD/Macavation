-- Finished-good stock FFA: when oil_bin_batch.ffa is null, use supplier-intake official FFA from
-- raw_ingredient_audit (per-row ffa or oil.intake_data official_ffa / ffa). Ensures bag FFA shows after send to stock.

CREATE OR REPLACE FUNCTION public.official_ffa_from_oil_intake_data(p_intake jsonb)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT NULLIF(
        COALESCE(
            CASE
                WHEN (p_intake ? 'official_ffa') AND jsonb_typeof(p_intake -> 'official_ffa') = 'number'
                THEN (p_intake -> 'official_ffa')::text::numeric
                ELSE NULL::numeric
            END,
            CASE
                WHEN NULLIF(trim(COALESCE(p_intake ->> 'official_ffa', '')), '') IS NOT NULL
                THEN (NULLIF(trim(p_intake ->> 'official_ffa'), ''))::numeric
                ELSE NULL::numeric
            END,
            CASE
                WHEN (p_intake ? 'ffa') AND jsonb_typeof(p_intake -> 'ffa') = 'number'
                THEN (p_intake -> 'ffa')::text::numeric
                ELSE NULL::numeric
            END,
            CASE
                WHEN NULLIF(trim(COALESCE(p_intake ->> 'ffa', '')), '') IS NOT NULL
                THEN (NULLIF(trim(p_intake ->> 'ffa'), ''))::numeric
                ELSE NULL::numeric
            END
        ),
        NULL::numeric
    );
$$;

REVOKE ALL ON FUNCTION public.official_ffa_from_oil_intake_data(jsonb) FROM PUBLIC;

COMMENT ON FUNCTION public.official_ffa_from_oil_intake_data(jsonb) IS
  'Official / bag FFA from oil.intake_data (official_ffa or ffa).';

CREATE OR REPLACE FUNCTION public.official_ffa_from_raw_ingredient_audit(p_audit jsonb)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH elems AS (
        SELECT e.elem, e.ord
        FROM jsonb_array_elements(COALESCE(p_audit, '[]'::jsonb)) WITH ORDINALITY AS e(elem, ord)
    ),
    resolved AS (
        SELECT
            e.ord,
            CASE
                WHEN (e.elem ? 'ffa') AND jsonb_typeof(e.elem -> 'ffa') = 'number'
                THEN (e.elem -> 'ffa')::text::numeric
                WHEN NULLIF(trim(COALESCE(e.elem ->> 'ffa', '')), '') IS NOT NULL
                THEN (NULLIF(trim(e.elem ->> 'ffa'), ''))::numeric
                WHEN e.elem ->> 'oil_id' IS NOT NULL AND trim(e.elem ->> 'oil_id') <> ''
                THEN (
                    SELECT public.official_ffa_from_oil_intake_data(o.intake_data)
                    FROM public.oil o
                    WHERE o.id = (e.elem ->> 'oil_id')::uuid
                      AND o.is_active = true
                    LIMIT 1
                )
                ELSE NULL
            END AS ffa_val
        FROM elems e
    )
    SELECT r.ffa_val
    FROM resolved r
    WHERE r.ffa_val IS NOT NULL
    ORDER BY r.ord
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.official_ffa_from_raw_ingredient_audit(jsonb) FROM PUBLIC;

COMMENT ON FUNCTION public.official_ffa_from_raw_ingredient_audit(jsonb) IS
  'First non-null FFA from raw_ingredient_audit: row ffa, else oil.intake_data official_ffa/ffa by oil_id.';

CREATE OR REPLACE FUNCTION public.send_oil_bin_batch_to_stock(
    p_oil_bin_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_obb         RECORD;
    v_oil_id      uuid;
    v_lot_id      uuid;
    v_kg          numeric;
    v_notes       text;
    v_grade       text;
    v_ffa_display numeric;
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

    v_grade := CASE trim(lower(COALESCE(v_obb.oil_stream::text, '')))
        WHEN 'food_grade' THEN 'Food grade'
        WHEN 'cosmetic' THEN 'Cosmetic'
        ELSE NULL
    END;

    v_ffa_display := COALESCE(
        v_obb.ffa,
        public.official_ffa_from_raw_ingredient_audit(v_obb.raw_ingredient_audit)
    );

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
            'ffa', v_ffa_display,
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
        grade,
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
        v_grade,
        v_ffa_display,
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

COMMENT ON FUNCTION public.send_oil_bin_batch_to_stock(uuid) IS
  'Creates oil (stock) row + finished_good lot; FFA from bin batch or supplier-intake audit; grade from oil_stream.';

-- Stock grid: show FFA from audit when lot row was created before this logic
CREATE OR REPLACE FUNCTION public.get_oil_stock_lots(
    p_location_code text DEFAULT NULL,
    p_stock_category text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_offset integer DEFAULT 0,
    p_limit integer DEFAULT 200
)
RETURNS TABLE (
    id uuid,
    location_code varchar,
    stock_category varchar,
    status varchar,
    counterparty_type varchar,
    counterparty_name text,
    counterparty_contact_id uuid,
    po_reference varchar,
    batch_number varchar,
    product_code varchar,
    product_description text,
    grade varchar,
    ffa numeric,
    coa_status varchar,
    units integer,
    volume numeric,
    kilograms numeric,
    delivery_date date,
    manufacture_date date,
    bb_date date,
    notes text,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        l.id,
        l.location_code,
        l.stock_category,
        l.status,
        l.counterparty_type,
        l.counterparty_name,
        l.counterparty_contact_id,
        l.po_reference,
        l.batch_number,
        l.product_code,
        l.product_description,
        (
            COALESCE(
                NULLIF(trim(l.grade), ''),
                (
                    SELECT CASE trim(lower(COALESCE(obb.oil_stream::text, '')))
                        WHEN 'food_grade' THEN 'Food grade'::varchar
                        WHEN 'cosmetic' THEN 'Cosmetic'::varchar
                        ELSE NULL::varchar
                    END
                    FROM public.oil_bin_batch obb
                    WHERE obb.batch_number = l.batch_number
                    ORDER BY obb.updated_at DESC NULLS LAST
                    LIMIT 1
                )
            )
        )::varchar AS grade,
        COALESCE(
            l.ffa,
            (
                SELECT public.official_ffa_from_raw_ingredient_audit(obb.raw_ingredient_audit)
                FROM public.oil_bin_batch obb
                WHERE obb.batch_number = l.batch_number
                ORDER BY obb.updated_at DESC NULLS LAST
                LIMIT 1
            ),
            (
                SELECT public.official_ffa_from_oil_intake_data(o.intake_data)
                FROM public.oil o
                WHERE o.batch_id = l.batch_number
                  AND o.is_active = true
                ORDER BY o.updated_at DESC NULLS LAST
                LIMIT 1
            )
        ) AS ffa,
        l.coa_status,
        l.units,
        l.volume,
        l.kilograms,
        l.delivery_date,
        l.manufacture_date,
        l.bb_date,
        l.notes,
        l.created_at,
        l.updated_at
    FROM public.oil_stock_lots l
    WHERE l.is_active = true
      AND (p_location_code IS NULL OR l.location_code = p_location_code)
      AND (p_stock_category IS NULL OR l.stock_category = p_stock_category)
      AND (p_status IS NULL OR l.status = p_status)
      AND (
          p_search IS NULL OR p_search = '' OR
          COALESCE(l.counterparty_name, '') ILIKE '%' || p_search || '%' OR
          COALESCE(l.po_reference, '') ILIKE '%' || p_search || '%' OR
          COALESCE(l.batch_number, '') ILIKE '%' || p_search || '%' OR
          COALESCE(l.product_code, '') ILIKE '%' || p_search || '%' OR
          COALESCE(l.product_description, '') ILIKE '%' || p_search || '%' OR
          COALESCE(l.grade, '') ILIKE '%' || p_search || '%' OR
          EXISTS (
              SELECT 1 FROM public.oil_bin_batch obb_s
              WHERE obb_s.batch_number = l.batch_number
                AND COALESCE(obb_s.oil_stream::text, '') ILIKE '%' || p_search || '%'
          )
      )
    ORDER BY COALESCE(l.bb_date, l.manufacture_date, l.delivery_date, l.created_at) DESC, l.created_at DESC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 1000);
END;
$$;

COMMENT ON FUNCTION public.get_oil_stock_lots(text, text, text, text, integer, integer) IS
  'Lists oil_stock_lots; grade from oil_bin_batch.oil_stream; FFA coalesced from supplier-intake audit when lot.ffa is null.';

-- Backfill existing lots (finished good, same batch as a bin batch with audit)
UPDATE public.oil_stock_lots l
SET
    ffa = COALESCE(
        l.ffa,
        public.official_ffa_from_raw_ingredient_audit(obb.raw_ingredient_audit)
    ),
    updated_at = now()
FROM public.oil_bin_batch obb
WHERE l.batch_number = obb.batch_number
  AND l.is_active = true
  AND l.stock_category = 'finished_good'
  AND l.ffa IS NULL
  AND obb.raw_ingredient_audit IS NOT NULL
  AND jsonb_typeof(obb.raw_ingredient_audit) = 'array'
  AND public.official_ffa_from_raw_ingredient_audit(obb.raw_ingredient_audit) IS NOT NULL;

-- Raw-material (or other) lots: match supplier bag by batch_number = oil.batch_id
UPDATE public.oil_stock_lots l
SET
    ffa = public.official_ffa_from_oil_intake_data(o.intake_data),
    updated_at = now()
FROM public.oil o
WHERE l.batch_number = o.batch_id
  AND l.is_active = true
  AND o.is_active = true
  AND l.ffa IS NULL
  AND public.official_ffa_from_oil_intake_data(o.intake_data) IS NOT NULL;

NOTIFY pgrst, 'reload schema';
