-- Supplier Intake: allow statuses and add get_supplier_intake_batches + update_supplier_intake_batch
-- Resolves "Batch not found" when releasing to Oil Production; batches live in production_batches (batch_type = 'oil').

-- 1. Allow supplier_intake and oil_production in production_batches.status
ALTER TABLE public.production_batches
  DROP CONSTRAINT IF EXISTS production_batches_status_check;

ALTER TABLE public.production_batches
  ADD CONSTRAINT production_batches_status_check CHECK (
    status::text = ANY (ARRAY[
      'receiving','cracking','washing','sorting_wet','drying','cooling','sorting_dry',
      'butter_separation','inspection','packing','metal_detection','weight_verification',
      'sampling','pending_release','released','cold_storage','completed','hold',
      'supplier_intake','oil_production','awaiting_production','intake_received',
      'quality_pending','quality_approved','awaiting_test','release_ready',
      'in_production','in_finished_stock'
    ]::text[])
  );

-- 2. Return oil batches for Supplier Intake / Oil Production modules
CREATE OR REPLACE FUNCTION public.get_supplier_intake_batches(p_status character varying DEFAULT NULL::character varying)
RETURNS SETOF json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT json_build_object(
    'id', pb.id,
    'batch_number', pb.batch_number,
    'batch_type', pb.batch_type,
    'product_type', COALESCE(pb.batch_type, 'oil'),
    'date_received', pb.received_date,
    'delivery_note_ref', NULL::varchar,
    'supplier_id', pb.supplier_id,
    'supplier_details', (SELECT COALESCE(c.company_name, c.trading_name, c.primary_contact_name) FROM public.contacts c WHERE c.id = pb.supplier_id LIMIT 1),
    'quantity_kg', pb.wet_nis_received_kg,
    'manufactured_date', NULL::date,
    'best_before_date', NULL::date,
    'status', COALESCE(pb.status, 'supplier_intake')
  )
  FROM public.production_batches pb
  WHERE pb.batch_type = 'oil'
    AND pb.is_active = true
    AND (p_status IS NULL OR pb.status = p_status)
  ORDER BY pb.received_date DESC NULLS LAST, pb.created_at DESC;
END;
$$;

-- 3. Update batch status (e.g. supplier_intake -> oil_production). Finds by id or by batch_number.
CREATE OR REPLACE FUNCTION public.update_supplier_intake_batch(
  p_batch_id uuid DEFAULT NULL,
  p_status character varying DEFAULT NULL,
  p_batch_number character varying DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_updated integer := 0;
BEGIN
  IF p_batch_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.production_batches WHERE id = p_batch_id AND is_active = true LIMIT 1;
  ELSIF p_batch_number IS NOT NULL AND trim(p_batch_number) <> '' THEN
    SELECT id INTO v_id FROM public.production_batches WHERE trim(batch_number) = trim(p_batch_number) AND is_active = true LIMIT 1;
  ELSE
    RETURN json_build_object('success', false, 'error', 'Batch not found');
  END IF;

  IF v_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Batch not found');
  END IF;

  IF p_status IS NULL OR trim(p_status) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Status is required');
  END IF;

  UPDATE public.production_batches SET status = p_status, updated_at = now() WHERE id = v_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    RETURN json_build_object('success', true, 'id', v_id);
  ELSE
    RETURN json_build_object('success', false, 'error', 'Update failed');
  END IF;
END;
$$;

-- 4. Grant EXECUTE to all roles
DO $$
DECLARE
  v_role_id uuid;
  v_func_name text;
  v_functions text[] := ARRAY['get_supplier_intake_batches', 'update_supplier_intake_batch'];
BEGIN
  FOR v_role_id IN SELECT id FROM public.roles
  LOOP
    FOREACH v_func_name IN ARRAY v_functions
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.role_permissions
        WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_func_name AND operation = 'EXECUTE'
      ) THEN
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', v_func_name, 'EXECUTE', true);
      END IF;
    END LOOP;
  END LOOP;
END $$;
