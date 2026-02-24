-- Fix "Could not find the function ... in the schema cache" when saving from Grower Intake
-- "New batch sample" modal, 5 kg tab. PostgREST matches RPC by the set of parameter names;
-- the 5 kg tab sends extra params (crack-out, float, unsound, supplier, etc.). This migration
-- extends the function to accept all parameters the frontend sends (with DEFAULT NULL for
-- the new ones) so the schema cache finds the function. The INSERT continues to use only
-- the columns that exist on sample_submissions; extra params are accepted but not yet persisted.

CREATE OR REPLACE FUNCTION public.create_sample_submission_for_batch(
    p_batch_id uuid,
    p_moisture_required boolean DEFAULT false,
    p_moisture_result numeric DEFAULT NULL,
    p_peroxide_required boolean DEFAULT false,
    p_peroxide_result numeric DEFAULT NULL,
    p_ffa_required boolean DEFAULT false,
    p_ffa_result numeric DEFAULT NULL,
    p_wet_nut_in_shell_kg numeric DEFAULT 0,
    -- 5 kg tab params (accepted so schema cache finds the function; use in INSERT where columns exist)
    p_sample_type varchar DEFAULT NULL,
    p_supplier varchar DEFAULT NULL,
    p_supplier_code varchar DEFAULT NULL,
    p_delivery_date date DEFAULT NULL,
    p_job_number varchar DEFAULT NULL,
    p_moisture_content numeric DEFAULT NULL,
    p_crack_out_sound_kernel_g numeric DEFAULT NULL,
    p_crack_out_unsound_kernel_g numeric DEFAULT NULL,
    p_crack_out_shell_g numeric DEFAULT NULL,
    p_float_floating_g numeric DEFAULT NULL,
    p_float_sinking_g numeric DEFAULT NULL,
    p_unsound_germination_g numeric DEFAULT NULL,
    p_unsound_late_stinkbug_g numeric DEFAULT NULL,
    p_unsound_early_stinkbug_g numeric DEFAULT NULL,
    p_unsound_dark_centre_g numeric DEFAULT NULL,
    p_unsound_mould_g numeric DEFAULT NULL,
    p_unsound_rotten_g numeric DEFAULT NULL,
    p_unsound_immature_split_g numeric DEFAULT NULL,
    p_unsound_shrivelled_g numeric DEFAULT NULL,
    p_unsound_nut_borer_g numeric DEFAULT NULL
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
        COALESCE(NULLIF(trim(v_batch.grower_name), ''), NULLIF(trim(p_supplier), ''), 'Unknown'),
        COALESCE(p_delivery_date, v_batch.received_date),
        v_batch.batch_number,
        COALESCE(p_wet_nut_in_shell_kg, 0),
        COALESCE(p_moisture_result, p_moisture_content, 0),
        COALESCE(p_ffa_result, 0),
        COALESCE(p_peroxide_result, 0),
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

-- Grant execute: full signature for roles (PostgREST uses param set for lookup)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT EXECUTE ON FUNCTION public.create_sample_submission_for_batch(
            uuid, boolean, numeric, boolean, numeric, boolean, numeric, numeric,
            varchar, varchar, varchar, date, varchar, numeric,
            numeric, numeric, numeric, numeric, numeric,
            numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
        ) TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.create_sample_submission_for_batch(
            uuid, boolean, numeric, boolean, numeric, boolean, numeric, numeric,
            varchar, varchar, varchar, date, varchar, numeric,
            numeric, numeric, numeric, numeric, numeric,
            numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
        ) TO service_role;
    END IF;
END
$$;
