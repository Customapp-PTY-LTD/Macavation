-- Executive KPIs: total_production_kg = sum of packed kg from kernel.packing_data (all time).
-- Total Sales and Quality Pass Rate left at 0 unless wired elsewhere.

CREATE OR REPLACE FUNCTION public.get_executive_kpis()
RETURNS TABLE (
    total_production_kg numeric,
    active_batches bigint,
    total_sales numeric,
    quality_pass_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_active_batches bigint;
    v_total_production numeric := 0;
    v_total_sales numeric := 0;
    v_quality_pass_rate numeric := 0;
BEGIN
    -- Active batches = all active kernel batches.
    SELECT count(*)::bigint INTO v_active_batches
    FROM public.kernel k
    WHERE k.is_active = true;

    -- Total production (kg) = sum of packed kg from all kernel packing_data entries.
    SELECT COALESCE(SUM(
        COALESCE(
            NULLIF(TRIM(elem->>'totals_qty'), '')::numeric,
            NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric + NULLIF(TRIM(elem->>'bt_total_qty'), '')::numeric,
            (SELECT COALESCE(SUM(NULLIF(TRIM(v->>'qty'), '')::numeric), 0)
             FROM jsonb_each(COALESCE(elem->'sound_kernel', '{}'::jsonb) || COALESCE(elem->'butter_grade', '{}'::jsonb)) AS t(k, v)
             WHERE v->>'qty' IS NOT NULL AND TRIM(COALESCE(v->>'qty', '')) <> ''),
            0
        )
    ), 0) INTO v_total_production
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND elem ? 'date'
      AND (elem->>'date') IS NOT NULL
      AND TRIM(COALESCE(elem->>'date', '')) <> '';

    -- total_sales, quality_pass_rate: leave 0 (wire to sales/quality_tests when available).

    RETURN QUERY SELECT v_total_production, v_active_batches, v_total_sales, v_quality_pass_rate;
END;
$$;

COMMENT ON FUNCTION public.get_executive_kpis() IS 'Executive dashboard KPIs. active_batches and total_production_kg from kernel; total_sales/quality_pass_rate placeholder.';
