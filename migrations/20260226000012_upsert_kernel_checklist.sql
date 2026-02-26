-- Migration: 20260226000012 — upsert_kernel_checklist
-- Saves receiving checklist data into kernel.intake_data.receiving_checklist JSONB.
-- Also updates kernel.actual_wet_nis_kg from the sum of received_items.quantity_kg.
-- Replaces create_receiving_checklist + updateProductionBatch for the new schema.
-- Returns: { success, kernel_id }

CREATE OR REPLACE FUNCTION public.upsert_kernel_checklist(
    p_kernel_id               uuid,
    p_date_received           date    DEFAULT NULL,
    p_delivery_note_ref       varchar DEFAULT NULL,
    p_supplier_id             uuid    DEFAULT NULL,
    p_vehicle_clean           varchar DEFAULT NULL,
    p_vehicle_enclosed        varchar DEFAULT NULL,
    p_hazard_substances       varchar DEFAULT NULL,
    p_pest_infestations       varchar DEFAULT NULL,
    p_pallets_condition       varchar DEFAULT NULL,
    p_raw_materials_condition varchar DEFAULT NULL,
    p_comments                text    DEFAULT NULL,
    p_received_items          jsonb   DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_checklist    jsonb;
    v_total_kg     numeric;
BEGIN
    -- Build the receiving_checklist JSONB object
    v_checklist := jsonb_build_object(
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
        'received_items',          COALESCE(p_received_items, '[]'::jsonb),
        'completed_at',            NOW()
    );

    -- Sum received_items to get actual wet NIS kg
    SELECT COALESCE(SUM((item ->> 'quantity_kg')::numeric), 0)
    INTO   v_total_kg
    FROM   jsonb_array_elements(COALESCE(p_received_items, '[]'::jsonb)) AS item
    WHERE  (item ->> 'quantity_kg') IS NOT NULL;

    -- Write checklist into intake_data and update actual weight
    UPDATE public.kernel
    SET intake_data       = jsonb_set(
                                COALESCE(intake_data, '{}'::jsonb),
                                ARRAY['receiving_checklist'],
                                v_checklist,
                                true
                            ),
        actual_wet_nis_kg = v_total_kg,
        updated_at        = NOW()
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

-- ── RBAC ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'upsert_kernel_checklist', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
