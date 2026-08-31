-- Production Trends showed February-May 2024 and "No daily cracked (kg) recorded", whichever
-- range button was pressed.
--
-- get_production_trends_daily back-fills one row per calendar day, so the dashboard's
-- getProductionTrendsDaily(1825) produced 1825 rows starting 2021-08-16. PostgREST caps a
-- response at 1000 rows and keeps the FIRST ones, so the browser received
-- 2021-08-16 .. 2024-05-11 (Content-Range: 0-999/*) — entirely before any production exists.
-- Real data (kg_cracked from 2026-04-22) sat in the discarded rows 1001-1825. The client then
-- windowed inside that dead range: 3M took the last 93 rows = 2024-02-09 .. 2024-05-11, and
-- Hide-weekends dropped Saturday 2024-05-11, giving the observed "Showing 09/02 - 10/05".
--
-- Two changes:
--   1. Order the daily function DESC so a truncated response keeps the NEWEST days, never the
--      oldest. The client re-sorts ascending, so nothing downstream changes.
--   2. Add a month-aggregated function for the long ranges (3Y/5Y/All and the Yearly view).
--      60 months is 60 rows, so those ranges can cover their true span without ever
--      approaching the row cap.
--
-- The daily body below is copied verbatim from its live definition in
-- 20260813092000_route_cracking_kg_through_helpers.sql — cracking kg/date still route through
-- public.kernel_day_kg()/public.kernel_day_date(), preserving the endqty1 preference settled in
-- 20260813093000_kernel_day_kg_prefer_endqty1.sql. ORDER BY direction is the ONLY change here;
-- do not re-inline the old COALESCE(totalqty, total_qty, 0), which under-reports cracked kg.
--
-- The monthly function delegates to the daily one rather than duplicating the JSON parsing, so
-- the endqty1 decision applies to both. Internal calls are not subject to the PostgREST row cap.

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
            public.kernel_day_date(elem) AS d,
            SUM(public.kernel_day_kg(elem)) AS kg
        FROM public.kernel k,
             jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
        WHERE k.is_active = true
          AND elem ? 'date'
          AND (elem->>'date') IS NOT NULL
          AND TRIM(COALESCE(elem->>'date', '')) <> ''
        GROUP BY public.kernel_day_date(elem)
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
    -- DESC: if PostgREST truncates at its row cap, keep the most recent days.
    ORDER BY dates.d DESC;
END;
$$;

COMMENT ON FUNCTION public.get_production_trends_daily(integer) IS
'Daily production trends for chart: kg cracked, kg packed, kg dispatched. Uses Africa/Johannesburg. Cracking kg/date route through public.kernel_day_kg()/public.kernel_day_date(). Returns newest-first so a PostgREST row-cap truncation drops the oldest days, not the newest.';

CREATE OR REPLACE FUNCTION public.get_production_trends_monthly(p_months integer DEFAULT 60)
RETURNS TABLE (
    trend_month date,
    kg_cracked numeric,
    kg_packed numeric,
    kg_dispatched numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_months integer := GREATEST(1, LEAST(240, COALESCE(p_months, 60)));
    v_today  date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_start  date;
    v_days   integer;
BEGIN
    v_start := (date_trunc('month', v_today)::date - make_interval(months => v_months - 1))::date;
    v_days  := (v_today - v_start) + 1;

    RETURN QUERY
    SELECT
        date_trunc('month', t.trend_date)::date AS trend_month,
        SUM(t.kg_cracked)::numeric              AS kg_cracked,
        SUM(t.kg_packed)::numeric               AS kg_packed,
        SUM(t.kg_dispatched)::numeric           AS kg_dispatched
    FROM public.get_production_trends_daily(v_days) t
    WHERE t.trend_date >= v_start
    GROUP BY date_trunc('month', t.trend_date)::date
    ORDER BY date_trunc('month', t.trend_date)::date DESC;
END;
$$;

COMMENT ON FUNCTION public.get_production_trends_monthly(integer) IS
'Month-aggregated production trends (kg cracked/packed/dispatched) for the long dashboard ranges. Delegates to get_production_trends_daily so the kernel_day_kg endqty1 preference applies. Returns newest-first; p_months is clamped to 1-240 so the result stays far below the PostgREST row cap.';

GRANT EXECUTE ON FUNCTION public.get_production_trends_monthly(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_production_trends_monthly(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_trends_monthly(integer) TO service_role;

DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_production_trends_monthly', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
