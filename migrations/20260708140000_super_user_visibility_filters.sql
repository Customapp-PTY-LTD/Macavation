-- Server-side filters: hide super_user role assignments and privileged users from non-super_user actors.
-- Actor resolution uses audit.current_actor() (JWT / X-User-Id header).

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

CREATE OR REPLACE FUNCTION public.portal_user_is_privileged(p_email text, p_role_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(COALESCE(trim(p_email), '')) LIKE '%@customapp.co.za'
        OR lower(COALESCE(trim(p_role_name), '')) = 'super_user';
$$;

-- Filter joined role-feature rows (permission admin grids).
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
    WHERE public.portal_actor_is_super_user()
       OR r.role_name <> 'super_user'
    ORDER BY r.role_name, f.name;
$$;

-- Filter joined role-action rows.
CREATE OR REPLACE FUNCTION public.get_role_actions()
RETURNS TABLE (
    id BIGINT,
    action_label VARCHAR,
    action_key VARCHAR,
    action_module VARCHAR,
    role_id UUID,
    role_name VARCHAR,
    value TEXT,
    action_description TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        ra.id,
        a.label AS action_label,
        a.key AS action_key,
        a.module AS action_module,
        ra.role_id,
        r.role_name,
        ra.value,
        a.description AS action_description,
        ra.created_at
    FROM role_actions ra
    JOIN actions a ON a.id = ra.action_id
    JOIN roles r ON r.id = ra.role_id
    WHERE public.portal_actor_is_super_user()
       OR r.role_name <> 'super_user'
    ORDER BY r.role_name, a.module, a.label;
$$;

NOTIFY pgrst, 'reload schema';
