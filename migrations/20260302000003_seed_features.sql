-- Seed features table with all app modules/routes, then assign features to roles.
-- Admin/super_user/management roles get ALL features.
-- PWA roles get specific features matching the existing role-menu-config.js.

-- ============================================================
-- 1. Seed features (25 routes)
-- ============================================================
INSERT INTO public.features (key, name, description) VALUES
    ('dashboard',                'Dashboard',                    'Main dashboard'),
    ('crm-grid',                 'Contacts',                     'Customer contacts management'),
    ('grower-intake-grid',       'Grower Intake',                'Kernel grower intake'),
    ('kernel-production-grid',   'Kernel Production',            'Kernel production workflow'),
    ('stock-management-kernel',  'Stock (Kernel)',               'Kernel stock management'),
    ('kernel-dispatch-grid',     'Kernel Dispatch',              'Kernel dispatch operations'),
    ('supplier-intake-grid',     'Supplier Intake',              'Oil supplier intake'),
    ('oil-production-grid',      'Oil Production',               'Oil production workflow'),
    ('stock-management-oil',     'Stock (Oil & Protein)',        'Oil & protein stock management'),
    ('oil-dispatch-grid',        'Oil & Protein Dispatch',       'Oil & protein dispatch operations'),
    ('quality-assurance-grid',   'Quality Assurance',            'Quality assurance testing'),
    ('sales-forecasting-grid',   'Sales Forecasting',            'Sales forecasting and planning'),
    ('financial-management-grid','Financial Management',         'Financial management'),
    ('document-management-grid', 'Document Management',          'Document management'),
    ('palladium-integration-grid','Palladium Integration',       'Palladium ERP integration'),
    ('users-grid',               'Users',                        'User management'),
    ('roles-grid',               'Roles',                        'Role management'),
    ('role-permissions-grid',    'Database Role Permissions',    'Database role permissions management'),
    ('role-features-grid',       'Role Features',                'Role feature access management'),
    ('admin-grid',               'System Administration',        'System administration tools'),
    ('test-scenarios-grid',      'Test Scenarios',               'Test scenario management'),
    ('test-data-grid',           'Test Data',                    'Test data management'),
    ('my-day',                   'My Day',                       'Personal daily workflow dashboard'),
    ('amanda-dashboard',         'Material Journey Dashboard',   'Material journey tracking dashboard'),
    ('executive-dashboard',      'Executive Dashboard',          'Executive KPI dashboard')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. Assign ALL features to full-access roles
--    (super_user, admin, General Manager, Production Manager,
--     QA Supervisor, Oil Plant Manager, Office Administrator)
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_feature_id bigint;
    v_full_access_roles text[] := ARRAY[
        'super_user', 'admin',
        'General Manager', 'Production Manager',
        'QA Supervisor', 'Oil Plant Manager', 'Office Administrator'
    ];
    v_role_name text;
BEGIN
    FOREACH v_role_name IN ARRAY v_full_access_roles
    LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_role_name;
        IF v_role_id IS NOT NULL THEN
            FOR v_feature_id IN SELECT id FROM public.features WHERE is_active = true
            LOOP
                INSERT INTO public.role_features (role_id, feature_id, value)
                VALUES (v_role_id, v_feature_id, 'true')
                ON CONFLICT (role_id, feature_id) DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- 3. Assign specific features to PWA roles
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_feature_key text;
BEGIN
    -- PWA Grower Intake
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'PWA Grower Intake';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['dashboard', 'grower-intake-grid', 'my-day']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;

    -- PWA Production
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'PWA Production';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['dashboard', 'grower-intake-grid', 'kernel-production-grid', 'oil-production-grid', 'supplier-intake-grid', 'my-day']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;

    -- PWA Quality Assurance
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'PWA Quality Assurance';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['dashboard', 'quality-assurance-grid', 'stock-management-kernel', 'stock-management-oil', 'grower-intake-grid', 'my-day']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;

    -- PWA Stock Management
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'PWA Stock Management';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['dashboard', 'stock-management-kernel', 'stock-management-oil', 'quality-assurance-grid', 'my-day']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;

    -- PWA Sales
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'PWA Sales';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['dashboard', 'sales-forecasting-grid', 'crm-grid', 'executive-dashboard', 'my-day']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;

    -- PWA Finance
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'PWA Finance';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['dashboard', 'financial-management-grid', 'executive-dashboard', 'my-day']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;

    -- PWA Document Management
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'PWA Document Management';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['dashboard', 'document-management-grid', 'my-day']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;

    -- PWA Field Operations
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'PWA Field Operations';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['dashboard', 'grower-intake-grid', 'kernel-production-grid', 'quality-assurance-grid', 'my-day']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;

    -- KP Data Admin
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = 'KP Data Admin';
    IF v_role_id IS NOT NULL THEN
        FOREACH v_feature_key IN ARRAY ARRAY['grower-intake-grid', 'kernel-production-grid', 'oil-production-grid', 'supplier-intake-grid']
        LOOP
            INSERT INTO public.role_features (role_id, feature_id, value)
            SELECT v_role_id, f.id, 'true' FROM public.features f WHERE f.key = v_feature_key
            ON CONFLICT (role_id, feature_id) DO NOTHING;
        END LOOP;
    END IF;
END $$;
