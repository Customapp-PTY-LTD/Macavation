-- Remove standalone Role Actions portal feature; button actions are managed in admin-grid Customize.

-- Safety: grant admin-grid to roles that only had role-actions-grid
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT DISTINCT rf.role_id, af.id, 'true'
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.is_active = TRUE
JOIN public.features af ON af.key = 'admin-grid' AND af.is_active = TRUE
WHERE f.key = 'role-actions-grid'
AND NOT EXISTS (
    SELECT 1 FROM public.role_features x
    JOIN public.features fx ON fx.id = x.feature_id
    WHERE x.role_id = rf.role_id AND fx.key = 'admin-grid'
)
ON CONFLICT (role_id, feature_id) DO NOTHING;

DELETE FROM public.role_features
WHERE feature_id IN (SELECT id FROM public.features WHERE key = 'role-actions-grid');

DELETE FROM public.features WHERE key = 'role-actions-grid';
