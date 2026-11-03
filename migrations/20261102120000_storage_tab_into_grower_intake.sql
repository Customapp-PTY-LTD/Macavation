-- ============================================================================
-- Storage areas move fully onto Grower Intake; the Storage areas tab is retired.
--
-- WHY. Henry (2 Nov 2026), after a Fable review: Grower Intake's bag-level storage list
-- (20261031090000) does what the Silos & storage "Storage areas" tab did for bags. Before the
-- tab goes, the jobs only it did move across, and the storage ledger stays bag-based:
--
--   1. trg_procurement_received_to_storage no longer writes a plain-kg 'in' row for a batch
--      without bags (that row could never be matched to bags later). Bags added later show as
--      "Not placed yet" on Grower Intake.
--   2. get_intake_bag_overview also returns the last 50 movements (Recent moves on Grower Intake).
--   3. get_kernel_pipeline_config also returns storage_areas (capacity is edited in Kernel
--      Pipeline Settings > Plant, next to the silos).
--   4. _nis_unplaced_task counts bags with no area and no silo, not kg: the old kg rule could
--      stay open for ever (receiving overwrites actual_wet_nis_kg; bags that go straight into a
--      silo never get an 'in' row). It is re-checked when bags or silos change too.
--   5. record_nis_storage_movement (kg moves, used only by the retired tab) is no longer callable
--      from the portal.
--   6. One-off: bags whose batch has a matching plain-kg 'in' row (booked from the procurement
--      plan before 20261031090000 reached the DB, e.g. prod Bn 44 26 77, 32 t in the Fuels depot)
--      are tagged to that area WITHOUT a new movement, because the kg is already in the ledger.
--      Only exact matches: one area, no bags tagged yet, none in a silo, bag kg = movement kg.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_procurement_received_to_storage()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_kernel uuid;
    v_bags   integer[];
BEGIN
    IF NEW.status = 'converted' AND OLD.status IS DISTINCT FROM 'converted'
       AND NEW.storage_area_code IS NOT NULL AND NEW.batch_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.nis_storage_movements WHERE procurement_id = NEW.id) THEN
        SELECT k.id INTO v_kernel
        FROM public.batches b
        LEFT JOIN public.kernel k ON k.batch_id = b.id
        WHERE b.id = NEW.batch_id;

        IF v_kernel IS NOT NULL THEN
            SELECT array_agg(w.bag_no) INTO v_bags
            FROM public._nis_bag_weights(v_kernel) w
            WHERE NOT EXISTS (SELECT 1 FROM public.nis_bag_locations l
                              WHERE l.kernel_id = v_kernel AND l.bag_no = w.bag_no);
        END IF;

        -- No bags yet: nothing is written; the bags show as "Not placed yet" once recorded.
        IF COALESCE(cardinality(v_bags), 0) > 0 THEN
            PERFORM public._nis_move_bags(v_kernel, v_bags, NEW.storage_area_code, NEW.updated_by,
                                          'Booked in from the procurement plan', NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

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
            ) x), '[]'::jsonb),
        'movements', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', t.id, 'movement_type', t.movement_type, 'from_area', t.from_area, 'to_area', t.to_area,
                       'kg', t.kg, 'batch_number', t.batch_number, 'kernel_id', t.kernel_id,
                       'moved_at', t.moved_at, 'note', t.note, 'by_label', t.by_label) ORDER BY t.moved_at DESC)
            FROM (
                SELECT m.id, m.movement_type, m.from_area, m.to_area, m.kg, m.batch_number, m.kernel_id, m.moved_at, m.note,
                       public.stock_history_user_label(m.created_by) AS by_label
                FROM public.nis_storage_movements m
                ORDER BY m.moved_at DESC
                LIMIT 50
            ) t), '[]'::jsonb)
    );
$$;

CREATE OR REPLACE FUNCTION public.get_kernel_pipeline_config()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'success', true,
        'settings', COALESCE((SELECT jsonb_object_agg(key, value) FROM public.kernel_pipeline_settings), '{}'::jsonb),
        'spec_thresholds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'test_key', test_key, 'label', label, 'direction', direction,
                'green_limit', green_limit, 'yellow_limit', yellow_limit) ORDER BY
                CASE test_key WHEN 'moisture' THEN 1 WHEN 'pv' THEN 2 ELSE 3 END)
            FROM public.sample_spec_thresholds), '[]'::jsonb),
        'crate_weights', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'stage', stage, 'crate_type', crate_type, 'label', label, 'kg_per_crate', kg_per_crate)
                ORDER BY stage DESC, sort_order)
            FROM public.crate_weights), '[]'::jsonb),
        'transporters', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'is_active', is_active) ORDER BY lower(name))
            FROM public.transporters), '[]'::jsonb),
        'transport_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'is_active', is_active) ORDER BY sort_order, lower(name))
            FROM public.transport_types), '[]'::jsonb),
        'silos', COALESCE((SELECT jsonb_agg(jsonb_build_object('silo_number', silo_number, 'capacity_kg', capacity_kg, 'is_active', is_active) ORDER BY silo_number)
            FROM public.silos), '[]'::jsonb),
        'storage_areas', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'label', label, 'capacity_kg', capacity_kg) ORDER BY display_order, code)
            FROM public.nis_storage_areas WHERE is_active), '[]'::jsonb)
    );
$$;

-- Bags booked in since unplaced_since that have no storage area and are not in a silo.
CREATE OR REPLACE FUNCTION public._nis_unplaced_task(p_may_open boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today   date := public._sast_today();
    v_after   integer := public._procurement_task_setting('unplaced_after_days', 1)::integer;
    v_since   date := COALESCE((SELECT (value ->> 'unplaced_since')::date FROM public.kernel_pipeline_settings WHERE key = 'procurement_tasks'), '2026-10-28');
    v_kg      numeric;
    v_bags    integer;
    v_n       integer;
    v_batches text;
BEGIN
    SELECT COALESCE(SUM(u.kg), 0), COALESCE(SUM(u.bags), 0), COUNT(*),
           string_agg(u.batch_number, ', ' ORDER BY u.received_date) FILTER (WHERE u.rn <= 5)
      INTO v_kg, v_bags, v_n, v_batches
    FROM (
        SELECT b.batch_id AS batch_number, k.received_date, x.bags, x.kg,
               row_number() OVER (ORDER BY k.received_date) AS rn
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        CROSS JOIN LATERAL (
            SELECT COUNT(*) AS bags, COALESCE(SUM(w.weight_kg), 0) AS kg
            FROM public._nis_bag_weights(k.id) w
            WHERE NOT EXISTS (SELECT 1 FROM public.nis_bag_locations l WHERE l.kernel_id = k.id AND l.bag_no = w.bag_no)
              AND NOT EXISTS (SELECT 1 FROM public.silo_allocations s
                              WHERE s.kernel_id = k.id AND s.bag_no = w.bag_no AND s.status <> 'removed')
        ) x
        WHERE k.is_active IS NOT FALSE
          AND k.status IN ('intake', 'receiving', 'production')
          AND k.received_date >= v_since
          AND k.received_date <= v_today - v_after
          AND x.bags > 0
    ) u;

    IF v_n = 0 THEN
        PERFORM public._close_tasks('nis_unplaced', 'nis_unplaced');
        RETURN;
    END IF;
    IF NOT p_may_open AND NOT EXISTS (
        SELECT 1 FROM public.workflow_tasks
        WHERE kind = 'nis_unplaced' AND dedupe_key = 'nis_unplaced' AND status NOT IN ('completed', 'dismissed')) THEN
        RETURN;
    END IF;

    PERFORM public._open_task('nis_unplaced', 'nis_unplaced',
        public._fmt_tonnes(v_kg) || ' t of nut in shell has no storage area yet',
        v_bags || CASE WHEN v_bags = 1 THEN ' bag' ELSE ' bags' END || ' from ' || v_n
            || CASE WHEN v_n = 1 THEN ' batch' ELSE ' batches' END || ' ('
            || v_batches || CASE WHEN v_n > 5 THEN ', …' ELSE '' END
            || ') ' || CASE WHEN v_bags = 1 THEN 'is' ELSE 'are' END
            || ' not in a storage area or a silo. Place ' || CASE WHEN v_bags = 1 THEN 'it' ELSE 'them' END
            || ' on Grower Intake so the storage totals stay right.',
        'nis_storage', NULL);
END;
$$;

-- Re-check when bags are tagged or go into a silo, not only on kg movements.
CREATE OR REPLACE TRIGGER nis_bag_locations_unplaced_task
    AFTER INSERT OR UPDATE OR DELETE ON public.nis_bag_locations
    FOR EACH STATEMENT EXECUTE FUNCTION public._trg_nis_unplaced_task();
CREATE OR REPLACE TRIGGER silo_allocations_unplaced_task
    AFTER INSERT OR UPDATE OR DELETE ON public.silo_allocations
    FOR EACH STATEMENT EXECUTE FUNCTION public._trg_nis_unplaced_task();

REVOKE EXECUTE ON FUNCTION public.record_nis_storage_movement(text, text, numeric, uuid, text, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;

-- One-off: tag bags that already have a matching plain-kg 'in' row (no new movement).
WITH bal AS (
    SELECT m.kernel_id, a.code, SUM(CASE WHEN m.to_area = a.code THEN m.kg ELSE -m.kg END) AS kg
    FROM public.nis_storage_areas a
    JOIN public.nis_storage_movements m ON (m.to_area = a.code OR m.from_area = a.code) AND m.kernel_id IS NOT NULL
    GROUP BY 1, 2
    HAVING SUM(CASE WHEN m.to_area = a.code THEN m.kg ELSE -m.kg END) > 0.009
),
one_area AS (
    SELECT kernel_id, MIN(code) AS code, MIN(kg) AS kg FROM bal GROUP BY kernel_id HAVING COUNT(*) = 1
),
fit AS (
    SELECT o.kernel_id, o.code
    FROM one_area o
    WHERE NOT EXISTS (SELECT 1 FROM public.nis_bag_locations l WHERE l.kernel_id = o.kernel_id)
      AND NOT EXISTS (SELECT 1 FROM public.silo_allocations s WHERE s.kernel_id = o.kernel_id AND s.status <> 'removed')
      AND ABS(COALESCE((SELECT SUM(w.weight_kg) FROM public._nis_bag_weights(o.kernel_id) w), 0) - o.kg) < 0.01
)
INSERT INTO public.nis_bag_locations (kernel_id, bag_no, area_code)
SELECT f.kernel_id, w.bag_no, f.code
FROM fit f
CROSS JOIN LATERAL public._nis_bag_weights(f.kernel_id) w
ON CONFLICT DO NOTHING;

SELECT public._nis_unplaced_task(false);

NOTIFY pgrst, 'reload schema';
