-- Production Trends chart: daily kg cracked, kg packed, kg dispatched (SA timezone).
-- Used by dashboard Production Trends chart with switch: daily cracked / daily packed / daily dispatched.

CREATE OR REPLACE FUNCTION public.get_production_trends_daily(p_days integer DEFAULT 30)
RETURNS TABLE (
    trend_date date,
    kg_cracked numeric,
    kg_packed numeric,
    kg_dispatched numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_start date := v_today - (p_days - 1);
BEGIN
    RETURN QUERY
    WITH dates AS (
        SELECT d::date AS d
        FROM generate_series(v_start, v_today, interval '1 day') AS d
    ),
    cracked AS (
        SELECT
            (CASE
                WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
                WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
                ELSE NULL
            END) AS d,
            SUM(COALESCE(
                NULLIF(TRIM(elem->>'totalqty'), '')::numeric,
                NULLIF(TRIM(elem->>'total_qty'), '')::numeric,
                0
            )) AS kg
        FROM public.kernel k,
             jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
        WHERE k.is_active = true
          AND elem ? 'date'
          AND (elem->>'date') IS NOT NULL
          AND TRIM(COALESCE(elem->>'date', '')) <> ''
        GROUP BY (CASE
            WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
            WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
            ELSE NULL
        END)
    ),
    packed AS (
        SELECT
            (CASE
                WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
                WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
                ELSE NULL
            END) AS d,
            SUM(COALESCE(
                NULLIF(TRIM(elem->>'totals_qty'), '')::numeric,
                NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric + NULLIF(TRIM(elem->>'bt_total_qty'), '')::numeric,
                (SELECT COALESCE(SUM(NULLIF(TRIM(v->>'qty'), '')::numeric), 0)
                 FROM jsonb_each(COALESCE(elem->'sound_kernel', '{}'::jsonb) || COALESCE(elem->'butter_grade', '{}'::jsonb)) AS t(k, v)
                 WHERE v->>'qty' IS NOT NULL AND TRIM(COALESCE(v->>'qty', '')) <> ''),
                0
            )) AS kg
        FROM public.kernel k,
             jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
        WHERE k.is_active = true
          AND elem ? 'date'
          AND (elem->>'date') IS NOT NULL
          AND TRIM(COALESCE(elem->>'date', '')) <> ''
        GROUP BY (CASE
            WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
            WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
            ELSE NULL
        END)
    ),
    dispatched AS (
        SELECT
            (o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date AS d,
            COALESCE(SUM((le->>'quantity_kg')::numeric), 0) AS kg
        FROM public.kernel_dispatch_orders o,
             jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
        WHERE o.dispatched_at IS NOT NULL
        GROUP BY (o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date
    )
    SELECT
        dates.d AS trend_date,
        COALESCE(c.kg, 0)::numeric AS kg_cracked,
        COALESCE(p.kg, 0)::numeric AS kg_packed,
        COALESCE(d.kg, 0)::numeric AS kg_dispatched
    FROM dates
    LEFT JOIN cracked c ON c.d = dates.d
    LEFT JOIN packed p ON p.d = dates.d
    LEFT JOIN dispatched d ON d.d = dates.d
    ORDER BY dates.d;
END;
$$;

COMMENT ON FUNCTION public.get_production_trends_daily(integer) IS 'Daily production trends for chart: kg cracked, kg packed, kg dispatched. Uses Africa/Johannesburg.';

-- RBAC (works for both uuid and integer role_id)
DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_production_trends_daily', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
