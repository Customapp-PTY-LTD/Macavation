-- CRUD RPC functions for managing the features table directly.
-- Complements the role_features functions in migration 20260302000002.

-- ============================================================
-- 1. get_feature_by_id(p_id) — single feature
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_feature_by_id(p_id BIGINT)
RETURNS SETOF public.features
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM features WHERE id = p_id;
$$;

-- ============================================================
-- 2. create_feature_simple(p_key, p_name, p_description)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_feature_simple(
    p_key VARCHAR,
    p_name VARCHAR,
    p_description TEXT DEFAULT NULL
)
RETURNS SETOF public.features
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO features (key, name, description)
    VALUES (p_key, p_name, p_description)
    RETURNING *;
$$;

-- ============================================================
-- 3. update_feature_simple(p_id, p_key, p_name, p_description, p_is_active)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_feature_simple(
    p_id BIGINT,
    p_key VARCHAR,
    p_name VARCHAR,
    p_description TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS SETOF public.features
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE features SET
        key = p_key,
        name = p_name,
        description = p_description,
        is_active = p_is_active,
        updated_at = NOW()
    WHERE id = p_id
    RETURNING *;
$$;

-- ============================================================
-- 4. delete_feature_simple(p_id) — hard delete
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_feature_simple(p_id BIGINT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM features WHERE id = p_id;
$$;

-- ============================================================
-- 5. RBAC grants for all 4 new functions
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_func_name text;
    v_functions text[] := ARRAY[
        'get_feature_by_id',
        'create_feature_simple',
        'update_feature_simple',
        'delete_feature_simple'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_func_name IN ARRAY v_functions
        LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_func_name, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;
