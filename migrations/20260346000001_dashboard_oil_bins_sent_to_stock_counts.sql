-- Dashboard: oil cards should show number of bins sent to stock (today / this week),
-- not litres from oil production sheets.
-- We keep existing output column names for compatibility with current frontend/data functions.

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
    v_awaiting_test bigint := 0;
    v_release_ready bigint := 0;
    v_completed_week bigint := 0;
    v_in_intake bigint := 0;
    v_oil_today numeric := 0;
    v_oil_week numeric := 0;
    v_oil_sheets_week bigint := 0;
    v_quality_rate numeric := 0;
    v_quality_tests_week bigint := 0;
    v_dispatch_week bigint := 0;
    v_dispatch_pending bigint := 0;
    v_on_hold bigint := 0;
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

    -- Oil bins sent to stock today/this week.
    -- Uses oil_stock_lots.created_at (send timestamp) and matches only rows tied to oil_bin_batch.
    BEGIN
        SELECT count(*)::numeric INTO v_oil_today
        FROM public.oil_stock_lots osl
        WHERE osl.created_at::date = current_date
          AND EXISTS (
              SELECT 1
              FROM public.oil_bin_batch obb
              WHERE obb.batch_number = osl.batch_number
          );
    EXCEPTION WHEN undefined_table OR undefined_column THEN
        v_oil_today := 0;
    END;

    BEGIN
        SELECT count(*)::numeric INTO v_oil_week
        FROM public.oil_stock_lots osl
        WHERE osl.created_at >= current_date - interval '7 days'
          AND EXISTS (
              SELECT 1
              FROM public.oil_bin_batch obb
              WHERE obb.batch_number = osl.batch_number
          );
    EXCEPTION WHEN undefined_table OR undefined_column THEN
        v_oil_week := 0;
    END;

    -- Keep legacy output for compatibility; no longer used for the cards.
    BEGIN
        SELECT count(*)::bigint INTO v_oil_sheets_week
        FROM public.oil_production_sheets
        WHERE production_date >= current_date - interval '7 days';
    EXCEPTION WHEN undefined_table OR undefined_column THEN
        v_oil_sheets_week := 0;
    END;

    -- Quality: optional (table may not exist)
    BEGIN
        SELECT CASE
            WHEN count(*) = 0 THEN 0
            ELSE (count(*) FILTER (WHERE overall_result IS NOT NULL AND lower(trim(overall_result::text)) IN ('pass', 'passed', 'yes', '1')) * 100.0 / count(*))
        END INTO v_quality_rate
        FROM public.quality_tests;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
        v_quality_rate := 0;
    END;

    BEGIN
        SELECT count(*)::bigint INTO v_quality_tests_week
        FROM public.quality_tests
        WHERE test_date >= current_date - interval '7 days';
    EXCEPTION WHEN undefined_table OR undefined_column THEN
        v_quality_tests_week := 0;
    END;

    -- Dispatch: kernel_dispatch_orders
    BEGIN
        SELECT count(*)::bigint INTO v_dispatch_week
        FROM public.kernel_dispatch_orders
        WHERE dispatched_at >= current_date - interval '7 days';
    EXCEPTION WHEN undefined_table THEN
        v_dispatch_week := 0;
    END;

    BEGIN
        SELECT count(*)::bigint INTO v_dispatch_pending
        FROM public.kernel_dispatch_orders
        WHERE dispatched_at IS NULL;
    EXCEPTION WHEN undefined_table THEN
        v_dispatch_pending := 0;
    END;

    -- Batches on hold: optional
    BEGIN
        SELECT count(*)::bigint INTO v_on_hold
        FROM public.production_batches
        WHERE status = 'hold';
    EXCEPTION WHEN undefined_table OR undefined_column THEN
        v_on_hold := 0;
    END;

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

COMMENT ON FUNCTION public.get_dashboard_production_stats() IS
  'Executive dashboard stats. Oil cards now return oil bins sent to stock (today/week) via oil_stock_lots tied to oil_bin_batch.';
