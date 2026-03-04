-- Assign a kernel batch to one or more silos (1-12). Only empty silos can be assigned.
-- Used after "Release to production" from Grower Intake when user selects silos.
-- Updates silo table and kernel.silos (integer[]) with the assigned silo numbers.
CREATE OR REPLACE FUNCTION public.assign_kernel_to_silos(
    p_kernel_id uuid,
    p_silo_numbers integer[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer;
    sn integer;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel ID is required');
    END IF;

    FOREACH sn IN ARRAY p_silo_numbers
    LOOP
        IF sn IS NULL OR sn < 1 OR sn > 12 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Silo numbers must be between 1 and 12');
        END IF;
    END LOOP;

    -- Update silo table: assign kernel to selected empty silos
    UPDATE public.silo s
    SET kernel_id = p_kernel_id,
        status = 'occupied',
        oil_batch_id = NULL,
        updated_at = NOW()
    WHERE s.silo_number = ANY(p_silo_numbers)
      AND (s.kernel_id IS NULL AND s.oil_batch_id IS NULL);

    GET DIAGNOSTICS n = ROW_COUNT;

    -- Persist silo numbers on the kernel (batch) row
    UPDATE public.kernel
    SET silos = p_silo_numbers,
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'silos_assigned', n);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'assign_kernel_to_silos', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
