-- Batch History: include kernel dispatch orders (and per-batch lines with cartons/kg) for the given kernel.
-- Lines match on jsonb line.kernel_id / KernelId = p_kernel_id (uuid).

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
    qa_data                 jsonb,
    dispatch_orders         jsonb
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
        COALESCE(k.qa_data,        '{}'::jsonb)            AS qa_data,
        (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'id', o.id,
                        'buyer_name', COALESCE(o.buyer_name, ''),
                        'delivery_date', o.delivery_date,
                        'best_before_date', o.best_before_date,
                        'status', COALESCE(o.status, ''),
                        'dispatched_at', o.dispatched_at,
                        'created_at', o.created_at,
                        'lines', (
                            SELECT COALESCE(
                                jsonb_agg(
                                    jsonb_build_object(
                                        'style', NULLIF(trim(both FROM COALESCE(le.e->>'style', le.e->>'Style', '')), ''),
                                        'cartons', CASE
                                            WHEN trim(both FROM COALESCE(le.e->>'cartons', le.e->>'Cartons', '')) ~ '^[0-9]+(\.[0-9]+)?$'
                                            THEN trim(both FROM COALESCE(le.e->>'cartons', le.e->>'Cartons', ''))::numeric
                                            ELSE NULL
                                        END,
                                        'quantity_kg', CASE
                                            WHEN trim(both FROM COALESCE(le.e->>'quantity_kg', le.e->>'QuantityKg', '')) ~ '^[0-9]+(\.[0-9]+)?$'
                                            THEN trim(both FROM COALESCE(le.e->>'quantity_kg', le.e->>'QuantityKg', ''))::numeric
                                            ELSE NULL
                                        END,
                                        'batch_number', NULLIF(trim(both FROM COALESCE(le.e->>'batch_number', le.e->>'BatchNumber', '')), '')
                                    )
                                    ORDER BY trim(both FROM COALESCE(le.e->>'style', le.e->>'Style', ''))
                                ),
                                '[]'::jsonb
                            )
                            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS le(e)
                            WHERE NULLIF(trim(both FROM COALESCE(le.e->>'kernel_id', le.e->>'KernelId', '')), '')::uuid = p_kernel_id
                        )
                    )
                    ORDER BY COALESCE(o.dispatched_at, o.updated_at, o.created_at) DESC NULLS LAST
                ),
                '[]'::jsonb
            )
            FROM public.kernel_dispatch_orders o
            WHERE EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) ex(x)
                WHERE NULLIF(trim(both FROM COALESCE(ex.x->>'kernel_id', ex.x->>'KernelId', '')), '')::uuid = p_kernel_id
            )
        ) AS dispatch_orders
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id
      AND k.is_active = true;
END;
$$;
