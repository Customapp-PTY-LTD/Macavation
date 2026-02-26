-- Migration: 20260226000011 — save_kernel_intake_sample
-- Saves ziplock or 5kg sample data directly into kernel.intake_data JSONB.
-- Replaces the production_batches-dependent create_sample_submission_for_batch
-- for the new batches/kernel schema.
-- Returns: { success, kernel_id, sample_type }

-- ─────────────────────────────────────────────────────────────────────────────
-- save_kernel_intake_sample
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_kernel_intake_sample(
    p_kernel_id                   uuid,
    p_sample_type                 varchar,        -- 'ziplock' or '5kg'
    -- ziplock fields
    p_moisture_required           boolean DEFAULT NULL,
    p_moisture_result             numeric DEFAULT NULL,
    p_peroxide_required           boolean DEFAULT NULL,
    p_peroxide_result             numeric DEFAULT NULL,
    p_ffa_required                boolean DEFAULT NULL,
    p_ffa_result                  numeric DEFAULT NULL,
    p_wet_nut_in_shell_kg         numeric DEFAULT NULL,
    -- 5kg crack-out fields
    p_crack_out_sound_kernel_g    numeric DEFAULT NULL,
    p_crack_out_unsound_kernel_g  numeric DEFAULT NULL,
    p_crack_out_shell_g           numeric DEFAULT NULL,
    -- 5kg float-test fields
    p_float_floating_g            numeric DEFAULT NULL,
    p_float_sinking_g             numeric DEFAULT NULL,
    -- 5kg unsound breakdown fields
    p_unsound_germination_g       numeric DEFAULT NULL,
    p_unsound_late_stinkbug_g     numeric DEFAULT NULL,
    p_unsound_early_stinkbug_g    numeric DEFAULT NULL,
    p_unsound_dark_centre_g       numeric DEFAULT NULL,
    p_unsound_mould_g             numeric DEFAULT NULL,
    p_unsound_rotten_g            numeric DEFAULT NULL,
    p_unsound_immature_split_g    numeric DEFAULT NULL,
    p_unsound_shrivelled_g        numeric DEFAULT NULL,
    p_unsound_nut_borer_g         numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sample_jsonb jsonb;
    v_path         text[];
BEGIN
    IF p_sample_type = 'ziplock' THEN
        v_path         := ARRAY['ziplock_sample'];
        v_sample_jsonb := jsonb_build_object(
            'moisture_required',   p_moisture_required,
            'moisture_result',     p_moisture_result,
            'peroxide_required',   p_peroxide_required,
            'peroxide_result',     p_peroxide_result,
            'ffa_required',        p_ffa_required,
            'ffa_result',          p_ffa_result,
            'wet_nut_in_shell_kg', p_wet_nut_in_shell_kg,
            'completed_at',        NOW()
        );

    ELSIF p_sample_type = '5kg' THEN
        v_path         := ARRAY['five_kg_sample'];
        v_sample_jsonb := jsonb_build_object(
            'crack_out', jsonb_build_object(
                'sound_kernel_g',   p_crack_out_sound_kernel_g,
                'unsound_kernel_g', p_crack_out_unsound_kernel_g,
                'shell_g',          p_crack_out_shell_g
            ),
            'float_test', jsonb_build_object(
                'floating_g', p_float_floating_g,
                'sinking_g',  p_float_sinking_g
            ),
            'unsound', jsonb_build_object(
                'germination_g',    p_unsound_germination_g,
                'late_stinkbug_g',  p_unsound_late_stinkbug_g,
                'early_stinkbug_g', p_unsound_early_stinkbug_g,
                'dark_centre_g',    p_unsound_dark_centre_g,
                'mould_g',          p_unsound_mould_g,
                'rotten_g',         p_unsound_rotten_g,
                'immature_split_g', p_unsound_immature_split_g,
                'shrivelled_g',     p_unsound_shrivelled_g,
                'nut_borer_g',      p_unsound_nut_borer_g
            ),
            'completed_at', NOW()
        );

    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Unknown sample_type: ' || COALESCE(p_sample_type, 'null'));
    END IF;

    UPDATE public.kernel
    SET intake_data = jsonb_set(
                          COALESCE(intake_data, '{}'::jsonb),
                          v_path,
                          v_sample_jsonb,
                          true   -- create key if missing
                      ),
        updated_at  = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'sample_type', p_sample_type);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'save_kernel_intake_sample', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
