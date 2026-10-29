-- ============================================================================
-- Oil plant: raw material stock on hand + oil cake production / sales log (Mike, 29 Oct 2026)
-- ============================================================================
-- 1. Settings, kept as one row in kernel_pipeline_settings (key 'oil_raw_stock'):
--      count_date   the day Mike's stock count was taken (it already includes that day's loads)
--      materials    per raw material: count_kg (counted on count_date) and daily_kg (budget use
--                   per working day). oil_kernel also keeps count_food_grade_kg; the rest of its
--                   count is crude grade. Food grade and crude are one pool for cover / minimum.
--      Minimum stock = daily_kg x 4 working days x 4 weeks (a month), as in Mike's sheet.
--    Seeded with Mike's count of 26 Oct 2026 from "Oil Pressing Plan YE27" (Setup - Settings).
--
-- 2. get_oil_raw_stock(): stock on hand per material =
--      count_kg
--      + bags received after count_date            (intake_data.date_received)
--      - bags released to Oil Production after it  (intake_data.weight_before_production_recorded_at,
--                                                   kg = weight_before_production_kg)
--    Only oil rows with product_type oil_kernel / kernel_dust / cracker_dust count.
--    Bags used without being released in the portal are NOT subtracted.
--
-- 3. oil_cake_movements: oil cake made in pressing and oil cake sold, recorded separately.
--    No stock-on-hand line for cake (Mike: "we produce it in our process").
--
-- Same model as the other kernel/oil pipeline functions: SECURITY DEFINER RPCs, tables closed to
-- anon/authenticated. The page falls back to built-in defaults (the same seed) until this is applied.
-- Down: DROP FUNCTION get_oil_raw_stock(), set_oil_raw_stock_settings(jsonb, uuid),
--       get_oil_cake_movements(date, date), save_oil_cake_movement(text, date, numeric, text, text, uuid),
--       void_oil_cake_movement(uuid, uuid); DROP TABLE oil_cake_movements;
--       DELETE FROM kernel_pipeline_settings WHERE key = 'oil_raw_stock';
-- ============================================================================

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('oil_raw_stock', jsonb_build_object(
    'count_date', '2026-10-26',
    'materials', jsonb_build_object(
        'oil_kernel',   jsonb_build_object('daily_kg', 2500,  'count_kg', 13350, 'count_food_grade_kg', 0),
        'kernel_dust',  jsonb_build_object('daily_kg', 3000,  'count_kg', 8636),
        'cracker_dust', jsonb_build_object('daily_kg', 10000, 'count_kg', 66059)
    )
))
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Stock on hand
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_oil_raw_stock()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_set   jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_count date  := COALESCE((v_set->>'count_date')::date, DATE '2026-10-26');
    v_out   jsonb := '[]'::jsonb;
    v_key   text;
    v_m     jsonb;
    v_daily numeric;
    v_cnt   numeric;
    v_in    numeric;
    v_used  numeric;
    v_fg_in numeric;
    v_fg_used numeric;
    v_on    numeric;
BEGIN
    FOREACH v_key IN ARRAY ARRAY['oil_kernel', 'kernel_dust', 'cracker_dust'] LOOP
        v_m     := COALESCE(v_set->'materials'->v_key, '{}'::jsonb);
        v_daily := COALESCE((v_m->>'daily_kg')::numeric, 0);
        v_cnt   := COALESCE((v_m->>'count_kg')::numeric, 0);

        SELECT COALESCE(sum(COALESCE((o.intake_data->>'quantity_kg')::numeric, 0))
                        FILTER (WHERE (o.intake_data->>'date_received')::date > v_count), 0),
               COALESCE(sum(COALESCE((o.intake_data->>'weight_before_production_kg')::numeric,
                                     (o.intake_data->>'quantity_kg')::numeric, 0))
                        FILTER (WHERE (((o.intake_data->>'weight_before_production_recorded_at')::timestamptz)
                                       AT TIME ZONE 'Africa/Johannesburg')::date > v_count), 0),
               COALESCE(sum(COALESCE((o.intake_data->>'quantity_kg')::numeric, 0))
                        FILTER (WHERE (o.intake_data->>'date_received')::date > v_count
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

        v_on := v_cnt + v_in - v_used;
        v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'material',    v_key,
            'count_kg',    v_cnt,
            'received_kg', v_in,
            'used_kg',     v_used,
            'on_hand_kg',  v_on,
            'daily_kg',    v_daily,
            'minimum_kg',  v_daily * 16,
            'days_cover',  CASE WHEN v_daily > 0 THEN round(v_on / v_daily, 1) END,
            'food_grade_kg', CASE WHEN v_key = 'oil_kernel'
                                  THEN COALESCE((v_m->>'count_food_grade_kg')::numeric, 0) + v_fg_in - v_fg_used END
        )));
    END LOOP;

    RETURN jsonb_build_object('success', true, 'count_date', v_count, 'settings', v_set, 'materials', v_out);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'A stored date or weight could not be read.');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_oil_raw_stock_settings(p_settings jsonb, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_cur jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'oil_raw_stock'), '{}'::jsonb);
    v_new jsonb := v_cur;
    v_key text;
    v_in  jsonb;
    v_m   jsonb;
    v_f   text;
    v_n   numeric;
BEGIN
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nothing to save.');
    END IF;
    IF p_settings ? 'count_date' THEN
        IF (p_settings->>'count_date')::date > (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
            RETURN jsonb_build_object('success', false, 'error', 'The count date can''t be in the future.');
        END IF;
        v_new := jsonb_set(v_new, '{count_date}', to_jsonb((p_settings->>'count_date')::date::text));
    END IF;
    IF jsonb_typeof(p_settings->'materials') = 'object' THEN
        FOREACH v_key IN ARRAY ARRAY['oil_kernel', 'kernel_dust', 'cracker_dust'] LOOP
            v_in := p_settings->'materials'->v_key;
            CONTINUE WHEN v_in IS NULL OR jsonb_typeof(v_in) <> 'object';
            v_m := COALESCE(v_new->'materials'->v_key, '{}'::jsonb);
            FOREACH v_f IN ARRAY ARRAY['daily_kg', 'count_kg', 'count_food_grade_kg'] LOOP
                CONTINUE WHEN NOT (v_in ? v_f);
                CONTINUE WHEN v_f = 'count_food_grade_kg' AND v_key <> 'oil_kernel';
                v_n := (v_in->>v_f)::numeric;
                IF v_n IS NULL OR v_n < 0 OR v_n > 10000000 THEN
                    RETURN jsonb_build_object('success', false, 'error', 'Weights must be between 0 and 10 000 000 kg.');
                END IF;
                v_m := jsonb_set(v_m, ARRAY[v_f], to_jsonb(v_n));
            END LOOP;
            v_new := jsonb_set(v_new, ARRAY['materials'], COALESCE(v_new->'materials', '{}'::jsonb) || jsonb_build_object(v_key, v_m));
        END LOOP;
    END IF;
    IF COALESCE((v_new->'materials'->'oil_kernel'->>'count_food_grade_kg')::numeric, 0)
       > COALESCE((v_new->'materials'->'oil_kernel'->>'count_kg')::numeric, 0) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Food grade can''t be more than the oil kernel count.');
    END IF;

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at, updated_by)
    VALUES ('oil_raw_stock', v_new, now(), p_actor_user_id)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
    RETURN jsonb_build_object('success', true, 'settings', v_new);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'Check the numbers and date you entered.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Oil cake: produced and sold
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.oil_cake_movements (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_date  date NOT NULL,
    kind           text NOT NULL CHECK (kind IN ('produced', 'sold')),
    kg             numeric(12, 2) NOT NULL CHECK (kg > 0),
    sold_to        text NULL,
    notes          text NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid NULL,
    voided_at      timestamptz NULL,
    voided_by      uuid NULL,
    CONSTRAINT oil_cake_sale_needs_buyer CHECK (kind <> 'sold' OR length(btrim(COALESCE(sold_to, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS idx_oil_cake_movements_date ON public.oil_cake_movements (movement_date DESC) WHERE voided_at IS NULL;

ALTER TABLE public.oil_cake_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oil_cake_movements FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_oil_cake_movements(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid date range is required.');
    END IF;
    IF p_date_to - p_date_from > 400 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Date range is limited to 400 days.');
    END IF;
    RETURN jsonb_build_object(
        'success', true,
        'produced_kg', COALESCE((SELECT sum(kg) FROM public.oil_cake_movements
                                 WHERE voided_at IS NULL AND kind = 'produced' AND movement_date BETWEEN p_date_from AND p_date_to), 0),
        'sold_kg',     COALESCE((SELECT sum(kg) FROM public.oil_cake_movements
                                 WHERE voided_at IS NULL AND kind = 'sold' AND movement_date BETWEEN p_date_from AND p_date_to), 0),
        'movements', COALESCE((
            SELECT jsonb_agg(to_jsonb(x) ORDER BY x.movement_date DESC, x.created_at DESC)
            FROM (SELECT id, movement_date, kind, kg, sold_to, notes, created_at
                  FROM public.oil_cake_movements
                  WHERE voided_at IS NULL AND movement_date BETWEEN p_date_from AND p_date_to
                  ORDER BY movement_date DESC, created_at DESC
                  LIMIT 500) x), '[]'::jsonb)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_oil_cake_movement(
    p_kind text, p_movement_date date, p_kg numeric, p_sold_to text DEFAULT NULL,
    p_notes text DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_kind IS NULL OR p_kind NOT IN ('produced', 'sold') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose production or sale.');
    END IF;
    IF p_movement_date IS NULL OR p_movement_date > (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a date that is not in the future.');
    END IF;
    IF p_kg IS NULL OR p_kg <= 0 OR p_kg > 1000000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the weight in kg.');
    END IF;
    IF p_kind = 'sold' AND length(btrim(COALESCE(p_sold_to, ''))) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter who the oil cake was sold to.');
    END IF;
    INSERT INTO public.oil_cake_movements (movement_date, kind, kg, sold_to, notes, created_by)
    VALUES (p_movement_date, p_kind, round(p_kg, 2),
            CASE WHEN p_kind = 'sold' THEN left(btrim(p_sold_to), 200) END,
            NULLIF(left(btrim(COALESCE(p_notes, '')), 500), ''), p_actor_user_id)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_oil_cake_movement(p_id uuid, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.oil_cake_movements SET voided_at = now(), voided_by = p_actor_user_id
     WHERE id = p_id AND voided_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That entry was not found.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_oil_raw_stock() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_oil_raw_stock_settings(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_cake_movements(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_oil_cake_movement(text, date, numeric, text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_oil_cake_movement(uuid, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
