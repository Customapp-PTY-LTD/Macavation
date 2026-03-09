-- Add batch-journey feature and assign to all roles that have dashboard access
-- (Batch Journey is a read-only overview, so all roles should see it)

-- 1. Insert the feature
INSERT INTO public.features (key, name, description)
VALUES ('batch-journey', 'Batch Journey', 'All batches overview with sorting and filtering')
ON CONFLICT (key) DO NOTHING;

-- 2. Assign to ALL roles (every role that has at least one feature gets batch-journey)
DO $$
DECLARE
    v_role_id integer;
    v_feature_id bigint;
BEGIN
    SELECT id INTO v_feature_id FROM public.features WHERE key = 'batch-journey';
    IF v_feature_id IS NULL THEN
        RAISE NOTICE 'batch-journey feature not found, skipping role assignment';
        RETURN;
    END IF;

    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        INSERT INTO public.role_features (role_id, feature_id, value)
        VALUES (v_role_id, v_feature_id, 'true')
        ON CONFLICT (role_id, feature_id) DO NOTHING;
    END LOOP;
END $$;
