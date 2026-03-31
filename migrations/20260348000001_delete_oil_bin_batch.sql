-- Allow deleting an oil bin batch before it is sent to stock.
-- Keeps the action scoped to in-production rows only.

CREATE OR REPLACE FUNCTION public.delete_oil_bin_batch(
    p_oil_bin_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.oil_bin_batch%ROWTYPE;
BEGIN
    SELECT *
    INTO v_row
    FROM public.oil_bin_batch
    WHERE id = p_oil_bin_batch_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found');
    END IF;

    IF COALESCE(v_row.status, '') <> 'in_production' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only in-production oil bin batches can be deleted');
    END IF;

    IF v_row.oil_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This oil bin batch has already been sent to stock and cannot be deleted');
    END IF;

    DELETE FROM public.oil_bin_batch
    WHERE id = p_oil_bin_batch_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', p_oil_bin_batch_id,
        'batch_number', v_row.batch_number
    );
END;
$$;

COMMENT ON FUNCTION public.delete_oil_bin_batch(uuid) IS
  'Deletes an in-production oil bin batch before it is sent to stock.';

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id,
       'function',
       'delete_oil_bin_batch',
       'EXECUTE',
       true
FROM public.role_permissions rp
WHERE rp.object_type = 'function'
  AND rp.object_name = 'update_oil_bin_batch'
  AND rp.operation = 'EXECUTE'
  AND COALESCE(rp.allowed, false) = true
  AND NOT EXISTS (
      SELECT 1
      FROM public.role_permissions x
      WHERE x.role_id = rp.role_id
        AND x.object_type = 'function'
        AND x.object_name = 'delete_oil_bin_batch'
        AND x.operation = 'EXECUTE'
  );

NOTIFY pgrst, 'reload schema';
