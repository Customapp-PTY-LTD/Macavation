-- ============================================================================
-- get_silo_activity — what happened in the silos, by day (Silo Allocation calendar)
-- ============================================================================
-- Read-only. For a date window (South African calendar days) returns:
--   allocations: bags put into silos, one row per day + batch + silo (undone bags excluded)
--   runs:        cracking runs, dated by the day the silo was closed (or opened, if still cracking)
-- Same security model as the other silo read functions (get_silo_overview, get_silo_runs):
-- SECURITY DEFINER over tables that anon/authenticated cannot read directly.
-- Window is capped at 62 days and each list at 2000 rows.

CREATE OR REPLACE FUNCTION public.get_silo_activity(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from date := p_date_from;
    v_to   date := p_date_to;
BEGIN
    IF v_from IS NULL OR v_to IS NULL OR v_to < v_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF v_to - v_from > 62 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 62 days.');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'allocations', COALESCE((
            SELECT jsonb_agg(to_jsonb(x) ORDER BY x.day, x.batch_number, x.silo_number)
            FROM (
                SELECT (a.allocated_at AT TIME ZONE 'Africa/Johannesburg')::date AS day,
                       b.batch_id::text                        AS batch_number,
                       k.grower_name,
                       a.silo_number,
                       array_agg(a.bag_no ORDER BY a.bag_no)   AS bag_nos,
                       sum(a.weight_kg)                        AS bag_kg,
                       sum(a.presizer_kg)                      AS removed_kg
                FROM public.silo_allocations a
                JOIN public.kernel k  ON k.id = a.kernel_id
                LEFT JOIN public.batches b ON b.id = k.batch_id
                WHERE a.status <> 'removed'
                  AND (a.allocated_at AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_from AND v_to
                GROUP BY 1, 2, 3, 4
                ORDER BY 1, 2, 4
                LIMIT 2000
            ) x), '[]'::jsonb),
        'runs', COALESCE((
            SELECT jsonb_agg(to_jsonb(y) ORDER BY y.day, y.opened_at)
            FROM (
                SELECT (COALESCE(r.closed_at, r.opened_at) AT TIME ZONE 'Africa/Johannesburg')::date AS day,
                       r.silo_number, r.opened_at, r.closed_at, r.volume_kg, r.left_kg, r.batch_numbers
                FROM public.silo_runs r
                WHERE (COALESCE(r.closed_at, r.opened_at) AT TIME ZONE 'Africa/Johannesburg')::date BETWEEN v_from AND v_to
                ORDER BY COALESCE(r.closed_at, r.opened_at)
                LIMIT 2000
            ) y), '[]'::jsonb)
    );
END;
$$;

COMMENT ON FUNCTION public.get_silo_activity(date, date) IS
    'Silo Allocation calendar: bags allocated (per day/batch/silo) and cracking runs in a date window (max 62 days).';
