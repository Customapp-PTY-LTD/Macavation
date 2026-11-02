-- Flag batch cracking sheets that still need finishing.
--
-- Why: since 20261030150000 a closed silo run writes its kg, times and silo onto the batch's cracking
-- sheet by itself. What a run cannot know is the shell waste: the shell bags are still weighed and
-- typed on the sheet by hand. Henry (30 Oct 2026): when a batch has a run in the Cracking log but its
-- sheet for that day has no shell bags, flag it so someone can finish it. Shell bags only - minute
-- tests stay optional.
--
-- A batch-day "needs finishing" when, from 2026-10-26 (the Cracking log cut-over):
--   the batch cracked kg in a closed silo run that SAST day (same bucketing as get_silo_runs_between), AND
--   its cracking_data entry for that day has no shell bag weight (shell_total and every shell_qtyN empty/0).
--
-- 1. cracking_day_has_shell_bags(entry)       - the test above, for one sheet day.
-- 2. get_unfinished_cracking_sheets(kernel?)  - the batch-days to finish (today included), for the
--                                               Production board, the sheet itself and Data health.
-- 3. refresh_cracking_sheet_alerts(kernel?)   - one dashboard alert per batch (warning) listing its
--                                               days BEFORE today (today's shift may still weigh bags);
--                                               resolved automatically once the bags are entered.
--    alert_type 'delay' + entity_type 'cracking_sheet' (entity_id = kernel id): dashboard_alerts_alert_type_check
--    only allows the 20261008090100 list, and nothing else raises 'delay'.
--    Run when a sheet changes (trigger on kernel.cracking_data) and just after midnight SAST (pg_cron),
--    when yesterday's unfinished days become overdue.
-- 4. get_data_health gains two values per day: [9] batch-days with silo runs, [10] of those unfinished.

-- 1. Shell bags weighed on one sheet day? ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cracking_day_has_shell_bags(p_elem jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM jsonb_each_text(CASE WHEN jsonb_typeof(p_elem) = 'object' THEN p_elem ELSE '{}'::jsonb END) f
        WHERE (f.key = 'shell_total' OR f.key ~ '^shell_qty[0-9]+$')
          AND trim(f.value) ~ '^[0-9]+(\.[0-9]+)?$'
          AND trim(f.value)::numeric > 0
    );
$$;

-- 2. Batch-days to finish ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unfinished_cracking_sheets(p_kernel_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH run_days AS (
        SELECT a.kernel_id, (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date AS d, sum(rb.kg) AS kg
        FROM public.silo_runs r
        JOIN public.silo_run_bags rb ON rb.run_id = r.id
        JOIN public.silo_allocations a ON a.id = rb.allocation_id
        WHERE r.closed_at IS NOT NULL
          AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date >= DATE '2026-10-26'
          AND (p_kernel_id IS NULL OR a.kernel_id = p_kernel_id)
        GROUP BY 1, 2
    ),
    open_days AS (
        SELECT rd.kernel_id, rd.d, rd.kg, b.batch_id AS batch_number, k.grower_name
        FROM run_days rd
        JOIN public.kernel k ON k.id = rd.kernel_id AND k.is_active
        LEFT JOIN public.batches b ON b.id = k.batch_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e
            WHERE public.kernel_day_date(e) = rd.d
              AND public.cracking_day_has_shell_bags(e))
    )
    SELECT jsonb_build_object(
        'success', true,
        'today', (now() AT TIME ZONE 'Africa/Johannesburg')::date,
        'days', COALESCE(jsonb_agg(jsonb_build_object(
            'kernel_id', o.kernel_id, 'batch_number', o.batch_number, 'grower_name', o.grower_name,
            'date', o.d, 'kg', o.kg) ORDER BY o.d, o.batch_number), '[]'::jsonb)
    )
    FROM open_days o;
$$;

REVOKE ALL ON FUNCTION public.get_unfinished_cracking_sheets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unfinished_cracking_sheets(uuid) TO anon, authenticated, service_role;

-- 3. Dashboard alert per batch -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_cracking_sheet_alerts(p_kernel_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today    date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    v_days     jsonb;
    b          record;
    v_existing uuid;
    v_title    text;
    v_message  text;
BEGIN
    v_days := public.get_unfinished_cracking_sheets(p_kernel_id) -> 'days';

    -- Open alerts first, one per batch, from the overdue days (before today).
    FOR b IN
        SELECT (x ->> 'kernel_id')::uuid AS kernel_id,
               max(x ->> 'batch_number') AS batch_number,
               string_agg(to_char((x ->> 'date')::date, 'Dy DD Mon') || ' ('
                          || to_char((x ->> 'kg')::numeric, 'FM999,999,990.##') || ' kg)', ', '
                          ORDER BY (x ->> 'date')::date) AS day_list
        FROM jsonb_array_elements(COALESCE(v_days, '[]'::jsonb)) x
        WHERE (x ->> 'date')::date < v_today
        GROUP BY 1
    LOOP
        v_title := 'Cracking sheet to finish · Batch ' || COALESCE(b.batch_number, '');
        v_message := 'Silo runs were logged but no shell bags were entered on the cracking sheet for: '
                     || b.day_list || '. Open Production, then this batch''s Production stages, and add the shell bags.';

        SELECT id INTO v_existing
        FROM public.dashboard_alerts
        WHERE alert_type = 'delay' AND entity_type = 'cracking_sheet' AND entity_id = b.kernel_id
          AND status IN ('active', 'acknowledged')
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_existing IS NOT NULL THEN
            UPDATE public.dashboard_alerts
            SET alert_title = v_title, alert_message = v_message, batch_number = b.batch_number
            WHERE id = v_existing
              AND (alert_title IS DISTINCT FROM v_title OR alert_message IS DISTINCT FROM v_message);
        ELSE
            INSERT INTO public.dashboard_alerts
                (alert_number, alert_type, severity, entity_type, entity_id, batch_number, alert_title, alert_message, status)
            VALUES (
                'ALT-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
                'delay', 'warning', 'cracking_sheet', b.kernel_id, b.batch_number, v_title, v_message, 'active'
            );
        END IF;
    END LOOP;

    -- Resolve the ones whose batch has no overdue day left (in scope: one batch, or all).
    UPDATE public.dashboard_alerts a
    SET status = 'resolved', resolved_at = now(), resolved_note = 'Auto-resolved: shell bags entered on the cracking sheet'
    WHERE a.alert_type = 'delay' AND a.entity_type = 'cracking_sheet'
      AND a.status IN ('active', 'acknowledged')
      AND (p_kernel_id IS NULL OR a.entity_id = p_kernel_id)
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(v_days, '[]'::jsonb)) x
          WHERE (x ->> 'kernel_id')::uuid = a.entity_id AND (x ->> 'date')::date < v_today);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_cracking_sheet_alerts(uuid) FROM PUBLIC, anon, authenticated;

-- A sheet saved (by hand or by a silo run): refresh that batch's alert. Never raises.
CREATE OR REPLACE FUNCTION public.trg_kernel_cracking_sheet_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    BEGIN
        PERFORM public.refresh_cracking_sheet_alerts(NEW.id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'refresh_cracking_sheet_alerts failed for kernel %: %', NEW.id, SQLERRM;
    END;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_kernel_cracking_sheet_alert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER kernel_cracking_sheet_alert
    AFTER UPDATE OF cracking_data ON public.kernel
    FOR EACH ROW
    WHEN (OLD.cracking_data IS DISTINCT FROM NEW.cracking_data)
    EXECUTE FUNCTION public.trg_kernel_cracking_sheet_alert();

-- Just after midnight SAST (22:15 UTC) yesterday's unfinished days become overdue.
SELECT cron.schedule('cracking-sheet-alerts', '15 22 * * *', 'SELECT public.refresh_cracking_sheet_alerts();');

-- 4. Data health: per day, batch-days with silo runs [9] and how many still need finishing [10] ------
CREATE OR REPLACE FUNCTION public.get_data_health(p_from date, p_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH bounds AS (
        SELECT p_from AS f,
               least(p_to, (now() AT TIME ZONE 'Africa/Johannesburg')::date) AS t,
               (now() AT TIME ZONE 'Africa/Johannesburg')::date AS today
    ),
    days AS (
        SELECT gs::date AS d FROM bounds, generate_series(bounds.f, bounds.t, interval '1 day') gs
    ),
    prod AS (
        SELECT production_date AS d, sum(coalesce(cracked_kg, 0)) AS typed, sum(cracked_kg_system) AS sys
        FROM public.data_production_daily, bounds
        WHERE production_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    nis AS (
        SELECT received_date AS d, count(*) AS n FROM public.data_nis_intake, bounds
        WHERE received_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    deliv AS (
        SELECT k.received_date AS d, count(*) AS n FROM public.kernel k, bounds
        WHERE k.is_active AND k.received_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    ksales AS (
        SELECT sale_date AS d, count(*) AS n FROM public.data_kernel_sales_lines, bounds
        WHERE sale_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    disp AS (
        SELECT coalesce((o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date, o.delivery_date) AS d, count(*) AS n
        FROM public.kernel_dispatch_orders o, bounds
        WHERE coalesce(lower(o.status), '') NOT IN ('cancelled', 'canceled', 'draft')
          AND coalesce((o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date, o.delivery_date) BETWEEN bounds.f AND bounds.t
        GROUP BY 1
    ),
    osales AS (
        SELECT sale_date AS d, count(*) AS n FROM public.data_oil_sales_lines, bounds
        WHERE sale_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    oexp AS (
        SELECT export_date AS d, count(*) AS n FROM public.data_oil_export_register, bounds
        WHERE export_date BETWEEN bounds.f AND bounds.t GROUP BY 1
    ),
    run_days AS (
        SELECT (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date AS d, count(DISTINCT a.kernel_id) AS n
        FROM public.silo_runs r
        JOIN public.silo_run_bags rb ON rb.run_id = r.id
        JOIN public.silo_allocations a ON a.id = rb.allocation_id, bounds
        WHERE r.closed_at IS NOT NULL
          AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date >= DATE '2026-10-26'
          AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN bounds.f AND bounds.t
        GROUP BY 1
    ),
    unfinished AS (
        SELECT (x ->> 'date')::date AS d, count(*) AS n
        FROM jsonb_array_elements(public.get_unfinished_cracking_sheets(NULL) -> 'days') x, bounds
        WHERE (x ->> 'date')::date BETWEEN bounds.f AND bounds.t
        GROUP BY 1
    )
    SELECT jsonb_build_object(
        'from', (SELECT f FROM bounds),
        'to', (SELECT t FROM bounds),
        'today', (SELECT today FROM bounds),
        'days', coalesce((
            SELECT jsonb_agg(jsonb_build_array(
                days.d, coalesce(prod.typed, 0), prod.sys, coalesce(nis.n, 0), coalesce(deliv.n, 0),
                coalesce(ksales.n, 0), coalesce(disp.n, 0), coalesce(osales.n, 0), coalesce(oexp.n, 0),
                coalesce(run_days.n, 0), coalesce(unfinished.n, 0)
            ) ORDER BY days.d)
            FROM days
            LEFT JOIN prod ON prod.d = days.d
            LEFT JOIN nis ON nis.d = days.d
            LEFT JOIN deliv ON deliv.d = days.d
            LEFT JOIN ksales ON ksales.d = days.d
            LEFT JOIN disp ON disp.d = days.d
            LEFT JOIN osales ON osales.d = days.d
            LEFT JOIN oexp ON oexp.d = days.d
            LEFT JOIN run_days ON run_days.d = days.d
            LEFT JOIN unfinished ON unfinished.d = days.d
        ), '[]'::jsonb)
    );
$$;

-- Raise today's alerts straight away.
SELECT public.refresh_cracking_sheet_alerts();
