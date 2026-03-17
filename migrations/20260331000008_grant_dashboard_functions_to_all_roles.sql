-- Grant EXECUTE on dashboard-related functions to ALL roles.
-- Fixes: "Access denied: operation EXECUTE is not allowed" for get_dashboard_kernel_stats,
-- get_dashboard_alerts, get_dashboard_stats, get_recent_activity, get_executive_kpis, get_active_anomalies
-- so every user with dashboard access can load the Dashboard Overview (default and executive).

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'get_dashboard_kernel_stats',
        'get_dashboard_stats',
        'get_dashboard_alerts',
        'get_recent_activity',
        'get_executive_kpis',
        'get_active_anomalies',
        'get_production_trends_daily',
        'get_daily_minute_tests',
        'get_dashboard_production_stats'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_fn IN ARRAY v_fns
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true);
            ELSE
                UPDATE public.role_permissions
                SET allowed = true, updated_at = now()
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE';
            END IF;
        END LOOP;
    END LOOP;
END $$;
