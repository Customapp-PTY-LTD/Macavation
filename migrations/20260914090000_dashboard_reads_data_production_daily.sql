-- Unify the Executive Dashboard onto the same production figures the reports use.
--
-- Context. Three dashboard functions (get_executive_kpis, get_dashboard_kernel_stats,
-- get_production_trends_daily) each independently summed public.kernel.cracking_data /
-- packing_data straight out of the raw factory jsonb, with COALESCE(..., 0) turning "no capture
-- yet" into a plain 0. The weekly/monthly reports and the WhatsApp daily digest read a different,
-- corrected source instead: public.data_production_daily, which a Sales Exec can override, and
-- which resolve_report_metric_value already treats as the one source of truth
-- (migrations/20260821100000_oil_export_register_channel.sql:174-182). The two could disagree:
-- a correction typed into the Production tab of Sales & Production Data was invisible to the
-- dashboard, which kept reading the uncorrected factory feed.
--
-- data_production_daily is kept current for "today" by the hourly reseed cron introduced in
-- migrations/20260901120000_auto_seed_production_daily_cron.sql (":05 past every hour"), so
-- switching the dashboard to it does not introduce a same-day lag beyond what that cron already
-- accepts. cracked_kg / sk_packed_kg are NOT NULL DEFAULT 0 on that table
-- (migrations/20260819090000_data_page_production_daily.sql:91-96), so a genuinely-zero day is
-- still a real 0 here, not a missing value — no NULL-handling change is needed in these three
-- functions or their callers.
--
-- total_sales on get_executive_kpis was a literal `:= 0`, never assigned. It is now a real
-- all-time sum of kernel sales (data_kernel_sales_lines) plus oil sales across both channels
-- (data_oil_export_register + data_oil_sales_lines, excluding local rows already counted on the
-- register — the same de-duplication resolve_report_metric_value uses for
-- data_page_oil_sales_all_channels, migrations/20260821100000_oil_export_register_channel.sql:
-- 209-226), matching the all-time (unbounded) framing total_production_kg already has.
--
-- quality_pass_rate is deliberately left at 0 here. No quality/QC capture exists anywhere in this
-- repo to compute it from — wiring it up is a separate piece of work, not a same-shape fix.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260914090000_dashboard_reads_data_production_daily.sql
-- against dev (nmdmddugxclpqrwylyfa) and, after sign-off, npm run db:apply-prod for the same file
-- against prod (sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. get_dashboard_kernel_stats() — today's-stats card.
-- Source: migrations/20260813092000_route_cracking_kg_through_helpers.sql:16-114 (unchanged since).
-- Only the four kg_* SELECTs change source table; batches_in_production and the SA-timezone
-- date arithmetic are untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_kernel_stats()
RETURNS TABLE (
    batches_in_production bigint,
    kg_cracked_today numeric,
    kg_cracked_week numeric,
    kg_packed_today numeric,
    kg_packed_week numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batches bigint;
    v_kg_today numeric;
    v_kg_week numeric;
    v_packed_today numeric;
    v_packed_week numeric;
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_week_start date := v_today - interval '7 days';
BEGIN
    SELECT count(*)::bigint INTO v_batches
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status = 'production';

    SELECT COALESCE(SUM(d.cracked_kg), 0) INTO v_kg_today
    FROM public.data_production_daily d
    WHERE d.production_date = v_today;

    SELECT COALESCE(SUM(d.cracked_kg), 0) INTO v_kg_week
    FROM public.data_production_daily d
    WHERE d.production_date >= v_week_start AND d.production_date <= v_today;

    SELECT COALESCE(SUM(d.sk_packed_kg), 0) INTO v_packed_today
    FROM public.data_production_daily d
    WHERE d.production_date = v_today;

    SELECT COALESCE(SUM(d.sk_packed_kg), 0) INTO v_packed_week
    FROM public.data_production_daily d
    WHERE d.production_date >= v_week_start AND d.production_date <= v_today;

    RETURN QUERY SELECT v_batches, v_kg_today, v_kg_week, v_packed_today, v_packed_week;
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_kernel_stats() IS 'Dashboard kernel stats. batches_in_production = active kernels with status production only. Uses Africa/Johannesburg for today/week. Cracked/packed kg now read from data_production_daily (the same corrected source the reports use) instead of raw kernel.cracking_data/packing_data.';

-- ============================================================================
-- 2. get_production_trends_daily(integer) — the flow-tile sparklines and the trends chart.
-- Source: migrations/20260818090400_production_trends_monthly_and_desc_order.sql:28-111
-- (latest version — this is the one get_production_trends_monthly delegates to, so both are
-- fixed by this one redefinition). The dispatched CTE is untouched; only cracked/packed now come
-- from data_production_daily instead of two independent kernel-jsonb reads.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_production_trends_daily(p_days integer DEFAULT 30)
RETURNS TABLE (
    trend_date date,
    kg_cracked numeric,
    kg_packed numeric,
    kg_dispatched numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_start date := v_today - (p_days - 1);
BEGIN
    RETURN QUERY
    WITH dates AS (
        SELECT d::date AS d
        FROM generate_series(v_start, v_today, interval '1 day') AS d
    ),
    production AS (
        SELECT d.production_date AS d, d.cracked_kg, d.sk_packed_kg
        FROM public.data_production_daily d
        WHERE d.production_date BETWEEN v_start AND v_today
    ),
    dispatched AS (
        SELECT
            (o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date AS d,
            COALESCE(SUM((le->>'quantity_kg')::numeric), 0) AS kg
        FROM public.kernel_dispatch_orders o,
             jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
        WHERE o.dispatched_at IS NOT NULL
        GROUP BY (o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date
    )
    SELECT
        dates.d AS trend_date,
        COALESCE(p.cracked_kg, 0)::numeric AS kg_cracked,
        COALESCE(p.sk_packed_kg, 0)::numeric AS kg_packed,
        COALESCE(d.kg, 0)::numeric AS kg_dispatched
    FROM dates
    LEFT JOIN production p ON p.d = dates.d
    LEFT JOIN dispatched d ON d.d = dates.d
    -- DESC: if PostgREST truncates at its row cap, keep the most recent days.
    ORDER BY dates.d DESC;
END;
$$;

COMMENT ON FUNCTION public.get_production_trends_daily(integer) IS 'Daily production trends for chart: kg cracked, kg packed, kg dispatched. Uses Africa/Johannesburg. Cracked/packed kg now read from data_production_daily (the same corrected source the reports use) instead of raw kernel.cracking_data/packing_data.';

-- ============================================================================
-- 3. get_executive_kpis() — the KPI tile row.
-- Source: migrations/20260329000001_active_batches_intake_and_production_only.sql:4-49
-- (the only version ever defined). total_production_kg now reads data_production_daily instead
-- of an inline packing_data COALESCE; total_sales is now computed; quality_pass_rate is
-- unchanged (still 0 — no capture exists for it yet).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_executive_kpis()
RETURNS TABLE (
    total_production_kg numeric,
    active_batches bigint,
    total_sales numeric,
    quality_pass_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_active_batches bigint;
    v_total_production numeric := 0;
    v_total_sales numeric := 0;
    v_quality_pass_rate numeric := 0;
BEGIN
    -- Active batches = only those in intake (intake, receiving) or in kernel production (production).
    SELECT count(*)::bigint INTO v_active_batches
    FROM public.kernel k
    WHERE k.is_active = true
      AND (k.status IS NULL OR k.status IN ('intake', 'receiving', 'production'));

    -- Total production (kg) = all-time sound kernel packed, from data_production_daily (the same
    -- corrected table the reports read) rather than a raw packing_data jsonb sum.
    SELECT COALESCE(SUM(d.sk_packed_kg), 0) INTO v_total_production
    FROM public.data_production_daily d;

    -- Total sales (ZAR excl VAT) = all-time kernel sales + all-time oil sales across both
    -- channels (export register plus local invoice-book rows not already counted on the
    -- register), mirroring resolve_report_metric_value's data_page_oil_sales_all_channels
    -- de-duplication but unbounded, to match total_production_kg's all-time framing.
    SELECT COALESCE(SUM(s.vat_excl_zar), 0) INTO v_total_sales
    FROM public.data_kernel_sales_lines s;

    v_total_sales := v_total_sales
        + COALESCE((SELECT SUM(e.rand_value) FROM public.data_oil_export_register e), 0)
        + COALESCE((SELECT SUM(s.vat_excl_zar) FROM public.data_oil_sales_lines s
                     WHERE s.export_register_id IS NULL), 0);

    RETURN QUERY SELECT v_total_production, v_active_batches, v_total_sales, v_quality_pass_rate;
END;
$$;

COMMENT ON FUNCTION public.get_executive_kpis() IS 'Executive dashboard KPIs. active_batches = kernel in intake (intake, receiving) or in production only. total_production_kg = all-time sk_packed_kg from data_production_daily (the corrected source the reports use, not raw packing_data). total_sales = all-time kernel + oil sales (both oil channels, de-duplicated). quality_pass_rate is still a placeholder 0 — no quality/QC capture exists in this repo yet.';

-- ============================================================================
-- 4. Verification — fail the migration rather than report a false success.
-- ============================================================================

DO $$
DECLARE
    v_missing text[] := ARRAY[]::text[];
BEGIN
    IF to_regprocedure('public.get_dashboard_kernel_stats()') IS NULL THEN
        v_missing := v_missing || 'get_dashboard_kernel_stats()';
    END IF;
    IF to_regprocedure('public.get_production_trends_daily(integer)') IS NULL THEN
        v_missing := v_missing || 'get_production_trends_daily(integer)';
    END IF;
    IF to_regprocedure('public.get_executive_kpis()') IS NULL THEN
        v_missing := v_missing || 'get_executive_kpis()';
    END IF;
    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Migration incomplete - missing function(s): %', array_to_string(v_missing, ', ');
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
