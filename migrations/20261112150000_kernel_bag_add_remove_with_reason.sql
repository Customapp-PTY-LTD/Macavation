-- =============================================================================
-- Add or remove a delivery bag with a reason (Henry, 12 Nov 2026).
--
-- After a delivery is booked in, a bag can spill, get wet, or an extra one can
-- turn up. Find a batch could only remove/re-weigh bags that were NOT placed
-- anywhere, and most bags are tagged into a storage area at book-in, so in
-- practice nothing could be removed, and no reason was ever recorded.
--
--   remove_kernel_bag  takes one bag off the delivery with a reason. A bag in a
--                      storage area leaves it (an 'out' movement for its kg, so
--                      the Silos & storage totals stay right). A bag in a silo
--                      or cracked is refused: undo it on Silos first.
--   add_kernel_bag     adds one bag (next bag number, never reused) with a
--                      reason. It starts as "Not placed yet".
--
-- Both keep wet NIS weighed (kernel.actual_wet_nis_kg) equal to the sum of the
-- bags, as save_kernel_delivery does (20261103090000), and log the change in
-- kernel.intake_data->'bag_changes'. That log sits BESIDE 'delivery', not in it,
-- because save_kernel_delivery rebuilds 'delivery' from scratch on every save.
--
-- SECURITY DEFINER + granted to anon like every portal RPC; the actor is passed in.
-- Down: DROP FUNCTION remove_kernel_bag(uuid, integer, text, text, uuid);
--       DROP FUNCTION add_kernel_bag(uuid, numeric, text, text, text, uuid);
--       (intake_data->'bag_changes' can stay; nothing else reads it.)
-- =============================================================================

CREATE OR REPLACE FUNCTION public._kernel_bag_reason_label(p_reason text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE p_reason
        WHEN 'spilled'  THEN 'Spilled'
        WHEN 'wet'      THEN 'Wet'
        WHEN 'damaged'  THEN 'Damaged'
        WHEN 'mistake'  THEN 'Booked by mistake'
        WHEN 'found'    THEN 'Found extra'
        WHEN 'missed'   THEN 'Missed at book-in'
        WHEN 'other'    THEN 'Other'
    END;
$$;

CREATE OR REPLACE FUNCTION public.remove_kernel_bag(
    p_kernel_id     uuid,
    p_bag_no        integer,
    p_reason        text,
    p_note          text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_reason  text := lower(trim(COALESCE(p_reason, '')));
    v_label   text := public._kernel_bag_reason_label(lower(trim(COALESCE(p_reason, ''))));
    v_note    text := NULLIF(left(trim(COALESCE(p_note, '')), 500), '');
    v_k       record;
    v_bags    jsonb;
    v_bag     jsonb;
    v_left    jsonb;
    v_kg      numeric;
    v_total   numeric;
    v_silo    record;
    v_area    text;
    v_by_name text;
BEGIN
    IF p_kernel_id IS NULL OR p_bag_no IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a bag.');
    END IF;
    IF v_label IS NULL OR v_reason IN ('found', 'missed') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose why the bag is being removed.');
    END IF;
    IF v_reason = 'other' AND v_note IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Say what happened to the bag.');
    END IF;

    SELECT k.id, k.status, k.intake_data, b.batch_id AS batch_number
      INTO v_k
    FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id AND k.is_active IS NOT FALSE
    FOR UPDATE OF k;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That batch was not found.');
    END IF;
    IF v_k.status NOT IN ('intake', 'receiving', 'production') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This batch is past production, so its bags can no longer change.');
    END IF;

    v_bags := CASE WHEN jsonb_typeof(v_k.intake_data #> '{delivery,bags}') = 'array'
                   THEN v_k.intake_data #> '{delivery,bags}' ELSE '[]'::jsonb END;
    SELECT b INTO v_bag FROM jsonb_array_elements(v_bags) b WHERE (b ->> 'no') = p_bag_no::text LIMIT 1;
    IF v_bag IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bag ' || p_bag_no || ' is not on this batch any more. Refresh the page.');
    END IF;
    IF jsonb_array_length(v_bags) <= 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'This is the last bag on the batch. A batch needs at least one bag.');
    END IF;

    SELECT s.status, s.silo_number INTO v_silo
    FROM public.silo_allocations s
    WHERE s.kernel_id = p_kernel_id AND s.bag_no = p_bag_no AND s.status <> 'removed'
    LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('success', false, 'error',
            CASE WHEN v_silo.status = 'cracked'
                 THEN 'Bag ' || p_bag_no || ' has already been cracked, so it cannot be removed.'
                 ELSE 'Bag ' || p_bag_no || ' is in silo ' || v_silo.silo_number || '. Undo it on the Silos screen first, then remove it here.' END);
    END IF;

    v_kg := COALESCE(NULLIF(v_bag ->> 'weight_kg', '')::numeric, 0);

    -- Out of its storage area through the table's only writer (20261031090000): it takes the tag off
    -- and writes the 'out' movement for the bag's kg, so the area's total drops by the bag's weight.
    -- Done before the bag leaves the delivery, because _nis_move_bags reads the weight from there.
    SELECT l.area_code INTO v_area
    FROM public.nis_bag_locations l
    WHERE l.kernel_id = p_kernel_id AND l.bag_no = p_bag_no;
    IF v_area IS NOT NULL THEN
        PERFORM public._nis_move_bags(p_kernel_id, ARRAY[p_bag_no], NULL, p_actor_user_id,
                                      left('Bag removed: ' || v_label || COALESCE(' · ' || v_note, ''), 300), NULL);
    END IF;

    SELECT COALESCE(jsonb_agg(b ORDER BY ord), '[]'::jsonb) INTO v_left
    FROM jsonb_array_elements(v_bags) WITH ORDINALITY AS t(b, ord)
    WHERE (b ->> 'no') IS DISTINCT FROM p_bag_no::text;
    SELECT COALESCE(sum(NULLIF(b ->> 'weight_kg', '')::numeric), 0) INTO v_total
    FROM jsonb_array_elements(v_left) b;

    SELECT NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '')
      INTO v_by_name FROM public.users u WHERE u.id = p_actor_user_id;

    UPDATE public.kernel k
       SET intake_data = jsonb_set(
               jsonb_set(k.intake_data, '{delivery,bags}', v_left, false),
               '{bag_changes}',
               (CASE WHEN jsonb_typeof(k.intake_data -> 'bag_changes') = 'array'
                     THEN k.intake_data -> 'bag_changes' ELSE '[]'::jsonb END)
               || jsonb_build_array(jsonb_build_object(
                      'action', 'removed', 'no', p_bag_no, 'weight_kg', v_kg,
                      'description', v_bag -> 'description', 'reason', v_reason, 'reason_label', v_label,
                      'note', v_note, 'from_area', v_area, 'at', now(),
                      'by', p_actor_user_id, 'by_name', v_by_name)),
               true),
           actual_wet_nis_kg = v_total,
           updated_at = now()
     WHERE k.id = p_kernel_id;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'bag_no', p_bag_no,
                              'removed_kg', v_kg, 'from_area', v_area, 'weighed_total_kg', v_total,
                              'bag_count', jsonb_array_length(v_left));
END;
$$;

CREATE OR REPLACE FUNCTION public.add_kernel_bag(
    p_kernel_id     uuid,
    p_weight_kg     numeric,
    p_description   text DEFAULT NULL,
    p_reason        text DEFAULT NULL,
    p_note          text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_reason  text := lower(trim(COALESCE(p_reason, '')));
    v_label   text := public._kernel_bag_reason_label(lower(trim(COALESCE(p_reason, ''))));
    v_note    text := NULLIF(left(trim(COALESCE(p_note, '')), 500), '');
    v_desc    text := NULLIF(left(trim(COALESCE(p_description, '')), 200), '');
    v_kg      numeric := ROUND(p_weight_kg, 2);
    v_k       record;
    v_bags    jsonb;
    v_no      integer;
    v_total   numeric;
    v_by_name text;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a batch.');
    END IF;
    IF v_kg IS NULL OR v_kg <= 0 OR v_kg > 5000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Type the bag''s weight in kg (more than 0).');
    END IF;
    IF v_reason NOT IN ('found', 'missed', 'other') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose why the bag is being added.');
    END IF;
    IF v_reason = 'other' AND v_note IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Say where the bag came from.');
    END IF;

    SELECT k.id, k.status, k.intake_data INTO v_k
    FROM public.kernel k
    WHERE k.id = p_kernel_id AND k.is_active IS NOT FALSE
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That batch was not found.');
    END IF;
    IF v_k.status NOT IN ('intake', 'receiving', 'production') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This batch is past production, so its bags can no longer change.');
    END IF;
    IF jsonb_typeof(v_k.intake_data -> 'delivery') IS DISTINCT FROM 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This batch has no delivery to add a bag to.');
    END IF;

    v_bags := CASE WHEN jsonb_typeof(v_k.intake_data #> '{delivery,bags}') = 'array'
                   THEN v_k.intake_data #> '{delivery,bags}' ELSE '[]'::jsonb END;
    -- Numbers never go backwards, even after a removal (save_kernel_delivery next_bag_no).
    SELECT GREATEST(COALESCE((v_k.intake_data #>> '{delivery,next_bag_no}')::int, 1),
                    COALESCE(max((b ->> 'no')::int), 0) + 1)
      INTO v_no
    FROM jsonb_array_elements(v_bags) b
    WHERE (b ->> 'no') ~ '^[0-9]{1,6}$';

    v_bags := v_bags || jsonb_build_array(jsonb_build_object(
        'no', v_no, 'description', COALESCE(v_desc, ''), 'weight_kg', v_kg,
        'added_reason', v_reason, 'added_on', now()));
    SELECT COALESCE(sum(NULLIF(b ->> 'weight_kg', '')::numeric), 0) INTO v_total
    FROM jsonb_array_elements(v_bags) b;

    SELECT NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '')
      INTO v_by_name FROM public.users u WHERE u.id = p_actor_user_id;

    UPDATE public.kernel k
       SET intake_data = jsonb_set(
               jsonb_set(
                   jsonb_set(k.intake_data, '{delivery,bags}', v_bags, true),
                   '{delivery,next_bag_no}', to_jsonb(v_no + 1), true),
               '{bag_changes}',
               (CASE WHEN jsonb_typeof(k.intake_data -> 'bag_changes') = 'array'
                     THEN k.intake_data -> 'bag_changes' ELSE '[]'::jsonb END)
               || jsonb_build_array(jsonb_build_object(
                      'action', 'added', 'no', v_no, 'weight_kg', v_kg, 'description', v_desc,
                      'reason', v_reason, 'reason_label', v_label, 'note', v_note,
                      'at', now(), 'by', p_actor_user_id, 'by_name', v_by_name)),
               true),
           actual_wet_nis_kg = v_total,
           updated_at = now()
     WHERE k.id = p_kernel_id;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'bag_no', v_no,
                              'added_kg', v_kg, 'weighed_total_kg', v_total,
                              'bag_count', jsonb_array_length(v_bags));
END;
$$;

REVOKE ALL ON FUNCTION public._kernel_bag_reason_label(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_kernel_bag(uuid, integer, text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_kernel_bag(uuid, numeric, text, text, text, uuid) TO anon, authenticated, service_role;

-- Function permissions (bookkeeping; same roles as move_nis_bags). NOT EXISTS: no unique key.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY['remove_kernel_bag', 'add_kernel_bag']) AS fn
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Procurement Lead', 'Shareholder', 'Palladium Manager',
                      'Production Manager', 'Factory Manager', 'Quality Assurance')
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
