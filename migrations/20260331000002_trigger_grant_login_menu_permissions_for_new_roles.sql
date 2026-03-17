-- Ensure newly created roles automatically get EXECUTE on login/menu-critical functions
-- so new users assigned to new roles never hit "Access denied" or missing menu.

CREATE OR REPLACE FUNCTION public.grant_login_menu_permissions_for_new_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fn text;
    v_fns text[] := ARRAY[
        'get_users',
        'get_roles',
        'get_user_by_id',
        'get_features_for_role',
        'get_role_by_id',
        'get_features',
        'get_role_features'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (NEW.id, 'function', v_fn, 'EXECUTE', true);
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_grant_login_menu_permissions_for_new_role ON public.roles;
CREATE TRIGGER trigger_grant_login_menu_permissions_for_new_role
    AFTER INSERT ON public.roles
    FOR EACH ROW
    EXECUTE FUNCTION public.grant_login_menu_permissions_for_new_role();
