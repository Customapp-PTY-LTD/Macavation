-- Restore release_kernel_to_production after 20260314000003 incorrectly dropped the only
-- remaining overload (consolidate left a single (uuid, integer[]) function; drop removed it).
-- PostgREST exposes this as callable with p_kernel_id alone (p_silos defaults to NULL).

CREATE OR REPLACE FUNCTION public.release_kernel_to_production(
    p_kernel_id uuid,
    p_silos integer[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_has_ziplock boolean;
    v_has_5kg     boolean;
    v_status      varchar;
    sn            integer;
BEGIN
    SELECT
        (intake_data #>> '{ziplock_sample,completed_at}') IS NOT NULL,
        (intake_data #>> '{five_kg_sample,completed_at}') IS NOT NULL,
        status
    INTO v_has_ziplock, v_has_5kg, v_status
    FROM public.kernel
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;

    IF NOT v_has_ziplock THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ziplock sample not completed — save it before releasing.');
    END IF;

    IF NOT v_has_5kg THEN
        RETURN jsonb_build_object('success', false, 'error', '5kg sample not completed — save it before releasing.');
    END IF;

    IF v_status NOT IN ('intake', 'receiving') THEN
        RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'already_released', true);
    END IF;

    UPDATE public.kernel
    SET status     = 'production',
        updated_at = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    IF p_silos IS NOT NULL AND array_length(p_silos, 1) > 0 THEN
        FOREACH sn IN ARRAY p_silos
        LOOP
            IF sn IS NULL OR sn < 1 OR sn > 12 THEN
                RETURN jsonb_build_object('success', false, 'error', 'Silo numbers must be between 1 and 12');
            END IF;
        END LOOP;

        UPDATE public.silo s
        SET kernel_id = p_kernel_id,
            status = 'occupied',
            oil_batch_id = NULL,
            updated_at = NOW()
        WHERE s.silo_number = ANY(p_silos)
          AND (s.kernel_id IS NULL AND s.oil_batch_id IS NULL);

        UPDATE public.kernel
        SET silos = p_silos,
            updated_at = NOW()
        WHERE id = p_kernel_id AND is_active = true;
    END IF;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'release_kernel_to_production', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
