-- Seed all active features into role_features for admin and super_user roles.
-- Same pattern as RBAC grants: loop roles, insert per feature, skip conflicts.

DO $$
DECLARE
    v_role_id UUID;
    v_feature_id BIGINT;
BEGIN
    FOR v_role_id IN
        SELECT id FROM public.roles WHERE role_name IN ('admin', 'super_user')
    LOOP
        FOR v_feature_id IN
            SELECT id FROM public.features WHERE is_active = true
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            VALUES (v_role_id, v_feature_id, 'true')
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;

-- Verify
SELECT r.role_name, COUNT(*) AS features_granted
FROM public.role_features rf
JOIN public.roles r ON r.id = rf.role_id
WHERE r.role_name IN ('admin', 'super_user')
GROUP BY r.role_name;
