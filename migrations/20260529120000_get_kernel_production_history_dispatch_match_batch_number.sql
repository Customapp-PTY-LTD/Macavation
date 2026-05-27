-- Batch History dispatch_orders: match lines by kernel.id, batches.id wrongly stored as kernel_id,
-- or human batch number (batch_number / BatchNumber / batch_id) with separator-insensitive compare.
-- Replaces get_kernel_production_history; supersedes 20260515180000 / 20260516120000 / 20260525100000 matching rules.

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
    job_card_data             jsonb,
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
                                        'batch_number', NULLIF(trim(both FROM COALESCE(le.e->>'batch_number', le.e->>'BatchNumber', le.e->>'batch_id', le.e->>'BatchId', '')), '')
                                    )
                                    ORDER BY trim(both FROM COALESCE(le.e->>'style', le.e->>'Style', ''))
                                ),
                                '[]'::jsonb
                            )
                            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS le(e)
                            WHERE public.kernel_production_history_dispatch_line_matches(
                                le.e, p_kernel_id, k.batch_id, b.batch_id
                            )
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
                WHERE public.kernel_production_history_dispatch_line_matches(
                    ex.x, p_kernel_id, k.batch_id, b.batch_id
                )
            )
        ) AS dispatch_orders
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id
      AND k.is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.kernel_production_history_dispatch_line_matches(
    p_line jsonb,
    p_kernel_id uuid,
    p_batches_pk uuid,
    p_human_batch_id varchar
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_kernel_id_text text;
    v_kernel_id_uuid uuid;
    v_line_batch text;
    v_target_batch text;
BEGIN
    IF p_line IS NULL OR p_line = 'null'::jsonb THEN
        RETURN false;
    END IF;

    v_kernel_id_text := NULLIF(trim(both FROM COALESCE(
        p_line->>'kernel_id',
        p_line->>'KernelId',
        ''
    )), '');

    IF v_kernel_id_text IS NOT NULL THEN
        BEGIN
            v_kernel_id_uuid := v_kernel_id_text::uuid;
            IF v_kernel_id_uuid = p_kernel_id OR v_kernel_id_uuid = p_batches_pk THEN
                RETURN true;
            END IF;
        EXCEPTION WHEN invalid_text_representation THEN
            NULL;
        END;
    END IF;

    v_line_batch := NULLIF(trim(both FROM COALESCE(
        p_line->>'batch_number',
        p_line->>'BatchNumber',
        p_line->>'batch_id',
        p_line->>'BatchId',
        ''
    )), '');

    IF v_line_batch IS NOT NULL AND p_human_batch_id IS NOT NULL THEN
        v_target_batch := regexp_replace(lower(trim(both FROM p_human_batch_id)), '[.\s\-_/]+', '', 'g');
        IF regexp_replace(lower(v_line_batch), '[.\s\-_/]+', '', 'g') = v_target_batch THEN
            RETURN true;
        END IF;
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.kernel_production_history_dispatch_line_matches(jsonb, uuid, uuid, varchar) IS
'True when a kernel_dispatch_orders.lines element belongs to the batch for Batch History (kernel.id, batches.id as kernel_id, or normalized human batch id).';

COMMENT ON FUNCTION public.get_kernel_production_history(uuid) IS
'Kernel batch history for Batch History modal: intake, stages, job card, QA, dispatch_orders (lines matched by kernel.id, batches.id as kernel_id, or normalized batch number).';

GRANT EXECUTE ON FUNCTION public.kernel_production_history_dispatch_line_matches(jsonb, uuid, uuid, varchar) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kernel_production_history_dispatch_line_matches(jsonb, uuid, uuid, varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.kernel_production_history_dispatch_line_matches(jsonb, uuid, uuid, varchar) TO anon;

NOTIFY pgrst, 'reload schema';
