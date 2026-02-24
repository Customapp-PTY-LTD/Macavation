-- Grower Intake: store actual weight (sum of bags from receiving checklist) and difference (supplied - actual).
-- actual_wet_nis_kg = sum of Weight (Kgs) from receiving checklist bags; wet_nis_weight_difference_kg = supplied - actual.

-- 1. Add columns to production_batches
ALTER TABLE public.production_batches
  ADD COLUMN IF NOT EXISTS actual_wet_nis_kg numeric,
  ADD COLUMN IF NOT EXISTS wet_nis_weight_difference_kg numeric;

COMMENT ON COLUMN public.production_batches.actual_wet_nis_kg IS 'Actual weight (kg) from receiving checklist - sum of all bag weights.';
COMMENT ON COLUMN public.production_batches.wet_nis_weight_difference_kg IS 'Supplied - Actual (wet_nis_received_kg - actual_wet_nis_kg).';

-- 2. RPC: set actual weight and difference for a batch (called by frontend after saving receiving checklist).
-- Parameter order (p_actual_wet_nis_kg, p_batch_id) matches schema cache lookup (alphabetical by param name).
CREATE OR REPLACE FUNCTION public.update_production_batch_actual_weight(
  p_actual_wet_nis_kg numeric DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplied numeric;
  v_diff numeric;
  v_updated integer := 0;
  v_found boolean := false;
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Batch id is required');
  END IF;

  SELECT wet_nis_received_kg INTO v_supplied FROM public.production_batches WHERE id = p_batch_id LIMIT 1;
  v_found := FOUND;
  IF NOT v_found THEN
    RETURN json_build_object('success', false, 'error', 'Batch not found');
  END IF;

  v_diff := CASE WHEN p_actual_wet_nis_kg IS NOT NULL AND v_supplied IS NOT NULL THEN v_supplied - p_actual_wet_nis_kg
                 WHEN p_actual_wet_nis_kg IS NOT NULL THEN - p_actual_wet_nis_kg
                 ELSE NULL END;

  UPDATE public.production_batches
  SET actual_wet_nis_kg = p_actual_wet_nis_kg,
      wet_nis_weight_difference_kg = v_diff,
      updated_at = now()
  WHERE id = p_batch_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    RETURN json_build_object('success', true, 'id', p_batch_id, 'actual_wet_nis_kg', p_actual_wet_nis_kg, 'wet_nis_weight_difference_kg', v_diff);
  ELSE
    RETURN json_build_object('success', false, 'error', 'Update failed');
  END IF;
END;
$$;

-- 3. Extend get_production_batches to return actual_wet_nis_kg and wet_nis_weight_difference_kg
CREATE OR REPLACE FUNCTION public.get_production_batches(p_batch_type character varying DEFAULT 'kernel'::character varying, p_status character varying DEFAULT NULL::character varying, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_result json;
BEGIN
    SELECT json_build_object(
        'success', true,
        'data', COALESCE(
            (SELECT json_agg(row_to_json(t))
             FROM (
                 SELECT
                     pb.id,
                     pb.batch_number,
                     pb.batch_type,
                     pb.supplier_id,
                     pb.grower_name,
                     pb.wet_nis_received_kg,
                     pb.actual_wet_nis_kg,
                     pb.wet_nis_weight_difference_kg,
                     (pb.wet_nis_received_kg - (SELECT COALESCE(SUM(l.quantity_kg), 0)::numeric FROM public.kernel_dispatch_order_lines l WHERE l.production_batch_id = pb.id)) AS remaining_kg,
                     pb.received_date,
                     pb.receiving_moisture_percentage,
                     pb.start_date,
                     pb.estimated_completion_date,
                     pb.current_step,
                     pb.status,
                     pb.stage,
                     pb.sample_submission_id,
                     pb.receiving_checklist_id,
                     pb.production_finished_at,
                     pb.created_at,
                     pb.updated_at,
                     public.get_batch_yield_by_style(pb.id) AS yield_by_style,
                     public.get_batch_remaining_by_style(pb.id, public.get_batch_yield_by_style(pb.id)) AS remaining_by_style
                 FROM public.production_batches pb
                 WHERE (p_batch_type IS NULL OR pb.batch_type = p_batch_type)
                   AND (p_status IS NULL OR pb.status = p_status)
                 ORDER BY pb.received_date DESC NULLS LAST, pb.batch_number
                 LIMIT p_limit
                 OFFSET p_offset
             ) t),
            '[]'::json
        )
    ) INTO v_result;
    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM, 'data', '[]'::json);
END;
$function$;

-- 4. Grant execute and RBAC for update_production_batch_actual_weight
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.update_production_batch_actual_weight(numeric, uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.update_production_batch_actual_weight(numeric, uuid) TO service_role;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 5. Add RBAC permission for all roles (Lambda checks role_permissions)
DO $$
DECLARE
  v_role_id uuid;
BEGIN
  FOR v_role_id IN SELECT id FROM public.roles
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'update_production_batch_actual_weight' AND operation = 'EXECUTE'
    ) THEN
      INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
      VALUES (v_role_id, 'function', 'update_production_batch_actual_weight', 'EXECUTE', true);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
