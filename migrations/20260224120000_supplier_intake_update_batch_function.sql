-- Supplier Intake: update_supplier_intake_batch – supports both supplier_intake_batches and production_batches.
-- Tries supplier_intake_batches first (id or batch_number); if not found, tries production_batches.
-- Fixes "Batch not found" when releasing batches that live in supplier_intake_batches while keeping compatibility with production_batches-only setups.

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
  v_in_sib boolean := false;  -- true if batch was found in supplier_intake_batches
BEGIN
  IF p_status IS NULL OR trim(p_status) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Status is required');
  END IF;

  -- 1) Try supplier_intake_batches first (by id or batch_number), if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'supplier_intake_batches') THEN
    IF p_batch_id IS NOT NULL THEN
      SELECT id INTO v_id FROM public.supplier_intake_batches WHERE id = p_batch_id LIMIT 1;
      IF v_id IS NOT NULL THEN v_in_sib := true; END IF;
    END IF;
    IF v_id IS NULL AND p_batch_number IS NOT NULL AND trim(p_batch_number) <> '' THEN
      SELECT id INTO v_id FROM public.supplier_intake_batches WHERE trim(batch_number) = trim(p_batch_number) LIMIT 1;
      IF v_id IS NOT NULL THEN v_in_sib := true; END IF;
    END IF;
  END IF;

  -- 2) If not in supplier_intake_batches, try production_batches (oil batches)
  IF v_id IS NULL AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'production_batches') THEN
    IF p_batch_id IS NOT NULL THEN
      SELECT id INTO v_id FROM public.production_batches WHERE id = p_batch_id AND is_active = true LIMIT 1;
    ELSIF p_batch_number IS NOT NULL AND trim(p_batch_number) <> '' THEN
      SELECT id INTO v_id FROM public.production_batches WHERE trim(batch_number) = trim(p_batch_number) AND is_active = true LIMIT 1;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Batch not found');
  END IF;

  IF v_in_sib THEN
    UPDATE public.supplier_intake_batches SET status = p_status, updated_at = now() WHERE id = v_id;
  ELSE
    UPDATE public.production_batches SET status = p_status, updated_at = now() WHERE id = v_id;
  END IF;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    RETURN json_build_object('success', true, 'id', v_id);
  ELSE
    RETURN json_build_object('success', false, 'error', 'Update failed');
  END IF;
END;
$$;

-- RBAC: grant to all roles (align with RBAC_GUIDE / RBAC_NEW_FUNCTION_CHECKLIST)
DO $$
DECLARE
  v_role_id uuid;
  v_func_name text;
  v_fns text[] := ARRAY['get_supplier_intake_batches', 'create_supplier_intake_batch', 'update_supplier_intake_batch'];
BEGIN
  FOR v_role_id IN SELECT id FROM public.roles LOOP
    FOREACH v_func_name IN ARRAY v_fns LOOP
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
