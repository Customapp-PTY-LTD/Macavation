-- Auto-populate Averages row from 07h00, 10h00, 13h00 values (average of slots that have numeric data).

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
    v_avg_wholes text;
    v_avg_uncracks text;
    v_avg_total text;
BEGIN
    -- 07h00
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

    -- Auto-compute Averages from 07, 10, 13 (average of slots that have numeric values)
    SELECT (SELECT ROUND(AVG(x)::numeric, 2)::text FROM (
        SELECT CASE WHEN v_wholes_07 IS NOT NULL AND TRIM(v_wholes_07) <> '' AND v_wholes_07 ~ '^-?[0-9.]+$' THEN v_wholes_07::numeric ELSE NULL END
        UNION ALL SELECT CASE WHEN v_wholes_10 IS NOT NULL AND TRIM(v_wholes_10) <> '' AND v_wholes_10 ~ '^-?[0-9.]+$' THEN v_wholes_10::numeric ELSE NULL END
        UNION ALL SELECT CASE WHEN v_wholes_13 IS NOT NULL AND TRIM(v_wholes_13) <> '' AND v_wholes_13 ~ '^-?[0-9.]+$' THEN v_wholes_13::numeric ELSE NULL END
    ) t(x) WHERE x IS NOT NULL),
           (SELECT ROUND(AVG(x)::numeric, 2)::text FROM (
        SELECT CASE WHEN v_uncracks_07 IS NOT NULL AND TRIM(v_uncracks_07) <> '' AND v_uncracks_07 ~ '^-?[0-9.]+$' THEN v_uncracks_07::numeric ELSE NULL END
        UNION ALL SELECT CASE WHEN v_uncracks_10 IS NOT NULL AND TRIM(v_uncracks_10) <> '' AND v_uncracks_10 ~ '^-?[0-9.]+$' THEN v_uncracks_10::numeric ELSE NULL END
        UNION ALL SELECT CASE WHEN v_uncracks_13 IS NOT NULL AND TRIM(v_uncracks_13) <> '' AND v_uncracks_13 ~ '^-?[0-9.]+$' THEN v_uncracks_13::numeric ELSE NULL END
    ) t(x) WHERE x IS NOT NULL),
           (SELECT ROUND(AVG(x)::numeric, 2)::text FROM (
        SELECT CASE WHEN v_total_07 IS NOT NULL AND TRIM(v_total_07) <> '' AND v_total_07 ~ '^-?[0-9.]+$' THEN v_total_07::numeric ELSE NULL END
        UNION ALL SELECT CASE WHEN v_total_10 IS NOT NULL AND TRIM(v_total_10) <> '' AND v_total_10 ~ '^-?[0-9.]+$' THEN v_total_10::numeric ELSE NULL END
        UNION ALL SELECT CASE WHEN v_total_13 IS NOT NULL AND TRIM(v_total_13) <> '' AND v_total_13 ~ '^-?[0-9.]+$' THEN v_total_13::numeric ELSE NULL END
    ) t(x) WHERE x IS NOT NULL)
    INTO v_avg_wholes, v_avg_uncracks, v_avg_total;

    time_slot := '07h00'; batch := COALESCE(v_batch_07, ''); wholes := COALESCE(v_wholes_07, ''); uncracks := COALESCE(v_uncracks_07, ''); total := COALESCE(v_total_07, ''); RETURN NEXT;
    time_slot := '10h00'; batch := COALESCE(v_batch_10, ''); wholes := COALESCE(v_wholes_10, ''); uncracks := COALESCE(v_uncracks_10, ''); total := COALESCE(v_total_10, ''); RETURN NEXT;
    time_slot := '13h00'; batch := COALESCE(v_batch_13, ''); wholes := COALESCE(v_wholes_13, ''); uncracks := COALESCE(v_uncracks_13, ''); total := COALESCE(v_total_13, ''); RETURN NEXT;
    time_slot := 'Averages'; batch := ''; wholes := COALESCE(v_avg_wholes, ''); uncracks := COALESCE(v_avg_uncracks, ''); total := COALESCE(v_avg_total, ''); RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_daily_minute_tests(date) IS 'Daily minute tests for dashboard: TIME, BATCH, WHOLES, UNCRACKS, TOTAL. 07h00/10h00/13h00 from cracking_data; Averages row auto-computed from those three slots.';
