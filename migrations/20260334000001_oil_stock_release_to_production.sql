-- Oil stock: release ledger lots to oil production by matching batch_number to public.oil.batch_id (supplier intake).
-- Apply via Supabase MCP (execute_sql / apply_migration) and reload PostgREST.

CREATE OR REPLACE FUNCTION public.release_oil_stock_lots_to_oil_production(p_lot_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_batch text;
  v_oil_id uuid;
  v_released int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF p_lot_ids IS NULL OR cardinality(p_lot_ids) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No lot ids provided');
  END IF;

  FOREACH v_id IN ARRAY p_lot_ids
  LOOP
    SELECT NULLIF(trim(both FROM batch_number), '') INTO v_batch
    FROM public.oil_stock_lots
    WHERE id = v_id AND is_active = true;

    IF v_batch IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'lot_id', v_id,
        'error', 'Lot not found or batch number empty'
      ));
      CONTINUE;
    END IF;

    SELECT o.id INTO v_oil_id
    FROM public.oil o
    WHERE o.is_active = true
      AND trim(both FROM o.batch_id) = v_batch
    LIMIT 1;

    IF v_oil_id IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'lot_id', v_id,
        'batch_number', v_batch,
        'error', 'No matching supplier intake (oil) batch for this batch number'
      ));
      CONTINUE;
    END IF;

    UPDATE public.oil
    SET status = 'production',
        updated_at = now()
    WHERE id = v_oil_id;

    v_released := v_released + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'released_count', v_released,
    'errors', v_errors
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.release_oil_stock_lots_to_oil_production(uuid[]) IS
  'Sets oil.status to production for intake rows whose batch_id matches selected oil_stock_lots.batch_number.';

NOTIFY pgrst, 'reload schema';

-- RBAC: same roles as update_oil_stock_lot_simple
DO $$
DECLARE
  v_admin uuid := '9c69485d-0116-4cf6-b7e6-2ff6c025478e'::uuid;
  v_super uuid := 'f8c7989a-cdf4-4804-952a-47565acd9c4c'::uuid;
BEGIN
  INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
  SELECT r.role_id, 'function', 'release_oil_stock_lots_to_oil_production', 'EXECUTE', true
  FROM (VALUES (v_admin), (v_super)) AS r(role_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.role_id
      AND rp.object_type = 'function'
      AND rp.object_name = 'release_oil_stock_lots_to_oil_production'
      AND rp.operation = 'EXECUTE'
  );
END;
$$;
