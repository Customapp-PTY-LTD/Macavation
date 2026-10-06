-- Kernel Pipeline: New Delivery, checklist, release, kg-cracked and shell-stock changes
-- (Mike Potgieter feedback, 5 Oct 2026; decisions D2, D3, D5, D11, H2).
--
-- 1. save_kernel_delivery     stores the New Delivery bag lines, transport details and supporting
--                             documents at kernel.intake_data.delivery and sets actual_wet_nis_kg
--                             to the bag sum (the "Weighed total"). wet_nis_received_kg stays the
--                             supplier's declared weight (D2).
-- 2. upsert_kernel_checklist  now MERGES into intake_data.receiving_checklist instead of replacing
--                             it, and only touches actual_wet_nis_kg when bag lines are passed.
--                             Without this, the new checklist (which no longer carries bag lines)
--                             would zero the weighed total and erase older batches' bag lines.
--                             Also accepts per-item comments and photos (Mike 1.b.i).
-- 3. release_kernel_to_production now takes p_removed_pre_sizer_kg (required, >= 0) and stores it
--                             at intake_data.removed_pre_sizer_kg (D5).
-- 4. kernel_day_kg            prefers the new cracking key volume_cracked (= startqty1 − endqty_left, D11).
--                             The "left in silo" figure is stored under the NEW key endqty_left; endqty1
--                             keeps its legacy meaning (kg cracked) and stays the fallback.
--                             Older day entries have no volume_cracked and fall through to the
--                             previous order unchanged. Historical figures are NOT restated.
-- Superseded signatures of 2, 3 and 5 are RENAMED to <name>_pre_20261006 rather than removed, so the
-- change is reversible and PostgREST still resolves exactly one candidate per name. They can be
-- removed once the new versions have been in use on prod.
-- 5. auto_create_shell_lot_from_production  becomes idempotent per (batch, production day). It used
--                             to ADD the whole shell total on every autosave, so shell stock grew
--                             each time a production day was saved.

-- ============================================================================
-- 1. save_kernel_delivery
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_kernel_delivery(
    p_kernel_id  uuid,
    p_bags       jsonb DEFAULT '[]'::jsonb,
    p_transport  jsonb DEFAULT '{}'::jsonb,
    p_documents  jsonb DEFAULT '[]'::jsonb,
    p_allow_replace boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_bags      jsonb := COALESCE(p_bags, '[]'::jsonb);
    v_total     numeric;
    v_max_no    integer;
    v_prev_next integer;
    v_delivery  jsonb;
BEGIN
    IF jsonb_typeof(v_bags) <> 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bags must be a list');
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_bags) b
        WHERE (b ->> 'no') IS NULL OR (b ->> 'no') !~ '^[0-9]+$'
           OR (b ->> 'weight_kg') IS NULL OR (b ->> 'weight_kg') !~ '^[0-9]+(\.[0-9]+)?$'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Every bag needs a number and a weight (kg).');
    END IF;
    IF (SELECT count(*) <> count(DISTINCT (b ->> 'no')::int) FROM jsonb_array_elements(v_bags) b) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bag numbers must be unique.');
    END IF;

    SELECT COALESCE(sum((b ->> 'weight_kg')::numeric), 0), COALESCE(max((b ->> 'no')::int), 0)
    INTO v_total, v_max_no
    FROM jsonb_array_elements(v_bags) b;

    SELECT COALESCE((intake_data #>> '{delivery,next_bag_no}')::int, 1)
    INTO v_prev_next
    FROM public.kernel WHERE id = p_kernel_id AND is_active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;
    -- New Delivery must never silently overwrite an earlier delivery recorded under the same batch
    -- number (initialize_kernel_for_batch reuses an existing kernel row for that batch).
    IF NOT COALESCE(p_allow_replace, false) AND EXISTS (
        SELECT 1 FROM public.kernel WHERE id = p_kernel_id AND intake_data ? 'delivery') THEN
        RETURN jsonb_build_object('success', false, 'already_has_delivery', true,
            'error', 'This batch number already has a delivery recorded. Use a different batch number.');
    END IF;

    v_delivery := jsonb_build_object(
        'bags',        v_bags,
        'transport',   COALESCE(p_transport, '{}'::jsonb),
        'documents',   COALESCE(p_documents, '[]'::jsonb),
        -- Stable numbering (H2): the next number never goes backwards, even after a delete.
        'next_bag_no', GREATEST(v_prev_next, v_max_no + 1),
        'saved_at',    now()
    );

    UPDATE public.kernel
    SET intake_data       = jsonb_set(COALESCE(intake_data, '{}'::jsonb), ARRAY['delivery'], v_delivery, true),
        actual_wet_nis_kg = CASE WHEN jsonb_array_length(v_bags) > 0 THEN v_total ELSE actual_wet_nis_kg END,
        updated_at        = now()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'weighed_total_kg', v_total,
                              'bag_count', jsonb_array_length(v_bags), 'next_bag_no', v_delivery -> 'next_bag_no');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================================
-- 2. upsert_kernel_checklist — merge, never wipe
-- ============================================================================

DO $do$
BEGIN
    -- Superseded signature is renamed (not removed) so PostgREST sees exactly one candidate.
    IF to_regprocedure('public.upsert_kernel_checklist(uuid, date, character varying, uuid, character varying, character varying, character varying, character varying, character varying, character varying, text, jsonb, numeric)') IS NOT NULL THEN
        ALTER FUNCTION public.upsert_kernel_checklist(uuid, date, character varying, uuid, character varying, character varying, character varying, character varying, character varying, character varying, text, jsonb, numeric) RENAME TO upsert_kernel_checklist_pre_20261006;
    END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.upsert_kernel_checklist(
    p_kernel_id               uuid,
    p_date_received           date DEFAULT NULL,
    p_delivery_note_ref       character varying DEFAULT NULL,
    p_supplier_id             uuid DEFAULT NULL,
    p_vehicle_clean           character varying DEFAULT NULL,
    p_vehicle_enclosed        character varying DEFAULT NULL,
    p_hazard_substances       character varying DEFAULT NULL,
    p_pest_infestations       character varying DEFAULT NULL,
    p_pallets_condition       character varying DEFAULT NULL,
    p_raw_materials_condition character varying DEFAULT NULL,
    p_comments                text DEFAULT NULL,
    p_received_items          jsonb DEFAULT NULL,
    p_removed_pre_sizer_kg    numeric DEFAULT NULL,
    p_item_comments           jsonb DEFAULT NULL,
    p_item_photos             jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_new        jsonb;
    v_has_items  boolean := p_received_items IS NOT NULL
                            AND jsonb_typeof(p_received_items) = 'array'
                            AND jsonb_array_length(p_received_items) > 0;
    v_total_kg   numeric;
BEGIN
    IF v_has_items THEN
        SELECT COALESCE(SUM((item ->> 'quantity_kg')::numeric), 0)
        INTO   v_total_kg
        FROM   jsonb_array_elements(p_received_items) AS item
        WHERE  (item ->> 'quantity_kg') IS NOT NULL;
    END IF;

    -- Only keys the caller actually sent are written; everything else already stored is kept.
    v_new := jsonb_strip_nulls(jsonb_build_object(
        'date_received',           p_date_received,
        'delivery_note_ref',       p_delivery_note_ref,
        'supplier_id',             p_supplier_id,
        'vehicle_clean',           p_vehicle_clean,
        'vehicle_enclosed',        p_vehicle_enclosed,
        'hazard_substances',       p_hazard_substances,
        'pest_infestations',       p_pest_infestations,
        'pallets_condition',       p_pallets_condition,
        'raw_materials_condition', p_raw_materials_condition,
        'comments',                p_comments,
        'received_items',          CASE WHEN v_has_items THEN p_received_items END,
        'total_weight_kg',         v_total_kg,
        'removed_pre_sizer_kg',    p_removed_pre_sizer_kg,
        'item_comments',           p_item_comments,
        'item_photos',             p_item_photos
    )) || jsonb_build_object('completed_at', now());

    UPDATE public.kernel
    SET intake_data       = jsonb_set(
                                COALESCE(intake_data, '{}'::jsonb),
                                ARRAY['receiving_checklist'],
                                COALESCE(intake_data -> 'receiving_checklist', '{}'::jsonb) || v_new,
                                true),
        actual_wet_nis_kg = CASE WHEN v_has_items THEN v_total_kg ELSE actual_wet_nis_kg END,
        updated_at        = now()
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'total_kg', v_total_kg);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================================
-- 3. release_kernel_to_production — removed pre-sizer required (D5)
-- ============================================================================

DO $do$
BEGIN
    -- Superseded signature is renamed (not removed) so PostgREST sees exactly one candidate.
    IF to_regprocedure('public.release_kernel_to_production(uuid)') IS NOT NULL THEN
        ALTER FUNCTION public.release_kernel_to_production(uuid) RENAME TO release_kernel_to_production_pre_20261006;
    END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.release_kernel_to_production(
    p_kernel_id            uuid,
    p_removed_pre_sizer_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_has_ziplock boolean;
    v_has_5kg     boolean;
    v_status      varchar;
BEGIN
    SELECT
        (intake_data #>> '{ziplock_sample,completed_at}') IS NOT NULL,
        (intake_data #>> '{five_kg_sample,completed_at}') IS NOT NULL,
        status
    INTO v_has_ziplock, v_has_5kg, v_status
    FROM public.kernel
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;

    IF v_status NOT IN ('intake', 'receiving') THEN
        RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'already_released', true);
    END IF;

    IF NOT v_has_ziplock THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ziplock sample not completed — save it before releasing.');
    END IF;

    IF NOT v_has_5kg THEN
        RETURN jsonb_build_object('success', false, 'error', '5kg sample not completed — save it before releasing.');
    END IF;

    IF p_removed_pre_sizer_kg IS NULL OR p_removed_pre_sizer_kg < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the kg removed at the pre-sizer (0 if none) before releasing.');
    END IF;

    UPDATE public.kernel
    SET status      = 'production',
        intake_data = COALESCE(intake_data, '{}'::jsonb)
                      || jsonb_build_object('removed_pre_sizer_kg', p_removed_pre_sizer_kg,
                                            'removed_pre_sizer_at', now()),
        updated_at  = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'removed_pre_sizer_kg', p_removed_pre_sizer_kg);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================================
-- 4. kernel_day_kg — Volume Cracked first (D11)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kernel_day_kg(p_elem jsonb)
RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
      NULLIF(TRIM(p_elem ->> 'volume_cracked'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'endqty1'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'totalqty'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'total_qty'), '')::numeric,
      0)::numeric;
$$;

COMMENT ON FUNCTION public.kernel_day_kg(jsonb) IS
  'Kg of nut-in-shell put through the cracker for one cracking_data day-entry. From Oct 2026 the form '
  'stores volume_cracked = startqty1 − endqty_left (End Quantity, left in silo), which wins. Older '
  'entries fall back to endqty1 (which held kg cracked), then totalqty / total_qty. History is not restated.';

-- ============================================================================
-- 5. auto_create_shell_lot_from_production — idempotent per production day
-- ============================================================================
-- Each (lot, production day) remembers what it last contributed, so a re-save adds only the
-- difference. Lots built by the old additive function have no per-day rows: we cannot know which
-- day put what in (they are typically already inflated), so the first save of a day on such a lot
-- records that day's total as already counted and changes nothing; tracking starts from there.
-- Known limit: if a production day's date is changed, the old date's contribution stays on the lot.

CREATE TABLE IF NOT EXISTS public.shell_lot_day_contributions (
    lot_id          uuid NOT NULL REFERENCES public.shell_stock_lot(id) ON DELETE CASCADE,
    day_ref         text NOT NULL,
    contributed_kg  numeric NOT NULL DEFAULT 0,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lot_id, day_ref)
);
REVOKE ALL ON TABLE public.shell_lot_day_contributions FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
    -- Superseded signature is renamed (not removed) so PostgREST sees exactly one candidate.
    IF to_regprocedure('public.auto_create_shell_lot_from_production(text, numeric, text)') IS NOT NULL THEN
        ALTER FUNCTION public.auto_create_shell_lot_from_production(text, numeric, text) RENAME TO auto_create_shell_lot_from_production_pre_20261006;
    END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.auto_create_shell_lot_from_production(
    p_batch_number    text,
    p_shell_kg        numeric,
    p_notes           text DEFAULT NULL,
    p_production_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_batch    text := trim(COALESCE(p_batch_number, ''));
    v_kg       numeric := GREATEST(COALESCE(p_shell_kg, 0), 0);
    v_day      text := COALESCE(p_production_date::text, 'undated');
    v_ref      text;
    v_lot_id   uuid;
    v_status   text;
    v_lot_num  text;
    v_prev     numeric;
    v_delta    numeric;
BEGIN
    IF v_batch = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'batch number required');
    END IF;
    v_ref := v_batch || ' @ ' || v_day;

    -- Prefer the lot still in stock; otherwise the most recent one for this batch.
    SELECT id, status INTO v_lot_id, v_status
    FROM public.shell_stock_lot
    WHERE source_batch_number = v_batch
    ORDER BY (status = 'in_stock') DESC, created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_lot_id IS NOT NULL AND v_status <> 'in_stock' THEN
        RETURN jsonb_build_object('success', false, 'skipped', true,
                                  'reason', 'shell lot already ' || v_status || '; not changed');
    END IF;

    IF v_lot_id IS NULL THEN
        IF v_kg <= 0 THEN
            RETURN jsonb_build_object('success', false, 'skipped', true, 'reason', 'zero shell kg');
        END IF;
        v_lot_num := 'SHELL-' || regexp_replace(v_batch, '[^A-Za-z0-9-]', '', 'g');
        INSERT INTO public.shell_stock_lot (lot_number, source_batch_number, quantity_kg, status, notes)
        VALUES (v_lot_num, v_batch, v_kg, 'in_stock', p_notes)
        RETURNING id INTO v_lot_id;
        INSERT INTO public.shell_lot_day_contributions (lot_id, day_ref, contributed_kg)
        VALUES (v_lot_id, v_day, v_kg);
        INSERT INTO public.shell_stock_movement (lot_id, movement_type, quantity_kg, reference, notes)
        VALUES (v_lot_id, 'created', v_kg, v_ref, 'Auto-created from production');
        RETURN jsonb_build_object('success', true, 'id', v_lot_id, 'lot_number', v_lot_num, 'delta_kg', v_kg);
    END IF;

    SELECT contributed_kg INTO v_prev
    FROM public.shell_lot_day_contributions
    WHERE lot_id = v_lot_id AND day_ref = v_day
    FOR UPDATE;

    IF NOT FOUND THEN
        IF NOT EXISTS (SELECT 1 FROM public.shell_lot_day_contributions WHERE lot_id = v_lot_id) THEN
            -- Legacy lot: assume this day's total is already in it (see header).
            INSERT INTO public.shell_lot_day_contributions (lot_id, day_ref, contributed_kg)
            VALUES (v_lot_id, v_day, v_kg);
            RETURN jsonb_build_object('success', true, 'id', v_lot_id, 'unchanged', true, 'baseline', true);
        END IF;
        v_prev := 0;
    END IF;

    v_delta := v_kg - v_prev;
    INSERT INTO public.shell_lot_day_contributions (lot_id, day_ref, contributed_kg, updated_at)
    VALUES (v_lot_id, v_day, v_kg, now())
    ON CONFLICT (lot_id, day_ref) DO UPDATE SET contributed_kg = EXCLUDED.contributed_kg, updated_at = now();

    IF v_delta = 0 THEN
        RETURN jsonb_build_object('success', true, 'id', v_lot_id, 'unchanged', true);
    END IF;

    UPDATE public.shell_stock_lot
    SET quantity_kg = GREATEST(0, quantity_kg + v_delta), updated_at = now()
    WHERE id = v_lot_id;
    INSERT INTO public.shell_stock_movement (lot_id, movement_type, quantity_kg, reference, notes)
    VALUES (v_lot_id, 'adjusted', v_delta, v_ref, COALESCE(p_notes, 'Production stage shell total'));

    RETURN jsonb_build_object('success', true, 'id', v_lot_id, 'updated', true, 'delta_kg', v_delta);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

NOTIFY pgrst, 'reload schema';
