-- Run this in the Supabase SQL editor for the project your Web Portal uses
-- (same project as WebPortal/js/appRouteConfig.json → environmentSettings.*.SupabaseUrl and Lambda SUPABASE_URL).
-- Safe to re-run. Does not modify grant_login_menu_permissions_for_new_role.
--
-- If Cursor Supabase MCP points at a different Supabase project than this URL, MCP "apply migration"
-- does not update this database — run this script here instead.

CREATE OR REPLACE FUNCTION public.revert_kernel_dispatch_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order id is required');
    END IF;

    SELECT lower(trim(coalesce(status, ''))) INTO v_status
    FROM public.kernel_dispatch_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_status IS NULL OR v_status = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF v_status <> 'dispatched' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only dispatched orders can be returned to awaiting dispatch');
    END IF;

    UPDATE public.kernel_dispatch_orders
    SET
        status = 'pending',
        record = '{}'::jsonb,
        dispatched_at = NULL,
        updated_at = now()
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'message', 'Order returned to awaiting dispatch; dispatch paperwork was cleared.');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_kernel_dispatch_order(uuid) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'revert_kernel_dispatch_order', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = 'revert_kernel_dispatch_order'
      AND x.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true, updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'revert_kernel_dispatch_order'
  AND operation = 'EXECUTE';

NOTIFY pgrst, 'reload schema';
