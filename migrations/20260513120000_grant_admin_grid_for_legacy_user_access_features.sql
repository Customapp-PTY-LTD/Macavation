-- Grant unified "admin-grid" feature to any role that had one of the legacy
-- user-access sidebar features but did not yet have admin-grid, so menu
-- consolidation does not hide access after deploy.
-- Legacy keys: users-grid, roles-grid, role-permissions-grid, role-features-grid

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
AND NOT EXISTS (
    SELECT 1
    FROM public.role_features x
    JOIN public.features fx ON fx.id = x.feature_id
    WHERE x.role_id = rf.role_id
      AND fx.key = 'admin-grid'
)
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- Align catalogue label with portal wording (optional metadata refresh)
UPDATE public.features
SET
    name = 'User & access',
    description = 'Unified hub: people, roles, portal modules per role, and advanced database permissions.',
    updated_at = NOW()
WHERE key = 'admin-grid';
