-- ============================================================================
-- Production log on the Kernel dashboard (Mike, 3 Nov 2026)
-- ============================================================================
-- The Kernel dashboard's Production section gets a log that switches between "Nut & shell
-- cracked" and "Sound kernel packed", by day, week, month, quarter (FY) or year (FY, Apr-Mar).
--
-- get_cracking_log_daily: one row per South African calendar day from silo_runs, with the same
--   "a run belongs to the day its silo closed" rule as get_silo_runs_between (20261029090000).
--   Day and Week still list single runs through get_silo_runs_between; Month/Quarter/Year use this,
--   so a full year is ~365 small rows instead of 1000+ runs.
-- get_packing_log: one row per batch per packing day from kernel.packing_data, using
--   kernel_day_date and kernel_packing_yield_by_style unchanged (as production_day_sk_packed_kg_live
--   in 20260819090000 does). Sound kernel = SP, 0, 1, 1S, 4L, 5, 6; butter = 7/8, Butter High Oil,
--   Butter Low Oil. Cartons are kg / 11.34 (KG_PER_CARTON in modal_production_stages.js), because
--   the stored *_total_cartons fields are blank on older batches. packing_data only updates when
--   the job card is approved (20260519120000), so unapproved packing does not show yet.
--
-- Both read-only, SECURITY DEFINER like the other silo / dashboard read functions, window capped
-- at 400 days.
-- Down: DROP FUNCTION public.get_cracking_log_daily(date, date);
--       DROP FUNCTION public.get_packing_log(date, date);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cracking_log_daily(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF p_date_to - p_date_from > 400 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 400 days.');
    END IF;

    RETURN (
        SELECT jsonb_build_object('success', true, 'days', COALESCE(jsonb_agg(jsonb_build_object(
            'day', d.day, 'kg', d.kg, 'minutes', d.minutes, 'runs', d.runs, 'emptied', d.emptied
        ) ORDER BY d.day), '[]'::jsonb))
        FROM (
            SELECT (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date AS day,
                   COALESCE(SUM(r.volume_kg), 0) AS kg,
                   COALESCE(SUM(round(extract(epoch FROM (r.closed_at - r.opened_at)) / 60.0, 1)), 0) AS minutes,
                   COUNT(*) AS runs,
                   COUNT(*) FILTER (WHERE COALESCE(r.left_kg, 0) = 0) AS emptied
            FROM public.silo_runs r
            WHERE r.closed_at IS NOT NULL
              AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN p_date_from AND p_date_to
            GROUP BY 1
        ) d
    );
END;
$$;

COMMENT ON FUNCTION public.get_cracking_log_daily(date, date) IS
    'Kernel dashboard production log: cracked kg, minutes, runs and emptied silos per SA day from closed silo runs (max 400 days).';

CREATE OR REPLACE FUNCTION public.get_packing_log(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF p_date_to - p_date_from > 400 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 400 days.');
    END IF;

    RETURN (
        SELECT jsonb_build_object('success', true, 'rows', COALESCE(jsonb_agg(jsonb_build_object(
            'day', p.day, 'kernel_id', p.kernel_id, 'batch_number', p.batch_number, 'supplier', p.supplier,
            'by_style', p.ys, 'sk_kg', p.sk_kg, 'bt_kg', p.bt_kg,
            'sk_cartons', round(p.sk_kg / 11.34, 2), 'bt_cartons', round(p.bt_kg / 11.34, 2)
        ) ORDER BY p.day DESC, p.batch_number), '[]'::jsonb))
        FROM (
            SELECT x.day, x.kernel_id, x.batch_number, x.supplier, x.ys,
                   COALESCE((x.ys ->> 'SP')::numeric, 0) + COALESCE((x.ys ->> '0')::numeric, 0)
                 + COALESCE((x.ys ->> '1')::numeric, 0) + COALESCE((x.ys ->> '1S')::numeric, 0)
                 + COALESCE((x.ys ->> '4L')::numeric, 0) + COALESCE((x.ys ->> '5')::numeric, 0)
                 + COALESCE((x.ys ->> '6')::numeric, 0) AS sk_kg,
                   COALESCE((x.ys ->> '7/8')::numeric, 0) + COALESCE((x.ys ->> 'Butter High Oil')::numeric, 0)
                 + COALESCE((x.ys ->> 'Butter Low Oil')::numeric, 0) AS bt_kg
            FROM (
                SELECT public.kernel_day_date(e) AS day, k.id AS kernel_id, b.batch_id AS batch_number,
                       k.grower_name AS supplier,
                       public.kernel_packing_yield_by_style(jsonb_build_array(e)) AS ys
                FROM public.kernel k
                JOIN public.batches b ON b.id = k.batch_id
                CROSS JOIN LATERAL jsonb_array_elements(
                    COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) e
                WHERE k.is_active
                  AND public.kernel_day_date(e) BETWEEN p_date_from AND p_date_to
            ) x
        ) p
        WHERE p.sk_kg <> 0 OR p.bt_kg <> 0
    );
END;
$$;

COMMENT ON FUNCTION public.get_packing_log(date, date) IS
    'Kernel dashboard production log: packed kg per style per batch per packing day from kernel.packing_data (max 400 days).';

GRANT EXECUTE ON FUNCTION public.get_cracking_log_daily(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_packing_log(date, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
