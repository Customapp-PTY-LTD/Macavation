-- Role-scoped delete/read RPCs for Admin Customize.
-- Prevents cross-role bleed when the UI toggles modules for one role while
-- stale role_features row IDs from another role are still in memory.

-- Actor helper (idempotent — may already exist from super_user visibility migration).
CREATE OR REPLACE FUNCTION public.portal_actor_is_super_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.roles r ON r.id = u.role_id
        WHERE u.id = (SELECT a.actor FROM audit.current_actor() a LIMIT 1)
          AND r.role_name = 'super_user'
          AND COALESCE(u.is_active, true) = true
    );
$$;

-- 1. Delete a feature assignment by role + feature (not by junction row PK alone).
CREATE OR REPLACE FUNCTION public.delete_role_feature_for_role(
    p_role_id UUID,
    p_feature_id BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.role_features
    WHERE role_id = p_role_id
      AND feature_id = p_feature_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN json_build_object('success', true, 'deleted', v_deleted);
END;
$$;

-- 2. Delete an action assignment by role + action.
CREATE OR REPLACE FUNCTION public.delete_role_action_for_role(
    p_role_id UUID,
    p_action_id BIGINT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.role_actions
    WHERE role_id = p_role_id
      AND action_id = p_action_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN json_build_object('success', true, 'deleted', v_deleted);
END;
$$;

-- 3. Role-filtered read (Customize loads only the selected role's assignments).
CREATE OR REPLACE FUNCTION public.get_role_features_for_role(p_role_id UUID)
RETURNS TABLE (
    id BIGINT,
    feature_id BIGINT,
    feature_name VARCHAR,
    feature_key VARCHAR,
    role_id UUID,
    role_name VARCHAR,
    value TEXT,
    feature_description TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        rf.id,
        rf.feature_id,
        f.name AS feature_name,
        f.key AS feature_key,
        rf.role_id,
        r.role_name,
        rf.value,
        f.description AS feature_description,
        rf.created_at
    FROM public.role_features rf
    JOIN public.features f ON f.id = rf.feature_id
    JOIN public.roles r ON r.id = rf.role_id
    WHERE rf.role_id = p_role_id
      AND (
          public.portal_actor_is_super_user()
          OR r.role_name <> 'super_user'
      )
    ORDER BY f.name;
$$;

-- 4. Harden blind delete: only remove the row if it belongs to the expected role.
CREATE OR REPLACE FUNCTION public.delete_role_feature_simple(role_feature_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role_id UUID;
    v_role_name TEXT;
BEGIN
    SELECT rf.role_id, r.role_name
    INTO v_role_id, v_role_name
    FROM public.role_features rf
    JOIN public.roles r ON r.id = rf.role_id
    WHERE rf.id = delete_role_feature_simple.role_feature_id;

    IF v_role_id IS NULL THEN
        RETURN json_build_object('success', true, 'deleted', 0);
    END IF;

    IF v_role_name = 'super_user' AND NOT public.portal_actor_is_super_user() THEN
        RAISE EXCEPTION 'Only super users may change permissions for the super_user role.';
    END IF;

    DELETE FROM public.role_features
    WHERE id = delete_role_feature_simple.role_feature_id
      AND role_id = v_role_id;

    RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_role_feature_for_role(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_role_action_for_role(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_role_features_for_role(uuid) TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'delete_role_feature_for_role',
        'delete_role_action_for_role',
        'get_role_features_for_role'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_fn IN ARRAY v_fns
        LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
