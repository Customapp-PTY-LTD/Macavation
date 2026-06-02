-- Sprint 0A: Live data audit.
-- get_dashboard_data_audit() surfaces the raw source counts behind the dashboard
-- stats so they can be cross-checked against the module grids (kernel production,
-- stock, oil). Read-only diagnostic; no data is changed.
-- WebPortal: dataFunctions.getDashboardDataAudit().

CREATE OR REPLACE FUNCTION public.get_dashboard_data_audit()
RETURNS TABLE (
    metric text,
    source text,
    value numeric,
    detail jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Kernel: total active rows (matches kernel production grid total).
    RETURN QUERY
    SELECT
        'kernel_active_total'::text,
        'kernel'::text,
        count(*)::numeric,
        NULL::jsonb
    FROM public.kernel k
    WHERE k.is_active = true;

    -- Kernel: batches "in production" (matches get_dashboard_kernel_stats).
    RETURN QUERY
    SELECT
        'kernel_in_production'::text,
        'kernel'::text,
        count(*)::numeric,
        NULL::jsonb
    FROM public.kernel k
    WHERE k.is_active = true
      AND (k.status IS NULL OR k.status NOT IN ('complete', 'in_finished_stock'));

    -- Kernel: breakdown by status (eyeball against grid kanban columns).
    RETURN QUERY
    SELECT
        'kernel_by_status'::text,
        'kernel'::text,
        count(*)::numeric,
        jsonb_object_agg(COALESCE(k.status, 'null'), k.cnt)
    FROM (
        SELECT status, count(*) AS cnt
        FROM public.kernel
        WHERE is_active = true
        GROUP BY status
    ) k;

    -- Kernel: complete batches with stock on hand (matches kernel stock grid).
    RETURN QUERY
    SELECT
        'kernel_complete_in_stock'::text,
        'kernel'::text,
        count(*)::numeric,
        NULL::jsonb
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status IN ('complete', 'in_finished_stock');

    -- Oil: total active rows (matches oil production grid total).
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oil') THEN
        RETURN QUERY
        SELECT
            'oil_active_total'::text,
            'oil'::text,
            count(*)::numeric,
            NULL::jsonb
        FROM public.oil o
        WHERE o.is_active = true;

        RETURN QUERY
        SELECT
            'oil_by_status'::text,
            'oil'::text,
            count(*)::numeric,
            jsonb_object_agg(COALESCE(o.status, 'null'), o.cnt)
        FROM (
            SELECT status, count(*) AS cnt
            FROM public.oil
            WHERE is_active = true
            GROUP BY status
        ) o;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_data_audit() IS
'Sprint 0A live data audit: raw source counts behind dashboard stats for cross-checking against module grids.';

GRANT EXECUTE ON FUNCTION public.get_dashboard_data_audit() TO authenticated, service_role;

-- Grant to all roles via role_permissions (admins/managers use the audit panel).
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_dashboard_data_audit', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
