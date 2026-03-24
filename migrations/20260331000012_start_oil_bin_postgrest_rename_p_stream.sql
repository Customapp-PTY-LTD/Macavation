-- Fix PostgREST: it sorts RPC parameter names alphabetically. p_oil_stream < p_start_date,
-- so it looked for start_oil_bin_batch(varchar, date) while the DB had (date, varchar).
-- Rename start_oil_bin_batch's second param to p_stream → order p_start_date, p_stream = (date, varchar).
-- Safe to run if you already applied 20260331000010/11 with p_oil_stream.

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

CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(p_start_date date)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.start_oil_bin_batch(p_start_date, NULL::varchar);
$$;

CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(p_stream varchar)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.start_oil_bin_batch(NULL::date, p_stream);
$$;

NOTIFY pgrst, 'reload schema';
