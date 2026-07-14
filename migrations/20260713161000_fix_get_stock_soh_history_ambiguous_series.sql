-- Fix ambiguous "series" column vs PL/pgSQL OUT parameter in get_stock_soh_history.

CREATE OR REPLACE FUNCTION public.get_stock_soh_history(
    p_product_type text DEFAULT 'kernel',
    p_days integer DEFAULT 365
)
RETURNS TABLE (
    d date,
    series text,
    qty_kg numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_days integer := GREATEST(7, LEAST(COALESCE(p_days, 365), 1826));
    v_start date;
    v_pt text := lower(trim(coalesce(p_product_type, 'kernel')));
BEGIN
    v_start := v_today - (v_days - 1);

    IF v_pt = 'oil' THEN
        RETURN QUERY
        WITH oil_stream AS (
            SELECT unnest(ARRAY['food_grade', 'cosmetic', 'protein']::text[]) AS stream_key
        ),
        dates AS (
            SELECT gs::date AS snap_date
            FROM generate_series(v_start, v_today, interval '1 day') AS gs
        ),
        lot_stream AS (
            SELECT
                l.id,
                CASE
                    WHEN position('protein' in lower(coalesce(l.product_description, ''))) > 0
                      OR position('protein' in lower(coalesce(l.grade, ''))) > 0 THEN 'protein'
                    WHEN position('cosmetic' in lower(coalesce(l.grade, ''))) > 0 THEN 'cosmetic'
                    ELSE 'food_grade'
                END AS stream_key
            FROM public.oil_stock_lots l
            WHERE l.is_active = true
              AND lower(coalesce(l.stock_category, '')) = 'finished_good'
        ),
        events AS (
            SELECT
                COALESCE(l.delivery_date, (l.created_at AT TIME ZONE 'Africa/Johannesburg')::date) AS ev_date,
                ls.stream_key,
                COALESCE(l.kilograms, 0)::numeric AS delta
            FROM public.oil_stock_lots l
            JOIN lot_stream ls ON ls.id = l.id
            WHERE COALESCE(l.kilograms, 0) > 0

            UNION ALL

            SELECT
                (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS ev_date,
                ls.stream_key,
                -COALESCE(NULLIF(trim(le ->> 'quantity_kg'), '')::numeric, 0) AS delta
            FROM public.oil_dispatch_orders o
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
            JOIN lot_stream ls ON ls.id = NULLIF(trim(le ->> 'oil_batch_id'), '')::uuid
            WHERE COALESCE(NULLIF(trim(le ->> 'quantity_kg'), '')::numeric, 0) > 0
        ),
        daily_net AS (
            SELECT ev_date AS snap_date, stream_key, SUM(delta) AS net
            FROM events
            WHERE ev_date IS NOT NULL
            GROUP BY ev_date, stream_key
        ),
        event_days AS (
            SELECT DISTINCT snap_date FROM daily_net
        ),
        cumulative AS (
            SELECT
                dn.snap_date,
                dn.stream_key,
                GREATEST(0, SUM(dn.net) OVER (PARTITION BY dn.stream_key ORDER BY dn.snap_date ROWS UNBOUNDED PRECEDING)) AS running_kg
            FROM daily_net dn
        ),
        grid AS (
            SELECT dates.snap_date, oil_stream.stream_key
            FROM dates
            CROSS JOIN oil_stream
        )
        SELECT
            g.snap_date,
            g.stream_key,
            GREATEST(0, COALESCE((
                SELECT c.running_kg
                FROM cumulative c
                WHERE c.stream_key = g.stream_key
                  AND c.snap_date <= g.snap_date
                ORDER BY c.snap_date DESC
                LIMIT 1
            ), 0))::numeric
        FROM grid g
        WHERE EXISTS (SELECT 1 FROM event_days)
        ORDER BY g.snap_date, g.stream_key;
        RETURN;
    END IF;

    RETURN QUERY
    WITH kernel_styles AS (
        SELECT unnest(ARRAY[
            'SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'
        ]::text[]) AS style_key
    ),
    dates AS (
        SELECT gs::date AS snap_date
        FROM generate_series(v_start, v_today, interval '1 day') AS gs
    ),
    packing_rows AS (
        SELECT
            elem,
            CASE
                WHEN (elem ->> 'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem ->> 'date')::date
                WHEN (elem ->> 'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem ->> 'date', 'DD/MM/YYYY')
                ELSE NULL
            END AS ev_date
        FROM public.kernel k
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) elem
        WHERE k.is_active = true
          AND elem ? 'date'
          AND trim(coalesce(elem ->> 'date', '')) <> ''
    ),
    events AS (
        SELECT pr.ev_date, 'SP' AS style_key, COALESCE(NULLIF(trim(pr.elem ->> 'sk_sp_qty'), '')::numeric, 0) AS delta
        FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, '0', COALESCE(NULLIF(trim(pr.elem ->> 'sk_0_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, '1', COALESCE(NULLIF(trim(pr.elem ->> 'sk_1_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, '1S', COALESCE(NULLIF(trim(pr.elem ->> 'sk_1s_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, '4L', COALESCE(NULLIF(trim(pr.elem ->> 'sk_4l_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, '5', COALESCE(NULLIF(trim(pr.elem ->> 'sk_5_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, '6', COALESCE(NULLIF(trim(pr.elem ->> 'sk_6_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, '7/8', COALESCE(NULLIF(trim(pr.elem ->> 'bt_78_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, 'Butter High Oil', COALESCE(NULLIF(trim(pr.elem ->> 'bt_high_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL
        UNION ALL
        SELECT pr.ev_date, 'Butter Low Oil', COALESCE(NULLIF(trim(pr.elem ->> 'bt_low_qty'), '')::numeric, 0) FROM packing_rows pr WHERE pr.ev_date IS NOT NULL

        UNION ALL

        SELECT
            (o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date AS ev_date,
            le ->> 'style' AS style_key,
            -COALESCE(NULLIF(trim(le ->> 'quantity_kg'), '')::numeric, 0) AS delta
        FROM public.kernel_dispatch_orders o
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
        WHERE o.dispatched_at IS NOT NULL
          AND le ->> 'style' IS NOT NULL
          AND COALESCE(NULLIF(trim(le ->> 'quantity_kg'), '')::numeric, 0) > 0
    ),
    daily_net AS (
        SELECT ev_date AS snap_date, style_key, SUM(delta) AS net
        FROM events
        WHERE ev_date IS NOT NULL
          AND style_key IN (SELECT ks.style_key FROM kernel_styles ks)
        GROUP BY ev_date, style_key
    ),
    event_days AS (
        SELECT DISTINCT snap_date FROM daily_net
    ),
    cumulative AS (
        SELECT
            dn.snap_date,
            dn.style_key,
            GREATEST(0, SUM(dn.net) OVER (PARTITION BY dn.style_key ORDER BY dn.snap_date ROWS UNBOUNDED PRECEDING)) AS running_kg
        FROM daily_net dn
    ),
    grid AS (
        SELECT dates.snap_date, kernel_styles.style_key
        FROM dates
        CROSS JOIN kernel_styles
    )
    SELECT
        g.snap_date,
        g.style_key,
        GREATEST(0, COALESCE((
            SELECT c.running_kg
            FROM cumulative c
            WHERE c.style_key = g.style_key
              AND c.snap_date <= g.snap_date
            ORDER BY c.snap_date DESC
            LIMIT 1
        ), 0))::numeric
    FROM grid g
    WHERE EXISTS (SELECT 1 FROM event_days)
    ORDER BY g.snap_date, g.style_key;
END;
$$;

NOTIFY pgrst, 'reload schema';
