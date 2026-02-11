-- Avoid "cannot extract elements from a scalar" when p_received_items is not a JSON array
-- Also handle client sending string (parse to jsonb when type is 'string')

CREATE OR REPLACE FUNCTION public.create_receiving_checklist(
    p_date_received date,
    p_delivery_note_ref character varying,
    p_supplier_id uuid DEFAULT NULL,
    p_vehicle_clean character varying DEFAULT NULL,
    p_vehicle_enclosed character varying DEFAULT NULL,
    p_hazard_substances character varying DEFAULT NULL,
    p_pest_infestations character varying DEFAULT NULL,
    p_pallets_condition character varying DEFAULT NULL,
    p_raw_materials_condition character varying DEFAULT NULL,
    p_comments text DEFAULT NULL,
    p_received_items jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
    v_id uuid;
    v_item jsonb;
    v_items jsonb;
BEGIN
    IF p_date_received IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Date received is required');
    END IF;
    IF p_delivery_note_ref IS NULL OR trim(p_delivery_note_ref) = '' THEN
        RETURN json_build_object('success', false, 'error', 'Delivery note reference is required');
    END IF;

    INSERT INTO receiving_checklists (
        date_received, delivery_note_ref, supplier_id,
        vehicle_clean, vehicle_enclosed, hazard_substances,
        pest_infestations, pallets_condition, raw_materials_condition,
        comments
    )
    VALUES (
        p_date_received, p_delivery_note_ref, p_supplier_id,
        p_vehicle_clean, p_vehicle_enclosed, p_hazard_substances,
        p_pest_infestations, p_pallets_condition, p_raw_materials_condition,
        p_comments
    )
    RETURNING id INTO v_id;

    v_items := p_received_items;
    IF p_received_items IS NOT NULL AND jsonb_typeof(p_received_items) = 'string' THEN
        v_items := (p_received_items#>>'{}')::jsonb;
    END IF;
    IF v_items IS NOT NULL AND jsonb_typeof(v_items) = 'array' THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
        LOOP
            INSERT INTO received_items (
                receiving_checklist_id, reference, description, batch,
                carton_bags, quantity_kg, manufactured_date, best_before_date
            )
            VALUES (
                v_id,
                v_item->>'reference',
                v_item->>'description',
                v_item->>'batch',
                (v_item->>'carton_bags')::integer,
                (v_item->>'quantity_kg')::numeric,
                (v_item->>'manufactured_date')::date,
                (v_item->>'best_before_date')::date
            );
        END LOOP;
    END IF;

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'Receiving checklist created successfully');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_receiving_checklist(
    p_receiving_id uuid,
    p_date_received date DEFAULT NULL,
    p_delivery_note_ref character varying DEFAULT NULL,
    p_supplier_id uuid DEFAULT NULL,
    p_vehicle_clean character varying DEFAULT NULL,
    p_vehicle_enclosed character varying DEFAULT NULL,
    p_hazard_substances character varying DEFAULT NULL,
    p_pest_infestations character varying DEFAULT NULL,
    p_pallets_condition character varying DEFAULT NULL,
    p_raw_materials_condition character varying DEFAULT NULL,
    p_comments text DEFAULT NULL,
    p_received_items jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
    v_item jsonb;
    v_items jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM receiving_checklists WHERE id = p_receiving_id) THEN
        RETURN json_build_object('success', false, 'error', 'Receiving checklist not found');
    END IF;

    UPDATE receiving_checklists
    SET
        date_received = COALESCE(p_date_received, date_received),
        delivery_note_ref = COALESCE(p_delivery_note_ref, delivery_note_ref),
        supplier_id = COALESCE(p_supplier_id, supplier_id),
        vehicle_clean = COALESCE(p_vehicle_clean, vehicle_clean),
        vehicle_enclosed = COALESCE(p_vehicle_enclosed, vehicle_enclosed),
        hazard_substances = COALESCE(p_hazard_substances, hazard_substances),
        pest_infestations = COALESCE(p_pest_infestations, pest_infestations),
        pallets_condition = COALESCE(p_pallets_condition, pallets_condition),
        raw_materials_condition = COALESCE(p_raw_materials_condition, raw_materials_condition),
        comments = COALESCE(p_comments, comments),
        updated_at = NOW()
    WHERE id = p_receiving_id;

    v_items := p_received_items;
    IF p_received_items IS NOT NULL AND jsonb_typeof(p_received_items) = 'string' THEN
        v_items := (p_received_items#>>'{}')::jsonb;
    END IF;
    IF v_items IS NOT NULL AND jsonb_typeof(v_items) = 'array' THEN
        DELETE FROM received_items WHERE receiving_checklist_id = p_receiving_id;
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
        LOOP
            INSERT INTO received_items (
                receiving_checklist_id, reference, description, batch,
                carton_bags, quantity_kg, manufactured_date, best_before_date
            )
            VALUES (
                p_receiving_id,
                v_item->>'reference',
                v_item->>'description',
                v_item->>'batch',
                (v_item->>'carton_bags')::integer,
                (v_item->>'quantity_kg')::numeric,
                (v_item->>'manufactured_date')::date,
                (v_item->>'best_before_date')::date
            );
        END LOOP;
    END IF;

    RETURN json_build_object('success', true, 'id', p_receiving_id, 'message', 'Receiving checklist updated successfully');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;
