-- OPTIONAL: extends update_oil_bin_batch with p_raw_ingredient_audit.
-- Prefer migrations/20260332000002_set_oil_bin_batch_raw_ingredient_links.sql + set_oil_bin_batch_raw_ingredient_links
-- so PostgREST does not depend on this overload (avoids "function not in schema cache" if this file was not applied).
-- Allow linking raw ingredient (oil) rows in production to an oil_bin_batch for traceability.
-- Frontend passes the same JSON shape as get_oil_production_raw_ingredients_snapshot(): array of
-- { oil_id, batch_id, quantity_kg, product_type }.

DROP FUNCTION IF EXISTS public.update_oil_bin_batch(uuid, character varying, character varying, numeric, numeric, character varying, jsonb);

CREATE OR REPLACE FUNCTION public.update_oil_bin_batch(
    p_id                      uuid,
    p_shifts                  varchar DEFAULT NULL,
    p_ingredients             varchar DEFAULT NULL,
    p_letrerage               numeric DEFAULT NULL,
    p_ffa                     numeric DEFAULT NULL,
    p_oil_stream              varchar DEFAULT NULL,
    p_shift_segments          jsonb   DEFAULT NULL,
    p_raw_ingredient_audit    jsonb   DEFAULT NULL
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
        letrerage       = COALESCE(p_letrerage, letrerage),
        ffa             = COALESCE(p_ffa, ffa),
        oil_stream      = CASE
            WHEN p_oil_stream IS NULL THEN oil_stream
            WHEN trim(COALESCE(p_oil_stream, '')) = '' THEN oil_stream
            ELSE v_stream
        END,
        shift_segments  = CASE
            WHEN p_shift_segments IS NULL THEN shift_segments
            ELSE p_shift_segments
        END,
        raw_ingredient_audit = CASE
            WHEN p_raw_ingredient_audit IS NULL THEN raw_ingredient_audit
            ELSE p_raw_ingredient_audit
        END,
        updated_at      = NOW()
    WHERE id = p_id AND status = 'in_production';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found or already sent to stock');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.update_oil_bin_batch IS 'Edit in-production oil bin batch; optional p_raw_ingredient_audit links supplier raw batches (traceability).';

NOTIFY pgrst, 'reload schema';
