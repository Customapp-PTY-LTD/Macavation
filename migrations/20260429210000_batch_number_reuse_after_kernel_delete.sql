-- Allow reuse of kernel batch numbers after deactivation/removal.
-- Retired batches get batch_id renamed to _inactive_<uuidhex> and batches.is_active = false, so the
-- human-readable number is no longer present in the table and can be inserted again (global
-- UNIQUE(batch_id) on public.batches is preserved for ON CONFLICT and seeds).
-- get_next_batch_number: only count active kernel + active batch rows for NN.
-- update_kernel_stock_batch_info: when checking duplicates, ignore retired _inactive_* batch_ids.
--
-- Oil: public.oil already has idx_oil_batch_id_unique_active; soft-deleted oil rows (is_active false)
--     or hard-deleted rows do not block reusing the same oil.batch_id for a new active row.

-- ── Backfill: kernels already inactive still held original batch_id on batches (blocking reuse)
UPDATE public.batches b
SET
    is_active = false,
    batch_id = '_inactive_' || replace(b.id::text, '-', ''),
    updated_at = now()
FROM public.kernel k
WHERE k.batch_id = b.id
  AND k.is_active = false
  AND b.batch_type = 'kernel'
  AND b.batch_id NOT LIKE '\_inactive\_%' ESCAPE '\';

CREATE OR REPLACE FUNCTION public.deactivate_kernel_batch(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_uuid uuid;
BEGIN
    SELECT k.batch_id INTO v_batch_uuid
    FROM public.kernel k
    WHERE k.id = p_kernel_id;

    IF v_batch_uuid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    UPDATE public.batches b
    SET
        is_active = false,
        batch_id = CASE
            WHEN b.batch_id LIKE '\_inactive\_%' ESCAPE '\' THEN b.batch_id
            ELSE '_inactive_' || replace(b.id::text, '-', '')
        END,
        updated_at = NOW()
    WHERE b.id = v_batch_uuid
      AND b.batch_type = 'kernel';

    UPDATE public.kernel
    SET is_active = false,
        updated_at = NOW()
    WHERE id = p_kernel_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.deactivate_kernel_batch(uuid) IS
    'Soft delete: kernel.is_active false; batches row retired with _inactive_<uuid> batch_id so the human batch number can be reused.';

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

CREATE OR REPLACE FUNCTION public.update_kernel_stock_batch_info(
    p_kernel_id uuid,
    p_batch_number varchar,
    p_grower_name varchar DEFAULT NULL,
    p_received_date date DEFAULT NULL,
    p_wet_nis_received_kg numeric DEFAULT NULL,
    p_best_before_date date DEFAULT NULL,
    p_ffa numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_uuid uuid;
    v_new_bn text;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch is required');
    END IF;

    SELECT k.batch_id INTO v_batch_uuid
    FROM public.kernel k
    WHERE k.id = p_kernel_id AND k.is_active = true;

    IF v_batch_uuid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    v_new_bn := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF v_new_bn IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.batches b
        WHERE b.batch_id = v_new_bn
          AND b.id <> v_batch_uuid
          AND b.is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'That batch number is already in use');
    END IF;

    UPDATE public.batches
    SET batch_id = v_new_bn,
        updated_at = now()
    WHERE id = v_batch_uuid;

    UPDATE public.kernel k
    SET
        grower_name = NULLIF(trim(COALESCE(p_grower_name, '')), ''),
        received_date = p_received_date,
        wet_nis_received_kg = p_wet_nis_received_kg,
        job_card_data = CASE
            WHEN p_best_before_date IS NOT NULL THEN
                COALESCE(k.job_card_data, '{}'::jsonb) || jsonb_build_object('best_before_date', p_best_before_date::text)
            ELSE k.job_card_data
        END,
        qa_data = CASE
            WHEN p_ffa IS NOT NULL THEN
                COALESCE(k.qa_data, '{}'::jsonb) || jsonb_build_object('ffa_result', p_ffa::numeric)
            ELSE k.qa_data
        END,
        updated_at = now()
    WHERE k.id = p_kernel_id AND k.is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
