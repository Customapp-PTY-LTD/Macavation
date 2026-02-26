-- Migration: 20260226000013 — release_kernel_to_production
-- Validates that both ziplock_sample and five_kg_sample are saved in kernel.intake_data,
-- then advances kernel.status from intake/receiving → production.
-- Returns: { success, kernel_id } or { success: false, error }

CREATE OR REPLACE FUNCTION public.release_kernel_to_production(
    p_kernel_id uuid
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

    -- Already in production or beyond — idempotent return
    IF v_status NOT IN ('intake', 'receiving') THEN
        RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'already_released', true);
    END IF;

    UPDATE public.kernel
    SET status     = 'production',
        updated_at = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── RBAC ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'release_kernel_to_production', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
