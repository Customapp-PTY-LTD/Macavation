-- Add batch column to get_daily_minute_tests: show which batch each time slot (07h00, 10h00, 13h00, Averages) came from.
-- Drop first because return type changes (adds batch column).

DROP FUNCTION IF EXISTS public.get_daily_minute_tests(date);

CREATE OR REPLACE FUNCTION public.get_daily_minute_tests(p_date date DEFAULT NULL)
RETURNS TABLE (
    time_slot text,
    batch text,
    wholes text,
    uncracks text,
    total text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_date date := COALESCE(p_date, (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date);
    v_batch_07 text;
    v_wholes_07 text;
    v_uncracks_07 text;
    v_total_07 text;
    v_batch_10 text;
    v_wholes_10 text;
    v_uncracks_10 text;
    v_total_10 text;
    v_batch_13 text;
    v_wholes_13 text;
    v_uncracks_13 text;
    v_total_13 text;
    v_batch_avg text;
    v_avg_wholes text;
    v_avg_uncracks text;
    v_avg_total text;
BEGIN
    -- 07h00: one row from kernel+batches for today with 07 slot filled
    SELECT b.batch_id, NULLIF(TRIM(elem->>'wholes_07'), ''), NULLIF(TRIM(elem->>'uncracks_07'), ''), NULLIF(TRIM(elem->>'total_07'), '')
    INTO v_batch_07, v_wholes_07, v_uncracks_07, v_total_07
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (CASE WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY') ELSE NULL END) = v_date
      AND (TRIM(COALESCE(elem->>'wholes_07', '')) <> '' OR TRIM(COALESCE(elem->>'total_07', '')) <> '')
    LIMIT 1;

    -- 10h00
    SELECT b.batch_id, NULLIF(TRIM(elem->>'wholes_10'), ''), NULLIF(TRIM(elem->>'uncracks_10'), ''), NULLIF(TRIM(elem->>'total_10'), '')
    INTO v_batch_10, v_wholes_10, v_uncracks_10, v_total_10
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (CASE WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY') ELSE NULL END) = v_date
      AND (TRIM(COALESCE(elem->>'wholes_10', '')) <> '' OR TRIM(COALESCE(elem->>'total_10', '')) <> '')
    LIMIT 1;

    -- 13h00
    SELECT b.batch_id, NULLIF(TRIM(elem->>'wholes_13'), ''), NULLIF(TRIM(elem->>'uncracks_13'), ''), NULLIF(TRIM(elem->>'total_13'), '')
    INTO v_batch_13, v_wholes_13, v_uncracks_13, v_total_13
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (CASE WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY') ELSE NULL END) = v_date
      AND (TRIM(COALESCE(elem->>'wholes_13', '')) <> '' OR TRIM(COALESCE(elem->>'total_13', '')) <> '')
    LIMIT 1;

    -- Averages
    SELECT b.batch_id, NULLIF(TRIM(elem->>'avg_wholes'), ''), NULLIF(TRIM(elem->>'avg_uncracks'), ''), NULLIF(TRIM(elem->>'avg_total'), '')
    INTO v_batch_avg, v_avg_wholes, v_avg_uncracks, v_avg_total
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (CASE WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY') ELSE NULL END) = v_date
      AND (TRIM(COALESCE(elem->>'avg_wholes', '')) <> '' OR TRIM(COALESCE(elem->>'avg_total', '')) <> '')
    LIMIT 1;

    time_slot := '07h00'; batch := COALESCE(v_batch_07, ''); wholes := COALESCE(v_wholes_07, ''); uncracks := COALESCE(v_uncracks_07, ''); total := COALESCE(v_total_07, ''); RETURN NEXT;
    time_slot := '10h00'; batch := COALESCE(v_batch_10, ''); wholes := COALESCE(v_wholes_10, ''); uncracks := COALESCE(v_uncracks_10, ''); total := COALESCE(v_total_10, ''); RETURN NEXT;
    time_slot := '13h00'; batch := COALESCE(v_batch_13, ''); wholes := COALESCE(v_wholes_13, ''); uncracks := COALESCE(v_uncracks_13, ''); total := COALESCE(v_total_13, ''); RETURN NEXT;
    time_slot := 'Averages'; batch := COALESCE(v_batch_avg, ''); wholes := COALESCE(v_avg_wholes, ''); uncracks := COALESCE(v_avg_uncracks, ''); total := COALESCE(v_avg_total, ''); RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_daily_minute_tests(date) IS 'Daily minute tests for dashboard: TIME, BATCH, WHOLES, UNCRACKS, TOTAL for 07h00, 10h00, 13h00, Averages from cracking_data for given date (default SA today).';
