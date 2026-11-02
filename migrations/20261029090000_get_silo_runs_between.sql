-- ============================================================================
-- get_silo_runs_between — the cracking log for a chosen day or week (Mike, 29 Oct 2026)
-- ============================================================================
-- Same row shape as get_silo_runs (20261027090000), but for a window of South African calendar
-- days instead of "the last N runs", so the Cracking log can total any day or week.
-- A run belongs to the day its silo was closed. Open runs are left out (they have no volume yet).
-- Read-only, SECURITY DEFINER like the other silo read functions. Window capped at 62 days and
-- 1000 rows.
--
-- The page falls back to get_silo_runs(500) filtered in the browser until this is applied.
-- Down: DROP FUNCTION public.get_silo_runs_between(date, date);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_silo_runs_between(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF p_date_to - p_date_from > 62 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 62 days.');
    END IF;

    RETURN (
        SELECT jsonb_build_object('success', true, 'runs', COALESCE(jsonb_agg(jsonb_build_object(
            'id', r.id, 'silo_number', r.silo_number, 'opened_at', r.opened_at, 'closed_at', r.closed_at,
            'volume_kg', r.volume_kg, 'left_kg', r.left_kg, 'batch_numbers', r.batch_numbers,
            'grower_names', (SELECT string_agg(DISTINCT k.grower_name, ', ')
                             FROM public.silo_run_bags rb
                             JOIN public.silo_allocations a ON a.id = rb.allocation_id
                             JOIN public.kernel k ON k.id = a.kernel_id
                             WHERE rb.run_id = r.id AND k.grower_name IS NOT NULL AND k.grower_name <> ''),
            'times_edited', r.times_edited,
            'minutes', round(extract(epoch FROM (r.closed_at - r.opened_at)) / 60.0, 1),
            'kg_per_hour', CASE WHEN r.closed_at > r.opened_at
                                THEN round(r.volume_kg / (extract(epoch FROM (r.closed_at - r.opened_at)) / 3600.0), 2) END
        ) ORDER BY r.closed_at DESC), '[]'::jsonb))
        FROM (SELECT * FROM public.silo_runs
              WHERE closed_at IS NOT NULL
                AND (closed_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN p_date_from AND p_date_to
              ORDER BY closed_at DESC
              LIMIT 1000) r
    );
END;
$$;

COMMENT ON FUNCTION public.get_silo_runs_between(date, date) IS
    'Cracking log: closed silo runs whose close date (SA time) falls in the window (max 62 days).';

GRANT EXECUTE ON FUNCTION public.get_silo_runs_between(date, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
