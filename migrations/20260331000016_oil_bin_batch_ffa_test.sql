-- FFA lab test on oil bin batches: record result, pass/fail, timestamp; show in production grid.

ALTER TABLE public.oil_bin_batch
    ADD COLUMN IF NOT EXISTS ffa_test_at timestamptz,
    ADD COLUMN IF NOT EXISTS ffa_test_pass boolean;

COMMENT ON COLUMN public.oil_bin_batch.ffa_test_at IS 'When the last FFA % test was recorded.';
COMMENT ON COLUMN public.oil_bin_batch.ffa_test_pass IS 'True = pass, false = fail (against site spec in UI).';

-- List RPC: include test columns (keep grade alias for proxies)
DROP FUNCTION IF EXISTS public.get_oil_bin_batches(character varying, integer, integer);

CREATE OR REPLACE FUNCTION public.get_oil_bin_batches(
    p_status varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_number varchar,
    shifts varchar,
    ingredients varchar,
    start_date date,
    letrerage numeric,
    ffa numeric,
    status varchar,
    oil_id uuid,
    created_at timestamptz,
    shift_id uuid,
    raw_ingredient_audit jsonb,
    duty_shift_date date,
    duty_shift_supervisor varchar,
    duty_shift_name varchar,
    oil_stream varchar,
    grade varchar,
    ffa_test_at timestamptz,
    ffa_test_pass boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        obb.id,
        obb.batch_number,
        obb.shifts,
        obb.ingredients,
        obb.start_date,
        obb.letrerage,
        obb.ffa,
        obb.status,
        obb.oil_id,
        obb.created_at,
        obb.shift_id,
        obb.raw_ingredient_audit,
        s.shift_date,
        s.shift_supervisor,
        s.shift_name,
        obb.oil_stream,
        obb.oil_stream AS grade,
        obb.ffa_test_at,
        obb.ffa_test_pass
    FROM public.oil_bin_batch obb
    LEFT JOIN public.shift s ON s.id = obb.shift_id
    WHERE (p_status IS NULL OR obb.status = p_status)
    ORDER BY obb.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- Record FFA test (param names ordered for PostgREST: p_bin_id, p_ffa_pct, p_pass)
CREATE OR REPLACE FUNCTION public.record_oil_bin_batch_ffa_test(
    p_bin_id   uuid,
    p_ffa_pct  numeric,
    p_pass     boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_bin_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_bin_id required');
    END IF;
    IF p_ffa_pct IS NULL OR p_ffa_pct < 0 OR p_ffa_pct > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'FFA % must be between 0 and 100');
    END IF;
    IF p_pass IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pass or fail is required');
    END IF;

    UPDATE public.oil_bin_batch
    SET ffa = p_ffa_pct,
        ffa_test_at = NOW(),
        ffa_test_pass = p_pass,
        updated_at = NOW()
    WHERE id = p_bin_id AND status = 'in_production';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found or already sent to stock');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.record_oil_bin_batch_ffa_test IS 'Record FFA lab % and pass/fail on an in-production oil bin batch.';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.role_permissions
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'record_oil_bin_batch_ffa_test' AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'record_oil_bin_batch_ffa_test', 'EXECUTE', true);
        ELSE
            UPDATE public.role_permissions SET allowed = true, updated_at = now()
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'record_oil_bin_batch_ffa_test' AND operation = 'EXECUTE';
        END IF;
    END LOOP;
END $$;
