-- Add actual_wet_nis_kg to get_kernel_production_history so Batch History can show Total weight
-- when job_card_data.total_weight_kg is empty (fallback: kernel.actual_wet_nis_kg).
-- Tables: kernel (k), batches (b). New column source: kernel.actual_wet_nis_kg (numeric).
-- Must DROP first because return type changes.
DROP FUNCTION IF EXISTS public.get_kernel_production_history(uuid);

CREATE OR REPLACE FUNCTION public.get_kernel_production_history(
    p_kernel_id uuid
)
RETURNS TABLE (
    id                      uuid,
    batch_number            varchar,
    grower_name             varchar,
    status                  varchar,
    received_date           date,
    actual_wet_nis_kg       numeric,
    production_finished_at  timestamptz,
    intake_data             jsonb,
    cracking_data           jsonb,
    washing_data            jsonb,
    sorting_data            jsonb,
    packing_data            jsonb,
    job_card_data           jsonb,
    qa_data                 jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id,
        b.batch_id                                          AS batch_number,
        k.grower_name,
        k.status::varchar,
        k.received_date,
        k.actual_wet_nis_kg,
        k.production_finished_at,
        k.intake_data,
        COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb) AS cracking_data,
        COALESCE(NULLIF(k.washing_data,  'null'::jsonb), '[]'::jsonb) AS washing_data,
        COALESCE(NULLIF(k.sorting_data,  'null'::jsonb), '[]'::jsonb) AS sorting_data,
        COALESCE(NULLIF(k.packing_data,  'null'::jsonb), '[]'::jsonb) AS packing_data,
        COALESCE(k.job_card_data,  '{}'::jsonb)            AS job_card_data,
        COALESCE(k.qa_data,        '{}'::jsonb)            AS qa_data
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id
      AND k.is_active = true;
END;
$$;
