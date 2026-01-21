-- RBAC permissions for oil stock lot functions (admin + super_user)

DO $$
DECLARE
  v_admin uuid := '9c69485d-0116-4cf6-b7e6-2ff6c025478e';
  v_super uuid := 'f8c7989a-cdf4-4804-952a-47565acd9c4c';
BEGIN
  -- get_oil_stock_lots
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_admin AND object_type = 'function' AND object_name = 'get_oil_stock_lots' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_admin, 'function', 'get_oil_stock_lots', 'EXECUTE', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_super AND object_type = 'function' AND object_name = 'get_oil_stock_lots' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_super, 'function', 'get_oil_stock_lots', 'EXECUTE', true);
  END IF;

  -- create_oil_stock_lot_simple
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_admin AND object_type = 'function' AND object_name = 'create_oil_stock_lot_simple' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_admin, 'function', 'create_oil_stock_lot_simple', 'EXECUTE', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_super AND object_type = 'function' AND object_name = 'create_oil_stock_lot_simple' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_super, 'function', 'create_oil_stock_lot_simple', 'EXECUTE', true);
  END IF;

  -- update_oil_stock_lot_simple
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_admin AND object_type = 'function' AND object_name = 'update_oil_stock_lot_simple' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_admin, 'function', 'update_oil_stock_lot_simple', 'EXECUTE', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_super AND object_type = 'function' AND object_name = 'update_oil_stock_lot_simple' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_super, 'function', 'update_oil_stock_lot_simple', 'EXECUTE', true);
  END IF;

  -- deactivate_oil_stock_lot
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_admin AND object_type = 'function' AND object_name = 'deactivate_oil_stock_lot' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_admin, 'function', 'deactivate_oil_stock_lot', 'EXECUTE', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_super AND object_type = 'function' AND object_name = 'deactivate_oil_stock_lot' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_super, 'function', 'deactivate_oil_stock_lot', 'EXECUTE', true);
  END IF;

  -- get_oil_stock_summary
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_admin AND object_type = 'function' AND object_name = 'get_oil_stock_summary' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_admin, 'function', 'get_oil_stock_summary', 'EXECUTE', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_super AND object_type = 'function' AND object_name = 'get_oil_stock_summary' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_super, 'function', 'get_oil_stock_summary', 'EXECUTE', true);
  END IF;
END $$;

