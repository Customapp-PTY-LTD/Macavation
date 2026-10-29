-- ============================================================================
-- Oil plant: supplier reconciliation (Henry, 29 Oct 2026)
-- ============================================================================
-- 1. oil_raw_receipts: raw material loads kept as history, one row per load (not per bag).
--    Filled from Mike's "Recon Jan 2026-October 2026.xlsx" by 20261029120100. These rows never go
--    on the Supplier Intake board (no tests, no release), they are a record of what came in.
--
-- 2. Settings, key 'oil_supplier_recon' in kernel_pipeline_settings:
--      history_through  last day the recon sheet covers. Up to and including this day the sheet is
--                       the record of receipts; from the next day the portal's deliveries are.
--    The one cut-off is used by both functions below, so a load is never counted twice.
--
-- 3. get_oil_supplier_recon(from, to): every load in the range, from the sheet history up to
--    history_through and from portal deliveries (oil rows, grouped by delivery_group_id) after it.
--    Quick stock entry rows (from_adjust_stock) are counts and corrections, not deliveries: left out.
--
-- 4. get_oil_raw_stock() (from 20261029100000) now also adds sheet loads received after the stock
--    count date up to history_through, and counts portal bags received only after history_through.
--    Releases to Oil Production are unchanged.
--
-- Same model as the other oil pipeline functions: SECURITY DEFINER RPCs, table closed to anon/authenticated.
-- Down: DROP FUNCTION get_oil_supplier_recon(date, date); DROP TABLE oil_raw_receipts;
--       DELETE FROM kernel_pipeline_settings WHERE key = 'oil_supplier_recon';
--       re-run get_oil_raw_stock from 20261029100000.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oil_raw_receipts (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    received_date             date NOT NULL,
    supplier_name             text NOT NULL CHECK (length(btrim(supplier_name)) > 0),
    supplier_name_as_written  text NULL,
    is_own_material           boolean NOT NULL DEFAULT false,
    cracker_dust_kg           numeric(12, 2) NOT NULL DEFAULT 0 CHECK (cracker_dust_kg >= 0),
    kernel_dust_kg            numeric(12, 2) NOT NULL DEFAULT 0 CHECK (kernel_dust_kg >= 0),
    food_grade_kernel_kg      numeric(12, 2) NOT NULL DEFAULT 0 CHECK (food_grade_kernel_kg >= 0),
    crude_kernel_kg           numeric(12, 2) NOT NULL DEFAULT 0 CHECK (crude_kernel_kg >= 0),
    source                    text NOT NULL DEFAULT 'recon_sheet_2026',
    sheet_row                 integer NULL,
    flag                      text NULL CHECK (flag IS NULL OR flag IN ('check_duplicate', 'date_corrected')),
    note                      text NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),
    voided_at                 timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_oil_raw_receipts_date ON public.oil_raw_receipts (received_date) WHERE voided_at IS NULL;

ALTER TABLE public.oil_raw_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oil_raw_receipts FROM anon, authenticated;

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('oil_supplier_recon', jsonb_build_object('history_through', '2026-10-29'))
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Every load in a date range, sheet history + portal deliveries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_oil_supplier_recon(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_hist  date := COALESCE((SELECT (value->>'history_through')::date FROM public.kernel_pipeline_settings
                               WHERE key = 'oil_supplier_recon'), DATE '2026-10-29');
    v_loads jsonb;
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF p_date_to - p_date_from > 800 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 800 days.');
    END IF;

    WITH sheet AS (
        SELECT r.received_date AS received_date, r.supplier_name AS supplier, 'sheet'::text AS source,
               r.is_own_material AS own, r.cracker_dust_kg AS cracker_dust_kg, r.kernel_dust_kg AS kernel_dust_kg,
               r.food_grade_kernel_kg AS food_grade_kg, r.crude_kernel_kg AS crude_kg,
               r.flag, r.note, NULL::text AS reference, 0 AS bags
          FROM public.oil_raw_receipts r
         WHERE r.voided_at IS NULL
           AND r.received_date BETWEEN p_date_from AND p_date_to
           AND r.received_date <= v_hist
    ),
    bags AS (
        SELECT COALESCE(o.intake_data->>'delivery_group_id', o.id::text) AS load_key,
               (o.intake_data->>'date_received')::date AS received_date,
               COALESCE(NULLIF(btrim(o.intake_data->>'supplier'), ''), NULLIF(btrim(o.intake_data->>'supplier_details'), ''), 'No supplier') AS supplier,
               NULLIF(btrim(COALESCE(o.intake_data->>'delivery_note_ref', o.intake_data->>'delivery_note_reference')), '') AS reference,
               o.intake_data->>'product_type' AS product_type,
               o.intake_data->>'grade' AS grade,
               COALESCE((o.intake_data->>'quantity_kg')::numeric, 0) AS kg
          FROM public.oil o
         WHERE COALESCE(o.is_active, true)
           AND o.intake_data->>'product_type' IN ('oil_kernel', 'kernel_dust', 'cracker_dust')
           AND COALESCE(o.intake_data->>'from_adjust_stock', 'false') <> 'true'
           AND (o.intake_data->>'date_received') ~ '^\d{4}-\d{2}-\d{2}'
    ),
    portal AS (
        SELECT min(b.received_date) AS received_date, min(b.supplier) AS supplier, 'portal'::text AS source,
               false AS own,
               sum(b.kg) FILTER (WHERE b.product_type = 'cracker_dust') AS cracker_dust_kg,
               sum(b.kg) FILTER (WHERE b.product_type = 'kernel_dust') AS kernel_dust_kg,
               sum(b.kg) FILTER (WHERE b.product_type = 'oil_kernel' AND b.grade = 'food_grade') AS food_grade_kg,
               sum(b.kg) FILTER (WHERE b.product_type = 'oil_kernel' AND COALESCE(b.grade, '') <> 'food_grade') AS crude_kg,
               NULL::text AS flag, NULL::text AS note, min(b.reference) AS reference, count(*)::int AS bags
          FROM bags b
         GROUP BY b.load_key
        HAVING min(b.received_date) BETWEEN p_date_from AND p_date_to
           AND min(b.received_date) > v_hist
    ),
    loads AS (
        SELECT * FROM sheet
        UNION ALL
        SELECT received_date, supplier, source, own, COALESCE(cracker_dust_kg, 0), COALESCE(kernel_dust_kg, 0),
               COALESCE(food_grade_kg, 0), COALESCE(crude_kg, 0), flag, note, reference, bags
          FROM portal
    )
    SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(to_jsonb(l)) ORDER BY l.received_date, l.supplier), '[]'::jsonb)
      INTO v_loads
      FROM loads l;

    RETURN jsonb_build_object('success', true, 'history_through', v_hist, 'loads', v_loads);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Stock on hand: add sheet loads after the count, portal bags only after the sheet's last day
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_oil_raw_stock()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_set   jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_count date  := COALESCE((v_set->>'count_date')::date, DATE '2026-10-26');
    v_hist  date  := COALESCE((SELECT (value->>'history_through')::date FROM public.kernel_pipeline_settings
                                WHERE key = 'oil_supplier_recon'), DATE '2026-10-29');
    v_from_portal date;
    v_out   jsonb := '[]'::jsonb;
    v_key   text;
    v_m     jsonb;
    v_daily numeric;
    v_cnt   numeric;
    v_in    numeric;
    v_used  numeric;
    v_fg_in numeric;
    v_fg_used numeric;
    v_sh_in numeric;
    v_sh_fg numeric;
    v_on    numeric;
BEGIN
    -- Portal bags count when received after both the count and the sheet's last day.
    v_from_portal := GREATEST(v_count, v_hist);

    FOREACH v_key IN ARRAY ARRAY['oil_kernel', 'kernel_dust', 'cracker_dust'] LOOP
        v_m     := COALESCE(v_set->'materials'->v_key, '{}'::jsonb);
        v_daily := COALESCE((v_m->>'daily_kg')::numeric, 0);
        v_cnt   := COALESCE((v_m->>'count_kg')::numeric, 0);

        SELECT COALESCE(sum(COALESCE((o.intake_data->>'quantity_kg')::numeric, 0))
                        FILTER (WHERE (o.intake_data->>'date_received')::date > v_from_portal), 0),
               COALESCE(sum(COALESCE((o.intake_data->>'weight_before_production_kg')::numeric,
                                     (o.intake_data->>'quantity_kg')::numeric, 0))
                        FILTER (WHERE (((o.intake_data->>'weight_before_production_recorded_at')::timestamptz)
                                       AT TIME ZONE 'Africa/Johannesburg')::date > v_count), 0),
               COALESCE(sum(COALESCE((o.intake_data->>'quantity_kg')::numeric, 0))
                        FILTER (WHERE (o.intake_data->>'date_received')::date > v_from_portal
                                  AND o.intake_data->>'grade' = 'food_grade'), 0),
               COALESCE(sum(COALESCE((o.intake_data->>'weight_before_production_kg')::numeric,
                                     (o.intake_data->>'quantity_kg')::numeric, 0))
                        FILTER (WHERE (((o.intake_data->>'weight_before_production_recorded_at')::timestamptz)
                                       AT TIME ZONE 'Africa/Johannesburg')::date > v_count
                                  AND o.intake_data->>'grade' = 'food_grade'), 0)
          INTO v_in, v_used, v_fg_in, v_fg_used
          FROM public.oil o
         WHERE COALESCE(o.is_active, true)
           AND o.intake_data->>'product_type' = v_key
           AND (o.intake_data->>'date_received') ~ '^\d{4}-\d{2}-\d{2}'
           AND (o.intake_data->>'weight_before_production_recorded_at' IS NULL
                OR (o.intake_data->>'weight_before_production_recorded_at') ~ '^\d{4}-\d{2}-\d{2}');

        SELECT COALESCE(sum(CASE v_key WHEN 'oil_kernel'   THEN r.food_grade_kernel_kg + r.crude_kernel_kg
                                       WHEN 'kernel_dust'  THEN r.kernel_dust_kg
                                       WHEN 'cracker_dust' THEN r.cracker_dust_kg END), 0),
               COALESCE(sum(r.food_grade_kernel_kg) FILTER (WHERE v_key = 'oil_kernel'), 0)
          INTO v_sh_in, v_sh_fg
          FROM public.oil_raw_receipts r
         WHERE r.voided_at IS NULL
           AND r.received_date > v_count
           AND r.received_date <= v_hist;

        v_in    := v_in + v_sh_in;
        v_fg_in := v_fg_in + v_sh_fg;
        v_on := v_cnt + v_in - v_used;
        v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'material',    v_key,
            'count_kg',    v_cnt,
            'received_kg', v_in,
            'received_sheet_kg', v_sh_in,
            'used_kg',     v_used,
            'on_hand_kg',  v_on,
            'daily_kg',    v_daily,
            'minimum_kg',  v_daily * 16,
            'days_cover',  CASE WHEN v_daily > 0 THEN round(v_on / v_daily, 1) END,
            'food_grade_kg', CASE WHEN v_key = 'oil_kernel'
                                  THEN COALESCE((v_m->>'count_food_grade_kg')::numeric, 0) + v_fg_in - v_fg_used END
        )));
    END LOOP;

    RETURN jsonb_build_object('success', true, 'count_date', v_count, 'history_through', v_hist,
                              'settings', v_set, 'materials', v_out);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_oil_supplier_recon(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_raw_stock() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
