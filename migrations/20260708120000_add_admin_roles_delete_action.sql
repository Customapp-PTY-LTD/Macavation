-- Granular action: deactivate (soft-delete) roles in User & access / Roles grids.
-- Broader admin.users.manage grants access to the screens; this action gates Deactivate.

INSERT INTO public.actions (key, module, label, description) VALUES
    ('admin.roles.delete', 'Administration', 'Deactivate role', 'Deactivate roles that are no longer in use')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
    v_role_id uuid;
    v_action_id bigint;
    v_role_name text;
    v_full_access_roles text[] := ARRAY['super_user', 'admin', 'General Manager'];
BEGIN
    SELECT id INTO v_action_id FROM public.actions WHERE key = 'admin.roles.delete';
    IF v_action_id IS NULL THEN
        RETURN;
    END IF;

    FOREACH v_role_name IN ARRAY v_full_access_roles
    LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_role_name;
        IF v_role_id IS NOT NULL THEN
            INSERT INTO public.role_actions (role_id, action_id, value)
            VALUES (v_role_id, v_action_id, 'true')
            ON CONFLICT (role_id, action_id) DO NOTHING;
        END IF;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
