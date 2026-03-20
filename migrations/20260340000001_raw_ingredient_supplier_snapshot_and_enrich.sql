-- Raw ingredient "bags" carry supplier name from oil.intake_data (supplier / supplier_details).
-- 1) Snapshot + duty sync include supplier on new links.
-- 2) get_oil_batch_ingredients_detail enriches stored JSON when supplier was missing (lookup by oil_id / batch_id).

-- Helper: fill supplier on each audit element from live oil.intake_data when not already set.
CREATE OR REPLACE FUNCTION public.enrich_raw_ingredient_audit_suppliers(p_audit jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(
        sub.elem || jsonb_build_object(
            'supplier', COALESCE(
                NULLIF(trim(COALESCE(sub.elem->>'supplier', sub.elem->>'supplier_details', '')), ''),
                (SELECT NULLIF(trim(COALESCE(o.intake_data->>'supplier', o.intake_data->>'supplier_details', '')), '')
                 FROM public.oil o
                 WHERE (sub.elem->>'oil_id' IS NOT NULL AND o.id = (sub.elem->>'oil_id')::uuid)
                    OR (sub.elem->>'batch_id' IS NOT NULL AND o.batch_id = sub.elem->>'batch_id')
                 LIMIT 1)
            )
        )
        ORDER BY sub.ord
    ), '[]'::jsonb)
    FROM (
        SELECT elem, ord
        FROM jsonb_array_elements(COALESCE(p_audit, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
    ) sub;
$$;

REVOKE ALL ON FUNCTION public.enrich_raw_ingredient_audit_suppliers(jsonb) FROM PUBLIC;

COMMENT ON FUNCTION public.enrich_raw_ingredient_audit_suppliers(jsonb) IS
  'Merges supplier / supplier_details from public.oil.intake_data onto raw_ingredient_audit JSON rows when missing.';

-- Current raw ingredients in oil production (status = production)
CREATE OR REPLACE FUNCTION public.get_oil_production_raw_ingredients_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(obj ORDER BY sort_key), '[]'::jsonb)
    FROM (
        SELECT
            jsonb_build_object(
                'oil_id', o.id,
                'batch_id', o.batch_id,
                'quantity_kg', COALESCE(
                    NULLIF((o.intake_data->>'quantity_kg'), '')::numeric,
                    NULLIF((o.intake_data#>>'{items,0,quantity_kg}'), '')::numeric
                ),
                'product_type', NULLIF(trim(COALESCE(
                    o.intake_data->>'product_type',
                    o.production_data->>'name_of_product',
                    ''
                )), ''),
                'supplier', NULLIF(trim(COALESCE(
                    o.intake_data->>'supplier',
                    o.intake_data->>'supplier_details',
                    ''
                )), '')
            ) AS obj,
            o.batch_id::text AS sort_key
        FROM public.oil o
        WHERE o.is_active = true
          AND o.status = 'production'
    ) s;
$$;

-- Duty sync: include supplier on per-line ingredients table
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
                ),
                'supplier', NULLIF(trim(COALESCE(e ->> 'supplier', '')), '')
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

-- Stock modal: enrich audit + nested segment audits
CREATE OR REPLACE FUNCTION public.get_oil_batch_ingredients_detail(p_batch_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bn   text;
    v_ob   RECORD;
    v_oil  RECORD;
    v_pd   jsonb;
    v_ing  text;
    v_sh   text;
    v_seg  jsonb;
    v_aud  jsonb;
    v_stream text;
BEGIN
    v_bn := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF v_bn IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'batch_number is required');
    END IF;

    SELECT
        obb.id,
        obb.ingredients,
        obb.shifts,
        COALESCE(obb.shift_segments, '[]'::jsonb) AS shift_segments,
        COALESCE(obb.raw_ingredient_audit, '[]'::jsonb) AS raw_ingredient_audit,
        obb.oil_stream
    INTO v_ob
    FROM public.oil_bin_batch obb
    WHERE obb.batch_number = v_bn
    ORDER BY obb.updated_at DESC NULLS LAST
    LIMIT 1;

    SELECT o.id, o.production_data
    INTO v_oil
    FROM public.oil o
    WHERE o.batch_id = v_bn
      AND COALESCE(o.is_active, true) = true
    ORDER BY o.created_at DESC NULLS LAST
    LIMIT 1;

    v_pd := COALESCE(v_oil.production_data, '{}'::jsonb);

    v_ing := COALESCE(v_ob.ingredients, v_pd ->> 'ingredients');
    v_sh := COALESCE(v_ob.shifts, v_pd ->> 'shifts');

    IF v_ob.id IS NOT NULL THEN
        v_seg := COALESCE(v_ob.shift_segments, '[]'::jsonb);
        v_aud := COALESCE(v_ob.raw_ingredient_audit, '[]'::jsonb);
    ELSE
        v_seg := '[]'::jsonb;
        v_aud := '[]'::jsonb;
    END IF;

    IF jsonb_typeof(v_seg) <> 'array' OR jsonb_array_length(COALESCE(v_seg, '[]'::jsonb)) = 0 THEN
        v_seg := COALESCE(v_pd -> 'shift_segments', '[]'::jsonb);
    END IF;
    IF jsonb_typeof(v_seg) <> 'array' THEN
        v_seg := '[]'::jsonb;
    END IF;

    IF jsonb_typeof(v_aud) <> 'array' OR jsonb_array_length(COALESCE(v_aud, '[]'::jsonb)) = 0 THEN
        v_aud := COALESCE(v_pd -> 'raw_ingredient_audit', '[]'::jsonb);
    END IF;
    IF jsonb_typeof(v_aud) <> 'array' THEN
        v_aud := '[]'::jsonb;
    END IF;

    v_stream := NULL;
    IF v_ob.id IS NOT NULL AND v_ob.oil_stream IS NOT NULL THEN
        v_stream := v_ob.oil_stream::text;
    ELSE
        v_stream := v_pd ->> 'oil_stream';
    END IF;

    v_aud := public.enrich_raw_ingredient_audit_suppliers(v_aud);

    v_seg := (
        SELECT COALESCE(jsonb_agg(
            CASE
                WHEN jsonb_typeof(s.elem->'raw_ingredient_audit') = 'array'
                THEN jsonb_set(
                    s.elem,
                    '{raw_ingredient_audit}',
                    public.enrich_raw_ingredient_audit_suppliers(s.elem->'raw_ingredient_audit')
                )
                ELSE s.elem
            END
            ORDER BY s.ord
        ), '[]'::jsonb)
        FROM jsonb_array_elements(v_seg) WITH ORDINALITY AS s(elem, ord)
    );

    RETURN jsonb_build_object(
        'success', true,
        'batch_number', v_bn,
        'has_oil_bin_batch', (v_ob.id IS NOT NULL),
        'has_oil_row', (v_oil.id IS NOT NULL),
        'oil_stream', v_stream,
        'ingredients_text', v_ing,
        'shifts_text', v_sh,
        'shift_segments', v_seg,
        'raw_ingredient_audit', v_aud,
        'production_data', v_pd
    );
END;
$$;

COMMENT ON FUNCTION public.get_oil_batch_ingredients_detail(text) IS
  'Returns JSON with ingredients, shifts, shift_segments, raw_ingredient_audit (suppliers enriched from oil.intake_data).';

COMMENT ON COLUMN public.oil_bin_batch.raw_ingredient_audit IS
  'JSON array snapshot: oil_id, batch_id, quantity_kg, product_type, supplier (from oil.intake_data at link time).';

NOTIFY pgrst, 'reload schema';
