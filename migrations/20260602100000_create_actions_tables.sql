-- Sprint 0B: Action-level permissions (buttons/actions inside modules).
-- Mirrors the features / role_features pattern. Where features gate module/route
-- visibility, actions gate individual controls (approve, release, adjust, etc.).
--
-- Default-deny: only super_user/admin are seeded with all actions. Every other
-- role starts with no actions and is configured via the Role Actions admin UI.

-- ============================================================
-- 1. actions catalogue
-- ============================================================
CREATE TABLE IF NOT EXISTS public.actions (
    id BIGSERIAL PRIMARY KEY,
    key VARCHAR(255) NOT NULL UNIQUE,
    module VARCHAR(100) NOT NULL,
    label VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actions_key ON public.actions (key);
CREATE INDEX IF NOT EXISTS idx_actions_module ON public.actions (module);
CREATE INDEX IF NOT EXISTS idx_actions_active ON public.actions (is_active);

-- ============================================================
-- 2. role_actions junction
-- ============================================================
CREATE TABLE IF NOT EXISTS public.role_actions (
    id BIGSERIAL PRIMARY KEY,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    action_id BIGINT NOT NULL REFERENCES public.actions(id) ON DELETE CASCADE,
    value TEXT NOT NULL DEFAULT 'true',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(role_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_role_actions_role ON public.role_actions (role_id);
CREATE INDEX IF NOT EXISTS idx_role_actions_action ON public.role_actions (action_id);
CREATE INDEX IF NOT EXISTS idx_role_actions_value ON public.role_actions (value);

REVOKE ALL ON TABLE public.actions FROM PUBLIC;
REVOKE ALL ON TABLE public.role_actions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.actions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.role_actions TO service_role;

-- ============================================================
-- 3. Seed pilot action catalogue (Kernel + Stock + Admin + Messaging)
-- ============================================================
INSERT INTO public.actions (key, module, label, description) VALUES
    ('kernel.production_stages.edit', 'Kernel Production', 'Edit production stages',  'Save cracking/washing/sorting/packing stage data'),
    ('kernel.job_card.approve',       'Kernel Production', 'Approve job card',         'Mark a kernel job card as approved'),
    ('kernel.release_to_stock',       'Kernel Production', 'Release batch to stock',   'Release a release-ready, approved batch into finished stock'),
    ('kernel.batch.create',           'Kernel Production', 'Create kernel batch',      'Create a new kernel production batch'),
    ('stock.adjust_soh',              'Stock',             'Adjust stock on hand',     'Adjust kernel/oil stock on hand quantities'),
    ('stock.import_batch',            'Stock',             'Import / add stock batch', 'Add or import a stock batch'),
    ('stock.shell.manage',            'Stock',             'Manage shell waste stock', 'Create/adjust shell waste stock lots'),
    ('oil.consolidated.manage',       'Oil Production',    'Manage consolidated batches', 'Group oil batches into a consolidated batch and attach lab results'),
    ('admin.users.manage',            'Administration',    'Manage users & roles',     'Access user/role/permission administration'),
    ('messaging.broadcast',           'Messaging',         'Send broadcast message',   'Send a broadcast notification to other users')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. Grant ALL actions to super_user and admin (full access)
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_action_id bigint;
    v_full_access_roles text[] := ARRAY['super_user', 'admin'];
    v_role_name text;
BEGIN
    FOREACH v_role_name IN ARRAY v_full_access_roles
    LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_role_name;
        IF v_role_id IS NOT NULL THEN
            FOR v_action_id IN SELECT id FROM public.actions WHERE is_active = true
            LOOP
                INSERT INTO public.role_actions (role_id, action_id, value)
                VALUES (v_role_id, v_action_id, 'true')
                ON CONFLICT (role_id, action_id) DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- 5. RPCs (mirror features RPC layer)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_actions()
RETURNS SETOF public.actions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM actions WHERE is_active = true ORDER BY module, label;
$$;

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
    ORDER BY r.role_name, a.module, a.label;
$$;

-- Enabled action keys for a role (frontend caches these at login).
CREATE OR REPLACE FUNCTION public.get_actions_for_role(p_role_id UUID)
RETURNS TABLE (key VARCHAR)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT a.key
    FROM actions a
    JOIN role_actions ra ON ra.action_id = a.id
    WHERE ra.role_id = p_role_id
      AND ra.value = 'true'
      AND a.is_active = true
    ORDER BY a.module, a.label;
$$;

-- Grant (ON CONFLICT update) a single role/action assignment.
CREATE OR REPLACE FUNCTION public.create_role_action_simple(
    role_id UUID,
    action_id BIGINT,
    value TEXT DEFAULT 'true'
)
RETURNS SETOF public.role_actions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO role_actions (role_id, action_id, value)
    VALUES (create_role_action_simple.role_id, create_role_action_simple.action_id, create_role_action_simple.value)
    ON CONFLICT (role_id, action_id) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    RETURNING *;
$$;

-- Revoke a single role/action assignment.
CREATE OR REPLACE FUNCTION public.delete_role_action_simple(role_action_id BIGINT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM role_actions WHERE id = delete_role_action_simple.role_action_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_actions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_role_actions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_actions_for_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_role_action_simple(uuid, bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_role_action_simple(bigint) TO authenticated, service_role;

-- ============================================================
-- 6. RBAC: allow all roles to EXECUTE the read/admin RPCs.
--    (Write enforcement is per-action in the UI + per-RPC grants elsewhere.)
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'get_actions',
        'get_role_actions',
        'get_actions_for_role',
        'create_role_action_simple',
        'delete_role_action_simple'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_fn IN ARRAY v_fns
        LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

COMMENT ON TABLE public.actions IS 'Catalogue of UI action permissions (buttons/actions inside modules).';
COMMENT ON TABLE public.role_actions IS 'Per-role grants of action keys. Default-deny; only super_user/admin seeded with all.';

-- ============================================================
-- 7. Register the Role Actions admin screen as a feature (menu visibility)
-- ============================================================
INSERT INTO public.features (key, name, description)
VALUES (
    'role-actions-grid',
    'Role Actions',
    'Manage per-role button/action permissions inside modules.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN public.features f
WHERE f.key = 'role-actions-grid'
  AND r.role_name IN ('super_user', 'admin', 'General Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
