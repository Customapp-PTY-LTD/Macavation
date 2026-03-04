-- Dashboard: extra production stats for Executive dashboard (kernel pipeline, oil, quality, dispatch, batch health).
-- Called by WebPortal via dataFunctions.getDashboardProductionStats().

CREATE OR REPLACE FUNCTION public.get_dashboard_production_stats()
RETURNS TABLE (
    batches_awaiting_test bigint,
    batches_release_ready bigint,
    batches_completed_week bigint,
    batches_in_intake bigint,
    oil_litres_today numeric,
    oil_litres_week numeric,
    oil_sheets_week bigint,
    quality_pass_rate numeric,
    quality_tests_week bigint,
    dispatch_orders_week bigint,
    dispatch_pending bigint,
    batches_on_hold bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_awaiting_test bigint;
    v_release_ready bigint;
    v_completed_week bigint;
    v_in_intake bigint;
    v_oil_today numeric;
    v_oil_week numeric;
    v_oil_sheets_week bigint;
    v_quality_rate numeric;
    v_quality_tests_week bigint;
    v_dispatch_week bigint;
    v_dispatch_pending bigint;
    v_on_hold bigint;
BEGIN
    -- Kernel: batches awaiting test (status qa, no qa_data or empty)
    SELECT count(*)::bigint INTO v_awaiting_test
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status = 'qa'
      AND (k.qa_data IS NULL OR k.qa_data = 'null'::jsonb OR k.qa_data = '{}'::jsonb);

    -- Kernel: batches release ready (status qa, has qa_data)
    SELECT count(*)::bigint INTO v_release_ready
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status = 'qa'
      AND k.qa_data IS NOT NULL
      AND k.qa_data != 'null'::jsonb
      AND k.qa_data != '{}'::jsonb;

    -- Kernel: batches completed (complete or in_finished_stock) in last 7 days
    SELECT count(*)::bigint INTO v_completed_week
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status IN ('complete', 'in_finished_stock')
      AND k.updated_at >= current_date - interval '7 days';

    -- Kernel: batches in intake/receiving
    SELECT count(*)::bigint INTO v_in_intake
    FROM public.kernel k
    WHERE k.is_active = true
      AND (k.status IS NULL OR k.status IN ('intake', 'receiving'));

    -- Oil: litres produced today (ibc1 + ibc2 + ibc3)
    SELECT COALESCE(SUM(
        COALESCE((ibc1_litre)::numeric, 0) + COALESCE((ibc2_litre)::numeric, 0) + COALESCE((ibc3_litre)::numeric, 0)
    ), 0) INTO v_oil_today
    FROM public.oil_production_sheets
    WHERE production_date = current_date;

    -- Oil: litres produced in last 7 days
    SELECT COALESCE(SUM(
        COALESCE((ibc1_litre)::numeric, 0) + COALESCE((ibc2_litre)::numeric, 0) + COALESCE((ibc3_litre)::numeric, 0)
    ), 0) INTO v_oil_week
    FROM public.oil_production_sheets
    WHERE production_date >= current_date - interval '7 days';

    -- Oil: number of production sheets in last 7 days
    SELECT count(*)::bigint INTO v_oil_sheets_week
    FROM public.oil_production_sheets
    WHERE production_date >= current_date - interval '7 days';

    -- Quality: pass rate (overall_result = 'Pass' or similar; fallback to pass columns)
    SELECT CASE
        WHEN count(*) = 0 THEN 0
        ELSE (count(*) FILTER (WHERE overall_result IS NOT NULL AND lower(trim(overall_result::text)) IN ('pass', 'passed', 'yes', '1')) * 100.0 / count(*))
    END INTO v_quality_rate
    FROM public.quality_tests;

    -- Quality: tests in last 7 days
    SELECT count(*)::bigint INTO v_quality_tests_week
    FROM public.quality_tests
    WHERE test_date >= current_date - interval '7 days';

    -- Dispatch: orders dispatched in last 7 days (dispatched_at set)
    SELECT count(*)::bigint INTO v_dispatch_week
    FROM public.kernel_dispatch_orders
    WHERE dispatched_at >= current_date - interval '7 days';

    -- Dispatch: orders pending (not dispatched)
    SELECT count(*)::bigint INTO v_dispatch_pending
    FROM public.kernel_dispatch_orders
    WHERE dispatched_at IS NULL;

    -- Production batches on hold
    SELECT count(*)::bigint INTO v_on_hold
    FROM public.production_batches
    WHERE status = 'hold';

    RETURN QUERY SELECT
        v_awaiting_test,
        v_release_ready,
        v_completed_week,
        v_in_intake,
        v_oil_today,
        v_oil_week,
        v_oil_sheets_week,
        round(v_quality_rate, 1),
        v_quality_tests_week,
        v_dispatch_week,
        v_dispatch_pending,
        v_on_hold;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_production_stats() IS 'Returns extra Executive dashboard stats: kernel pipeline (awaiting test, release ready, completed week, intake), oil (L today/week, sheets week), quality (pass rate, tests week), dispatch (orders week, pending), batches on hold.';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_dashboard_production_stats', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
