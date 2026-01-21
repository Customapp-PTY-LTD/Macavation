-- Create function to create a new production batch
CREATE OR REPLACE FUNCTION create_production_batch_simple(
    p_batch_number varchar,
    p_received_date date,
    p_wet_nis_received_kg decimal,
    p_supplier_id uuid DEFAULT NULL,
    p_grower_name varchar DEFAULT NULL,
    p_receiving_moisture_percentage decimal DEFAULT NULL,
    p_start_date date DEFAULT NULL,
    p_estimated_completion_date date DEFAULT NULL,
    p_batch_type varchar DEFAULT 'kernel',
    p_status varchar DEFAULT 'receiving',
    p_current_step integer DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
    v_batch_number varchar;
BEGIN
    -- Validate required fields
    IF p_batch_number IS NULL OR p_batch_number = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Batch number is required'
        );
    END IF;
    
    IF p_received_date IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Received date is required'
        );
    END IF;
    
    IF p_wet_nis_received_kg IS NULL OR p_wet_nis_received_kg <= 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Wet NIS received (kg) must be greater than 0'
        );
    END IF;
    
    -- Check if batch number already exists
    SELECT id INTO v_id
    FROM production_batches
    WHERE batch_number = p_batch_number;
    
    IF v_id IS NOT NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Batch number already exists: ' || p_batch_number
        );
    END IF;
    
    -- Insert new batch
    INSERT INTO production_batches (
        batch_number,
        batch_type,
        supplier_id,
        grower_name,
        wet_nis_received_kg,
        received_date,
        receiving_moisture_percentage,
        start_date,
        estimated_completion_date,
        current_step,
        status,
        created_at,
        updated_at
    )
    VALUES (
        p_batch_number,
        COALESCE(p_batch_type, 'kernel'),
        p_supplier_id,
        p_grower_name,
        p_wet_nis_received_kg,
        p_received_date,
        p_receiving_moisture_percentage,
        p_start_date,
        p_estimated_completion_date,
        COALESCE(p_current_step, 1),
        COALESCE(p_status, 'receiving'),
        NOW(),
        NOW()
    )
    RETURNING id, batch_number INTO v_id, v_batch_number;
    
    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'batch_number', v_batch_number,
        'message', 'Production batch created successfully'
    );
    
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Batch number already exists: ' || p_batch_number
        );
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to create production batch: ' || SQLERRM
        );
END;
$$;

-- Grant execute permission to admin and super_user roles
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_production_batch_simple', 'EXECUTE', true
FROM public.roles r
WHERE r.role_name IN ('admin', 'super_user')
ON CONFLICT DO NOTHING;
