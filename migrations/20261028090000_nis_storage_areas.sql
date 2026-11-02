-- =============================================================================
-- NIS storage areas (Mike, 26 Oct 2026): silo storage, drying storage, the shelter
-- and the fuels depot. Stock lands in an area, moves between areas, and leaves an
-- area when it is cracked. Balances are derived from nis_storage_movements only;
-- whatever of the system NIS pool is not in any area shows as "not placed yet".
--
-- SECURITY DEFINER + granted to anon, like every portal RPC (data-functions.js runs
-- with the anon key). The actor is passed explicitly as p_actor_user_id.
-- Down: DROP FUNCTION the four RPCs; DROP TABLE nis_storage_movements, nis_storage_areas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nis_storage_areas (
    code           text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,30}$'),
    label          text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
    capacity_kg    numeric(12,2) CHECK (capacity_kg IS NULL OR capacity_kg > 0),
    display_order  integer NOT NULL DEFAULT 0,
    is_active      boolean NOT NULL DEFAULT true,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     uuid
);

INSERT INTO public.nis_storage_areas (code, label, display_order) VALUES
    ('silo',        'Silo storage',   10),
    ('drying',      'Drying storage', 20),
    ('shelter',     'The shelter',    30),
    ('fuels_depot', 'Fuels depot',    40)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.nis_storage_movements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_type   text NOT NULL CHECK (movement_type IN ('in', 'move', 'out')),
    from_area       text REFERENCES public.nis_storage_areas(code) ON DELETE RESTRICT,
    to_area         text REFERENCES public.nis_storage_areas(code) ON DELETE RESTRICT,
    kg              numeric(12,2) NOT NULL CHECK (kg > 0),
    kernel_id       uuid REFERENCES public.kernel(id) ON DELETE SET NULL,
    batch_number    text,
    procurement_id  uuid REFERENCES public.kernel_intake_procurement(id) ON DELETE SET NULL,
    moved_at        timestamptz NOT NULL DEFAULT now(),
    note            text,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT nis_storage_movements_shape CHECK (
        (movement_type = 'in'   AND from_area IS NULL     AND to_area IS NOT NULL) OR
        (movement_type = 'out'  AND from_area IS NOT NULL AND to_area IS NULL) OR
        (movement_type = 'move' AND from_area IS NOT NULL AND to_area IS NOT NULL AND from_area <> to_area)
    )
);

CREATE INDEX IF NOT EXISTS idx_nis_storage_movements_from_area ON public.nis_storage_movements(from_area);
CREATE INDEX IF NOT EXISTS idx_nis_storage_movements_to_area   ON public.nis_storage_movements(to_area);
CREATE INDEX IF NOT EXISTS idx_nis_storage_movements_kernel_id ON public.nis_storage_movements(kernel_id);
CREATE INDEX IF NOT EXISTS idx_nis_storage_movements_moved_at  ON public.nis_storage_movements(moved_at DESC);

ALTER TABLE public.nis_storage_areas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nis_storage_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nis_storage_areas     FROM anon, authenticated;
REVOKE ALL ON TABLE public.nis_storage_movements FROM anon, authenticated;

-- Net kg of one batch (or of "no batch" when both keys are null) in one area.
CREATE OR REPLACE FUNCTION public._nis_area_balance(p_area text, p_kernel_id uuid DEFAULT NULL, p_batch_number text DEFAULT NULL)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(SUM(CASE WHEN m.to_area = p_area THEN m.kg ELSE -m.kg END), 0)
    FROM public.nis_storage_movements m
    WHERE (m.to_area = p_area OR m.from_area = p_area)
      AND (p_kernel_id IS NULL OR m.kernel_id = p_kernel_id)
      AND (p_batch_number IS NULL OR m.batch_number = p_batch_number);
$$;

CREATE OR REPLACE FUNCTION public.get_nis_storage_overview(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    v_pool    numeric := 0;
    v_areas   jsonb;
    v_placed  numeric;
    v_moves   jsonb;
    v_unplaced jsonb;
BEGIN
    BEGIN
        v_pool := COALESCE((public.get_nis_runway_forecast(30, NULL, NULL, 1, false)->'meta'->>'pool_kg')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN
        v_pool := 0;
    END;

    WITH per_batch AS (
        SELECT a.code,
               COALESCE(m.kernel_id::text, m.batch_number, '(no batch)') AS bkey,
               MAX(m.kernel_id::text) AS kernel_id,
               MAX(m.batch_number) AS batch_number,
               SUM(CASE WHEN m.to_area = a.code THEN m.kg ELSE -m.kg END) AS kg,
               MIN(m.moved_at) FILTER (WHERE m.to_area = a.code) AS first_in
        FROM public.nis_storage_areas a
        JOIN public.nis_storage_movements m ON m.to_area = a.code OR m.from_area = a.code
        GROUP BY a.code, 2
    ),
    live AS (SELECT * FROM per_batch WHERE kg > 0.009)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'code', a.code,
               'label', a.label,
               'capacity_kg', a.capacity_kg,
               'kg', COALESCE((SELECT SUM(kg) FROM live l WHERE l.code = a.code), 0),
               'batch_count', (SELECT COUNT(*) FROM live l WHERE l.code = a.code AND l.bkey <> '(no batch)'),
               'oldest_in', (SELECT MIN(first_in) FROM live l WHERE l.code = a.code),
               'batches', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                               'kernel_id', l.kernel_id, 'batch_number', l.batch_number,
                               'kg', ROUND(l.kg, 2), 'first_in', l.first_in) ORDER BY l.first_in NULLS LAST)
                            FROM live l WHERE l.code = a.code), '[]'::jsonb)
           ) ORDER BY a.display_order), '[]'::jsonb)
    INTO v_areas
    FROM public.nis_storage_areas a
    WHERE a.is_active;

    SELECT COALESCE(SUM((x->>'kg')::numeric), 0) INTO v_placed FROM jsonb_array_elements(v_areas) x;

    -- Batches in the NIS pool that still have kg not placed in any area.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'kernel_id', u.id, 'batch_number', u.batch_number, 'kg', ROUND(u.unplaced, 2),
               'received_date', u.received_date) ORDER BY u.received_date NULLS LAST), '[]'::jsonb)
    INTO v_unplaced
    FROM (
        SELECT k.id, b.batch_id AS batch_number, k.received_date,
               COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg, 0)
               - COALESCE((SELECT SUM(m.kg) FROM public.nis_storage_movements m
                           WHERE m.kernel_id = k.id AND m.movement_type = 'in'), 0) AS unplaced
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE k.is_active IS NOT FALSE
          AND k.status IN ('intake', 'receiving', 'production')
        ORDER BY k.received_date DESC NULLS LAST
        LIMIT 200
    ) u
    WHERE u.unplaced > 0.009;

    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.moved_at DESC), '[]'::jsonb)
    INTO v_moves
    FROM (
        SELECT m.id, m.movement_type, m.from_area, m.to_area, m.kg, m.batch_number, m.moved_at, m.note,
               public.stock_history_user_label(m.created_by) AS by_label
        FROM public.nis_storage_movements m
        ORDER BY m.moved_at DESC
        LIMIT v_limit
    ) t;

    RETURN jsonb_build_object(
        'success', true,
        'pool_kg', ROUND(v_pool, 2),
        'placed_kg', ROUND(v_placed, 2),
        'unplaced_kg', ROUND(GREATEST(v_pool - v_placed, 0), 2),
        'areas', v_areas,
        'unplaced_batches', v_unplaced,
        'movements', v_moves
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_nis_storage_movement(
    p_from_area     text,
    p_to_area       text,
    p_kg            numeric,
    p_kernel_id     uuid DEFAULT NULL,
    p_batch_number  text DEFAULT NULL,
    p_moved_at      timestamptz DEFAULT NULL,
    p_note          text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from  text := NULLIF(trim(COALESCE(p_from_area, '')), '');
    v_to    text := NULLIF(trim(COALESCE(p_to_area, '')), '');
    v_type  text;
    v_batch text := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    v_have  numeric;
    v_id    uuid;
BEGIN
    IF p_kg IS NULL OR p_kg <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the kg moved (more than 0).');
    END IF;
    IF v_from IS NULL AND v_to IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose where the stock comes from or goes to.');
    END IF;
    IF v_from IS NOT NULL AND v_from = v_to THEN
        RETURN jsonb_build_object('success', false, 'error', 'From and To are the same area.');
    END IF;
    IF v_from IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.nis_storage_areas WHERE code = v_from AND is_active) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown storage area: ' || v_from);
    END IF;
    IF v_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.nis_storage_areas WHERE code = v_to AND is_active) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown storage area: ' || v_to);
    END IF;
    IF p_moved_at IS NOT NULL AND p_moved_at > now() + interval '1 day' THEN
        RETURN jsonb_build_object('success', false, 'error', 'The move date cannot be in the future.');
    END IF;

    IF p_kernel_id IS NOT NULL THEN
        SELECT b.batch_id INTO v_batch
        FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id
        WHERE k.id = p_kernel_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'That batch was not found.');
        END IF;
    END IF;

    v_type := CASE WHEN v_from IS NULL THEN 'in' WHEN v_to IS NULL THEN 'out' ELSE 'move' END;

    IF v_from IS NOT NULL THEN
        v_have := public._nis_area_balance(v_from, p_kernel_id, CASE WHEN p_kernel_id IS NULL THEN v_batch END);
        IF v_have + 0.009 < p_kg THEN
            RETURN jsonb_build_object('success', false, 'error',
                format('Only %s kg of that stock is in this area.', to_char(GREATEST(v_have, 0), 'FM999G999G990D00')));
        END IF;
    END IF;

    INSERT INTO public.nis_storage_movements (movement_type, from_area, to_area, kg, kernel_id, batch_number, moved_at, note, created_by)
    VALUES (v_type, v_from, v_to, ROUND(p_kg, 2), p_kernel_id, v_batch, COALESCE(p_moved_at, now()),
            NULLIF(trim(COALESCE(p_note, '')), ''), p_actor_user_id)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id, 'movement_type', v_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_nis_storage_area_capacity(p_code text, p_capacity_kg numeric, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_capacity_kg IS NOT NULL AND p_capacity_kg <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Capacity must be more than 0, or blank.');
    END IF;
    UPDATE public.nis_storage_areas
       SET capacity_kg = p_capacity_kg, updated_at = now(), updated_by = p_actor_user_id
     WHERE code = p_code;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown storage area.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public._nis_area_balance(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_nis_storage_overview(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_nis_storage_movement(text, text, numeric, uuid, text, timestamptz, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_nis_storage_area_capacity(text, numeric, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
