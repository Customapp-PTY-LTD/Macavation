-- ============================================================================
-- Oil Raw Materials: stock on hand "as at" a chosen day (Mike, 16 Nov 2026)
-- ============================================================================
-- Mike wants to see how much of each raw material was on hand at the end of a past day (e.g. the
-- end of last week), and Simone now records the real day a bag went to production (the portal
-- stores it in intake_data.weight_before_production_recorded_at, which _oil_raw_flows already
-- uses). This adds an optional p_as_of to get_oil_raw_materials():
--   - NULL or a future day = today (same output as before).
--   - A day before the stock count date has no known position: available = false and the
--     on-hand figures come back null (never a faked 0).
--   - Daily use / stock level use the recipe in force on that day.
-- New keys: as_of, available. Everything else is unchanged.
--
-- The old no-argument version is RENAMED to get_oil_raw_materials_pre_20261116 (not dropped) so the
-- new one with a defaulted argument is the only match for get_oil_raw_materials(). Safe to drop the
-- renamed one later.
--
-- Down: DROP FUNCTION public.get_oil_raw_materials(date);
--       ALTER FUNCTION public.get_oil_raw_materials_pre_20261116() RENAME TO get_oil_raw_materials;
-- ============================================================================

DO $$
BEGIN
    IF to_regprocedure('public.get_oil_raw_materials()') IS NOT NULL THEN
        ALTER FUNCTION public.get_oil_raw_materials() RENAME TO get_oil_raw_materials_pre_20261116;
        REVOKE EXECUTE ON FUNCTION public.get_oil_raw_materials_pre_20261116() FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_oil_raw_materials(p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := public.report_sast_today();
    v_set   jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_count date := COALESCE((v_set->>'count_date')::date, DATE '2026-10-26');
    v_as_of date;
    v_pos   jsonb;
    v_daily jsonb;
    v_out   jsonb := '[]'::jsonb;
    v_key   text;
    v_on    numeric;
    v_d     numeric;
    v_wk    numeric;
    v_lvl   text;
BEGIN
    v_as_of := LEAST(COALESCE(p_as_of, v_today), v_today);
    v_pos   := public._oil_rm_position(v_as_of);   -- NULL before the count date
    v_daily := public._oil_rm_daily(v_as_of);

    FOREACH v_key IN ARRAY ARRAY['crude_kernel', 'food_grade_kernel', 'kernel_dust', 'cracker_dust', 'crush', 'cake'] LOOP
        v_on := (v_pos->v_key->>'on_hand_kg')::numeric;
        v_d  := COALESCE((v_daily->'daily'->>v_key)::numeric, 0);
        v_wk := CASE WHEN v_d > 0 AND v_on IS NOT NULL THEN round(v_on / (v_d * 4), 2) END;
        v_lvl := CASE WHEN v_wk IS NULL THEN NULL
                      WHEN v_wk < 1 THEN 'critical' WHEN v_wk < 2 THEN 'low'
                      WHEN v_wk < 4 THEN 'manageable' ELSE 'good' END;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'material', v_key,
            'count_kg', (v_pos->v_key->>'count_kg')::numeric,
            'received_kg', (v_pos->v_key->>'received_kg')::numeric,
            'used_kg', (v_pos->v_key->>'used_kg')::numeric,
            'on_hand_kg', v_on,
            'daily_kg', v_d,
            'week_kg', v_d * 4,
            'weeks', v_wk,
            'days', CASE WHEN v_d > 0 AND v_on IS NOT NULL THEN round(v_on / v_d, 1) END,
            'level', v_lvl));
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'today', v_today,
        'as_of', v_as_of,
        'available', v_pos IS NOT NULL,
        'count_date', v_count,
        'daily_source', v_daily->>'source',
        'recipe_date', v_daily->>'recipe_date',
        'recipe_today', EXISTS (SELECT 1 FROM public.oil_daily_recipes WHERE recipe_date = v_today),
        'settings', public._oil_rm_settings(),
        'materials', v_out);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_oil_raw_materials(date) TO anon, authenticated, service_role;
