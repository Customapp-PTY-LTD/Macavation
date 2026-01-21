DO $$
DECLARE
    admin_role_id UUID;
    super_user_role_id UUID;
BEGIN
    SELECT id INTO admin_role_id FROM public.roles WHERE role_name = 'admin';
    SELECT id INTO super_user_role_id FROM public.roles WHERE role_name = 'super_user';

    IF admin_role_id IS NOT NULL THEN
        GRANT EXECUTE ON FUNCTION public.get_table_columns(text) TO public.role_admin;
        GRANT EXECUTE ON FUNCTION public.import_table_rows(text, jsonb) TO public.role_admin;
    END IF;
    IF super_user_role_id IS NOT NULL THEN
        GRANT EXECUTE ON FUNCTION public.get_table_columns(text) TO public.role_super_user;
        GRANT EXECUTE ON FUNCTION public.import_table_rows(text, jsonb) TO public.role_super_user;
    END IF;
END
$$;
