-- ============================================================================
-- Oil plant: Raw Materials module (Mike's "Oil Changes" email 11 Nov 2026, answers 12 Nov 2026)
-- ============================================================================
-- Six raw materials, one stock bar each:
--   crude_kernel       oil rows product_type oil_kernel, grade not food_grade (incl. ungraded)
--   food_grade_kernel  oil rows product_type oil_kernel, grade food_grade
--   kernel_dust, cracker_dust, crush, cake   oil rows with that product_type
-- Position on a day = the stock count (kernel_pipeline_settings 'oil_raw_stock', unchanged shape;
-- crush and cake counts are added to it) + received - released to production, using the existing
-- _oil_raw_flows() so reports and this page agree.
--
-- 1. oil_raw_counts      month-end physical counts, with what the portal expected (history).
--                        Saving one also moves 'oil_raw_stock' count_date/count_kg to it, so the
--                        count is the new starting point (same effect as the old settings save).
-- 2. oil_daily_recipes   one row per day: kg per material, in the unit set at the time
--                        (per day, or per bin x bins per day). "Recipe unchanged" copies the last one.
--                        Daily use for a day = the latest recipe on or before it; before the first
--                        recipe, the old 'oil_raw_stock' daily_kg (oil kernel's goes to crude).
-- 3. 'oil_raw_materials' settings: recipe_unit per_day|per_bin, bins_per_day, count_reminder_days.
-- 4. Stock level: weeks of stock = on hand / (daily use x 4 working days).
--    < 1 Critical, < 2 Low, < 4 Manageable, else Good. No daily use = no level.
-- 5. Tasks (My Day + bell), switches task-oil-daily-recipe and task-oil-stock-count, on by default
--    for Quality Assurance (Simone). Josh is not a user yet: switch his role on in Role Features.
--      oil_daily_recipe  each Mon-Fri with no recipe yet; older ones close.
--      oil_stock_count   from N working days before the last working day of the month (default 3)
--                        until a count dated in that window is saved; closes 7 days into the next month.
--    Daily at 06:00 SAST (cron 'oil-raw-task-checks') and after each save.
-- 6. suggest_oil_batch_number(): the latest oil raw batch number + 1 (trailing digits, same width),
--    skipping numbers already used; 'OIL-0001' when there is none.
-- 7. Feature 'oil-raw-materials' (new sidebar item), same roles as supplier-intake-grid.
--
-- SECURITY DEFINER RPCs, tables closed to anon/authenticated, like the rest of the oil pipeline.
-- Down: SELECT cron.unschedule('oil-raw-task-checks'); DROP FUNCTION get_oil_raw_materials(),
--   get_oil_raw_weekly(integer, text), save_oil_raw_count(date, jsonb, text, uuid),
--   save_oil_daily_recipe(date, jsonb, boolean, uuid), get_oil_daily_recipes(integer),
--   set_oil_raw_materials_settings(jsonb, uuid), suggest_oil_batch_number(),
--   run_oil_raw_task_checks(), _oil_rm_position(date), _oil_rm_daily(date), _oil_rm_settings();
--   DROP TABLE oil_raw_counts, oil_daily_recipes; DELETE FROM kernel_pipeline_settings WHERE
--   key = 'oil_raw_materials'; DELETE FROM features WHERE key IN ('oil-raw-materials',
--   'task-oil-daily-recipe', 'task-oil-stock-count').
-- ============================================================================

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('oil_raw_materials', jsonb_build_object('recipe_unit', 'per_day', 'bins_per_day', NULL, 'count_reminder_days', 3))
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.oil_raw_counts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    count_date  date NOT NULL,
    counted     jsonb NOT NULL,
    expected    jsonb NULL,
    notes       text NULL,
    counted_by  uuid NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oil_raw_counts_date ON public.oil_raw_counts (count_date DESC, created_at DESC);
ALTER TABLE public.oil_raw_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oil_raw_counts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.oil_daily_recipes (
    recipe_date   date PRIMARY KEY,
    materials     jsonb NOT NULL,
    unit          text NOT NULL CHECK (unit IN ('per_day', 'per_bin')),
    bins_per_day  numeric(8, 2) NULL CHECK (bins_per_day IS NULL OR bins_per_day > 0),
    unchanged     boolean NOT NULL DEFAULT false,
    entered_by    uuid NULL,
    entered_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oil_daily_recipes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oil_daily_recipes FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._oil_rm_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('recipe_unit', 'per_day', 'bins_per_day', NULL, 'count_reminder_days', 3)
           || COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_materials'), '{}'::jsonb);
$$;

-- Position at the end of p_date for the six materials: {key: {count_kg, received_kg, used_kg, on_hand_kg}}.
-- NULL when p_date is before the stock count date (no known position).
CREATE OR REPLACE FUNCTION public._oil_rm_position(p_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_set   jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_count date  := COALESCE((v_set->>'count_date')::date, DATE '2026-10-26');
    v_m     jsonb := COALESCE(v_set->'materials', '{}'::jsonb);
    v_out   jsonb := '{}'::jsonb;
    v_fl    jsonb;
    v_key   text;
    v_cnt   numeric;
    v_fg    numeric;
BEGIN
    IF p_date IS NULL OR p_date < v_count THEN
        RETURN NULL;
    END IF;

    v_fl  := public._oil_raw_flows(v_count + 1, p_date, 'oil_kernel');
    v_cnt := COALESCE((v_m->'oil_kernel'->>'count_kg')::numeric, 0);
    v_fg  := COALESCE((v_m->'oil_kernel'->>'count_food_grade_kg')::numeric, 0);
    v_out := v_out || jsonb_build_object(
        'crude_kernel', jsonb_build_object(
            'count_kg', v_cnt - v_fg,
            'received_kg', (v_fl->>'received_kg')::numeric - (v_fl->>'fg_in_kg')::numeric,
            'used_kg', (v_fl->>'used_kg')::numeric - (v_fl->>'fg_used_kg')::numeric,
            'on_hand_kg', (v_cnt - v_fg) + (v_fl->>'received_kg')::numeric - (v_fl->>'fg_in_kg')::numeric
                          - ((v_fl->>'used_kg')::numeric - (v_fl->>'fg_used_kg')::numeric)),
        'food_grade_kernel', jsonb_build_object(
            'count_kg', v_fg,
            'received_kg', (v_fl->>'fg_in_kg')::numeric,
            'used_kg', (v_fl->>'fg_used_kg')::numeric,
            'on_hand_kg', v_fg + (v_fl->>'fg_in_kg')::numeric - (v_fl->>'fg_used_kg')::numeric));

    FOREACH v_key IN ARRAY ARRAY['kernel_dust', 'cracker_dust', 'crush', 'cake'] LOOP
        v_fl  := public._oil_raw_flows(v_count + 1, p_date, v_key);
        v_cnt := COALESCE((v_m->v_key->>'count_kg')::numeric, 0);
        v_out := v_out || jsonb_build_object(v_key, jsonb_build_object(
            'count_kg', v_cnt,
            'received_kg', (v_fl->>'received_kg')::numeric,
            'used_kg', (v_fl->>'used_kg')::numeric,
            'on_hand_kg', v_cnt + (v_fl->>'received_kg')::numeric - (v_fl->>'used_kg')::numeric));
    END LOOP;
    RETURN v_out;
END;
$$;

-- Daily use (kg per working day) per material on p_date, plus where it came from.
CREATE OR REPLACE FUNCTION public._oil_rm_daily(p_date date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r       public.oil_daily_recipes%ROWTYPE;
    v_mult  numeric;
    v_out   jsonb := '{}'::jsonb;
    v_key   text;
    v_old   jsonb;
BEGIN
    SELECT * INTO r FROM public.oil_daily_recipes WHERE recipe_date <= p_date ORDER BY recipe_date DESC LIMIT 1;
    IF FOUND THEN
        v_mult := CASE WHEN r.unit = 'per_bin' THEN COALESCE(r.bins_per_day, 0) ELSE 1 END;
        FOREACH v_key IN ARRAY ARRAY['crude_kernel', 'food_grade_kernel', 'kernel_dust', 'cracker_dust', 'crush', 'cake'] LOOP
            v_out := v_out || jsonb_build_object(v_key, round(COALESCE((r.materials->>v_key)::numeric, 0) * v_mult, 2));
        END LOOP;
        RETURN jsonb_build_object('source', 'recipe', 'recipe_date', r.recipe_date, 'daily', v_out);
    END IF;
    v_old := COALESCE((SELECT value->'materials' FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    RETURN jsonb_build_object('source', 'settings', 'recipe_date', NULL, 'daily', jsonb_build_object(
        'crude_kernel',      COALESCE((v_old->'oil_kernel'->>'daily_kg')::numeric, 0),
        'food_grade_kernel', 0,
        'kernel_dust',       COALESCE((v_old->'kernel_dust'->>'daily_kg')::numeric, 0),
        'cracker_dust',      COALESCE((v_old->'cracker_dust'->>'daily_kg')::numeric, 0),
        'crush',             0,
        'cake',              0));
END;
$$;

-- ---------------------------------------------------------------------------
-- Stock levels (the Raw Materials page)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_oil_raw_materials()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := public.report_sast_today();
    v_set   jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_pos   jsonb := public._oil_rm_position(public.report_sast_today());
    v_daily jsonb := public._oil_rm_daily(public.report_sast_today());
    v_out   jsonb := '[]'::jsonb;
    v_key   text;
    v_on    numeric;
    v_d     numeric;
    v_wk    numeric;
    v_lvl   text;
BEGIN
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
        'count_date', COALESCE((v_set->>'count_date')::date, DATE '2026-10-26'),
        'daily_source', v_daily->>'source',
        'recipe_date', v_daily->>'recipe_date',
        'recipe_today', EXISTS (SELECT 1 FROM public.oil_daily_recipes WHERE recipe_date = v_today),
        'settings', public._oil_rm_settings(),
        'materials', v_out);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Weekly overview: Monday-Sunday weeks, newest first, for one material or all.
-- Weeks that start before the stock count date begin at the count instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_oil_raw_weekly(p_weeks integer DEFAULT 8, p_material text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := public.report_sast_today();
    v_count date := COALESCE((SELECT (value->>'count_date')::date FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), DATE '2026-10-26');
    v_mon   date := v_today - (extract(isodow FROM v_today)::int - 1);
    v_keys  text[] := ARRAY['crude_kernel', 'food_grade_kernel', 'kernel_dust', 'cracker_dust', 'crush', 'cake'];
    v_weeks jsonb := '[]'::jsonb;
    v_i     integer;
    v_ws    date;
    v_we    date;
    v_from  date;
    v_open  jsonb;
    v_close jsonb;
    v_daily jsonb;
    v_row   jsonb;
    v_key   text;
    v_o     numeric;
    v_c     numeric;
    v_d     numeric;
    v_wk    numeric;
BEGIN
    IF p_material IS NOT NULL AND NOT (p_material = ANY (v_keys)) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown material.');
    END IF;
    IF p_material IS NOT NULL THEN v_keys := ARRAY[p_material]; END IF;

    FOR v_i IN 0 .. LEAST(GREATEST(COALESCE(p_weeks, 8), 1), 26) - 1 LOOP
        v_ws := v_mon - 7 * v_i;
        v_we := LEAST(v_ws + 6, v_today);
        EXIT WHEN v_we < v_count;
        v_from  := GREATEST(v_ws, v_count + 1);
        v_open  := public._oil_rm_position(v_from - 1);
        v_close := public._oil_rm_position(v_we);
        v_daily := public._oil_rm_daily(v_we);
        v_row := '{}'::jsonb;
        FOREACH v_key IN ARRAY v_keys LOOP
            v_o  := (v_open->v_key->>'on_hand_kg')::numeric;
            v_c  := (v_close->v_key->>'on_hand_kg')::numeric;
            v_d  := COALESCE((v_daily->'daily'->>v_key)::numeric, 0);
            v_wk := CASE WHEN v_d > 0 THEN round(v_c / (v_d * 4), 2) END;
            v_row := v_row || jsonb_build_object(v_key, jsonb_build_object(
                'start_kg', v_o,
                'received_kg', (v_close->v_key->>'received_kg')::numeric - (v_open->v_key->>'received_kg')::numeric,
                'used_kg', (v_close->v_key->>'used_kg')::numeric - (v_open->v_key->>'used_kg')::numeric,
                'end_kg', v_c,
                'daily_kg', v_d,
                'weeks', v_wk,
                'level', CASE WHEN v_wk IS NULL THEN NULL WHEN v_wk < 1 THEN 'critical' WHEN v_wk < 2 THEN 'low'
                              WHEN v_wk < 4 THEN 'manageable' ELSE 'good' END));
        END LOOP;
        v_weeks := v_weeks || jsonb_build_array(jsonb_build_object(
            'week_start', v_ws, 'week_end', v_ws + 6, 'to_date', v_we,
            'from_count', v_from > v_ws, 'materials', v_row));
    END LOOP;

    RETURN jsonb_build_object('success', true, 'count_date', v_count, 'weeks', v_weeks,
        'counts', COALESCE((SELECT jsonb_agg(jsonb_build_object('count_date', c.count_date, 'counted', c.counted,
                                    'expected', c.expected, 'notes', c.notes, 'created_at', c.created_at,
                                    'counted_by_name', NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''))
                                    ORDER BY c.count_date DESC, c.created_at DESC)
                            FROM (SELECT * FROM public.oil_raw_counts ORDER BY count_date DESC, created_at DESC LIMIT 24) c
                            LEFT JOIN public.users u ON u.id = c.counted_by), '[]'::jsonb));
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Month-end count
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_oil_raw_count(p_count_date date, p_counted jsonb, p_notes text DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_set    jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_prev   date  := COALESCE((v_set->>'count_date')::date, DATE '2026-10-26');
    v_keys   text[] := ARRAY['crude_kernel', 'food_grade_kernel', 'kernel_dust', 'cracker_dust', 'crush', 'cake'];
    v_clean  jsonb := '{}'::jsonb;
    v_exp    jsonb := '{}'::jsonb;
    v_pos    jsonb;
    v_key    text;
    v_n      numeric;
    v_m      jsonb;
    v_id     uuid;
BEGIN
    IF p_count_date IS NULL OR p_count_date > public.report_sast_today() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a count date that is not in the future.');
    END IF;
    IF p_count_date < v_prev THEN
        RETURN jsonb_build_object('success', false, 'error', 'The count date can''t be before the last count (' || to_char(v_prev, 'DD Mon YYYY') || ').');
    END IF;
    IF p_counted IS NULL OR jsonb_typeof(p_counted) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the counted weight for every material.');
    END IF;
    FOREACH v_key IN ARRAY v_keys LOOP
        IF NOT (p_counted ? v_key) OR jsonb_typeof(p_counted->v_key) <> 'number' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Enter the counted weight for every material (0 if there is none).');
        END IF;
        v_n := (p_counted->>v_key)::numeric;
        IF v_n < 0 OR v_n > 10000000 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Weights must be between 0 and 10 000 000 kg.');
        END IF;
        v_clean := v_clean || jsonb_build_object(v_key, round(v_n, 2));
    END LOOP;

    -- What the portal expected on the count date, before the count becomes the new starting point.
    v_pos := public._oil_rm_position(p_count_date);
    FOREACH v_key IN ARRAY v_keys LOOP
        v_exp := v_exp || jsonb_build_object(v_key, round((v_pos->v_key->>'on_hand_kg')::numeric, 2));
    END LOOP;

    INSERT INTO public.oil_raw_counts (count_date, counted, expected, notes, counted_by)
    VALUES (p_count_date, v_clean, v_exp, NULLIF(left(btrim(COALESCE(p_notes, '')), 500), ''), p_actor_user_id)
    RETURNING id INTO v_id;

    v_m := COALESCE(v_set->'materials', '{}'::jsonb);
    v_m := v_m || jsonb_build_object(
        'oil_kernel',   COALESCE(v_m->'oil_kernel', '{}'::jsonb) || jsonb_build_object(
                            'count_kg', (v_clean->>'crude_kernel')::numeric + (v_clean->>'food_grade_kernel')::numeric,
                            'count_food_grade_kg', (v_clean->>'food_grade_kernel')::numeric),
        'kernel_dust',  COALESCE(v_m->'kernel_dust', '{}'::jsonb)  || jsonb_build_object('count_kg', (v_clean->>'kernel_dust')::numeric),
        'cracker_dust', COALESCE(v_m->'cracker_dust', '{}'::jsonb) || jsonb_build_object('count_kg', (v_clean->>'cracker_dust')::numeric),
        'crush',        COALESCE(v_m->'crush', '{}'::jsonb)        || jsonb_build_object('count_kg', (v_clean->>'crush')::numeric),
        'cake',         COALESCE(v_m->'cake', '{}'::jsonb)         || jsonb_build_object('count_kg', (v_clean->>'cake')::numeric));
    v_set := v_set || jsonb_build_object('count_date', p_count_date::text, 'materials', v_m);

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at, updated_by)
    VALUES ('oil_raw_stock', v_set, now(), p_actor_user_id)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;

    PERFORM public.run_oil_raw_task_checks();
    RETURN jsonb_build_object('success', true, 'id', v_id, 'expected', v_exp, 'counted', v_clean);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'Check the numbers and date you entered.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Daily recipe
-- ---------------------------------------------------------------------------
-- p_unchanged = true copies the latest earlier recipe (an error if there is none).
CREATE OR REPLACE FUNCTION public.save_oil_daily_recipe(p_date date, p_materials jsonb, p_unchanged boolean DEFAULT false, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_s     jsonb := public._oil_rm_settings();
    v_unit  text;
    v_bins  numeric;
    v_mat   jsonb := '{}'::jsonb;
    v_key   text;
    v_n     numeric;
    prev    public.oil_daily_recipes%ROWTYPE;
BEGIN
    IF p_date IS NULL OR p_date > public.report_sast_today() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a date that is not in the future.');
    END IF;
    IF COALESCE(p_unchanged, false) THEN
        SELECT * INTO prev FROM public.oil_daily_recipes WHERE recipe_date < p_date ORDER BY recipe_date DESC LIMIT 1;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'There is no earlier recipe yet. Enter today''s recipe.');
        END IF;
        v_mat := prev.materials; v_unit := prev.unit; v_bins := prev.bins_per_day;
    ELSE
        IF p_materials IS NULL OR jsonb_typeof(p_materials) <> 'object' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Enter the recipe.');
        END IF;
        FOREACH v_key IN ARRAY ARRAY['crude_kernel', 'food_grade_kernel', 'kernel_dust', 'cracker_dust', 'crush', 'cake'] LOOP
            v_n := CASE WHEN jsonb_typeof(p_materials->v_key) = 'number' THEN (p_materials->>v_key)::numeric ELSE 0 END;
            IF v_n < 0 OR v_n > 1000000 THEN
                RETURN jsonb_build_object('success', false, 'error', 'Recipe weights must be between 0 and 1 000 000 kg.');
            END IF;
            v_mat := v_mat || jsonb_build_object(v_key, round(v_n, 2));
        END LOOP;
        v_unit := CASE WHEN v_s->>'recipe_unit' = 'per_bin' THEN 'per_bin' ELSE 'per_day' END;
        v_bins := CASE WHEN v_unit = 'per_bin' THEN (v_s->>'bins_per_day')::numeric END;
        IF v_unit = 'per_bin' AND (v_bins IS NULL OR v_bins <= 0) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Set the number of bins a day in the recipe settings first.');
        END IF;
    END IF;

    INSERT INTO public.oil_daily_recipes (recipe_date, materials, unit, bins_per_day, unchanged, entered_by, entered_at)
    VALUES (p_date, v_mat, v_unit, v_bins, COALESCE(p_unchanged, false), p_actor_user_id, now())
    ON CONFLICT (recipe_date) DO UPDATE SET materials = EXCLUDED.materials, unit = EXCLUDED.unit,
        bins_per_day = EXCLUDED.bins_per_day, unchanged = EXCLUDED.unchanged,
        entered_by = EXCLUDED.entered_by, entered_at = now();

    PERFORM public._close_tasks('oil_daily_recipe', 'oil_daily_recipe:' || p_date::text);
    RETURN jsonb_build_object('success', true, 'recipe_date', p_date, 'materials', v_mat, 'unit', v_unit, 'bins_per_day', v_bins);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'Check the numbers you entered.');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_oil_daily_recipes(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := public.report_sast_today();
BEGIN
    RETURN jsonb_build_object('success', true, 'today', v_today, 'settings', public._oil_rm_settings(),
        'latest', (SELECT to_jsonb(x) FROM (SELECT recipe_date, materials, unit, bins_per_day, unchanged
                                              FROM public.oil_daily_recipes ORDER BY recipe_date DESC LIMIT 1) x),
        'daily_now', public._oil_rm_daily(v_today),
        'recipes', COALESCE((SELECT jsonb_agg(jsonb_build_object('recipe_date', r.recipe_date, 'materials', r.materials,
                                  'unit', r.unit, 'bins_per_day', r.bins_per_day, 'unchanged', r.unchanged, 'entered_at', r.entered_at,
                                  'entered_by_name', NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''))
                                  ORDER BY r.recipe_date DESC)
                             FROM public.oil_daily_recipes r LEFT JOIN public.users u ON u.id = r.entered_by
                             WHERE r.recipe_date > v_today - LEAST(GREATEST(COALESCE(p_days, 30), 1), 366)), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_oil_raw_materials_settings(p_settings jsonb, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_new  jsonb := public._oil_rm_settings();
    v_n    numeric;
BEGIN
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nothing to save.');
    END IF;
    IF p_settings ? 'recipe_unit' THEN
        IF p_settings->>'recipe_unit' NOT IN ('per_day', 'per_bin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Choose per day or per bin.');
        END IF;
        v_new := v_new || jsonb_build_object('recipe_unit', p_settings->>'recipe_unit');
    END IF;
    IF p_settings ? 'bins_per_day' THEN
        IF jsonb_typeof(p_settings->'bins_per_day') = 'null' THEN
            v_new := v_new || jsonb_build_object('bins_per_day', NULL);
        ELSE
            v_n := (p_settings->>'bins_per_day')::numeric;
            IF v_n IS NULL OR v_n <= 0 OR v_n > 1000 THEN
                RETURN jsonb_build_object('success', false, 'error', 'Bins a day must be more than 0.');
            END IF;
            v_new := v_new || jsonb_build_object('bins_per_day', round(v_n, 2));
        END IF;
    END IF;
    IF p_settings ? 'count_reminder_days' THEN
        v_n := (p_settings->>'count_reminder_days')::numeric;
        IF v_n IS NULL OR v_n < 0 OR v_n > 15 OR v_n <> trunc(v_n) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Reminder days must be a whole number from 0 to 15.');
        END IF;
        v_new := v_new || jsonb_build_object('count_reminder_days', v_n::int);
    END IF;
    IF v_new->>'recipe_unit' = 'per_bin' AND COALESCE((v_new->>'bins_per_day')::numeric, 0) <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter how many bins a day when the recipe is per bin.');
    END IF;

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at, updated_by)
    VALUES ('oil_raw_materials', v_new, now(), p_actor_user_id)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
    PERFORM public.run_oil_raw_task_checks();
    RETURN jsonb_build_object('success', true, 'settings', v_new);
EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Check the numbers you entered.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Suggested batch number for the next oil raw bag
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suggest_oil_batch_number()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_last   text;
    v_prefix text;
    v_digits text;
    v_n      bigint;
    v_try    text;
    v_i      integer := 0;
BEGIN
    SELECT o.batch_id INTO v_last
      FROM public.oil o
     WHERE COALESCE(o.is_active, true) AND o.intake_data ? 'product_type' AND o.batch_id ~ '\d+$'
     ORDER BY o.created_at DESC
     LIMIT 1;
    IF v_last IS NULL THEN
        v_prefix := 'OIL-'; v_digits := '0000';
    ELSE
        v_digits := substring(v_last FROM '(\d+)$');
        v_prefix := left(v_last, length(v_last) - length(v_digits));
    END IF;
    v_n := v_digits::bigint;
    LOOP
        v_n := v_n + 1; v_i := v_i + 1;
        v_try := v_prefix || lpad(v_n::text, length(v_digits), '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.oil WHERE batch_id = v_try) OR v_i > 1000;
    END LOOP;
    RETURN v_try;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_oil_raw_task_checks()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today   date := public.report_sast_today();
    v_s       jsonb := public._oil_rm_settings();
    v_n       integer := COALESCE((v_s->>'count_reminder_days')::int, 3);
    v_last    date;
    v_start   date;
    v_month   date;
    v_k       integer;
    v_due     boolean;
BEGIN
    -- Daily recipe: Monday to Friday, until it is entered. Earlier days' tasks close.
    UPDATE public.workflow_tasks SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE kind = 'oil_daily_recipe' AND dedupe_key <> 'oil_daily_recipe:' || v_today::text
       AND status NOT IN ('completed', 'dismissed');
    IF extract(isodow FROM v_today) <= 5
       AND NOT EXISTS (SELECT 1 FROM public.oil_daily_recipes WHERE recipe_date = v_today) THEN
        PERFORM public._open_task('oil_daily_recipe', 'oil_daily_recipe:' || v_today::text,
            'Enter today''s oil recipe (' || to_char(v_today, 'Dy DD Mon') || ')',
            'Enter the recipe on Raw Materials, or press "Recipe unchanged" if it is the same as the last one. It sets the daily use behind the stock levels.');
    END IF;

    -- Month-end count: this month's window, or last month's if we are early in a new month.
    FOR v_k IN 0 .. 1 LOOP
        v_month := date_trunc('month', v_today)::date - (v_k * interval '1 month')::interval;
        v_month := date_trunc('month', v_month)::date;
        v_last  := (v_month + interval '1 month' - interval '1 day')::date;
        WHILE extract(isodow FROM v_last) > 5 LOOP v_last := v_last - 1; END LOOP;
        v_start := v_last;
        FOR v_i IN 1 .. v_n LOOP
            v_start := v_start - 1;
            WHILE extract(isodow FROM v_start) > 5 LOOP v_start := v_start - 1; END LOOP;
        END LOOP;
        v_due := v_today >= v_start AND v_today <= (v_month + interval '1 month')::date + 6
                 AND NOT EXISTS (SELECT 1 FROM public.oil_raw_counts c WHERE c.count_date >= v_start - 3);
        IF v_due THEN
            PERFORM public._open_task('oil_stock_count', 'oil_stock_count:' || to_char(v_month, 'YYYY-MM'),
                'Month-end raw material count for ' || to_char(v_month, 'FMMonth YYYY'),
                'Count every oil raw material (crude and food grade kernel, kernel dust, cracker dust, crush, oil cake) and save it on Raw Materials, Month-end count. Last working day: ' || to_char(v_last, 'Dy DD Mon') || '.');
        ELSE
            PERFORM public._close_tasks('oil_stock_count', 'oil_stock_count:' || to_char(v_month, 'YYYY-MM'));
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'ran_on', v_today);
END;
$$;

-- ---------------------------------------------------------------------------
-- Features: the new sidebar item and the two task switches
-- ---------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active) VALUES
    ('oil-raw-materials', 'Oil Raw Materials',
     'Oil raw material stock levels, bags in stock, weekly overview, month-end count, daily recipe and supplier recon.', true),
    ('task-oil-daily-recipe', 'Tasks: oil daily recipe',
     'Gets a task each working day to enter the oil recipe, or confirm it is unchanged.', true),
    ('task-oil-stock-count', 'Tasks: oil month-end count',
     'Gets a task near month end to count the oil raw materials.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

-- Same roles that see Supplier Intake today see Raw Materials.
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT rf.role_id, nf.id, 'true'
FROM public.role_features rf
JOIN public.features sf ON sf.id = rf.feature_id AND sf.key = 'supplier-intake-grid'
CROSS JOIN (SELECT id FROM public.features WHERE key = 'oil-raw-materials') nf
WHERE rf.value = 'true'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

-- Simone (Quality Assurance) gets both tasks. Josh: switch his role on in Role Features.
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
JOIN public.features f ON f.key IN ('task-oil-daily-recipe', 'task-oil-stock-count')
WHERE r.role_name = 'Quality Assurance'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

UPDATE public.features SET name = 'Oil Receiving', updated_at = now() WHERE key = 'supplier-intake-grid';

REVOKE EXECUTE ON FUNCTION public._oil_rm_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._oil_rm_position(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._oil_rm_daily(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_oil_raw_task_checks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_oil_raw_materials() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_raw_weekly(integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_oil_raw_count(date, jsonb, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_oil_daily_recipe(date, jsonb, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_daily_recipes(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_oil_raw_materials_settings(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suggest_oil_batch_number() TO anon, authenticated, service_role;

-- Daily at 06:00 SAST (04:00 UTC), and once now.
SELECT cron.schedule('oil-raw-task-checks', '0 4 * * *', 'SELECT public.run_oil_raw_task_checks()');
SELECT public.run_oil_raw_task_checks();

NOTIFY pgrst, 'reload schema';
