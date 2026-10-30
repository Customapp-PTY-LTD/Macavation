-- =============================================================================
-- Procurement plan (Mike's "Procurement Plan YE27" sheet as a screen, 26 Oct 2026).
--
-- Builds on kernel_intake_procurement (20260601090000): a planned truck is still one
-- row there. This adds: truck label, storage area, confirmed flag, note, audit; a
-- per-day calendar of day types (work / half / off / no cracking / shutdown /
-- holiday) with an optional kg override; and plan settings (planned kg per day and
-- the opening stock the forecast starts from) under kernel_pipeline_settings key
-- 'procurement_plan'. The week/day/month forecast itself is computed in the browser
-- from get_procurement_plan's payload, so changing a day or a truck redraws instantly.
--
-- Defaults with no day row: Mon-Fri = cracking day, Sat/Sun = off.
-- Depends on 20261028090000_nis_storage_areas.sql (storage_area_code FK, intake trigger).
-- Down: remove the RPCs + trigger, the procurement_day_types table and the new columns.
-- =============================================================================

ALTER TABLE public.kernel_intake_procurement
    ADD COLUMN IF NOT EXISTS truck_label       text,
    ADD COLUMN IF NOT EXISTS storage_area_code text REFERENCES public.nis_storage_areas(code) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_confirmed      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS note              text,
    ADD COLUMN IF NOT EXISTS created_by        uuid,
    ADD COLUMN IF NOT EXISTS updated_by        uuid;

CREATE INDEX IF NOT EXISTS idx_kip_batch_id ON public.kernel_intake_procurement(batch_id);

CREATE TABLE IF NOT EXISTS public.procurement_day_types (
    day          date PRIMARY KEY,
    -- 'default' = back to the normal rule (Mon-Fri cracking, weekend off); kept as a row
    -- so clearing a day never needs a DELETE.
    day_type     text NOT NULL CHECK (day_type IN ('default', 'work', 'half', 'off', 'nocrack', 'shutdown', 'holiday')),
    kg_override  numeric(12,2) CHECK (kg_override IS NULL OR kg_override >= 0),
    note         text,
    updated_by   uuid,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.procurement_day_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.procurement_day_types FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read: everything the Procurement plan screen needs in one call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_procurement_plan(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today     date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    v_from      date;
    v_to        date;
    v_settings  jsonb;
    v_fc        jsonb := '{}'::jsonb;
    v_pool      numeric;
    v_actual    numeric;
    v_actual_n  integer;
    v_deliv     jsonb;
    v_days      jsonb;
    v_growers   jsonb;
    v_areas     jsonb;
BEGIN
    v_from := COALESCE(p_from, v_today - 90);
    v_to   := COALESCE(p_to, v_today + 450);
    IF v_to < v_from OR v_to - v_from > 900 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a date range of up to 900 days.');
    END IF;

    v_settings := jsonb_build_object('planned_kg_per_day', 5000, 'opening_mode', 'system')
                  || COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'procurement_plan'), '{}'::jsonb);

    BEGIN
        v_fc := public.get_nis_runway_forecast(60, NULL, NULL, 1, false);
    EXCEPTION WHEN OTHERS THEN
        v_fc := '{}'::jsonb;
    END;
    v_pool := (v_fc->'meta'->>'pool_kg')::numeric;

    -- Real cracking average: the last 30 days that actually recorded cracking.
    SELECT AVG(c), COUNT(*) INTO v_actual, v_actual_n
    FROM (
        SELECT (p->>'cracked_kg')::numeric AS c
        FROM jsonb_array_elements(COALESCE(v_fc->'points', '[]'::jsonb)) p
        WHERE COALESCE((p->>'is_forecast')::boolean, false) = false
          AND COALESCE((p->>'cracked_kg')::numeric, 0) > 0
        ORDER BY (p->>'d')::date DESC
        LIMIT 30
    ) x;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', p.id,
               'scheduled_date', p.scheduled_date,
               'supplier_id', p.supplier_id,
               'grower_name', p.grower_name,
               'grower', COALESCE(NULLIF(trim(p.grower_name), ''), c.company_name, c.trading_name, 'Grower'),
               'truck_label', p.truck_label,
               'predicted_weight_kg', p.predicted_weight_kg,
               'status', CASE WHEN p.status = 'converted' THEN 'received'
                              WHEN p.is_confirmed THEN 'confirmed' ELSE 'planned' END,
               'storage_area_code', p.storage_area_code,
               'note', p.note,
               'batch_number', b.batch_id,
               'received_kg', COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg),
               'received_date', k.received_date,
               'sort_index', p.sort_index
           ) ORDER BY p.scheduled_date, p.sort_index NULLS LAST, p.created_at), '[]'::jsonb)
    INTO v_deliv
    FROM public.kernel_intake_procurement p
    LEFT JOIN public.contacts c ON c.id = p.supplier_id
    LEFT JOIN public.batches  b ON b.id = p.batch_id
    LEFT JOIN public.kernel   k ON k.batch_id = p.batch_id
    WHERE p.status <> 'cancelled'
      AND p.scheduled_date BETWEEN v_from AND v_to;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d.day, 'day_type', d.day_type,
               'kg_override', d.kg_override, 'note', d.note) ORDER BY d.day), '[]'::jsonb)
    INTO v_days
    FROM public.procurement_day_types d
    WHERE d.day BETWEEN v_from AND v_to
      AND d.day_type <> 'default';

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.name), '[]'::jsonb)
    INTO v_growers
    FROM (
        SELECT c.id, COALESCE(NULLIF(trim(c.company_name), ''), c.trading_name, c.primary_contact_name) AS name
        FROM public.contacts c
        WHERE c.contact_type IN ('nis_supplier', 'supplier', 'both')
        LIMIT 500
    ) g
    WHERE g.name IS NOT NULL;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label) ORDER BY a.display_order), '[]'::jsonb)
    INTO v_areas
    FROM public.nis_storage_areas a WHERE a.is_active;

    RETURN jsonb_build_object(
        'success', true,
        'today', v_today,
        'from', v_from,
        'to', v_to,
        'settings', v_settings,
        'system_pool_kg', v_pool,
        'actual_kg_per_day', CASE WHEN v_actual_n >= 5 THEN ROUND(v_actual, 0) END,
        'actual_days_used', v_actual_n,
        'deliveries', v_deliv,
        'day_types', v_days,
        'growers', v_growers,
        'areas', v_areas
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Write: add / edit a planned truck (optionally repeating weekly).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_procurement_delivery(
    p_id                  uuid,
    p_scheduled_date      date,
    p_predicted_weight_kg numeric,
    p_supplier_id         uuid DEFAULT NULL,
    p_grower_name         text DEFAULT NULL,
    p_truck_label         text DEFAULT NULL,
    p_storage_area_code   text DEFAULT NULL,
    p_is_confirmed        boolean DEFAULT false,
    p_note                text DEFAULT NULL,
    p_repeat_every_weeks  integer DEFAULT 0,
    p_repeat_count        integer DEFAULT 0,
    p_actor_user_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_area   text := NULLIF(trim(COALESCE(p_storage_area_code, '')), '');
    v_grower text := NULLIF(trim(COALESCE(p_grower_name, '')), '');
    v_label  text := NULLIF(trim(COALESCE(p_truck_label, '')), '');
    v_every  integer := GREATEST(COALESCE(p_repeat_every_weeks, 0), 0);
    v_count  integer := GREATEST(COALESCE(p_repeat_count, 0), 0);
    v_ids    uuid[] := '{}';
    v_id     uuid;
    v_base   text;
    v_num    integer;
    i        integer;
BEGIN
    IF p_scheduled_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose the planned date.');
    END IF;
    IF p_predicted_weight_kg IS NULL OR p_predicted_weight_kg <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the planned weight in kg.');
    END IF;
    IF p_supplier_id IS NULL AND v_grower IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose or type the grower.');
    END IF;
    IF v_area IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.nis_storage_areas WHERE code = v_area) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown storage area.');
    END IF;
    IF v_count > 52 OR v_every > 8 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Repeat at most 52 times, up to every 8 weeks.');
    END IF;

    IF p_id IS NOT NULL THEN
        UPDATE public.kernel_intake_procurement
           SET scheduled_date = p_scheduled_date,
               predicted_weight_kg = p_predicted_weight_kg,
               supplier_id = p_supplier_id,
               grower_name = v_grower,
               truck_label = v_label,
               storage_area_code = v_area,
               is_confirmed = COALESCE(p_is_confirmed, false),
               note = NULLIF(trim(COALESCE(p_note, '')), ''),
               updated_by = p_actor_user_id,
               updated_at = now()
         WHERE id = p_id AND status = 'scheduled';
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'This truck has already been received or cancelled, so it can no longer be changed here.');
        END IF;
        RETURN jsonb_build_object('success', true, 'ids', jsonb_build_array(p_id));
    END IF;

    -- Repeats number on from the given label: "Agristar 6" -> "Agristar 7", ...
    IF v_label ~ '\s\d+$' THEN
        v_base := regexp_replace(v_label, '\s\d+$', '');
        v_num  := substring(v_label FROM '\s(\d+)$')::integer;
    END IF;

    FOR i IN 0 .. (CASE WHEN v_every > 0 THEN v_count ELSE 0 END) LOOP
        INSERT INTO public.kernel_intake_procurement
            (scheduled_date, supplier_id, grower_name, predicted_weight_kg, status,
             truck_label, storage_area_code, is_confirmed, note, created_by, updated_by)
        VALUES
            (p_scheduled_date + (i * v_every * 7), p_supplier_id, v_grower, p_predicted_weight_kg, 'scheduled',
             CASE WHEN v_base IS NOT NULL THEN v_base || ' ' || (v_num + i) ELSE v_label END,
             v_area, COALESCE(p_is_confirmed, false), NULLIF(trim(COALESCE(p_note, '')), ''),
             p_actor_user_id, p_actor_user_id)
        RETURNING id INTO v_id;
        v_ids := v_ids || v_id;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'ids', to_jsonb(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_procurement_delivery(p_id uuid, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel_intake_procurement
       SET status = 'cancelled', updated_by = p_actor_user_id, updated_at = now()
     WHERE id = p_id AND status = 'scheduled';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only a planned truck that has not been received can be cancelled.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- Write: set the day type for one day or a range. 'default' puts it back to
-- Mon-Fri cracking / weekend off.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_procurement_days(
    p_from          date,
    p_to            date,
    p_day_type      text,
    p_kg_override   numeric DEFAULT NULL,
    p_note          text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_to date := COALESCE(p_to, p_from);
    v_n  integer;
BEGIN
    IF p_from IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose the date.');
    END IF;
    IF v_to < p_from OR v_to - p_from > 400 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a range of up to 400 days.');
    END IF;
    IF p_kg_override IS NOT NULL AND p_kg_override < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kg cracked cannot be negative.');
    END IF;

    IF p_day_type IS NULL OR p_day_type NOT IN ('default', 'work', 'half', 'off', 'nocrack', 'shutdown', 'holiday') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown day type.');
    END IF;

    INSERT INTO public.procurement_day_types (day, day_type, kg_override, note, updated_by, updated_at)
    SELECT d::date, p_day_type, CASE WHEN p_day_type = 'default' THEN NULL ELSE p_kg_override END, NULLIF(trim(COALESCE(p_note, '')), ''), p_actor_user_id, now()
    FROM generate_series(p_from, v_to, interval '1 day') d
    ON CONFLICT (day) DO UPDATE
       SET day_type = EXCLUDED.day_type, kg_override = EXCLUDED.kg_override, note = EXCLUDED.note,
           updated_by = EXCLUDED.updated_by, updated_at = now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'days', v_n);
END;
$$;

-- ---------------------------------------------------------------------------
-- Write: plan settings (planned kg/day, opening stock source).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_procurement_plan_settings(p_settings jsonb, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_cur  jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'procurement_plan'), '{}'::jsonb);
    v_new  jsonb;
    v_rate numeric;
    v_open numeric;
BEGIN
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nothing to save.');
    END IF;
    v_new := v_cur || (p_settings - ARRAY(SELECT k FROM jsonb_object_keys(p_settings) k
                                         WHERE k NOT IN ('planned_kg_per_day', 'opening_mode', 'opening_kg', 'opening_as_of')));

    v_rate := (v_new->>'planned_kg_per_day')::numeric;
    IF v_rate IS NOT NULL AND (v_rate <= 0 OR v_rate > 100000) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Planned kg per day must be between 1 and 100 000.');
    END IF;
    IF COALESCE(v_new->>'opening_mode', 'system') NOT IN ('system', 'manual') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Opening stock must come from the system or your own figure.');
    END IF;
    IF v_new->>'opening_mode' = 'manual' THEN
        v_open := (v_new->>'opening_kg')::numeric;
        IF v_open IS NULL OR v_open < 0 OR (v_new->>'opening_as_of') IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Enter your opening stock in kg and the date it was counted.');
        END IF;
        PERFORM (v_new->>'opening_as_of')::date;
    END IF;

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at, updated_by)
    VALUES ('procurement_plan', v_new, now(), p_actor_user_id)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
    RETURN jsonb_build_object('success', true, 'settings', v_new);
EXCEPTION WHEN invalid_datetime_format OR invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Check the numbers and date you entered.');
END;
$$;

-- ---------------------------------------------------------------------------
-- When a planned truck is booked in (scheduled -> converted) and it had a storage
-- area, log it into that area with the real weighed kg.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_procurement_received_to_storage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_kernel uuid;
    v_batch  text;
    v_kg     numeric;
BEGIN
    IF NEW.status = 'converted' AND OLD.status IS DISTINCT FROM 'converted'
       AND NEW.storage_area_code IS NOT NULL AND NEW.batch_id IS NOT NULL THEN
        SELECT k.id, b.batch_id, COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg, NEW.predicted_weight_kg)
          INTO v_kernel, v_batch, v_kg
        FROM public.batches b
        LEFT JOIN public.kernel k ON k.batch_id = b.id
        WHERE b.id = NEW.batch_id;
        IF COALESCE(v_kg, 0) > 0 AND NOT EXISTS (SELECT 1 FROM public.nis_storage_movements WHERE procurement_id = NEW.id) THEN
            INSERT INTO public.nis_storage_movements (movement_type, to_area, kg, kernel_id, batch_number, procurement_id, note, created_by)
            VALUES ('in', NEW.storage_area_code, ROUND(v_kg, 2), v_kernel, v_batch, NEW.id,
                    'Booked in from the procurement plan', NEW.updated_by);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER procurement_received_to_storage
    AFTER UPDATE OF status ON public.kernel_intake_procurement
    FOR EACH ROW EXECUTE FUNCTION public.trg_procurement_received_to_storage();

GRANT EXECUTE ON FUNCTION public.get_procurement_plan(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_procurement_delivery(uuid, date, numeric, uuid, text, text, text, boolean, text, integer, integer, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_procurement_delivery(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_procurement_days(date, date, text, numeric, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_procurement_plan_settings(jsonb, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
