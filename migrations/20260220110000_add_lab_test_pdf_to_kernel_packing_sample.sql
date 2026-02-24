-- Add lab_test_pdf_url to kernel_packing_samples so create_kernel_packing_sample
-- accepts the same parameters the frontend sends (fixes "function not found in schema cache").

ALTER TABLE public.kernel_packing_samples
    ADD COLUMN IF NOT EXISTS lab_test_pdf_url text NULL;

-- Recreate function to include lab_test_pdf_url (parameter order matches frontend payload)
CREATE OR REPLACE FUNCTION public.create_kernel_packing_sample(
    production_batch_id uuid,
    moisture_required boolean DEFAULT false,
    moisture_result numeric DEFAULT NULL,
    peroxide_required boolean DEFAULT false,
    peroxide_result numeric DEFAULT NULL,
    ffa_required boolean DEFAULT false,
    ffa_result numeric DEFAULT NULL,
    internal_micro_required boolean DEFAULT false,
    internal_micro_result text DEFAULT NULL,
    external_lab_required boolean DEFAULT false,
    external_lab_result text DEFAULT NULL,
    lab_test_pdf_url text DEFAULT NULL,
    supervisor_signed_by text DEFAULT NULL,
    nut_plant_manager_signed_by text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF production_batch_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'production_batch_id is required');
    END IF;

    INSERT INTO public.kernel_packing_samples (
        production_batch_id,
        moisture_required,
        moisture_result,
        peroxide_required,
        peroxide_result,
        ffa_required,
        ffa_result,
        internal_micro_required,
        internal_micro_result,
        external_lab_required,
        external_lab_result,
        lab_test_pdf_url,
        supervisor_signed_by,
        nut_plant_manager_signed_by,
        updated_at
    )
    VALUES (
        production_batch_id,
        COALESCE(moisture_required, false),
        moisture_result,
        COALESCE(peroxide_required, false),
        peroxide_result,
        COALESCE(ffa_required, false),
        ffa_result,
        COALESCE(internal_micro_required, false),
        internal_micro_result,
        COALESCE(external_lab_required, false),
        external_lab_result,
        lab_test_pdf_url,
        supervisor_signed_by,
        nut_plant_manager_signed_by,
        now()
    )
    RETURNING id INTO v_id;

    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'production_batch_id', production_batch_id,
        'message', 'Kernel packing sample created'
    );
EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN json_build_object('success', false, 'error', 'Invalid production_batch_id');
    WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'error', 'Packing sample already exists for this batch');
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to create packing sample: ' || SQLERRM);
END;
$$;
