-- Active Batches = kernel batches in intake (intake, receiving) OR in kernel production (production).
-- Excludes qa, complete, in_finished_stock.

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
    -- Active batches = only those in intake (intake, receiving) or in kernel production (production).
    SELECT count(*)::bigint INTO v_active_batches
    FROM public.kernel k
    WHERE k.is_active = true
      AND (k.status IS NULL OR k.status IN ('intake', 'receiving', 'production'));

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

    RETURN QUERY SELECT v_total_production, v_active_batches, v_total_sales, v_quality_pass_rate;
END;
$$;

COMMENT ON FUNCTION public.get_executive_kpis() IS 'Executive dashboard KPIs. active_batches = kernel in intake (intake, receiving) or in production only; total_production_kg from packing_data.';
