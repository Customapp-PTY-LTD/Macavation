-- Migration: create_kernel_batch + complete_kernel_batch
-- Used by: kernel_production_batch_actions.js (saveNewBatch + releaseBatchToStock)

-- ============================================================
-- 1. create_kernel_batch — insert into batches + kernel tables
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_kernel_batch(
    p_batch_number          varchar,
    p_received_date         date,
    p_wet_nis_received_kg   numeric  DEFAULT NULL,
    p_supplier_id           uuid     DEFAULT NULL,
    p_grower_name           varchar  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id  uuid;
    v_kernel_id uuid;
BEGIN
    -- Insert parent batch record
    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (p_batch_number, 'kernel', true)
    RETURNING id INTO v_batch_id;

    -- Insert kernel row with status 'production' (created from production grid)
    INSERT INTO public.kernel (
        batch_id, supplier_id, grower_name, status,
        received_date, wet_nis_received_kg, is_active
    )
    VALUES (
        v_batch_id, p_supplier_id, p_grower_name, 'production',
        p_received_date, p_wet_nis_received_kg, true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object('success', true, 'id', v_kernel_id, 'batch_id', v_batch_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists');
END;
$$;

-- ============================================================
-- 2. complete_kernel_batch — advance status to 'complete'
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_kernel_batch(
    p_kernel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel
    SET status     = 'complete',
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- RBAC: Grant EXECUTE on both functions to all roles
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_fn varchar;
    v_fns varchar[] := ARRAY[
        'create_kernel_batch',
        'complete_kernel_batch'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
