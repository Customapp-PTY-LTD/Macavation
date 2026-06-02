-- Sprint 1C: Configurable dashboard targets.
-- Replaces hardcoded targets in dashboard.js (quality 95%, production 50000kg)
-- so managers can change targets without a code deploy.
-- WebPortal: dataFunctions.getDashboardTargets() / upsertDashboardTarget() / deleteDashboardTarget().

CREATE TABLE IF NOT EXISTS public.dashboard_targets (
    id BIGSERIAL PRIMARY KEY,
    metric_key VARCHAR(100) NOT NULL,
    target_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
    period_type VARCHAR(20) NOT NULL DEFAULT 'monthly'
        CHECK (period_type IN ('daily', 'weekly', 'monthly', 'annual')),
    division VARCHAR(20) NOT NULL DEFAULT 'all'
        CHECK (division IN ('all', 'kernel', 'oil')),
    effective_from DATE NOT NULL DEFAULT current_date,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One target row per metric/division/period takes effect from a date; latest wins.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_targets_effective
    ON public.dashboard_targets (metric_key, division, period_type, effective_from);
CREATE INDEX IF NOT EXISTS idx_dashboard_targets_metric ON public.dashboard_targets (metric_key);

REVOKE ALL ON TABLE public.dashboard_targets FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.dashboard_targets TO service_role;

-- ============================================================
-- get_dashboard_targets() — latest effective target per metric/division/period
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_targets()
RETURNS TABLE (
    id BIGINT,
    metric_key VARCHAR,
    target_value NUMERIC,
    period_type VARCHAR,
    division VARCHAR,
    effective_from DATE,
    notes TEXT,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT ON (t.metric_key, t.division, t.period_type)
        t.id, t.metric_key, t.target_value, t.period_type, t.division,
        t.effective_from, t.notes, t.updated_at
    FROM public.dashboard_targets t
    WHERE t.effective_from <= current_date
    ORDER BY t.metric_key, t.division, t.period_type, t.effective_from DESC;
$$;

-- ============================================================
-- upsert_dashboard_target(...) — create or update a target row
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_dashboard_target(
    p_id BIGINT,
    p_metric_key text,
    p_target_value numeric,
    p_period_type text,
    p_division text,
    p_effective_from date,
    p_notes text
)
RETURNS SETOF public.dashboard_targets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_metric text := trim(coalesce(p_metric_key, ''));
    v_period text := lower(trim(coalesce(p_period_type, 'monthly')));
    v_division text := lower(trim(coalesce(p_division, 'all')));
    v_eff date := coalesce(p_effective_from, current_date);
    v_id bigint;
BEGIN
    IF v_metric = '' THEN
        RAISE EXCEPTION 'metric_key is required';
    END IF;
    IF v_period NOT IN ('daily', 'weekly', 'monthly', 'annual') THEN
        RAISE EXCEPTION 'Invalid period_type';
    END IF;
    IF v_division NOT IN ('all', 'kernel', 'oil') THEN
        RAISE EXCEPTION 'Invalid division';
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.dashboard_targets (metric_key, target_value, period_type, division, effective_from, notes)
        VALUES (v_metric, coalesce(p_target_value, 0), v_period, v_division, v_eff, nullif(trim(coalesce(p_notes, '')), ''))
        ON CONFLICT (metric_key, division, period_type, effective_from) DO UPDATE
            SET target_value = EXCLUDED.target_value,
                notes = EXCLUDED.notes,
                updated_at = NOW()
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.dashboard_targets
        SET metric_key = v_metric,
            target_value = coalesce(p_target_value, 0),
            period_type = v_period,
            division = v_division,
            effective_from = v_eff,
            notes = nullif(trim(coalesce(p_notes, '')), ''),
            updated_at = NOW()
        WHERE id = p_id;
        v_id := p_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target not found: %', p_id;
        END IF;
    END IF;

    RETURN QUERY SELECT * FROM public.dashboard_targets WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_dashboard_target(p_id BIGINT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer;
BEGIN
    DELETE FROM public.dashboard_targets WHERE id = p_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_targets() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_dashboard_target(bigint, text, numeric, text, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_dashboard_target(bigint) TO authenticated, service_role;

-- ============================================================
-- Seed default targets (replacing hardcoded dashboard.js values)
-- ============================================================
INSERT INTO public.dashboard_targets (metric_key, target_value, period_type, division, effective_from, notes) VALUES
    ('quality_pass_rate',   95,    'monthly', 'all', current_date, 'Default seeded target (was hardcoded in dashboard.js)'),
    ('total_production_kg', 50000, 'monthly', 'all', current_date, 'Default seeded target (was hardcoded in dashboard.js)')
ON CONFLICT (metric_key, division, period_type, effective_from) DO NOTHING;

-- ============================================================
-- RBAC: read for all roles; write RPCs gated to admin/management.
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_role_name text;
    v_fn text;
    v_read_fns text[] := ARRAY['get_dashboard_targets'];
    v_write_fns text[] := ARRAY['upsert_dashboard_target', 'delete_dashboard_target'];
    v_write_roles text[] := ARRAY['super_user', 'admin', 'General Manager', 'Production Manager', 'Oil Plant Manager'];
BEGIN
    FOR v_role_id, v_role_name IN SELECT id, role_name FROM public.roles
    LOOP
        FOREACH v_fn IN ARRAY v_read_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
        IF v_role_name = ANY (v_write_roles) THEN
            FOREACH v_fn IN ARRAY v_write_fns LOOP
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END $$;

COMMENT ON TABLE public.dashboard_targets IS 'Configurable KPI targets for dashboards (replaces hardcoded values).';

-- Register the Dashboard Targets admin screen as a feature (menu visibility).
INSERT INTO public.features (key, name, description)
VALUES (
    'dashboard-targets-grid',
    'Dashboard Targets',
    'Set KPI targets used by dashboards without a code deploy.'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN public.features f
WHERE f.key = 'dashboard-targets-grid'
  AND r.role_name IN ('super_user', 'admin', 'General Manager', 'Production Manager', 'Oil Plant Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
