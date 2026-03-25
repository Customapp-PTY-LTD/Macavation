-- Dashboard "Kernel batches in production": count only batches in the production phase.
-- Previously (20260323000001): counted every active kernel row, which inflated the card vs the label.

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
           END) = v_today
      );

    -- Sum kg cracked in the last 7 days (SA), including today.
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
           END) >= v_week_start
      );

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

COMMENT ON FUNCTION public.get_dashboard_kernel_stats() IS 'Dashboard kernel stats. batches_in_production = active kernels with status production only. Uses Africa/Johannesburg for today/week.';
