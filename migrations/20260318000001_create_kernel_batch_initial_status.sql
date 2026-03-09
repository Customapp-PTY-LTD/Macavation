-- create_kernel_batch: add p_initial_status so Grower Intake can create batches with status 'intake'
-- and they appear in the Grower Intake list. Kernel Production "New batch" keeps default 'production'.

DROP FUNCTION IF EXISTS public.create_kernel_batch(varchar, date, numeric, uuid, varchar);

CREATE OR REPLACE FUNCTION public.create_kernel_batch(
    p_batch_number          varchar DEFAULT NULL,
    p_received_date         date DEFAULT NULL,
    p_wet_nis_received_kg   numeric  DEFAULT NULL,
    p_supplier_id           uuid     DEFAULT NULL,
    p_grower_name           varchar  DEFAULT NULL,
    p_initial_status        varchar  DEFAULT 'production'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_number varchar;
    v_batch_id     uuid;
    v_kernel_id    uuid;
    v_year         int;
    v_status       varchar;
BEGIN
    v_status := COALESCE(NULLIF(trim(p_initial_status), ''), 'production');
    IF v_status NOT IN ('intake', 'receiving', 'production', 'qa', 'complete') THEN
        v_status := 'production';
    END IF;

    v_batch_number := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF v_batch_number IS NULL THEN
        v_year := EXTRACT(YEAR FROM COALESCE(p_received_date, CURRENT_DATE))::int;
        v_batch_number := public.get_next_batch_number(p_supplier_id, v_year);
    END IF;

    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (v_batch_number, 'kernel', true)
    RETURNING id INTO v_batch_id;

    INSERT INTO public.kernel (
        batch_id, supplier_id, grower_name, status,
        received_date, wet_nis_received_kg, is_active
    )
    VALUES (
        v_batch_id, p_supplier_id, p_grower_name, v_status,
        p_received_date, p_wet_nis_received_kg, true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object('success', true, 'id', v_kernel_id, 'batch_id', v_batch_id, 'batch_number', v_batch_number);
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists');
END;
$$;
