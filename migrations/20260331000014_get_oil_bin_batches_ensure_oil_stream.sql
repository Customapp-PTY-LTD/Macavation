-- Ensure list RPC returns oil_stream for Grade column (idempotent if 20260331000010 applied).

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
    oil_stream varchar
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
        obb.oil_stream
    FROM public.oil_bin_batch obb
    LEFT JOIN public.shift s ON s.id = obb.shift_id
    WHERE (p_status IS NULL OR obb.status = p_status)
    ORDER BY obb.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

NOTIFY pgrst, 'reload schema';
