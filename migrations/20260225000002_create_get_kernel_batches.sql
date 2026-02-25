-- Migration: Create get_kernel_batches stored procedure
-- Replaces 4 old calls: get_production_batches (kernel), get_kernel_job_cards,
-- get_kernel_packing_samples, get_kernel_production_days_list

CREATE OR REPLACE FUNCTION public.get_kernel_batches(
    p_status varchar DEFAULT NULL,
    p_search varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_id uuid,
    batch_number varchar,
    grower_name varchar,
    supplier_id uuid,
    status varchar,
    received_date date,
    wet_nis_received_kg numeric,
    actual_wet_nis_kg numeric,
    weight_difference_kg numeric,
    production_finished_at timestamptz,
    is_active boolean,
    has_receiving_checklist boolean,
    has_ziplock_sample boolean,
    has_5kg_sample boolean,
    has_job_card boolean,
    has_qa boolean,
    has_dispatch boolean,
    production_day_count integer,
    yield_by_style jsonb,
    remaining_by_style jsonb,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id,
        k.batch_id,
        b.batch_id AS batch_number,
        k.grower_name,
        k.supplier_id,
        k.status::varchar,
        k.received_date,
        k.wet_nis_received_kg,
        k.actual_wet_nis_kg,
        -- Weight difference (supplied - actual)
        CASE
            WHEN k.wet_nis_received_kg IS NOT NULL AND k.actual_wet_nis_kg IS NOT NULL
            THEN k.wet_nis_received_kg - k.actual_wet_nis_kg
            ELSE NULL
        END AS weight_difference_kg,
        k.production_finished_at,
        k.is_active,
        -- Receiving checklist completed
        (k.intake_data -> 'receiving_checklist' IS NOT NULL
         AND k.intake_data -> 'receiving_checklist' != '{}'::jsonb
         AND k.intake_data -> 'receiving_checklist' != 'null'::jsonb
        ) AS has_receiving_checklist,
        -- Ziplock sample completed
        (k.intake_data #>> '{ziplock_sample,completed_at}' IS NOT NULL
        ) AS has_ziplock_sample,
        -- 5kg sample completed
        (k.intake_data #>> '{five_kg_sample,completed_at}' IS NOT NULL
        ) AS has_5kg_sample,
        -- Job card exists
        (k.job_card_data IS NOT NULL
         AND k.job_card_data != '{}'::jsonb
         AND k.job_card_data != 'null'::jsonb
        ) AS has_job_card,
        -- QA completed
        (k.qa_data IS NOT NULL
         AND k.qa_data != '{}'::jsonb
         AND k.qa_data != 'null'::jsonb
        ) AS has_qa,
        -- Has dispatch data
        (k.dispatch_data IS NOT NULL
         AND k.dispatch_data != '{}'::jsonb
         AND k.dispatch_data != 'null'::jsonb
         AND jsonb_array_length(COALESCE(k.dispatch_data -> 'orders', '[]'::jsonb)) > 0
        ) AS has_dispatch,
        -- Production day count = max array length across 4 stages
        GREATEST(
            jsonb_array_length(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)),
            jsonb_array_length(COALESCE(NULLIF(k.washing_data, 'null'::jsonb), '[]'::jsonb)),
            jsonb_array_length(COALESCE(NULLIF(k.sorting_data, 'null'::jsonb), '[]'::jsonb)),
            jsonb_array_length(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb))
        )::integer AS production_day_count,
        -- Yield by style from packing_data (aggregate across all packing days)
        (
            SELECT jsonb_object_agg(style_key, style_total)
            FROM (
                SELECT
                    sk.key AS style_key,
                    SUM((sk.value ->> 'qty')::numeric) AS style_total
                FROM jsonb_array_elements(
                    COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
                ) AS day_entry,
                LATERAL jsonb_each(
                    COALESCE(day_entry -> 'sound_kernel', '{}'::jsonb) ||
                    COALESCE(day_entry -> 'butter_grade', '{}'::jsonb)
                ) AS sk(key, value)
                WHERE sk.key NOT IN ('total')
                  AND sk.value ->> 'qty' IS NOT NULL
                GROUP BY sk.key
            ) AS styles
        ) AS yield_by_style,
        -- Remaining by style = yield - dispatched
        (
            SELECT jsonb_object_agg(y.style_key, GREATEST(0, y.total_qty - COALESCE(d.dispatched_qty, 0)))
            FROM (
                SELECT
                    sk.key AS style_key,
                    SUM((sk.value ->> 'qty')::numeric) AS total_qty
                FROM jsonb_array_elements(
                    COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
                ) AS day_entry,
                LATERAL jsonb_each(
                    COALESCE(day_entry -> 'sound_kernel', '{}'::jsonb) ||
                    COALESCE(day_entry -> 'butter_grade', '{}'::jsonb)
                ) AS sk(key, value)
                WHERE sk.key NOT IN ('total')
                  AND sk.value ->> 'qty' IS NOT NULL
                GROUP BY sk.key
            ) AS y
            LEFT JOIN (
                SELECT
                    dl.value ->> 'style' AS style_key,
                    SUM((dl.value ->> 'quantity_kg')::numeric) AS dispatched_qty
                FROM jsonb_array_elements(
                    COALESCE(k.dispatch_data -> 'orders', '[]'::jsonb)
                ) AS ord,
                LATERAL jsonb_array_elements(
                    COALESCE(ord -> 'lines', '[]'::jsonb)
                ) AS dl
                WHERE ord ->> 'status' = 'dispatched'
                GROUP BY dl.value ->> 'style'
            ) AS d ON d.style_key = y.style_key
        ) AS remaining_by_style,
        k.created_at,
        k.updated_at
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.is_active = true
      -- Status filter: supports single value or comma-separated list
      AND (
          p_status IS NULL
          OR k.status = p_status
          OR k.status = ANY(string_to_array(p_status, ','))
      )
      -- Search filter: ILIKE on batch_number and grower_name
      AND (
          p_search IS NULL
          OR b.batch_id ILIKE '%' || p_search || '%'
          OR k.grower_name ILIKE '%' || p_search || '%'
      )
    ORDER BY k.received_date DESC NULLS LAST, b.batch_id DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- RBAC: Grant execute to all roles
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id, role_name FROM public.roles LOOP
        EXECUTE format(
            'GRANT EXECUTE ON FUNCTION public.get_kernel_batches(varchar, varchar, integer, integer) TO authenticated'
        );
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (r.id, 'function', 'get_kernel_batches', 'execute', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
