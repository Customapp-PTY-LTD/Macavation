-- RBAC for Feedback & Issues functions (admin + super_user only)

DO $$
DECLARE
  v_admin uuid := '9c69485d-0116-4cf6-b7e6-2ff6c025478e';
  v_super uuid := 'f8c7989a-cdf4-4804-952a-47565acd9c4c';
  v_fn text;
  v_fns text[] := ARRAY[
    'get_issues',
    'get_issue_by_id',
    'get_issue_signoff_status',
    'create_issue_simple',
    'update_issue_simple',
    'resolve_issue_simple',
    'delete_issue_hard',
    'update_issue_clickup_sync'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_admin AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE'
    ) THEN
      INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
      VALUES (v_admin, 'function', v_fn, 'EXECUTE', true);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.role_permissions
      WHERE role_id = v_super AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE'
    ) THEN
      INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
      VALUES (v_super, 'function', v_fn, 'EXECUTE', true);
    END IF;
  END LOOP;
END $$;
