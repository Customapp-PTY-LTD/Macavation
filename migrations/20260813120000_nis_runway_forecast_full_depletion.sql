-- get_nis_runway_forecast: carry the projection past the first run-out, until the last scheduled
-- delivery has itself been consumed.
--
-- Supersedes 20260813100000. The history ledger, the month-basis rate and the data-quality reporting
-- are unchanged -- that migration's header still explains them and still applies. This migration
-- changes ONE thing: how the forecast is projected.
--
-- WHY THE OLD ARITHMETIC HAD TO GO. The previous version projected with a plain cumulative sum:
--
--     level(d) = pool + SUM(intake) OVER (...) - SUM(rate) OVER (...)
--
-- and cut the series at the first day level <= 0. That was exact *only because of the cut*. Carried
-- further it is simply wrong: it keeps subtracting the daily rate from an empty plant, so the line
-- dives negative and any later delivery is added to a fictitious debt instead of to zero. A plant
-- that has run dry cracks nothing -- it idles until nut arrives.
--
-- So the projection is now a stateful day-by-day simulation, which cannot be expressed as a window
-- function because each day depends on the clamped result of the day before:
--
--     available = level(d-1) + intake(d)
--     cracked   = LEAST(available, rate)        <-- cannot crack what is not there
--     level(d)  = available - cracked           <-- therefore never negative
--
-- That is a recursive CTE, bounded by p_max_forecast_days (<= 1826) through a step counter so it
-- cannot run away. It still contains no division, so a zero rate is a flat line, not an error. The
-- earlier "no loop" note is withdrawn: the loop is required for correctness, and the cheaper form
-- was only ever valid up to the first zero.
--
-- TWO DATES, NOT ONE -- they answer different questions and both are returned:
--
--   run_out_date          the first day the plant is dry. Still the headline: it is when production
--                         stops, whatever is scheduled to arrive afterwards.
--   final_depletion_date  the day the LAST scheduled delivery is itself used up. The series now runs
--                         to here, so the chart shows every delivery arriving and being eaten, with
--                         flat stretches at zero wherever the plant is starved in between.
--
-- idle_days_in_forecast counts projected days with stock at zero and nothing to crack. That is lost
-- production, and it is invisible if the series stops at the first zero.
--
-- With nothing scheduled after the first run-out the two dates coincide and the series ends where it
-- used to, so behaviour is unchanged for the common case of an empty procurement calendar.

CREATE OR REPLACE FUNCTION public.get_nis_runway_forecast(
    p_history_days        integer DEFAULT 365,
    p_kg_per_day          numeric DEFAULT NULL,   -- kg per CALENDAR day
    p_rate_basis_month    integer DEFAULT NULL,   -- YYYYMM, e.g. 202605
    p_max_forecast_days   integer DEFAULT 730,
    p_include_procurement boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today       date    := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_hist_days   integer := GREATEST(7, LEAST(COALESCE(p_history_days, 365), 1826));
    v_max_fc      integer := GREATEST(7, LEAST(COALESCE(p_max_forecast_days, 730), 1826));
    v_hist_start  date;
    v_hist_end    date;

    v_pool_kg     numeric := 0;
    v_pool_await  numeric := 0;
    v_pool_prod   numeric := 0;

    v_kg_per_day  numeric := 0;
    v_rate_source text    := 'none';
    v_basis_month integer := NULL;
    v_basis_label text    := NULL;

    v_months      jsonb   := '[]'::jsonb;
    v_points      jsonb   := '[]'::jsonb;
    v_fc_points   jsonb   := '[]'::jsonb;
    v_warnings    text[]  := ARRAY[]::text[];

    v_run_out     date    := NULL;
    v_days_out    integer := NULL;
    v_fc_end      date;
    v_truncated   boolean := false;
    v_final_dep   date    := NULL;
    v_last_intake date    := NULL;
    v_idle        integer := 0;

    v_neg_days    integer := 0;
    v_rows_total  integer := 0;
    v_rows_kg     integer := 0;
    v_over_n      integer := 0;
    v_over_kg     numeric := 0;
    v_undated_kg  numeric := 0;
    v_recv_null   integer := 0;

    v_proc_future  numeric := 0;
    v_proc_overdue numeric := 0;

    v_tmp         numeric;
BEGIN
    v_hist_start := v_today - v_hist_days + 1;
    v_hist_end   := v_today;

    -- ---------------------------------------------------------------- pool + data quality
    SELECT
        COALESCE(SUM(nis_kg - cracked_kg) FILTER (WHERE status IN ('intake', 'receiving')), 0),
        COALESCE(SUM(nis_kg - cracked_kg) FILTER (WHERE status = 'production'), 0),
        COUNT(*) FILTER (WHERE cracked_kg > nis_kg),
        COALESCE(SUM(cracked_kg - nis_kg) FILTER (WHERE cracked_kg > nis_kg), 0),
        COUNT(*) FILTER (WHERE recv_null)
    INTO v_pool_await, v_pool_prod, v_over_n, v_over_kg, v_recv_null
    FROM (
        SELECT k.status,
               COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg, 0)::numeric AS nis_kg,
               (k.received_date IS NULL)                                        AS recv_null,
               (SELECT COALESCE(SUM(public.kernel_day_kg(e)), 0)
                  FROM jsonb_array_elements(
                         COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e) AS cracked_kg
          FROM public.kernel k
         WHERE k.is_active = true
           AND k.status IN ('intake', 'receiving', 'production')
    ) q;

    v_pool_kg := v_pool_await + v_pool_prod;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE public.kernel_day_kg(e) > 0),
           COALESCE(SUM(public.kernel_day_kg(e)) FILTER (WHERE public.kernel_day_date(e) IS NULL), 0)
      INTO v_rows_total, v_rows_kg, v_undated_kg
      FROM public.kernel k,
           jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e
     WHERE k.is_active = true;

    IF v_rows_total > 0 AND v_rows_kg * 2 < v_rows_total THEN
        v_warnings := v_warnings || 'sparse_cracking_capture'::text;
    END IF;
    IF v_over_n > 0 THEN
        v_warnings := v_warnings || 'recorded_feed_exceeds_intake'::text;
    END IF;
    IF v_undated_kg > 0 THEN
        v_warnings := v_warnings || 'undated_cracking_kg'::text;
    END IF;
    IF v_recv_null > 0 THEN
        v_warnings := v_warnings || 'received_date_null'::text;
    END IF;

    -- ---------------------------------------------------------------- month picker data
    -- One entry per calendar month that has any cracking day-row, including months that captured
    -- no tonnage (they render disabled in the picker: a month that exists but recorded nothing is
    -- information, and dropping it would imply no production was attempted).
    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'yyyymm',          (EXTRACT(YEAR FROM ms) * 100 + EXTRACT(MONTH FROM ms))::int,
                   'label',           to_char(ms, 'FMMonth YYYY'),
                   'month_start',     ms,
                   'total_kg',        ROUND(total_kg, 2),
                   'days_in_month',   dim,
                   'kg_per_day',      ROUND(total_kg / dim, 2),
                   'day_rows',        day_rows,
                   'day_rows_with_kg', rows_with_kg,
                   'capture_pct',     ROUND(100.0 * rows_with_kg / NULLIF(day_rows, 0), 1)
               ) ORDER BY ms), '[]'::jsonb)
      INTO v_months
      FROM (
        SELECT ms,
               EXTRACT(DAY FROM (ms + interval '1 month' - interval '1 day'))::int AS dim,
               SUM(kg)                            AS total_kg,
               COUNT(*)                           AS day_rows,
               COUNT(*) FILTER (WHERE kg > 0)     AS rows_with_kg
          FROM (
            SELECT date_trunc('month', public.kernel_day_date(e))::date AS ms,
                   public.kernel_day_kg(e)                             AS kg
              FROM public.kernel k,
                   jsonb_array_elements(
                     COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e
             WHERE k.is_active = true
               AND public.kernel_day_date(e) IS NOT NULL
          ) d
         GROUP BY ms, dim
      ) m;

    -- ---------------------------------------------------------------- rate resolution
    -- First match wins. An unusable value falls through to the next source and is reported, never
    -- silently clamped and never silently swapped for a different month.
    IF p_kg_per_day IS NOT NULL THEN
        IF p_kg_per_day > 0 AND p_kg_per_day <= 200000 THEN
            v_kg_per_day  := p_kg_per_day;
            v_rate_source := 'parameter';
        ELSE
            v_warnings := v_warnings || 'rate_source_rejected:parameter_kg_per_day'::text;
        END IF;
    END IF;

    IF v_rate_source = 'none' AND p_rate_basis_month IS NOT NULL THEN
        SELECT (m ->> 'kg_per_day')::numeric, m ->> 'label', (m ->> 'yyyymm')::int
          INTO v_kg_per_day, v_basis_label, v_basis_month
          FROM jsonb_array_elements(v_months) m
         WHERE (m ->> 'yyyymm')::int = p_rate_basis_month
           AND (m ->> 'total_kg')::numeric > 0
         LIMIT 1;

        IF v_kg_per_day IS NULL OR v_kg_per_day <= 0 THEN
            v_kg_per_day  := 0;
            v_basis_label := NULL;
            v_basis_month := NULL;
            v_warnings    := v_warnings || 'rate_source_rejected:parameter_basis_month'::text;
        ELSE
            v_rate_source := 'parameter';
        END IF;
    END IF;

    -- dashboard_targets overrides: a typed kg/day figure wins over a basis month, so a human can
    -- always overrule the data outright. A basis month recomputes live, so the forecast improves as
    -- that month's capture improves.
    IF v_rate_source = 'none' THEN
        SELECT target_value INTO v_tmp
          FROM public.dashboard_targets
         WHERE metric_key = 'nis_crack_rate_kg_per_day'
           AND effective_from <= v_today
         ORDER BY effective_from DESC, updated_at DESC
         LIMIT 1;

        IF v_tmp IS NOT NULL AND v_tmp > 0 THEN
            IF v_tmp <= 200000 THEN
                v_kg_per_day  := v_tmp;
                v_rate_source := 'override';
            ELSE
                v_warnings := v_warnings || 'rate_source_rejected:override_kg_per_day'::text;
            END IF;
        END IF;
    END IF;

    IF v_rate_source = 'none' THEN
        SELECT target_value::int INTO v_tmp
          FROM public.dashboard_targets
         WHERE metric_key = 'nis_rate_basis_month'
           AND effective_from <= v_today
         ORDER BY effective_from DESC, updated_at DESC
         LIMIT 1;

        IF v_tmp IS NOT NULL AND v_tmp BETWEEN 200001 AND 299912 THEN
            SELECT (m ->> 'kg_per_day')::numeric, m ->> 'label', (m ->> 'yyyymm')::int
              INTO v_kg_per_day, v_basis_label, v_basis_month
              FROM jsonb_array_elements(v_months) m
             WHERE (m ->> 'yyyymm')::int = v_tmp::int
               AND (m ->> 'total_kg')::numeric > 0
             LIMIT 1;

            IF v_kg_per_day IS NULL OR v_kg_per_day <= 0 THEN
                v_kg_per_day  := 0;
                v_basis_label := NULL;
                v_basis_month := NULL;
                v_warnings    := v_warnings || 'rate_source_rejected:override_basis_month'::text;
            ELSE
                v_rate_source := 'basis_month';
            END IF;
        ELSIF v_tmp IS NOT NULL AND v_tmp <> 0 THEN
            v_warnings := v_warnings || 'rate_source_rejected:override_basis_month'::text;
        END IF;
    END IF;

    v_kg_per_day := COALESCE(v_kg_per_day, 0);
    IF v_rate_source = 'none' THEN
        v_warnings := v_warnings || 'no_rate_configured'::text;
    END IF;

    -- ---------------------------------------------------------------- history: three-event ledger
    WITH b AS (
        SELECT k.id,
               COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg, 0)::numeric AS nis_kg,
               COALESCE(k.received_date,
                        (k.created_at AT TIME ZONE 'Africa/Johannesburg')::date) AS recv_d,
               (k.production_finished_at AT TIME ZONE 'Africa/Johannesburg')::date AS pfa_d,
               (SELECT COALESCE(SUM(public.kernel_day_kg(e)), 0)
                  FROM jsonb_array_elements(
                         COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e) AS cracked_kg,
               (SELECT MAX(public.kernel_day_date(e))
                  FROM jsonb_array_elements(
                         COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e) AS last_crack_d,
               (k.status IN ('intake', 'receiving', 'production')) AS in_pool
          FROM public.kernel k
         WHERE k.is_active = true
    ),
    ev AS (
        -- nut arrives in the uncracked pool
        SELECT LEAST(recv_d, v_today) AS d, nis_kg AS i, 0::numeric AS c, 0::numeric AS r
          FROM b
        UNION ALL
        -- nut goes through the cracker
        SELECT public.kernel_day_date(e), 0::numeric, public.kernel_day_kg(e), 0::numeric
          FROM public.kernel k
          JOIN b ON b.id = k.id,
               jsonb_array_elements(
                 COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e
         WHERE public.kernel_day_date(e) IS NOT NULL
        UNION ALL
        -- batch left the pool: write off whatever the day-level records did not account for.
        -- SIGNED, UNCLAMPED -- see the header. This is what makes level(today) exact.
        SELECT LEAST(GREATEST(COALESCE(pfa_d, recv_d), COALESCE(last_crack_d, recv_d), recv_d),
                     v_today),
               0::numeric, 0::numeric, (nis_kg - cracked_kg)
          FROM b
         WHERE NOT in_pool
    ),
    daily AS (
        SELECT d, SUM(i) AS i, SUM(c) AS c, SUM(r) AS r
          FROM ev
         WHERE d IS NOT NULL AND d <= v_today
         GROUP BY d
    ),
    g AS (
        -- Run the grid from the FIRST event, not from history_start, so the level at history_start
        -- already carries every earlier event. Then slice.
        SELECT gs::date AS d
          FROM (SELECT MIN(d) AS d0 FROM daily) x,
               generate_series(x.d0, v_today, interval '1 day') gs
         WHERE x.d0 IS NOT NULL
    ),
    lvl AS (
        SELECT g.d,
               COALESCE(daily.i, 0) AS i,
               COALESCE(daily.c, 0) AS c,
               COALESCE(daily.r, 0) AS r,
               SUM(COALESCE(daily.i, 0) - COALESCE(daily.c, 0) - COALESCE(daily.r, 0))
                   OVER (ORDER BY g.d ROWS UNBOUNDED PRECEDING) AS level
          FROM g
          LEFT JOIN daily ON daily.d = g.d
    ),
    sliced AS (
        SELECT * FROM lvl WHERE d >= v_hist_start
    )
    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'd',             d,
                   'qty_kg',        ROUND(GREATEST(level, 0), 2),
                   'is_forecast',   false,
                   'intake_kg',     ROUND(i, 2),
                   'cracked_kg',    ROUND(c, 2),
                   'reconciled_kg', ROUND(r, 2)
               ) ORDER BY d), '[]'::jsonb),
           COUNT(*) FILTER (WHERE level < 0)
      INTO v_points, v_neg_days
      FROM sliced;

    IF v_neg_days > 0 THEN
        v_warnings := v_warnings || 'history_has_negative_days'::text;
    END IF;

    IF jsonb_array_length(v_points) = 0 THEN
        v_warnings := v_warnings || 'no_data'::text;
    END IF;

    -- ---------------------------------------------------------------- procurement
    IF p_include_procurement THEN
        -- Join on p.batch_id = k.batch_id: kernel_intake_procurement.batch_id FKs batches(id), not
        -- kernel(id) (20260601090000_kernel_intake_procurement.sql:12).
        SELECT COALESCE(SUM(p.predicted_weight_kg) FILTER (WHERE p.scheduled_date > v_today), 0),
               COALESCE(SUM(p.predicted_weight_kg) FILTER (WHERE p.scheduled_date <= v_today), 0)
          INTO v_proc_future, v_proc_overdue
          FROM public.kernel_intake_procurement p
         WHERE p.status = 'scheduled'
           AND COALESCE(p.predicted_weight_kg, 0) > 0
           AND NOT EXISTS (SELECT 1 FROM public.kernel k
                            WHERE k.batch_id = p.batch_id AND k.is_active = true);

        IF v_proc_future = 0 THEN
            v_warnings := v_warnings || 'procurement_calendar_empty'::text;
        END IF;
        -- Overdue-but-still-scheduled deliveries are excluded from both history and forecast.
        -- Rolling them forward would extend the runway on nut that never arrived.
        IF v_proc_overdue > 0 THEN
            v_warnings := v_warnings || 'procurement_overdue'::text;
        END IF;
    ELSE
        v_warnings := v_warnings || 'procurement_excluded'::text;
    END IF;

    -- ---------------------------------------------------------------- forecast
    IF v_pool_kg <= 0 THEN
        v_run_out  := v_today;
        v_days_out := 0;
        v_fc_end   := v_today;
        v_warnings := v_warnings || 'pool_empty'::text;

    ELSIF v_kg_per_day <= 0 THEN
        -- No rate: show a flat line so the card can render the level, but assert no run-out.
        v_fc_end := v_today;

    ELSE
        -- Last scheduled delivery inside the horizon: the simulation must run at least until this
        -- has been consumed, otherwise the chart hides deliveries the business has already booked.
        SELECT MAX(d) INTO v_last_intake FROM (
            SELECT p.scheduled_date AS d, SUM(p.predicted_weight_kg)::numeric AS kg
              FROM public.kernel_intake_procurement p
             WHERE p_include_procurement
               AND p.status = 'scheduled'
               AND p.scheduled_date > v_today
               AND p.scheduled_date <= v_today + v_max_fc
               AND COALESCE(p.predicted_weight_kg, 0) > 0
               AND NOT EXISTS (SELECT 1 FROM public.kernel k
                                WHERE k.batch_id = p.batch_id AND k.is_active = true)
             GROUP BY p.scheduled_date
        ) q;

        WITH RECURSIVE fu AS (
            SELECT p.scheduled_date AS d, SUM(p.predicted_weight_kg)::numeric AS kg
              FROM public.kernel_intake_procurement p
             WHERE p_include_procurement
               AND p.status = 'scheduled'
               AND p.scheduled_date > v_today
               AND p.scheduled_date <= v_today + v_max_fc
               AND COALESCE(p.predicted_weight_kg, 0) > 0
               AND NOT EXISTS (SELECT 1 FROM public.kernel k
                                WHERE k.batch_id = p.batch_id AND k.is_active = true)
             GROUP BY p.scheduled_date
        ),
        sim AS (
            -- Stateful simulation. Each day depends on the CLAMPED result of the day before, which
            -- is why this cannot be a window function:
            --     available = level(d-1) + intake(d)
            --     cracked   = LEAST(available, rate)   -- cannot crack what is not there
            --     level(d)  = available - cracked      -- therefore never negative
            -- Bounded by the step counter (<= p_max_forecast_days), so it cannot run away, and there
            -- is no division, so a zero rate is a flat line rather than an error.
            SELECT v_today AS d,
                   v_pool_kg AS lvl,
                   0::numeric AS intake_kg,
                   0::numeric AS cracked_kg,
                   0 AS step
            UNION ALL
            SELECT s.d + 1,
                   (s.lvl + COALESCE(u.kg, 0)) - LEAST(s.lvl + COALESCE(u.kg, 0), v_kg_per_day),
                   COALESCE(u.kg, 0),
                   LEAST(s.lvl + COALESCE(u.kg, 0), v_kg_per_day),
                   s.step + 1
              FROM sim s
              LEFT JOIN fu u ON u.d = s.d + 1
             WHERE s.step < v_max_fc
        )
        SELECT MIN(d) FILTER (WHERE lvl <= 0),
               MIN(d) FILTER (WHERE lvl <= 0 AND d >= COALESCE(v_last_intake, v_today))
          INTO v_run_out, v_final_dep
          FROM sim
         WHERE step > 0;

        -- The series runs to final depletion, not the first run-out, so every scheduled delivery is
        -- shown arriving and being consumed.
        v_fc_end    := COALESCE(v_final_dep, v_today + v_max_fc);
        v_truncated := (v_final_dep IS NULL);
        v_days_out  := CASE WHEN v_run_out IS NOT NULL THEN v_run_out - v_today END;

        IF v_truncated THEN
            v_warnings := v_warnings || 'forecast_truncated_at_max_days'::text;
        END IF;

        WITH RECURSIVE fu AS (
            SELECT p.scheduled_date AS d, SUM(p.predicted_weight_kg)::numeric AS kg
              FROM public.kernel_intake_procurement p
             WHERE p_include_procurement
               AND p.status = 'scheduled'
               AND p.scheduled_date > v_today
               AND p.scheduled_date <= v_today + v_max_fc
               AND COALESCE(p.predicted_weight_kg, 0) > 0
               AND NOT EXISTS (SELECT 1 FROM public.kernel k
                                WHERE k.batch_id = p.batch_id AND k.is_active = true)
             GROUP BY p.scheduled_date
        ),
        sim AS (
            -- Stateful simulation. Each day depends on the CLAMPED result of the day before, which
            -- is why this cannot be a window function:
            --     available = level(d-1) + intake(d)
            --     cracked   = LEAST(available, rate)   -- cannot crack what is not there
            --     level(d)  = available - cracked      -- therefore never negative
            -- Bounded by the step counter (<= p_max_forecast_days), so it cannot run away, and there
            -- is no division, so a zero rate is a flat line rather than an error.
            SELECT v_today AS d,
                   v_pool_kg AS lvl,
                   0::numeric AS intake_kg,
                   0::numeric AS cracked_kg,
                   0 AS step
            UNION ALL
            SELECT s.d + 1,
                   (s.lvl + COALESCE(u.kg, 0)) - LEAST(s.lvl + COALESCE(u.kg, 0), v_kg_per_day),
                   COALESCE(u.kg, 0),
                   LEAST(s.lvl + COALESCE(u.kg, 0), v_kg_per_day),
                   s.step + 1
              FROM sim s
              LEFT JOIN fu u ON u.d = s.d + 1
             WHERE s.step < v_max_fc
        )
        SELECT COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'd',             d,
                       'qty_kg',        ROUND(lvl, 2),
                       'is_forecast',   true,
                       'intake_kg',     ROUND(intake_kg, 2),
                       'cracked_kg',    ROUND(cracked_kg, 2),
                       'reconciled_kg', 0
                   ) ORDER BY d), '[]'::jsonb),
               COUNT(*) FILTER (WHERE lvl <= 0 AND cracked_kg <= 0)
          INTO v_fc_points, v_idle
          FROM sim
         WHERE step > 0 AND d <= v_fc_end;

        IF v_idle > 0 THEN
            v_warnings := v_warnings || 'forecast_includes_idle_days'::text;
        END IF;

        v_points := v_points || v_fc_points;
    END IF;

    -- ---------------------------------------------------------------- assemble
    RETURN jsonb_build_object(
        'meta', jsonb_build_object(
            'today',                            v_today,
            'timezone',                         'Africa/Johannesburg',
            'history_start',                    v_hist_start,
            'history_end',                      v_hist_end,
            'pool_kg',                          ROUND(v_pool_kg, 2),
            'pool_awaiting_production_kg',      ROUND(v_pool_await, 2),
            'pool_in_production_remaining_kg',  ROUND(v_pool_prod, 2),
            'scheduled_procurement_future_kg',  ROUND(v_proc_future, 2),
            'scheduled_procurement_overdue_kg', ROUND(v_proc_overdue, 2),
            'kg_per_day',                       ROUND(v_kg_per_day, 2),
            'kg_per_day_source',                v_rate_source,
            'kg_per_week',                      ROUND(v_kg_per_day * 7, 2),
            'rate_basis_month',                 v_basis_month,
            'rate_basis_label',                 v_basis_label,
            'months',                           v_months,
            'run_out_date',                     v_run_out,
            'days_to_run_out',                  v_days_out,
            'forecast_end',                     v_fc_end,
            'final_depletion_date',             v_final_dep,
            'idle_days_in_forecast',            v_idle,
            'last_scheduled_intake_date',       v_last_intake,
            'forecast_truncated',               v_truncated,
            'history_has_negative_days',        v_neg_days,
            'cracking_rows_total',              v_rows_total,
            'cracking_rows_with_kg',            v_rows_kg,
            'batches_over_cracked',             v_over_n,
            'over_cracked_excess_kg',           ROUND(v_over_kg, 2),
            'undated_cracking_kg',              ROUND(v_undated_kg, 2),
            'warnings',                         to_jsonb(v_warnings)
        ),
        'points', v_points
    );
END;
$$;

COMMENT ON FUNCTION public.get_nis_runway_forecast(integer, numeric, integer, integer, boolean) IS
  'Raw-material runway: daily kg of nut-in-shell not yet put into production -- actual history plus a '
  'projection that runs to final_depletion_date, the day the LAST scheduled delivery is itself '
  'consumed, not merely to the first run_out_date. The projection is a stateful day-by-day simulation '
  '(recursive CTE) because consumption must be clamped to stock on hand: a plant that has run dry '
  'cracks nothing and idles at zero until nut arrives, so the cheaper cumulative-sum form is valid '
  'only up to the first zero. run_out_date remains the headline (when production stops) and '
  'idle_days_in_forecast counts projected days starved at zero. Rate is kg per CALENDAR day from a '
  'human-chosen month or a typed override in dashboard_targets; there is no automatic average, so '
  'with no rate configured this returns kg_per_day 0 and no forecast points rather than inventing a '
  'date. History is a signed three-event ledger whose terminal value provably equals the status-based '
  'pool; its reconciliation term must never be clamped. See the migration headers and '
  'docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md.';

DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_nis_runway_forecast', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_nis_runway_forecast(integer, numeric, integer, integer, boolean)
    TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
