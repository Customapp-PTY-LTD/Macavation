-- ============================================================================
-- Silo Allocation: supplier names on the silo cards and in the cracking log.
--
-- WHY. Mike (27 Oct 2026) asked to see which supplier is in which silo. get_silo_overview's
-- contents and get_silo_runs carried batch numbers only. Both functions are otherwise unchanged
-- from their live definitions (20261007090000 / 20261008090000); this adds:
--   get_silo_overview  contents[].grower_name
--   get_silo_runs      grower_names  (comma list of the suppliers whose bags the run cracked)
--
-- The page falls back to the batch list's grower_name until this is applied, so the order of
-- deploy and apply does not matter. CREATE OR REPLACE keeps the existing grants.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_silo_overview()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'silos', COALESCE(jsonb_agg(x ORDER BY (x ->> 'silo_number')::int), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'silo_number', s.silo_number,
            'capacity_kg', s.capacity_kg,
            'is_active',   s.is_active,
            'filled_kg',   COALESCE((SELECT sum(a.remaining_kg) FROM public.silo_allocations a
                                     WHERE a.silo_number = s.silo_number AND a.status = 'in_silo'), 0),
            'contents',    COALESCE((
                SELECT jsonb_agg(jsonb_build_object('kernel_id', g.kernel_id, 'batch_number', g.batch_number,
                                                    'grower_name', g.grower_name,
                                                    'kg', g.kg, 'bags', g.bags) ORDER BY g.first_at)
                FROM (
                    SELECT a.kernel_id, b.batch_id AS batch_number, k.grower_name, sum(a.remaining_kg) AS kg,
                           jsonb_agg(a.bag_no ORDER BY a.bag_no) AS bags, min(a.allocated_at) AS first_at
                    FROM public.silo_allocations a
                    JOIN public.kernel k ON k.id = a.kernel_id
                    JOIN public.batches b ON b.id = k.batch_id
                    WHERE a.silo_number = s.silo_number AND a.status = 'in_silo'
                    GROUP BY a.kernel_id, b.batch_id, k.grower_name
                ) g), '[]'::jsonb),
            'open_run',    (SELECT jsonb_build_object('id', r.id, 'opened_at', r.opened_at)
                            FROM public.silo_runs r WHERE r.silo_number = s.silo_number AND r.closed_at IS NULL)
        ) AS x
        FROM public.silos s
        WHERE s.is_active
    ) t;
$$;

CREATE OR REPLACE FUNCTION public.get_silo_runs(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
    FROM (SELECT * FROM public.silo_runs WHERE closed_at IS NOT NULL
          ORDER BY closed_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))) r;
$$;
