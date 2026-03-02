-- When initialize_kernel_for_batch finds an existing kernel row (same batch), update intake
-- fields (wet_nis_received_kg, grower_name, supplier_id, received_date) so that creating
-- the same batch again from Grower Intake (e.g. correcting NIS weight) persists the new values.
-- Fixes: user entered 20 kg at Grower Intake but Production showed 1000 (existing row was not updated).

CREATE OR REPLACE FUNCTION public.initialize_kernel_for_batch(
    p_batch_uuid          uuid,
    p_supplier_id         uuid    DEFAULT NULL,
    p_grower_name         varchar DEFAULT NULL,
    p_received_date       date    DEFAULT NULL,
    p_wet_nis_received_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_kernel_id uuid;
BEGIN
    SELECT id INTO v_kernel_id
    FROM public.kernel
    WHERE batch_id = p_batch_uuid AND is_active = true
    LIMIT 1;

    IF v_kernel_id IS NOT NULL THEN
        -- Update intake fields when caller provides them (e.g. Grower Intake correcting weight)
        UPDATE public.kernel
        SET
            wet_nis_received_kg = CASE WHEN p_wet_nis_received_kg IS NOT NULL THEN p_wet_nis_received_kg ELSE wet_nis_received_kg END,
            grower_name         = CASE WHEN p_grower_name IS NOT NULL THEN p_grower_name ELSE grower_name END,
            supplier_id        = CASE WHEN p_supplier_id IS NOT NULL THEN p_supplier_id ELSE supplier_id END,
            received_date      = CASE WHEN p_received_date IS NOT NULL THEN p_received_date ELSE received_date END,
            updated_at         = NOW()
        WHERE id = v_kernel_id;

        RETURN jsonb_build_object(
            'success',    true,
            'id',         v_kernel_id,
            'batch_uuid', p_batch_uuid,
            'existing',   true
        );
    END IF;

    INSERT INTO public.kernel (
        batch_id,
        supplier_id,
        grower_name,
        status,
        received_date,
        wet_nis_received_kg,
        is_active
    )
    VALUES (
        p_batch_uuid,
        p_supplier_id,
        p_grower_name,
        'intake',
        COALESCE(p_received_date, CURRENT_DATE),
        p_wet_nis_received_kg,
        true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object(
        'success',    true,
        'id',         v_kernel_id,
        'batch_uuid', p_batch_uuid,
        'existing',   false
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
