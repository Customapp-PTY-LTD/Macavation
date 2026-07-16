-- Repair admin-grid (User & access) grants removed by the Customize modal race
-- where toggling one role could delete another role's role_features row.
-- Idempotent: safe to re-run.

-- 1. admin and super_user must always retain the unified hub
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN public.features f
WHERE r.role_name IN ('admin', 'super_user')
  AND f.key = 'admin-grid'
  AND f.is_active = TRUE
ON CONFLICT (role_id, feature_id) DO UPDATE SET
    value = 'true',
    updated_at = NOW();

-- 2. Any role that still has a legacy user-access sidebar feature but lost admin-grid
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT DISTINCT rf.role_id, af.id, 'true'
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.is_active = TRUE
JOIN public.features af ON af.key = 'admin-grid' AND af.is_active = TRUE
WHERE f.key IN (
    'users-grid',
    'roles-grid',
    'role-permissions-grid',
    'role-features-grid'
)
AND rf.value = 'true'
AND NOT EXISTS (
    SELECT 1
    FROM public.role_features x
    JOIN public.features fx ON fx.id = x.feature_id
    WHERE x.role_id = rf.role_id
      AND fx.key = 'admin-grid'
      AND x.value = 'true'
)
ON CONFLICT (role_id, feature_id) DO UPDATE SET
    value = 'true',
    updated_at = NOW();
