-- Batch naming: Bn SS YY NN (Bn, supplier number, 2-digit year, sequence for that supplier that year). Spaces between; zero-pad single digits.

-- ============================================================
-- 1. get_next_batch_number(p_supplier_id, p_year)
--    Returns next batch id e.g. 'Bn 01 26 01'. Uses contacts.supplier_number for SS; 00 if unknown.
-- ============================================================
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

    IF p_supplier_id IS NOT NULL THEN
        SELECT COUNT(*)::int INTO v_seq
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE k.supplier_id = p_supplier_id
          AND b.batch_id LIKE v_prefix || '%';
    ELSE
        SELECT COUNT(*)::int INTO v_seq
        FROM public.batches b
        WHERE b.batch_id LIKE v_prefix || '%';
    END IF;

    RETURN v_prefix || lpad((v_seq + 1)::text, 2, '0');
END;
$$;

-- ============================================================
-- 2. create_kernel_batch — allow null p_batch_number; then generate via get_next_batch_number
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_kernel_batch(
    p_batch_number          varchar DEFAULT NULL,
    p_received_date         date DEFAULT NULL,
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
    v_batch_number varchar;
    v_batch_id     uuid;
    v_kernel_id    uuid;
    v_year         int;
BEGIN
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
        v_batch_id, p_supplier_id, p_grower_name, 'production',
        p_received_date, p_wet_nis_received_kg, true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object('success', true, 'id', v_kernel_id, 'batch_id', v_batch_id, 'batch_number', v_batch_number);
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists');
END;
$$;

-- RBAC for new function
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_next_batch_number', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
