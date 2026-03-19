-- Mark a supplier-intake oil batch as emptied after use in the press (Oil Production).
-- Moves status from 'production' to 'raw_empty' so it leaves "Raw ingredients in production"
-- and appears in the finished (emptied) list.

CREATE OR REPLACE FUNCTION public.mark_oil_raw_ingredient_empty(
    p_oil_id      uuid,
    p_updated_by  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_oil_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_oil_id is required');
    END IF;

    UPDATE public.oil
    SET
        status = 'raw_empty',
        production_completed_at = COALESCE(production_completed_at, NOW()),
        intake_data = COALESCE(intake_data, '{}'::jsonb) || jsonb_build_object(
            'raw_emptied_at', to_jsonb(NOW())
        ),
        updated_by = COALESCE(p_updated_by, updated_by),
        updated_at = NOW()
    WHERE id = p_oil_id
      AND is_active = true
      AND status = 'production'
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Batch not found, not active, or not in production — cannot mark empty'
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

COMMENT ON FUNCTION public.mark_oil_raw_ingredient_empty IS 'Oil Production: transition raw ingredient bag from status production to raw_empty after press is emptied.';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'mark_oil_raw_ingredient_empty', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
