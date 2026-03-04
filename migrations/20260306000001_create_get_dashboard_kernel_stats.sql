-- Dashboard: kernel stats for default dashboard (batches in production, kg cracked/packed today and this week).
-- Multiple batches per day are summed. Called by WebPortal dashboard.js via dataFunctions.getDashboardKernelStats().

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
BEGIN
    -- Count kernel batches "in production": intake, receiving, production, qa (excludes only complete, in_finished_stock).
    -- UI "Awaiting test" and "Release ready" both use status qa, so they are included here.
    SELECT count(*)::bigint INTO v_batches
    FROM public.kernel k
    WHERE k.is_active = true
      AND (k.status IS NULL OR k.status NOT IN ('complete', 'in_finished_stock'));

    -- Sum kg cracked today: from all kernel rows, sum totalqty/total_qty from cracking_data array where date = current_date.
    -- Accept both YYYY-MM-DD and DD/MM/YYYY so stored dates match server date.
    SELECT COALESCE(SUM(
        COALESCE(
            NULLIF(TRIM(elem->>'totalqty'), '')::numeric,
            NULLIF(TRIM(elem->>'total_qty'), '')::numeric,
            0
        )
    ), 0) INTO v_kg_today
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND (elem->>'date') IS NOT NULL
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (
          (CASE
               WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
               WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
               ELSE NULL
           END) = current_date
      );

    -- Sum kg cracked in the last 7 days (including today).
    SELECT COALESCE(SUM(
        COALESCE(
            NULLIF(TRIM(elem->>'totalqty'), '')::numeric,
            NULLIF(TRIM(elem->>'total_qty'), '')::numeric,
            0
        )
    ), 0) INTO v_kg_week
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND (elem->>'date') IS NOT NULL
      AND TRIM(COALESCE(elem->>'date', '')) <> ''
      AND (
          (CASE
               WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
               WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
               ELSE NULL
           END) >= current_date - interval '7 days'
      );

    -- Sum kg packed today: from all kernel rows, sum packed total per day from packing_data array where date = current_date.
    -- Multiple batches per day add up. Use totals_qty, or sk_total_qty + bt_total_qty, or sum of style qtys. Accept YYYY-MM-DD or DD/MM/YYYY.
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
           END) = current_date
      );

    -- Sum kg packed in the last 7 days (including today).
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
           END) >= current_date - interval '7 days'
      );

    RETURN QUERY SELECT v_batches, v_kg_today, v_kg_week, v_packed_today, v_packed_week;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_kernel_stats() IS 'Returns dashboard stats: kernel batches in production, kg cracked today/week, kg packed today/week. Multiple batches per day are summed.';

-- Grant EXECUTE to all roles (same pattern as get_kernel_batches).
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_dashboard_kernel_stats', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
