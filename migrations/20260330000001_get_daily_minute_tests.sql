-- Daily minute tests for dashboard: aggregate 07h00, 10h00, 13h00 and Averages from cracking_data
-- for a given date (default: today in SA). Each time slot can come from a different batch.

CREATE OR REPLACE FUNCTION public.get_daily_minute_tests(p_date date DEFAULT NULL)
RETURNS TABLE (
    time_slot text,
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
    v_wholes_07 text;
    v_uncracks_07 text;
    v_total_07 text;
    v_wholes_10 text;
    v_uncracks_10 text;
    v_total_10 text;
    v_wholes_13 text;
    v_uncracks_13 text;
    v_total_13 text;
    v_avg_wholes text;
    v_avg_uncracks text;
    v_avg_total text;
BEGIN
    -- From all kernel cracking_data entries for v_date, take one non-empty value per slot (max of trimmed value).
    SELECT
        NULLIF(TRIM(MAX(elem->>'wholes_07')), ''),
        NULLIF(TRIM(MAX(elem->>'uncracks_07')), ''),
        NULLIF(TRIM(MAX(elem->>'total_07')), ''),
        NULLIF(TRIM(MAX(elem->>'wholes_10')), ''),
        NULLIF(TRIM(MAX(elem->>'uncracks_10')), ''),
        NULLIF(TRIM(MAX(elem->>'total_10')), ''),
        NULLIF(TRIM(MAX(elem->>'wholes_13')), ''),
        NULLIF(TRIM(MAX(elem->>'uncracks_13')), ''),
        NULLIF(TRIM(MAX(elem->>'total_13')), ''),
        NULLIF(TRIM(MAX(elem->>'avg_wholes')), ''),
        NULLIF(TRIM(MAX(elem->>'avg_uncracks')), ''),
        NULLIF(TRIM(MAX(elem->>'avg_total')), '')
    INTO
        v_wholes_07, v_uncracks_07, v_total_07,
        v_wholes_10, v_uncracks_10, v_total_10,
        v_wholes_13, v_uncracks_13, v_total_13,
        v_avg_wholes, v_avg_uncracks, v_avg_total
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (
          (CASE
               WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
               WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
               ELSE NULL
           END) = v_date
      );

    -- Return 4 rows: 07h00, 10h00, 13h00, Averages (empty string when no data).
    time_slot := '07h00'; wholes := COALESCE(v_wholes_07, ''); uncracks := COALESCE(v_uncracks_07, ''); total := COALESCE(v_total_07, ''); RETURN NEXT;
    time_slot := '10h00'; wholes := COALESCE(v_wholes_10, ''); uncracks := COALESCE(v_uncracks_10, ''); total := COALESCE(v_total_10, ''); RETURN NEXT;
    time_slot := '13h00'; wholes := COALESCE(v_wholes_13, ''); uncracks := COALESCE(v_uncracks_13, ''); total := COALESCE(v_total_13, ''); RETURN NEXT;
    time_slot := 'Averages'; wholes := COALESCE(v_avg_wholes, ''); uncracks := COALESCE(v_avg_uncracks, ''); total := COALESCE(v_avg_total, ''); RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_daily_minute_tests(date) IS 'Daily minute tests for dashboard: TIME, WHOLES, UNCRACKS, TOTAL for 07h00, 10h00, 13h00, Averages from cracking_data for given date (default SA today).';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.role_permissions
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'get_daily_minute_tests' AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'get_daily_minute_tests', 'EXECUTE', true);
        END IF;
    END LOOP;
END $$;
