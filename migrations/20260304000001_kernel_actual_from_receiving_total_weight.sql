-- Grower intake "Actual" column = Total weight (kg) from Receiving Checklist (sum of bag weights).
-- Previously actual_wet_nis_kg was set to (total - removed_pre_sizer). Now set to total (sum of received_items).

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
    -- Sum received_items = Total weight (kg) from checklist; this is what shows as "Actual" in grower intake table
    SELECT COALESCE(SUM((item ->> 'quantity_kg')::numeric), 0)
    INTO   v_total_kg
    FROM   jsonb_array_elements(COALESCE(p_received_items, '[]'::jsonb)) AS item
    WHERE  (item ->> 'quantity_kg') IS NOT NULL;

    -- Balance (total - removed pre sizer) is stored in receiving_checklist only; Actual column = total weight
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

    -- Actual column in grower intake = Total weight (sum of bag weights). Do NOT change supplied (wet_nis_received_kg).
    UPDATE public.kernel
    SET intake_data         = jsonb_set(
                                COALESCE(intake_data, '{}'::jsonb),
                                ARRAY['receiving_checklist'],
                                v_checklist,
                                true
                            ),
        actual_wet_nis_kg   = v_total_kg,
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
