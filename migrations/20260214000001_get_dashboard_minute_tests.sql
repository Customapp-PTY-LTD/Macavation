-- Dashboard: daily minute tests from cracking (07h00, 10h00, 13h00, Averages).
-- Returns one row per time slot for today (SA timezone); each slot shows the first non-empty
-- values from any kernel's cracking_data for that day (so 07h00 can be from one batch, 10h00 from another).

CREATE OR REPLACE FUNCTION public.get_dashboard_minute_tests()
RETURNS TABLE (
    time_slot text,
    wholes numeric,
    uncracks numeric,
    total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
    RETURN QUERY
    -- 07h00: first cracking_data entry for today that has any minute-test value for 07
    (SELECT '07h00'::text,
            NULLIF(TRIM(elem->>'wholes_07'), '')::numeric,
            NULLIF(TRIM(elem->>'uncracks_07'), '')::numeric,
            NULLIF(TRIM(elem->>'total_07'), '')::numeric
     FROM public.kernel k,
          jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
     WHERE k.is_active = true
       AND elem ? 'date'
       AND TRIM(COALESCE(elem->>'date', '')) <> ''
       AND (CASE
                WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
                WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
                ELSE NULL
            END) = v_today
       AND (NULLIF(TRIM(COALESCE(elem->>'wholes_07', '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(elem->>'uncracks_07', '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(elem->>'total_07', '')), '') IS NOT NULL)
     LIMIT 1)
    UNION ALL
    -- 10h00
    (SELECT '10h00'::text,
            NULLIF(TRIM(elem->>'wholes_10'), '')::numeric,
            NULLIF(TRIM(elem->>'uncracks_10'), '')::numeric,
            NULLIF(TRIM(elem->>'total_10'), '')::numeric
     FROM public.kernel k,
          jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
     WHERE k.is_active = true
       AND elem ? 'date'
       AND TRIM(COALESCE(elem->>'date', '')) <> ''
       AND (CASE
                WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
                WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
                ELSE NULL
            END) = v_today
       AND (NULLIF(TRIM(COALESCE(elem->>'wholes_10', '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(elem->>'uncracks_10', '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(elem->>'total_10', '')), '') IS NOT NULL)
     LIMIT 1)
    UNION ALL
    -- 13h00
    (SELECT '13h00'::text,
            NULLIF(TRIM(elem->>'wholes_13'), '')::numeric,
            NULLIF(TRIM(elem->>'uncracks_13'), '')::numeric,
            NULLIF(TRIM(elem->>'total_13'), '')::numeric
     FROM public.kernel k,
          jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
     WHERE k.is_active = true
       AND elem ? 'date'
       AND TRIM(COALESCE(elem->>'date', '')) <> ''
       AND (CASE
                WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
                WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
                ELSE NULL
            END) = v_today
       AND (NULLIF(TRIM(COALESCE(elem->>'wholes_13', '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(elem->>'uncracks_13', '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(elem->>'total_13', '')), '') IS NOT NULL)
     LIMIT 1)
    UNION ALL
    -- Averages
    (SELECT 'Averages'::text,
            NULLIF(TRIM(elem->>'avg_wholes'), '')::numeric,
            NULLIF(TRIM(elem->>'avg_uncracks'), '')::numeric,
            NULLIF(TRIM(elem->>'avg_total'), '')::numeric
     FROM public.kernel k,
          jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
     WHERE k.is_active = true
       AND elem ? 'date'
       AND TRIM(COALESCE(elem->>'date', '')) <> ''
       AND (CASE
                WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
                WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
                ELSE NULL
            END) = v_today
       AND (NULLIF(TRIM(COALESCE(elem->>'avg_wholes', '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(elem->>'avg_uncracks', '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(elem->>'avg_total', '')), '') IS NOT NULL)
     LIMIT 1);
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_minute_tests() IS 'Returns today (SA timezone) daily minute test rows from cracking: 07h00, 10h00, 13h00, Averages. Each slot is the first non-empty from any batch.';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_dashboard_minute_tests', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
