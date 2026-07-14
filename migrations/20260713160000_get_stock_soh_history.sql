-- Stock on hand history for dashboard line chart: daily cumulative kg per kernel style or oil stream.
-- Reconstructs history from dated packing/dispatch and oil lot/dispatch ledgers (Africa/Johannesburg).

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
            SELECT unnest(ARRAY['food_grade', 'cosmetic', 'protein']::text[]) AS series
        ),
        dates AS (
            SELECT gs::date AS d
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
                END AS series
            FROM public.oil_stock_lots l
            WHERE l.is_active = true
              AND lower(coalesce(l.stock_category, '')) = 'finished_good'
        ),
        events AS (
            SELECT
                COALESCE(l.delivery_date, (l.created_at AT TIME ZONE 'Africa/Johannesburg')::date) AS ev_date,
                ls.series,
                COALESCE(l.kilograms, 0)::numeric AS delta
            FROM public.oil_stock_lots l
            JOIN lot_stream ls ON ls.id = l.id
            WHERE COALESCE(l.kilograms, 0) > 0

            UNION ALL

            SELECT
                (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS ev_date,
                ls.series,
                -COALESCE(NULLIF(trim(le ->> 'quantity_kg'), '')::numeric, 0) AS delta
            FROM public.oil_dispatch_orders o
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
            JOIN lot_stream ls ON ls.id = NULLIF(trim(le ->> 'oil_batch_id'), '')::uuid
            WHERE COALESCE(NULLIF(trim(le ->> 'quantity_kg'), '')::numeric, 0) > 0
        ),
        daily_net AS (
            SELECT ev_date AS d, series, SUM(delta) AS net
            FROM events
            WHERE ev_date IS NOT NULL
            GROUP BY ev_date, series
        ),
        event_days AS (
            SELECT DISTINCT d FROM daily_net
        ),
        cumulative AS (
            SELECT
                dn.d,
                dn.series,
                GREATEST(0, SUM(dn.net) OVER (PARTITION BY dn.series ORDER BY dn.d ROWS UNBOUNDED PRECEDING)) AS qty_kg
            FROM daily_net dn
        ),
        grid AS (
            SELECT dates.d, oil_stream.series
            FROM dates
            CROSS JOIN oil_stream
        )
        SELECT
            g.d,
            g.series,
            GREATEST(0, COALESCE((
                SELECT c.qty_kg
                FROM cumulative c
                WHERE c.series = g.series
                  AND c.d <= g.d
                ORDER BY c.d DESC
                LIMIT 1
            ), 0))::numeric AS qty_kg
        FROM grid g
        WHERE EXISTS (SELECT 1 FROM event_days)
        ORDER BY g.d, g.series;
        RETURN;
    END IF;

    -- Kernel (default)
    RETURN QUERY
    WITH kernel_styles AS (
        SELECT unnest(ARRAY[
            'SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'
        ]::text[]) AS series
    ),
    dates AS (
        SELECT gs::date AS d
        FROM generate_series(v_start, v_today, interval '1 day') AS gs
    ),
    packing_rows AS (
        SELECT
            k.id AS kernel_id,
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
        SELECT pr.ev_date, 'SP' AS series, COALESCE(NULLIF(trim(pr.elem ->> 'sk_sp_qty'), '')::numeric, 0) AS delta
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
            le ->> 'style' AS series,
            -COALESCE(NULLIF(trim(le ->> 'quantity_kg'), '')::numeric, 0) AS delta
        FROM public.kernel_dispatch_orders o
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
        WHERE o.dispatched_at IS NOT NULL
          AND le ->> 'style' IS NOT NULL
          AND COALESCE(NULLIF(trim(le ->> 'quantity_kg'), '')::numeric, 0) > 0
    ),
    daily_net AS (
        SELECT ev_date AS d, series, SUM(delta) AS net
        FROM events
        WHERE ev_date IS NOT NULL
          AND series IN (SELECT ks.series FROM kernel_styles ks)
        GROUP BY ev_date, series
    ),
    event_days AS (
        SELECT DISTINCT d FROM daily_net
    ),
    cumulative AS (
        SELECT
            dn.d,
            dn.series,
            GREATEST(0, SUM(dn.net) OVER (PARTITION BY dn.series ORDER BY dn.d ROWS UNBOUNDED PRECEDING)) AS qty_kg
        FROM daily_net dn
    ),
    grid AS (
        SELECT dates.d, kernel_styles.series
        FROM dates
        CROSS JOIN kernel_styles
    )
    SELECT
        g.d,
        g.series,
        GREATEST(0, COALESCE((
            SELECT c.qty_kg
            FROM cumulative c
            WHERE c.series = g.series
              AND c.d <= g.d
            ORDER BY c.d DESC
            LIMIT 1
        ), 0))::numeric AS qty_kg
    FROM grid g
    WHERE EXISTS (SELECT 1 FROM event_days)
    ORDER BY g.d, g.series;
END;
$$;

COMMENT ON FUNCTION public.get_stock_soh_history(text, integer) IS
  'Daily stock-on-hand history per kernel style or oil stream (kg). Reconstructed from packing/dispatch and oil lot ledgers.';

DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_stock_soh_history', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
