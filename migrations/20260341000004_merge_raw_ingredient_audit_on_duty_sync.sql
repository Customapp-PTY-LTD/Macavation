-- Duty sync previously set raw_ingredient_audit = floor snapshot only, which removed
-- manually linked oils once they left production (bag emptied). Merge keeps audit rows
-- whose oil_id is not on the floor and appends current floor snapshot (same rule as frontend merge).

CREATE OR REPLACE FUNCTION public.merge_raw_ingredient_audit_with_floor_snapshot(
    p_existing jsonb,
    p_floor jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH floor_ids AS (
        SELECT COALESCE(
            (
                SELECT array_agg(DISTINCT trim(ev ->> 'oil_id'))
                FROM jsonb_array_elements(COALESCE(p_floor, '[]'::jsonb)) ev
                WHERE ev ->> 'oil_id' IS NOT NULL
                  AND trim(ev ->> 'oil_id') <> ''
            ),
            ARRAY[]::text[]
        ) AS ids
    ),
    kept AS (
        SELECT e.elem
        FROM jsonb_array_elements(COALESCE(p_existing, '[]'::jsonb)) AS e(elem)
        CROSS JOIN floor_ids f
        WHERE trim(COALESCE(e.elem ->> 'oil_id', '')) = ''
           OR NOT (trim(e.elem ->> 'oil_id') = ANY (f.ids))
    ),
    floor_rows AS (
        SELECT fr.elem
        FROM jsonb_array_elements(COALESCE(p_floor, '[]'::jsonb)) AS fr(elem)
    ),
    combined AS (
        SELECT elem FROM kept
        UNION ALL
        SELECT elem FROM floor_rows
    )
    SELECT COALESCE(
        jsonb_agg(elem ORDER BY COALESCE(elem ->> 'batch_id', '')),
        '[]'::jsonb
    )
    FROM combined;
$$;

REVOKE ALL ON FUNCTION public.merge_raw_ingredient_audit_with_floor_snapshot(jsonb, jsonb) FROM PUBLIC;

COMMENT ON FUNCTION public.merge_raw_ingredient_audit_with_floor_snapshot(jsonb, jsonb) IS
  'Keeps raw_ingredient_audit rows for oils not on the production floor, then appends current floor snapshot (by oil_id). Used by sync_oil_production_duty_audit.';

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
    v_merged     jsonb;
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
                ),
                'supplier', NULLIF(trim(COALESCE(e ->> 'supplier', '')), '')
            )
            ORDER BY e ->> 'batch_id'
        ),
        '[]'::jsonb
    )
    INTO v_ing_lines
    FROM jsonb_array_elements(v_snapshot) AS e;

    FOR obb IN
        SELECT id, shift_segments, raw_ingredient_audit
        FROM public.oil_bin_batch
        WHERE status = 'in_production'
    LOOP
        v_merged := public.merge_raw_ingredient_audit_with_floor_snapshot(
            COALESCE(obb.raw_ingredient_audit, '[]'::jsonb),
            v_snapshot
        );

        v_new_seg := jsonb_build_object(
            'shift_id', p_shift_id::text,
            'shift_name', COALESCE(v_shift_name, ''),
            'shift_date', v_shift_date,
            'ingredients', COALESCE(v_ing_lines, '[]'::jsonb),
            'raw_ingredient_audit', COALESCE(v_merged, '[]'::jsonb)
        );

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
            raw_ingredient_audit = v_merged,
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
