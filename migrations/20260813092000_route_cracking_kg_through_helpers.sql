-- Route the duplicated cracking-kg / cracking-date expressions in
-- get_dashboard_kernel_stats(), get_production_trends_daily() and get_kernel_mass_balance()
-- through the shared helpers public.kernel_day_kg(jsonb) / public.kernel_day_date(jsonb)
-- introduced in migrations/20260813091000_kernel_cracking_kg_helpers.sql.
--
-- No numeric behaviour change. Each body below is copied verbatim from its live definition and
-- only the cracking-kg COALESCE(...) and the inline cracking-date CASE are substituted for the
-- helper calls. Packed/dispatched expressions, guard predicates, WHERE clauses, the rolling
-- 7-day window and all other logic are untouched. All three functions keep their existing
-- signatures, so no DROP FUNCTION is needed or added.

-- ============================================================
-- get_dashboard_kernel_stats()
-- Source: migrations/20260343000001_dashboard_kernel_batches_status_production_only.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_kernel_stats()
RETURNS TABLE (
    batches_in_production bigint,
    kg_cracked_today numeric,
    kg_cracked_week numeric,
    kg_packed_today numeric,
    kg_packed_week numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batches bigint;
    v_kg_today numeric;
    v_kg_week numeric;
    v_packed_today numeric;
    v_packed_week numeric;
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_week_start date := v_today - interval '7 days';
BEGIN
    SELECT count(*)::bigint INTO v_batches
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status = 'production';

    -- Sum kg cracked today (SA date): from cracking_data where parsed date = v_today.
    SELECT COALESCE(SUM(public.kernel_day_kg(elem)), 0) INTO v_kg_today
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND (elem->>'date') IS NOT NULL
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND public.kernel_day_date(elem) = v_today;

    -- Sum kg cracked in the last 7 days (SA), including today.
    SELECT COALESCE(SUM(public.kernel_day_kg(elem)), 0) INTO v_kg_week
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND (elem->>'date') IS NOT NULL
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND public.kernel_day_date(elem) >= v_week_start;

    -- Sum kg packed today (SA date).
    SELECT COALESCE(SUM(
        COALESCE(
            NULLIF(TRIM(elem->>'totals_qty'), '')::numeric,
            NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric + NULLIF(TRIM(elem->>'bt_total_qty'), '')::numeric,
            (SELECT COALESCE(SUM(NULLIF(TRIM(v->>'qty'), '')::numeric), 0)
             FROM jsonb_each(COALESCE(elem->'sound_kernel', '{}'::jsonb) || COALESCE(elem->'butter_grade', '{}'::jsonb)) AS t(k, v)
             WHERE v->>'qty' IS NOT NULL AND TRIM(COALESCE(v->>'qty', '')) <> ''),
            0
        )
    ), 0) INTO v_packed_today
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND (elem->>'date') IS NOT NULL
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (
          (CASE
               WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
               WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
               ELSE NULL
           END) = v_today
      );

    -- Sum kg packed in the last 7 days (SA), including today.
    SELECT COALESCE(SUM(
        COALESCE(
            NULLIF(TRIM(elem->>'totals_qty'), '')::numeric,
            NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric + NULLIF(TRIM(elem->>'bt_total_qty'), '')::numeric,
            (SELECT COALESCE(SUM(NULLIF(TRIM(v->>'qty'), '')::numeric), 0)
             FROM jsonb_each(COALESCE(elem->'sound_kernel', '{}'::jsonb) || COALESCE(elem->'butter_grade', '{}'::jsonb)) AS t(k, v)
             WHERE v->>'qty' IS NOT NULL AND TRIM(COALESCE(v->>'qty', '')) <> ''),
            0
        )
    ), 0) INTO v_packed_week
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND (elem->>'date') IS NOT NULL
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (
          (CASE
               WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
               WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
               ELSE NULL
           END) >= v_week_start
      );

    RETURN QUERY SELECT v_batches, v_kg_today, v_kg_week, v_packed_today, v_packed_week;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_kernel_stats() IS 'Dashboard kernel stats. batches_in_production = active kernels with status production only. Uses Africa/Johannesburg for today/week. Cracking kg/date expressions now route through public.kernel_day_kg()/public.kernel_day_date() — no behaviour change.';

DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_dashboard_kernel_stats', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_kernel_stats() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- get_production_trends_daily(integer)
-- Source: migrations/20260326000001_get_production_trends_daily.sql
-- ============================================================
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
    ORDER BY dates.d;
END;
$$;

COMMENT ON FUNCTION public.get_production_trends_daily(integer) IS 'Daily production trends for chart: kg cracked, kg packed, kg dispatched. Uses Africa/Johannesburg. Cracking kg/date expressions now route through public.kernel_day_kg()/public.kernel_day_date() — no behaviour change.';

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

GRANT EXECUTE ON FUNCTION public.get_production_trends_daily(integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- get_kernel_mass_balance(date, date)
-- Source: migrations/20260706100000_phase2_implementation_complete.sql:310-362
-- Only v_cracked's summed expression changes. Its WHERE clause, and every other variable/clause
-- in this function, are byte-identical to the live definition, including the known
-- received_date-vs-cracking-date filter mismatch, which is deliberately deferred (see plan).
-- No DROP FUNCTION — the live file has one at line 308; it is not copied here since this
-- migration does not change the signature.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_kernel_mass_balance(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
    nis_in_kg numeric,
    cracked_kg numeric,
    packed_kg numeric,
    balance_kg numeric,
    balance_pct numeric,
    procurement_scheduled_kg numeric,
    procurement_received_kg numeric,
    procurement_variance_kg numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from date := COALESCE(p_from, current_date - interval '30 days');
    v_to date := COALESCE(p_to, current_date);
    v_cracked numeric;
    v_packed numeric;
    v_nis numeric;
    v_proc_sched numeric;
    v_proc_recv numeric;
BEGIN
    SELECT coalesce(SUM(coalesce(k.wet_nis_received_kg, 0)), 0) INTO v_nis
    FROM public.kernel k
    WHERE k.is_active = true AND k.received_date BETWEEN v_from AND v_to;

    SELECT coalesce(SUM(public.kernel_day_kg(elem)), 0) INTO v_cracked
    FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true AND k.received_date BETWEEN v_from AND v_to;

    SELECT coalesce(SUM(
        COALESCE(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, 0)
    ), 0) INTO v_packed
    FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true AND k.received_date BETWEEN v_from AND v_to;

    SELECT coalesce(SUM(predicted_weight_kg), 0) INTO v_proc_sched
    FROM public.kernel_intake_procurement
    WHERE status IN ('scheduled', 'converted') AND scheduled_date BETWEEN v_from AND v_to;

    SELECT coalesce(SUM(coalesce(k.wet_nis_received_kg, 0)), 0) INTO v_proc_recv
    FROM public.kernel k
    JOIN public.kernel_intake_procurement p ON p.batch_id = k.batch_id AND p.status = 'converted'
    WHERE k.is_active = true AND p.scheduled_date BETWEEN v_from AND v_to;

    RETURN QUERY SELECT
        v_nis, v_cracked, v_packed, (v_cracked - v_packed),
        CASE WHEN v_cracked > 0 THEN round((v_packed / v_cracked) * 100, 2) ELSE 0 END,
        v_proc_sched, v_proc_recv, (v_proc_recv - v_proc_sched);
END;
$$;

COMMENT ON FUNCTION public.get_kernel_mass_balance(date, date) IS 'Kernel mass balance (NIS in, cracked, packed) plus procurement variance over a date range, defaulting to the trailing 30 days. Cracked-kg expression now routes through public.kernel_day_kg() — no behaviour change. NOTE: cracked/packed are still filtered by k.received_date rather than the cracking/packing entry date, a known deferred issue — left unchanged here.';

DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_kernel_mass_balance', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_mass_balance(date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
