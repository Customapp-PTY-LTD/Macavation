-- Stock Management: view ingredients / shift segments used for an oil stock batch.
-- Joins oil_bin_batch (production) and oil.production_data (snapshot at send-to-stock).

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
  'Returns JSON with ingredients, shifts, shift_segments, raw_ingredient_audit for a batch (oil_bin_batch + oil.production_data).';

-- RBAC: same roles as get_oil_stock_lots
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id,
       'function',
       'get_oil_batch_ingredients_detail',
       'EXECUTE',
       true
FROM public.role_permissions rp
WHERE rp.object_type = 'function'
  AND rp.object_name = 'get_oil_stock_lots'
  AND rp.operation = 'EXECUTE'
  AND COALESCE(rp.allowed, false) = true
  AND NOT EXISTS (
      SELECT 1
      FROM public.role_permissions x
      WHERE x.role_id = rp.role_id
        AND x.object_type = 'function'
        AND x.object_name = 'get_oil_batch_ingredients_detail'
        AND x.operation = 'EXECUTE'
  );

NOTIFY pgrst, 'reload schema';
