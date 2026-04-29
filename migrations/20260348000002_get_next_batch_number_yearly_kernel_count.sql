-- Kernel batch naming: Bn SS YY NN — NN is the first unused sequence for the
-- calendar year (YY) across all kernel batches. This ignores duplicates and
-- old/manual outlier suffixes such as 56 or 88, so if 01..08 exist the next
-- batch will use 09.

CREATE OR REPLACE FUNCTION public.get_next_batch_number(
    p_supplier_id uuid DEFAULT NULL,
    p_year       int DEFAULT NULL
)
RETURNS varchar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_supplier_no int;
    v_year2       int;
    v_prefix      varchar;
    v_seq         int;
BEGIN
    v_year2 := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int) % 100;

    IF p_supplier_id IS NOT NULL THEN
        SELECT COALESCE(c.supplier_number, 0) INTO v_supplier_no
        FROM public.contacts c
        WHERE c.id = p_supplier_id;
    END IF;
    v_supplier_no := COALESCE(v_supplier_no, 0);

    v_prefix := 'Bn ' || lpad(v_supplier_no::text, 2, '0') || ' ' || lpad(v_year2::text, 2, '0') || ' ';

    SELECT gs.seq INTO v_seq
    FROM generate_series(1, 99) AS gs(seq)
    WHERE NOT EXISTS (
        SELECT 1
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE k.is_active = true
          AND b.is_active = true
          AND b.batch_type = 'kernel'
          AND b.batch_id ~ ('^Bn [0-9]{2} ' || lpad(v_year2::text, 2, '0') || ' ' || lpad(gs.seq::text, 2, '0') || '$')
    )
    ORDER BY gs.seq
    LIMIT 1;

    v_seq := COALESCE(v_seq, 99);

    RETURN v_prefix || lpad(v_seq::text, 2, '0');
END;
$$;

COMMENT ON FUNCTION public.get_next_batch_number(uuid, int) IS
    'Next kernel batch id Bn SS YY NN: SS from supplier (or 00); YY from year; NN = first unused yearly sequence across all kernel batches.';
