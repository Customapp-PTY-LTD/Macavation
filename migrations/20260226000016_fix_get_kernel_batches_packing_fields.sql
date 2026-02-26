-- Fix get_kernel_batches: packing_data uses flat fields (sk_sp_qty, sk_0_qty, bt_78_qty, etc.)
-- not nested sound_kernel/butter_grade objects. Previous SP returned NULL for yield/remaining.
-- Also fixes remaining_by_style to read from kernel_dispatch_orders.lines (new JSONB schema)
-- instead of k.dispatch_data (which is no longer populated by the new create SP).
-- Apply via Supabase SQL Editor.

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
        CASE
            WHEN k.wet_nis_received_kg IS NOT NULL AND k.actual_wet_nis_kg IS NOT NULL
            THEN k.wet_nis_received_kg - k.actual_wet_nis_kg
            ELSE NULL
        END AS weight_difference_kg,
        k.production_finished_at,
        k.is_active,
        (k.intake_data -> 'receiving_checklist' IS NOT NULL
         AND k.intake_data -> 'receiving_checklist' != '{}'::jsonb
         AND k.intake_data -> 'receiving_checklist' != 'null'::jsonb
        ) AS has_receiving_checklist,
        (k.intake_data #>> '{ziplock_sample,completed_at}' IS NOT NULL) AS has_ziplock_sample,
        (k.intake_data #>> '{five_kg_sample,completed_at}' IS NOT NULL) AS has_5kg_sample,
        (k.job_card_data IS NOT NULL
         AND k.job_card_data != '{}'::jsonb
         AND k.job_card_data != 'null'::jsonb
        ) AS has_job_card,
        (k.qa_data IS NOT NULL
         AND k.qa_data != '{}'::jsonb
         AND k.qa_data != 'null'::jsonb
        ) AS has_qa,
        -- Has dispatch: check kernel_dispatch_orders.lines for entries referencing this kernel id
        EXISTS (
            SELECT 1
            FROM kernel_dispatch_orders o
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
            WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id
        ) AS has_dispatch,
        GREATEST(
            jsonb_array_length(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)),
            jsonb_array_length(COALESCE(NULLIF(k.washing_data,  'null'::jsonb), '[]'::jsonb)),
            jsonb_array_length(COALESCE(NULLIF(k.sorting_data,  'null'::jsonb), '[]'::jsonb)),
            jsonb_array_length(COALESCE(NULLIF(k.packing_data,  'null'::jsonb), '[]'::jsonb))
        )::integer AS production_day_count,

        -- yield_by_style: sum flat _qty fields across all packing days
        -- packing_data entries use: sk_sp_qty, sk_0_qty, sk_1_qty, sk_1s_qty, sk_4l_qty,
        --   sk_5_qty, sk_6_qty, bt_78_qty, bt_high_qty, bt_low_qty
        -- Empty string values are treated as 0 via NULLIF(...,'')::numeric
        (
            SELECT jsonb_build_object(
                'SP',              COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty',  '')::numeric), 0),
                '0',               COALESCE(SUM(NULLIF(e ->> 'sk_0_qty',   '')::numeric), 0),
                '1',               COALESCE(SUM(NULLIF(e ->> 'sk_1_qty',   '')::numeric), 0),
                '1S',              COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty',  '')::numeric), 0),
                '4L',              COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty',  '')::numeric), 0),
                '5',               COALESCE(SUM(NULLIF(e ->> 'sk_5_qty',   '')::numeric), 0),
                '6',               COALESCE(SUM(NULLIF(e ->> 'sk_6_qty',   '')::numeric), 0),
                '7/8',             COALESCE(SUM(NULLIF(e ->> 'bt_78_qty',  '')::numeric), 0),
                'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_qty','')::numeric), 0),
                'Butter Low Oil',  COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0)
            )
            FROM jsonb_array_elements(
                COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
            ) e
        ) AS yield_by_style,

        -- remaining_by_style = yield - dispatched
        -- dispatched comes from kernel_dispatch_orders.lines JSONB (new schema after 20260226000015)
        (
            SELECT jsonb_build_object(
                'SP',              GREATEST(0, COALESCE(y.sp,  0) - COALESCE(d.sp,  0)),
                '0',               GREATEST(0, COALESCE(y.s0,  0) - COALESCE(d.s0,  0)),
                '1',               GREATEST(0, COALESCE(y.s1,  0) - COALESCE(d.s1,  0)),
                '1S',              GREATEST(0, COALESCE(y.s1s, 0) - COALESCE(d.s1s, 0)),
                '4L',              GREATEST(0, COALESCE(y.s4l, 0) - COALESCE(d.s4l, 0)),
                '5',               GREATEST(0, COALESCE(y.s5,  0) - COALESCE(d.s5,  0)),
                '6',               GREATEST(0, COALESCE(y.s6,  0) - COALESCE(d.s6,  0)),
                '7/8',             GREATEST(0, COALESCE(y.s78, 0) - COALESCE(d.s78, 0)),
                'Butter High Oil', GREATEST(0, COALESCE(y.bh,  0) - COALESCE(d.bh,  0)),
                'Butter Low Oil',  GREATEST(0, COALESCE(y.bl,  0) - COALESCE(d.bl,  0))
            )
            FROM (
                -- yield: sum flat packing_data fields
                SELECT
                    COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty',  '')::numeric), 0) AS sp,
                    COALESCE(SUM(NULLIF(e ->> 'sk_0_qty',   '')::numeric), 0) AS s0,
                    COALESCE(SUM(NULLIF(e ->> 'sk_1_qty',   '')::numeric), 0) AS s1,
                    COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty',  '')::numeric), 0) AS s1s,
                    COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty',  '')::numeric), 0) AS s4l,
                    COALESCE(SUM(NULLIF(e ->> 'sk_5_qty',   '')::numeric), 0) AS s5,
                    COALESCE(SUM(NULLIF(e ->> 'sk_6_qty',   '')::numeric), 0) AS s6,
                    COALESCE(SUM(NULLIF(e ->> 'bt_78_qty',  '')::numeric), 0) AS s78,
                    COALESCE(SUM(NULLIF(e ->> 'bt_high_qty','')::numeric), 0) AS bh,
                    COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0) AS bl
                FROM jsonb_array_elements(
                    COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
                ) e
            ) y
            -- dispatched: sum quantity_kg per style from all dispatch orders containing this kernel
            CROSS JOIN LATERAL (
                SELECT
                    COALESCE(SUM(CASE WHEN le ->> 'style' = 'SP'              THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS sp,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '0'               THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s0,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '1'               THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s1,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '1S'              THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s1s,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '4L'              THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s4l,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '5'               THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s5,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '6'               THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s6,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = '7/8'             THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s78,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter High Oil' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS bh,
                    COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter Low Oil'  THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS bl
                FROM kernel_dispatch_orders o
                CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
                WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id
            ) d
        ) AS remaining_by_style,

        k.created_at,
        k.updated_at
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.is_active = true
      AND (
          p_status IS NULL
          OR k.status = p_status
          OR k.status = ANY(string_to_array(p_status, ','))
      )
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

-- No RBAC change needed — permissions already granted in 20260225000002 / 20260225000004
