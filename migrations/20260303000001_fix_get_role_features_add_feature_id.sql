DROP FUNCTION IF EXISTS public.get_role_features();

-- Fix get_role_features: add feature_id to the return set.
-- Also fixes delete_role_feature_simple: was RETURNS VOID (Lambda can't parse empty body)
-- and had unquoted json_build_object key causing hard errors.
-- The frontend builds a map of feature_id -> role_feature_id for checkbox state,
-- but the SP was missing this column so the map was always keyed as "undefined".

CREATE OR REPLACE FUNCTION public.get_role_features()
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
    FROM role_features rf
    JOIN features f ON f.id = rf.feature_id
    JOIN roles r ON r.id = rf.role_id
    ORDER BY r.role_name, f.name;
$$;

-- Fix delete_role_feature_simple: VOID return breaks Lambda JSON parse;
-- unquoted 'success' key in json_build_object caused column-not-found error.
DROP FUNCTION IF EXISTS public.delete_role_feature_simple(bigint);
CREATE OR REPLACE FUNCTION public.delete_role_feature_simple(role_feature_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM role_features WHERE id = delete_role_feature_simple.role_feature_id;
    RETURN json_build_object('success', true);
END;
$$;
