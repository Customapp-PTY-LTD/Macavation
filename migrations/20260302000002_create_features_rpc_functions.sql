-- RPC stored procedures for features and role_features CRUD.
-- Matches the existing data-functions.js API layer.

-- ============================================================
-- 1. get_features() — list all active features (for dropdowns)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_features()
RETURNS SETOF public.features
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM features WHERE is_active = true ORDER BY name;
$$;

-- ============================================================
-- 2. get_role_features() — list all role-feature assignments
--    Returns joined data for the admin grid
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_role_features()
RETURNS TABLE (
    id BIGINT,
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
        f.name AS feature_name,
        f.key AS feature_key,
        rf.role_id,
        r.role_name,
        rf.value,
        f.description AS feature_description,
        rf.created_at
    FROM role_features rf
    JOIN features f ON f.id = rf.feature_id
    JOIN roles r ON r.id = rf.role_id
    ORDER BY r.role_name, f.name;
$$;

-- ============================================================
-- 3. get_role_feature_by_id(p_id) — single assignment
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_role_feature_by_id(p_id BIGINT)
RETURNS TABLE (
    id BIGINT,
    role_id UUID,
    feature_id BIGINT,
    feature_name VARCHAR,
    feature_key VARCHAR,
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
        rf.role_id,
        rf.feature_id,
        f.name AS feature_name,
        f.key AS feature_key,
        r.role_name,
        rf.value,
        f.description AS feature_description,
        rf.created_at
    FROM role_features rf
    JOIN features f ON f.id = rf.feature_id
    JOIN roles r ON r.id = rf.role_id
    WHERE rf.id = p_id;
$$;

-- ============================================================
-- 4. create_role_feature_simple(role_id, feature_id, value)
--    ON CONFLICT updates the existing value
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_role_feature_simple(
    role_id UUID,
    feature_id BIGINT,
    value TEXT DEFAULT 'true'
)
RETURNS SETOF public.role_features
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO role_features (role_id, feature_id, value)
    VALUES (create_role_feature_simple.role_id, create_role_feature_simple.feature_id, create_role_feature_simple.value)
    ON CONFLICT (role_id, feature_id) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    RETURNING *;
$$;

-- ============================================================
-- 5. update_role_feature_simple(role_feature_id, role_id, feature_id, value)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_role_feature_simple(
    role_feature_id BIGINT,
    role_id UUID,
    feature_id BIGINT,
    value TEXT
)
RETURNS SETOF public.role_features
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE role_features SET
        role_id = update_role_feature_simple.role_id,
        feature_id = update_role_feature_simple.feature_id,
        value = update_role_feature_simple.value,
        updated_at = NOW()
    WHERE id = update_role_feature_simple.role_feature_id
    RETURNING *;
$$;

-- ============================================================
-- 6. delete_role_feature_simple(role_feature_id)
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_role_feature_simple(role_feature_id BIGINT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM role_features WHERE id = delete_role_feature_simple.role_feature_id;
$$;

-- ============================================================
-- 7. get_features_for_role(p_role_id) — NEW
--    Returns enabled feature keys for a specific role.
--    Used by the frontend menu filter.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_features_for_role(p_role_id UUID)
RETURNS TABLE (key VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT f.key
    FROM features f
    JOIN role_features rf ON rf.feature_id = f.id
    WHERE rf.role_id = p_role_id
      AND rf.value = 'true'
      AND f.is_active = true
    ORDER BY f.name;
$$;
