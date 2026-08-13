-- Allow the batch edit RPC to change kernel.supplier_id.
--
-- Why: a batch captured against the wrong supplier could not be corrected anywhere in the app.
-- update_kernel_stock_batch_info renamed batches.batch_id in place but wrote only the free-text
-- kernel.grower_name, never kernel.supplier_id. Because batch numbers are 'Bn SS YY NN' where SS is
-- contacts.supplier_number (20260317000001_batch_naming_bn_supplier_year_seq.sql), the supplier and
-- the batch number have to move together, so the same call now does both.
--
-- p_supplier_id NULL means LEAVE UNCHANGED (same convention as initialize_kernel_for_batch in
-- 20260302000001_initialize_kernel_update_existing_intake_fields.sql). This path deliberately cannot
-- clear a supplier. Every other parameter keeps its existing semantics unchanged, including the
-- unconditional writes to grower_name / received_date / wet_nis_received_kg, where passing NULL
-- clears the stored value - Stock Management documents that behaviour to users.
--
-- DROP before CREATE is required: CREATE OR REPLACE with an extra defaulted argument would create a
-- second overload, and PostgREST cannot disambiguate overloaded RPCs. Dropping also drops the
-- function's grants, so they are re-issued below.
--
-- Rollback: drop the 8-arg function, recreate the 7-arg body from
-- 20260708150000_kernel_batch_archive_and_insert_guards.sql:592-669, re-grant, NOTIFY.

DROP FUNCTION IF EXISTS public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric);

CREATE OR REPLACE FUNCTION public.update_kernel_stock_batch_info(
    p_kernel_id uuid,
    p_batch_number varchar,
    p_grower_name varchar DEFAULT NULL,
    p_received_date date DEFAULT NULL,
    p_wet_nis_received_kg numeric DEFAULT NULL,
    p_best_before_date date DEFAULT NULL,
    p_ffa numeric DEFAULT NULL,
    p_supplier_id uuid DEFAULT NULL
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

    IF p_supplier_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.contacts c WHERE c.id = p_supplier_id AND c.deleted_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Selected supplier no longer exists');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.batches b
        JOIN public.kernel k ON k.batch_id = b.id
        WHERE b.batch_id = v_new_bn
          AND b.id <> v_batch_uuid
          AND b.batch_type = 'kernel'
          AND b.is_active = true
          AND k.is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'That batch number is already in use');
    END IF;

    UPDATE public.batches
    SET batch_id = v_new_bn,
        updated_at = now()
    WHERE id = v_batch_uuid;

    UPDATE public.kernel k
    SET
        supplier_id = COALESCE(p_supplier_id, k.supplier_id),
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
EXCEPTION
    -- The active-only guard above misses numbers still held by an archived batch, where the global
    -- UNIQUE on batches.batch_id would otherwise surface as an unhandled 500.
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number ' || v_new_bn || ' is already taken by another batch');
END;
$$;

COMMENT ON FUNCTION public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric, uuid) IS
    'Updates batches.batch_id (display batch number) and kernel row fields used by the shared batch edit dialog (supplier, grower, dates, wet NIS, job_card best_before_date, qa ffa_result). p_supplier_id NULL leaves the supplier unchanged.';

GRANT EXECUTE ON FUNCTION public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric, uuid) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_kernel_stock_batch_info', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.object_type = 'function'
      AND rp.object_name = 'update_kernel_stock_batch_info'
      AND rp.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true, updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'update_kernel_stock_batch_info'
  AND operation = 'EXECUTE';

NOTIFY pgrst, 'reload schema';
