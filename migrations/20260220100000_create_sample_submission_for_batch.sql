-- Create sample submission from Grower Intake "New batch sample" and link to batch.
-- Called when user fills in the receiving form (Moisture, Peroxide Value, Free Fatty Acids).

CREATE OR REPLACE FUNCTION public.create_sample_submission_for_batch(
    p_batch_id uuid,
    p_moisture_required boolean DEFAULT false,
    p_moisture_result numeric DEFAULT NULL,
    p_peroxide_required boolean DEFAULT false,
    p_peroxide_result numeric DEFAULT NULL,
    p_ffa_required boolean DEFAULT false,
    p_ffa_result numeric DEFAULT NULL,
    p_wet_nut_in_shell_kg numeric DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch record;
    v_submission_number varchar(50);
    v_id uuid;
BEGIN
    IF p_batch_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Batch id is required');
    END IF;

    SELECT id, batch_number, grower_name, received_date, supplier_id
    INTO v_batch
    FROM production_batches
    WHERE id = p_batch_id;

    IF v_batch.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Batch not found');
    END IF;

    v_submission_number := 'SMP-' || COALESCE(v_batch.batch_number, 'BATCH') || '-' || to_char(now(), 'YYYYMMDD-HH24MISS');
    -- Ensure uniqueness
    IF EXISTS (SELECT 1 FROM sample_submissions WHERE submission_number = v_submission_number) THEN
        v_submission_number := v_submission_number || '-' || substr(gen_random_uuid()::text, 1, 4);
    END IF;

    INSERT INTO sample_submissions (
        submission_number,
        supplier_id,
        grower_name,
        delivery_date,
        batch_number,
        wet_nut_in_shell_kg,
        moisture_content_percentage,
        ffa_percentage,
        peroxide_value,
        status
    )
    VALUES (
        v_submission_number,
        v_batch.supplier_id,
        v_batch.grower_name,
        v_batch.received_date,
        v_batch.batch_number,
        COALESCE(p_wet_nut_in_shell_kg, 0),
        p_moisture_result,
        p_ffa_result,
        p_peroxide_result,
        'pending'
    )
    RETURNING id INTO v_id;

    UPDATE production_batches
    SET sample_submission_id = v_id, updated_at = now()
    WHERE id = p_batch_id;

    RETURN json_build_object('success', true, 'id', v_id, 'submission_number', v_submission_number);
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execute to roles that need it (align with other data functions)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT EXECUTE ON FUNCTION public.create_sample_submission_for_batch(uuid, boolean, numeric, boolean, numeric, boolean, numeric, numeric) TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.create_sample_submission_for_batch(uuid, boolean, numeric, boolean, numeric, boolean, numeric, numeric) TO service_role;
    END IF;
END
$$;
