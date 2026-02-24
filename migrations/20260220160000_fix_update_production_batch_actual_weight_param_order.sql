-- Fix schema cache lookup: PostgREST/Supabase schema cache looks up RPC by param names in alphabetical order.
-- Redefine update_production_batch_actual_weight with (p_actual_wet_nis_kg, p_batch_id) so it matches.

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

-- Re-grant (signature changed: numeric, uuid)
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.update_production_batch_actual_weight(numeric, uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.update_production_batch_actual_weight(numeric, uuid) TO service_role;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
