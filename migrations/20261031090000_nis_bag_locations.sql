-- =============================================================================
-- Bag tags for nut in shell storage (Henry, 30-31 Oct 2026).
--
-- Grower Intake now shows every bag of a batch and where it is: a storage area
-- (tagged here), a silo or cracked (from silo_allocations), or not placed yet.
-- A batch can be split across areas by bag, and released batches stay visible
-- while any of their bags are still waiting.
--
--   nis_bag_locations       one row per tagged bag (kernel_id, bag_no) -> area.
--                           No row and no live silo allocation = "Not placed yet".
--   _nis_move_bags          the only writer: tags the bags AND writes the matching
--                           nis_storage_movements rows (kg = the bags' own weights),
--                           so the Silos & storage screen's kg totals stay in step.
--   move_nis_bags           portal RPC around it (Grower Intake: Move to / Place).
--   get_intake_bag_overview every active intake/production batch with its bags and
--                           each bag's place, plus the storage areas.
--   silo_allocations trigger: a bag going into a silo leaves its storage area
--                           (an 'out' movement for its weight) - the open question
--                           on the Storage areas screen, answered "yes".
--   procurement trigger     booking in a planned truck tags all its bags with the
--                           truck's area; batches without bags keep the old kg entry.
--   'Silo storage' is renamed 'Silo floor' (the store beside the silos).
--
-- Bags are the delivery bags in kernel.intake_data->'delivery'->'bags' ({no, weight_kg}).
-- SECURITY DEFINER + granted to anon like every portal RPC; the actor is passed in.
-- Down: DROP TRIGGER silo_allocation_leaves_storage ON silo_allocations;
--       restore trg_procurement_received_to_storage from 20261028090100;
--       DROP FUNCTION move_nis_bags, get_intake_bag_overview, _nis_move_bags, _nis_bag_weights,
--       trg_silo_allocation_leaves_storage; DROP TABLE nis_bag_locations;
--       UPDATE nis_storage_areas SET label = 'Silo storage' WHERE code = 'silo'.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nis_bag_locations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kernel_id   uuid NOT NULL REFERENCES public.kernel(id) ON DELETE CASCADE,
    bag_no      integer NOT NULL CHECK (bag_no > 0),
    area_code   text NOT NULL REFERENCES public.nis_storage_areas(code) ON DELETE RESTRICT,
    placed_at   timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid,
    CONSTRAINT uq_nis_bag_locations_bag UNIQUE (kernel_id, bag_no)
);

CREATE INDEX IF NOT EXISTS idx_nis_bag_locations_area_code ON public.nis_bag_locations(area_code);

ALTER TABLE public.nis_bag_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nis_bag_locations FROM anon, authenticated;

UPDATE public.nis_storage_areas
   SET label = 'Silo floor', updated_at = now()
 WHERE code = 'silo' AND label = 'Silo storage';

-- Bag numbers and weights of one batch's delivery.
CREATE OR REPLACE FUNCTION public._nis_bag_weights(p_kernel_id uuid)
RETURNS TABLE (bag_no integer, weight_kg numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT (b->>'no')::integer,
           COALESCE(NULLIF(b->>'weight_kg', '')::numeric, 0)
    FROM public.kernel k
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(k.intake_data->'delivery'->'bags') = 'array'
             THEN k.intake_data->'delivery'->'bags' ELSE '[]'::jsonb END) b
    WHERE k.id = p_kernel_id
      AND (b->>'no') ~ '^[0-9]{1,6}$'
    LIMIT 2000;
$$;

-- Tags bags with an area (NULL = take the tag off) and logs the kg movement.
-- Bags in a silo or cracked are left alone; bags already in that area are skipped.
CREATE OR REPLACE FUNCTION public._nis_move_bags(
    p_kernel_id      uuid,
    p_bag_nos        integer[],
    p_area_code      text,
    p_actor_user_id  uuid DEFAULT NULL,
    p_note           text DEFAULT NULL,
    p_procurement_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_area  text := NULLIF(trim(COALESCE(p_area_code, '')), '');
    v_batch text;
    v_moved integer := 0;
    v_asked integer := COALESCE(cardinality(p_bag_nos), 0);
    r       record;
BEGIN
    SELECT b.batch_id INTO v_batch
    FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That batch was not found.');
    END IF;
    IF v_area IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.nis_storage_areas WHERE code = v_area AND is_active) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown storage area: ' || v_area);
    END IF;

    FOR r IN
        SELECT COALESCE(l.area_code, '') AS from_area,
               array_agg(w.bag_no ORDER BY w.bag_no) AS bags,
               SUM(w.weight_kg) AS kg
        FROM public._nis_bag_weights(p_kernel_id) w
        LEFT JOIN public.nis_bag_locations l ON l.kernel_id = p_kernel_id AND l.bag_no = w.bag_no
        WHERE w.bag_no = ANY (p_bag_nos)
          AND l.area_code IS DISTINCT FROM v_area
          AND NOT EXISTS (
              SELECT 1 FROM public.silo_allocations s
              WHERE s.kernel_id = p_kernel_id AND s.bag_no = w.bag_no AND s.status <> 'removed')
        GROUP BY COALESCE(l.area_code, '')
    LOOP
        IF v_area IS NULL THEN
            DELETE FROM public.nis_bag_locations
             WHERE kernel_id = p_kernel_id AND bag_no = ANY (r.bags);
        ELSE
            INSERT INTO public.nis_bag_locations (kernel_id, bag_no, area_code, updated_by)
            SELECT p_kernel_id, x, v_area, p_actor_user_id FROM unnest(r.bags) AS x
            ON CONFLICT (kernel_id, bag_no) DO UPDATE
               SET area_code = EXCLUDED.area_code, placed_at = now(), updated_at = now(),
                   updated_by = EXCLUDED.updated_by;
        END IF;

        IF COALESCE(r.kg, 0) > 0 THEN
            INSERT INTO public.nis_storage_movements
                (movement_type, from_area, to_area, kg, kernel_id, batch_number, procurement_id, note, created_by)
            VALUES (CASE WHEN r.from_area = '' THEN 'in' WHEN v_area IS NULL THEN 'out' ELSE 'move' END,
                    NULLIF(r.from_area, ''), v_area, ROUND(r.kg, 2), p_kernel_id, v_batch, p_procurement_id,
                    left(COALESCE(NULLIF(trim(COALESCE(p_note, '')), '') || ' · ', '')
                         || 'bags ' || array_to_string(r.bags, ', '), 500),
                    p_actor_user_id);
        END IF;
        v_moved := v_moved + cardinality(r.bags);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'moved', v_moved, 'skipped', GREATEST(v_asked - v_moved, 0));
END;
$$;

-- Portal: tag bags (Grower Intake "Move to", "Place them", book-in split and Undo).
CREATE OR REPLACE FUNCTION public.move_nis_bags(
    p_kernel_id     uuid,
    p_bag_nos       integer[],
    p_area_code     text,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a batch.');
    END IF;
    IF p_bag_nos IS NULL OR cardinality(p_bag_nos) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose at least one bag.');
    END IF;
    IF cardinality(p_bag_nos) > 2000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Too many bags in one go.');
    END IF;
    RETURN public._nis_move_bags(p_kernel_id, p_bag_nos, p_area_code, p_actor_user_id, 'Grower Intake', NULL);
END;
$$;

-- Every active intake / production batch with its bags and where each bag is.
-- loc: area code | 'silo:<n>' | 'cracked' | '' (not placed yet).
CREATE OR REPLACE FUNCTION public.get_intake_bag_overview(p_limit integer DEFAULT 300)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'success', true,
        'areas', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label,
                                                'capacity_kg', a.capacity_kg) ORDER BY a.display_order, a.code)
            FROM (SELECT * FROM public.nis_storage_areas WHERE is_active ORDER BY display_order LIMIT 50) a), '[]'::jsonb),
        'batches', COALESCE((
            SELECT jsonb_agg(x.row ORDER BY x.received_date DESC NULLS LAST)
            FROM (
                SELECT k.received_date,
                       jsonb_build_object(
                           'kernel_id', k.id,
                           'batch_number', b.batch_id,
                           'grower_name', k.grower_name,
                           'status', k.status,
                           'received_date', k.received_date,
                           'wet_nis_received_kg', k.wet_nis_received_kg,
                           'actual_wet_nis_kg', k.actual_wet_nis_kg,
                           'bags', COALESCE((
                               SELECT jsonb_agg(jsonb_build_object(
                                          'no', w.bag_no,
                                          'kg', w.weight_kg,
                                          'loc', CASE WHEN s.status = 'cracked' THEN 'cracked'
                                                      WHEN s.status IS NOT NULL THEN 'silo:' || s.silo_number
                                                      ELSE COALESCE(l.area_code, '') END)
                                      ORDER BY w.bag_no)
                               FROM public._nis_bag_weights(k.id) w
                               LEFT JOIN public.silo_allocations s
                                      ON s.kernel_id = k.id AND s.bag_no = w.bag_no AND s.status <> 'removed'
                               LEFT JOIN public.nis_bag_locations l
                                      ON l.kernel_id = k.id AND l.bag_no = w.bag_no), '[]'::jsonb)
                       ) AS row
                FROM public.kernel k
                JOIN public.batches b ON b.id = k.batch_id
                WHERE k.is_active IS NOT FALSE
                  AND k.status IN ('intake', 'receiving', 'production')
                ORDER BY k.received_date DESC NULLS LAST
                LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 500)
            ) x), '[]'::jsonb)
    );
$$;

-- A bag going into a silo leaves its storage area.
CREATE OR REPLACE FUNCTION public.trg_silo_allocation_leaves_storage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_area  text;
    v_batch text;
BEGIN
    IF NEW.status = 'removed' THEN
        RETURN NEW;
    END IF;
    DELETE FROM public.nis_bag_locations
     WHERE kernel_id = NEW.kernel_id AND bag_no = NEW.bag_no
    RETURNING area_code INTO v_area;
    IF v_area IS NOT NULL AND COALESCE(NEW.weight_kg, 0) > 0 THEN
        SELECT b.batch_id INTO v_batch
        FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id
        WHERE k.id = NEW.kernel_id;
        INSERT INTO public.nis_storage_movements
            (movement_type, from_area, kg, kernel_id, batch_number, note, created_by)
        VALUES ('out', v_area, ROUND(NEW.weight_kg, 2), NEW.kernel_id, v_batch,
                'Into silo ' || NEW.silo_number || ' · bag ' || NEW.bag_no, NEW.allocated_by);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS silo_allocation_leaves_storage ON public.silo_allocations;
CREATE TRIGGER silo_allocation_leaves_storage
    AFTER INSERT ON public.silo_allocations
    FOR EACH ROW EXECUTE FUNCTION public.trg_silo_allocation_leaves_storage();

-- Booking in a planned truck: tag its bags with the truck's area (kg entry only when it has no bags).
CREATE OR REPLACE FUNCTION public.trg_procurement_received_to_storage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_kernel uuid;
    v_batch  text;
    v_kg     numeric;
    v_bags   integer[];
BEGIN
    IF NEW.status = 'converted' AND OLD.status IS DISTINCT FROM 'converted'
       AND NEW.storage_area_code IS NOT NULL AND NEW.batch_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.nis_storage_movements WHERE procurement_id = NEW.id) THEN
        SELECT k.id, b.batch_id, COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg, NEW.predicted_weight_kg)
          INTO v_kernel, v_batch, v_kg
        FROM public.batches b
        LEFT JOIN public.kernel k ON k.batch_id = b.id
        WHERE b.id = NEW.batch_id;

        IF v_kernel IS NOT NULL THEN
            SELECT array_agg(w.bag_no) INTO v_bags
            FROM public._nis_bag_weights(v_kernel) w
            WHERE NOT EXISTS (SELECT 1 FROM public.nis_bag_locations l
                              WHERE l.kernel_id = v_kernel AND l.bag_no = w.bag_no);
        END IF;

        IF COALESCE(cardinality(v_bags), 0) > 0 THEN
            PERFORM public._nis_move_bags(v_kernel, v_bags, NEW.storage_area_code, NEW.updated_by,
                                          'Booked in from the procurement plan', NEW.id);
        ELSIF COALESCE(v_kg, 0) > 0
              AND NOT EXISTS (SELECT 1 FROM public.nis_bag_locations WHERE kernel_id = v_kernel) THEN
            INSERT INTO public.nis_storage_movements (movement_type, to_area, kg, kernel_id, batch_number, procurement_id, note, created_by)
            VALUES ('in', NEW.storage_area_code, ROUND(v_kg, 2), v_kernel, v_batch, NEW.id,
                    'Booked in from the procurement plan', NEW.updated_by);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._nis_bag_weights(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._nis_move_bags(uuid, integer[], text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_silo_allocation_leaves_storage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_intake_bag_overview(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_nis_bags(uuid, integer[], text, uuid) TO anon, authenticated, service_role;

-- Function permissions (bookkeeping; RPCs are SECURITY DEFINER + anon). NOT EXISTS: no unique key.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY['get_intake_bag_overview', 'move_nis_bags']) AS fn
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Procurement Lead', 'Shareholder', 'Palladium Manager',
                      'Production Manager', 'Factory Manager', 'Quality Assurance')
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
