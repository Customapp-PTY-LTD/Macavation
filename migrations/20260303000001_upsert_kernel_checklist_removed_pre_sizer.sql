-- Migration: Add removed_pre_sizer_kg to upsert_kernel_checklist.
-- Stores removed_pre_sizer_kg in intake_data.receiving_checklist and sets:
--   wet_nis_received_kg = sum(received_items) [supplied]
--   actual_wet_nis_kg   = sum(received_items) - removed_pre_sizer_kg
-- So the grower intake grid shows Supplied and Actual correctly after save.

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
    p_received_items          jsonb   DEFAULT '[]'::jsonb,
    p_removed_pre_sizer_kg    numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_checklist    jsonb;
    v_total_kg     numeric;
    v_actual_kg    numeric;
BEGIN
    -- Sum received_items to get supplied total (wet_nis_received_kg)
    SELECT COALESCE(SUM((item ->> 'quantity_kg')::numeric), 0)
    INTO   v_total_kg
    FROM   jsonb_array_elements(COALESCE(p_received_items, '[]'::jsonb)) AS item
    WHERE  (item ->> 'quantity_kg') IS NOT NULL;

    -- Actual = supplied - removed pre sizer (never below 0)
    v_actual_kg := GREATEST(0, v_total_kg - COALESCE(p_removed_pre_sizer_kg, 0));

    -- Build the receiving_checklist JSONB object (include removed_pre_sizer_kg for edit form)
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
        'removed_pre_sizer_kg',    p_removed_pre_sizer_kg,
        'completed_at',            NOW()
    );

    -- Write checklist into intake_data; set supplied = total, actual = total - removed pre sizer
    UPDATE public.kernel
    SET intake_data         = jsonb_set(
                                COALESCE(intake_data, '{}'::jsonb),
                                ARRAY['receiving_checklist'],
                                v_checklist,
                                true
                            ),
        wet_nis_received_kg = v_total_kg,
        actual_wet_nis_kg   = v_actual_kg,
        updated_at          = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'total_kg', v_total_kg, 'actual_kg', v_actual_kg);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
