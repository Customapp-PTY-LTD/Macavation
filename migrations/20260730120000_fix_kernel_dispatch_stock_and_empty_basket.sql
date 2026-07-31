-- Fix: kernel dispatch "Order lines (basket)" shows empty, and Stock (Kernel) on-hand figures
-- don't drop after a dispatch is completed.
--
-- Root causes, all reading/writing the same kernel_dispatch_orders.lines jsonb column:
--
-- 1. create_kernel_dispatch_order never rejected an empty p_lines array (unlike
--    update_kernel_dispatch_order, which already requires >= 1 line). A basket created with
--    zero lines renders "No lines on this order." forever, and since get_kernel_batches sums
--    kernel_dispatch_orders.lines to compute remaining stock, an order with no lines can never
--    subtract anything - dispatching it looks like it did nothing to stock on hand.
-- 2. get_kernel_batches / get_batch_remaining_by_style matched dispatch lines to a kernel batch
--    with a strict `kernel_id = k.id` comparison. get_kernel_production_history (Batch History)
--    already had to tolerate lines whose kernel_id was historically stored as batches.id instead
--    of kernel.id, or only carries a human batch_number (see kernel_production_history_dispatch_
--    line_matches, added 2026-05-29) - that tolerant match was never backported to the stock-on-
--    hand RPCs, so any such line is silently excluded from the dispatched-quantity subtraction
--    and remaining stock never drops for that batch.
-- 3. The kg-based remaining_by_style calculation summed quantity_kg with no fallback when a line
--    only carries cartons, while the cartons-based remaining_by_style_cartons already falls back
--    from quantity_kg. That asymmetry can leave the kg figure (used by the runway/KPI dashboard)
--    stuck at the pre-dispatch value even when the cartons-based grid cell is correct.

-- ============================================================
-- 1. create_kernel_dispatch_order: require at least one line (parity with update_kernel_dispatch_order)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_kernel_dispatch_order(
    p_buyer_name        text,
    p_delivery_date     date,
    p_lines             jsonb,
    p_buyer_contact_id  uuid  DEFAULT NULL,
    p_best_before_date  date  DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_order_id   uuid;
    v_lines      jsonb := '[]'::jsonb;
    v_line       jsonb;
    v_cartons    numeric;
    v_quantity_kg numeric;
    v_kg_per_carton constant numeric := 11.34;
    i            int;
BEGIN
    IF p_buyer_name IS NULL OR trim(p_buyer_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Buyer name is required');
    END IF;
    IF p_delivery_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery date is required');
    END IF;
    IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'At least one line is required');
    END IF;

    -- Normalize lines: cartons is source of truth; quantity_kg = cartons * 11.34
    FOR i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
        v_line := p_lines->i;
        -- Prefer cartons; if missing, derive from quantity_kg
        v_cartons := (v_line->>'cartons')::numeric;
        IF v_cartons IS NULL OR v_cartons < 0 THEN
            v_cartons := (v_line->>'quantity_kg')::numeric / NULLIF(v_kg_per_carton, 0);
            IF v_cartons IS NULL OR v_cartons < 0 THEN
                v_cartons := 0;
            END IF;
        END IF;
        v_quantity_kg := ROUND(v_cartons * v_kg_per_carton, 2);

        v_lines := v_lines || jsonb_build_object(
            'kernel_id',    v_line->>'kernel_id',
            'batch_number', v_line->>'batch_number',
            'style',        v_line->>'style',
            'cartons',      v_cartons,
            'quantity_kg',  v_quantity_kg
        );
    END LOOP;

    INSERT INTO public.kernel_dispatch_orders (
        buyer_name, buyer_contact_id, delivery_date, best_before_date, lines, status
    ) VALUES (
        p_buyer_name, p_buyer_contact_id, p_delivery_date, p_best_before_date,
        v_lines, 'pending'
    )
    RETURNING id INTO v_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================
-- 2. get_batch_remaining_by_style: tolerant kernel_id match (kernel.id, batches.id, or batch
--    number) + cartons->kg fallback, mirroring get_kernel_production_history's matcher.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_batch_remaining_by_style(p_batch_id uuid, p_yield_by_style jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_object_agg(
      kv.key,
      GREATEST(0,
        COALESCE((p_yield_by_style->>kv.key)::numeric, 0)
        - COALESCE((
            SELECT SUM(COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34))
            FROM kernel_dispatch_orders o
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
            JOIN public.kernel k ON k.id = p_batch_id
            JOIN public.batches b ON b.id = k.batch_id
            WHERE public.kernel_production_history_dispatch_line_matches(le, k.id, k.batch_id, b.batch_id)
              AND le ->> 'style' = kv.key
          ), 0)
      )
    )
    FROM jsonb_each_text(COALESCE(p_yield_by_style, '{}'::jsonb)) AS kv(key, val)),
    '{}'::jsonb
  );
$$;

-- ============================================================
-- 3. get_kernel_batches: same tolerant kernel_id match + kg fallback, applied to has_dispatch,
--    remaining_by_style, and remaining_by_style_cartons (byte-for-byte unchanged otherwise).
-- ============================================================
DROP FUNCTION IF EXISTS public.get_kernel_batches(varchar, varchar, integer, integer);

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
    has_jobcard_approved boolean,
    has_qa boolean,
    has_dispatch boolean,
    production_day_count integer,
    yield_by_style jsonb,
    remaining_by_style jsonb,
    yield_by_style_cartons jsonb,
    remaining_by_style_cartons jsonb,
    ffa numeric,
    best_before_date date,
    created_at timestamptz,
    updated_at timestamptz,
    sound_kernel_recovery_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        base.*,
        CASE
            WHEN base.actual_wet_nis_kg IS NOT NULL
                 AND base.actual_wet_nis_kg > 0
                 AND base.production_finished_at IS NOT NULL
            THEN round((
                  COALESCE((base.yield_by_style ->> 'SP')::numeric, 0)
                + COALESCE((base.yield_by_style ->> '0')::numeric, 0)
                + COALESCE((base.yield_by_style ->> '1')::numeric, 0)
                + COALESCE((base.yield_by_style ->> '1S')::numeric, 0)
                + COALESCE((base.yield_by_style ->> '4L')::numeric, 0)
                + COALESCE((base.yield_by_style ->> '5')::numeric, 0)
                + COALESCE((base.yield_by_style ->> '6')::numeric, 0)
                + COALESCE((base.yield_by_style ->> '7/8')::numeric, 0)
                ) / base.actual_wet_nis_kg * 100, 2)
            ELSE NULL
        END AS sound_kernel_recovery_pct
    FROM (
        SELECT
            k.id, k.batch_id, b.batch_id AS batch_number, k.grower_name, k.supplier_id, k.status::varchar,
            k.received_date, k.wet_nis_received_kg, k.actual_wet_nis_kg,
            CASE WHEN k.wet_nis_received_kg IS NOT NULL AND k.actual_wet_nis_kg IS NOT NULL THEN k.wet_nis_received_kg - k.actual_wet_nis_kg ELSE NULL END,
            k.production_finished_at, k.is_active,
            (k.intake_data -> 'receiving_checklist' IS NOT NULL AND k.intake_data -> 'receiving_checklist' != '{}'::jsonb AND k.intake_data -> 'receiving_checklist' != 'null'::jsonb) AS has_receiving_checklist,
            (k.intake_data #>> '{ziplock_sample,completed_at}' IS NOT NULL) AS has_ziplock_sample,
            (k.intake_data #>> '{five_kg_sample,completed_at}' IS NOT NULL) AS has_5kg_sample,
            (k.job_card_data IS NOT NULL AND k.job_card_data != '{}'::jsonb AND k.job_card_data != 'null'::jsonb) AS has_job_card,
            COALESCE(k.jobcard_approved, false) AS has_jobcard_approved,
            (k.qa_data IS NOT NULL AND k.qa_data != '{}'::jsonb AND k.qa_data != 'null'::jsonb) AS has_qa,
            EXISTS (SELECT 1 FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le WHERE public.kernel_production_history_dispatch_line_matches(le, k.id, k.batch_id, b.batch_id)) AS has_dispatch,
            GREATEST(jsonb_array_length(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.washing_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.sorting_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)))::integer AS production_day_count,

            CASE WHEN COALESCE(k.jobcard_approved, false) AND public.kernel_job_card_has_stock_quantities(k.job_card_data)
                THEN public.kernel_yield_kg_from_job_card(k.job_card_data)
                ELSE (
                    SELECT jsonb_build_object('SP', COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty', '')::numeric), 0), '0', COALESCE(SUM(NULLIF(e ->> 'sk_0_qty', '')::numeric), 0), '1', COALESCE(SUM(NULLIF(e ->> 'sk_1_qty', '')::numeric), 0), '1S', COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty', '')::numeric), 0), '4L', COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty', '')::numeric), 0), '5', COALESCE(SUM(NULLIF(e ->> 'sk_5_qty', '')::numeric), 0), '6', COALESCE(SUM(NULLIF(e ->> 'sk_6_qty', '')::numeric), 0), '7/8', COALESCE(SUM(NULLIF(e ->> 'bt_78_qty', '')::numeric), 0), 'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_qty','')::numeric), 0), 'Butter Low Oil', COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0))
                    FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) e
                )
            END AS yield_by_style,

            CASE WHEN COALESCE(k.jobcard_approved, false) AND public.kernel_job_card_has_stock_quantities(k.job_card_data)
                THEN (
                    SELECT jsonb_build_object(
                        'SP', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'SP')::numeric, 0) - COALESCE(d.sp, 0)),
                        '0', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '0')::numeric, 0) - COALESCE(d.s0, 0)),
                        '1', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '1')::numeric, 0) - COALESCE(d.s1, 0)),
                        '1S', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '1S')::numeric, 0) - COALESCE(d.s1s, 0)),
                        '4L', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '4L')::numeric, 0) - COALESCE(d.s4l, 0)),
                        '5', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '5')::numeric, 0) - COALESCE(d.s5, 0)),
                        '6', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '6')::numeric, 0) - COALESCE(d.s6, 0)),
                        '7/8', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '7/8')::numeric, 0) - COALESCE(d.s78, 0)),
                        'Butter High Oil', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'Butter High Oil')::numeric, 0) - COALESCE(d.bh, 0)),
                        'Butter Low Oil', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'Butter Low Oil')::numeric, 0) - COALESCE(d.bl, 0))
                    )
                    FROM (
                        SELECT
                            COALESCE(SUM(CASE WHEN le ->> 'style' = 'SP' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS sp,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = '0' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS s0,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = '1' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS s1,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = '1S' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS s1s,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = '4L' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS s4l,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = '5' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS s5,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = '6' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS s6,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = '7/8' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS s78,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter High Oil' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS bh,
                            COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter Low Oil' THEN COALESCE(NULLIF(le ->> 'quantity_kg', '')::numeric, NULLIF(le ->> 'cartons', '')::numeric * 11.34) ELSE 0 END), 0) AS bl
                        FROM kernel_dispatch_orders o
                        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
                        WHERE public.kernel_production_history_dispatch_line_matches(le, k.id, k.batch_id, b.batch_id)
                    ) d
                )
                ELSE (
                    SELECT jsonb_build_object('SP', GREATEST(0, COALESCE(y.sp,0)-COALESCE(d.sp,0)), '0', GREATEST(0, COALESCE(y.s0,0)-COALESCE(d.s0,0)), '1', GREATEST(0, COALESCE(y.s1,0)-COALESCE(d.s1,0)), '1S', GREATEST(0, COALESCE(y.s1s,0)-COALESCE(d.s1s,0)), '4L', GREATEST(0, COALESCE(y.s4l,0)-COALESCE(d.s4l,0)), '5', GREATEST(0, COALESCE(y.s5,0)-COALESCE(d.s5,0)), '6', GREATEST(0, COALESCE(y.s6,0)-COALESCE(d.s6,0)), '7/8', GREATEST(0, COALESCE(y.s78,0)-COALESCE(d.s78,0)), 'Butter High Oil', GREATEST(0, COALESCE(y.bh,0)-COALESCE(d.bh,0)), 'Butter Low Oil', GREATEST(0, COALESCE(y.bl,0)-COALESCE(d.bl,0)))
                    FROM (SELECT COALESCE(SUM(NULLIF(e->>'sk_sp_qty','')::numeric),0) AS sp, COALESCE(SUM(NULLIF(e->>'sk_0_qty','')::numeric),0) AS s0, COALESCE(SUM(NULLIF(e->>'sk_1_qty','')::numeric),0) AS s1, COALESCE(SUM(NULLIF(e->>'sk_1s_qty','')::numeric),0) AS s1s, COALESCE(SUM(NULLIF(e->>'sk_4l_qty','')::numeric),0) AS s4l, COALESCE(SUM(NULLIF(e->>'sk_5_qty','')::numeric),0) AS s5, COALESCE(SUM(NULLIF(e->>'sk_6_qty','')::numeric),0) AS s6, COALESCE(SUM(NULLIF(e->>'bt_78_qty','')::numeric),0) AS s78, COALESCE(SUM(NULLIF(e->>'bt_high_qty','')::numeric),0) AS bh, COALESCE(SUM(NULLIF(e->>'bt_low_qty','')::numeric),0) AS bl FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data,'null'::jsonb),'[]'::jsonb)) e) y
                    CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS sp, COALESCE(SUM(CASE WHEN le->>'style'='0' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS s0, COALESCE(SUM(CASE WHEN le->>'style'='1' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS s1, COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS s1s, COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS s4l, COALESCE(SUM(CASE WHEN le->>'style'='5' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS s5, COALESCE(SUM(CASE WHEN le->>'style'='6' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS s6, COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS s78, COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS bh, COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN COALESCE(NULLIF(le->>'quantity_kg','')::numeric, NULLIF(le->>'cartons','')::numeric * 11.34) ELSE 0 END),0) AS bl FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE public.kernel_production_history_dispatch_line_matches(le, k.id, k.batch_id, b.batch_id)) d
                )
            END AS remaining_by_style,

            CASE WHEN COALESCE(k.jobcard_approved, false) AND public.kernel_job_card_has_stock_quantities(k.job_card_data)
                THEN public.kernel_yield_cartons_from_job_card(k.job_card_data)
                ELSE (
                    SELECT jsonb_build_object('SP', COALESCE(SUM(NULLIF(e ->> 'sk_sp_cartons', '')::numeric), 0), '0', COALESCE(SUM(NULLIF(e ->> 'sk_0_cartons', '')::numeric), 0), '1', COALESCE(SUM(NULLIF(e ->> 'sk_1_cartons', '')::numeric), 0), '1S', COALESCE(SUM(NULLIF(e ->> 'sk_1s_cartons', '')::numeric), 0), '4L', COALESCE(SUM(NULLIF(e ->> 'sk_4l_cartons', '')::numeric), 0), '5', COALESCE(SUM(NULLIF(e ->> 'sk_5_cartons', '')::numeric), 0), '6', COALESCE(SUM(NULLIF(e ->> 'sk_6_cartons', '')::numeric), 0), '7/8', COALESCE(SUM(NULLIF(e ->> 'bt_78_cartons', '')::numeric), 0), 'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_cartons','')::numeric), 0), 'Butter Low Oil', COALESCE(SUM(NULLIF(e ->> 'bt_low_cartons', '')::numeric), 0))
                    FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) e
                )
            END AS yield_by_style_cartons,

            CASE WHEN COALESCE(k.jobcard_approved, false) AND public.kernel_job_card_has_stock_quantities(k.job_card_data)
                THEN (
                    SELECT jsonb_build_object(
                        'SP', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'SP')::numeric, 0) - COALESCE(dc.sp, 0)),
                        '0', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '0')::numeric, 0) - COALESCE(dc.s0, 0)),
                        '1', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '1')::numeric, 0) - COALESCE(dc.s1, 0)),
                        '1S', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '1S')::numeric, 0) - COALESCE(dc.s1s, 0)),
                        '4L', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '4L')::numeric, 0) - COALESCE(dc.s4l, 0)),
                        '5', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '5')::numeric, 0) - COALESCE(dc.s5, 0)),
                        '6', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '6')::numeric, 0) - COALESCE(dc.s6, 0)),
                        '7/8', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '7/8')::numeric, 0) - COALESCE(dc.s78, 0)),
                        'Butter High Oil', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'Butter High Oil')::numeric, 0) - COALESCE(dc.bh, 0)),
                        'Butter Low Oil', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'Butter Low Oil')::numeric, 0) - COALESCE(dc.bl, 0))
                    )
                    FROM (
                        SELECT
                            COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS sp,
                            COALESCE(SUM(CASE WHEN le->>'style'='0' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s0,
                            COALESCE(SUM(CASE WHEN le->>'style'='1' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1,
                            COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1s,
                            COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s4l,
                            COALESCE(SUM(CASE WHEN le->>'style'='5' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s5,
                            COALESCE(SUM(CASE WHEN le->>'style'='6' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s6,
                            COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s78,
                            COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bh,
                            COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bl
                        FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE public.kernel_production_history_dispatch_line_matches(le, k.id, k.batch_id, b.batch_id)
                    ) dc
                )
                ELSE (
                    SELECT jsonb_build_object('SP', GREATEST(0, COALESCE(yc.sp,0)-COALESCE(dc.sp,0)), '0', GREATEST(0, COALESCE(yc.s0,0)-COALESCE(dc.s0,0)), '1', GREATEST(0, COALESCE(yc.s1,0)-COALESCE(dc.s1,0)), '1S', GREATEST(0, COALESCE(yc.s1s,0)-COALESCE(dc.s1s,0)), '4L', GREATEST(0, COALESCE(yc.s4l,0)-COALESCE(dc.s4l,0)), '5', GREATEST(0, COALESCE(yc.s5,0)-COALESCE(dc.s5,0)), '6', GREATEST(0, COALESCE(yc.s6,0)-COALESCE(dc.s6,0)), '7/8', GREATEST(0, COALESCE(yc.s78,0)-COALESCE(dc.s78,0)), 'Butter High Oil', GREATEST(0, COALESCE(yc.bh,0)-COALESCE(dc.bh,0)), 'Butter Low Oil', GREATEST(0, COALESCE(yc.bl,0)-COALESCE(dc.bl,0)))
                    FROM (SELECT COALESCE(SUM(NULLIF(e->>'sk_sp_cartons','')::numeric),0) AS sp, COALESCE(SUM(NULLIF(e->>'sk_0_cartons','')::numeric),0) AS s0, COALESCE(SUM(NULLIF(e->>'sk_1_cartons','')::numeric),0) AS s1, COALESCE(SUM(NULLIF(e->>'sk_1s_cartons','')::numeric),0) AS s1s, COALESCE(SUM(NULLIF(e->>'sk_4l_cartons','')::numeric),0) AS s4l, COALESCE(SUM(NULLIF(e->>'sk_5_cartons','')::numeric),0) AS s5, COALESCE(SUM(NULLIF(e->>'sk_6_cartons','')::numeric),0) AS s6, COALESCE(SUM(NULLIF(e->>'bt_78_cartons','')::numeric),0) AS s78, COALESCE(SUM(NULLIF(e->>'bt_high_cartons','')::numeric),0) AS bh, COALESCE(SUM(NULLIF(e->>'bt_low_cartons','')::numeric),0) AS bl FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data,'null'::jsonb),'[]'::jsonb)) e) yc
                    CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS sp, COALESCE(SUM(CASE WHEN le->>'style'='0' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s0, COALESCE(SUM(CASE WHEN le->>'style'='1' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1, COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1s, COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s4l, COALESCE(SUM(CASE WHEN le->>'style'='5' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s5, COALESCE(SUM(CASE WHEN le->>'style'='6' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s6, COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s78, COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bh, COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bl FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE public.kernel_production_history_dispatch_line_matches(le, k.id, k.batch_id, b.batch_id)) dc
                )
            END AS remaining_by_style_cartons,

            COALESCE((NULLIF(k.qa_data->>'ffa_result', ''))::numeric, (NULLIF(k.qa_data->>'ffa', ''))::numeric) AS ffa,
            COALESCE((NULLIF(k.job_card_data->>'best_before_date', ''))::date, ((NULLIF(k.job_card_data->>'packing_completion_date', ''))::date + interval '18 months')::date) AS best_before_date,
            k.created_at, k.updated_at
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE k.is_active = true
          AND b.is_active = true
          AND (p_status IS NULL OR k.status = p_status OR k.status = ANY(string_to_array(p_status, ',')))
          AND (p_search IS NULL OR b.batch_id ILIKE '%' || p_search || '%' OR k.grower_name ILIKE '%' || p_search || '%')
        ORDER BY k.received_date DESC NULLS LAST, b.batch_id DESC
        LIMIT p_limit OFFSET p_offset
    ) base;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_batches(varchar, varchar, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kernel_batches(varchar, varchar, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_batches(varchar, varchar, integer, integer) TO anon;

NOTIFY pgrst, 'reload schema';
