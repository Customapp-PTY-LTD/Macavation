-- get_nis_runway_forecast: when does the plant run out of nut-in-shell to crack?
--
-- Returns a gap-free daily series of "kg of NIS not yet put into production" -- actual history to
-- today, then a projection to the predicted run-out date -- plus the scalars needed to describe the
-- assumptions behind it. Consumed by the Raw material runway forecast card on the executive
-- dashboard.
--
-- WHY jsonb AND NOT "RETURNS TABLE": the scalars (run-out date, effective rate, provenance,
-- warnings, the month picker's data) must be computed from the same pool and rate as the series, in
-- one round trip, or the caption can contradict the plot. It also avoids two traps this repo has
-- already hit: adding a column to a RETURNS TABLE function needs DROP FUNCTION first
-- (20260707170000_drop_resurrected_function_overloads.sql), and an OUT parameter colliding with a
-- column name needed 20260713161000_fix_get_stock_soh_history_ambiguous_series.sql. No OUT params,
-- neither can happen.
--
-- ============================ THE RATE IS A HUMAN CHOICE ============================
-- There is deliberately NO automatic trailing-average fallback. Cracking capture is too sparse for
-- one to be meaningful: measured per calendar month on production, kg/day ranges from 420 (June
-- 2026, 3 of 12 day-rows captured -> a 481-day runway) to 2,333 (May 2026, 25 of 48 captured -> an
-- 87-day runway). An average silently blends those. A human reading each month's capture_pct can
-- tell them apart, so the rate comes from a month someone picked, or a number someone typed.
--
-- With no rate configured the function returns kg_per_day = 0, source 'none', warning
-- 'no_rate_configured', and NO forecast points -- so the card shows the stock level and asks for a
-- basis month instead of inventing a run-out date. Do not add a "sensible default"; that would
-- reintroduce exactly the confidently-wrong number this design exists to avoid.
--
-- Rate = total kg cracked in the chosen month / calendar days in that month. Dividing by calendar
-- days already absorbs idle days and weekends, which is why there is no production-days-per-week
-- parameter and why the projected line is straight. A stepped line would imply knowledge of the
-- production calendar that this data does not contain.
--
-- ======================= HISTORY IS A THREE-EVENT LEDGER =======================
-- Per active batch: +nis_kg on received_date, -kernel_day_kg(elem) on each cracking day, and a
-- reconciliation of -(nis_kg - cracked_kg) on the day the batch left the uncracked pool.
--
-- THE RECONCILIATION TERM IS SIGNED AND MUST NOT BE CLAMPED WITH greatest(...,0). Unclamped, every
-- exited batch's +nis and -cracked cancel against its own residual, which gives the exact identity
--
--     level(today) == SUM over in-pool batches of (nis_kg - cracked_kg)
--
-- so the history line provably terminates on the status-based pool figure and the forecast can
-- anchor straight to it. Verified on production: both sides = 202,245.7 kg. Clamping the residual
-- yields 157,060.2 -- out by 45,186 -- because five complete batches are over-cracked by 45,185.5 kg
-- in total. A defensive-looking clamp breaks the whole design here.
--
-- Why not the two obvious alternatives: walking only today's pool batches backwards lands on the
-- right number today but collapses toward zero a few months back, because the batches that
-- dominated the pool in Mar-Jun are now 'complete'; and a plain plant ledger (SUM intake - SUM
-- cracked) reads 374,722 kg today, 85% high, because 172,476 kg of consumption on completed batches
-- was never captured as cracking rows. The audit trail cannot help either -- audit.audit_log holds
-- only 39 kernel status changes, none before 2026-07-07.
--
-- Assumptions: received_date is the day NIS entered the pool (falls back to created_at, clamped to
-- <= today); a batch leaves the pool at GREATEST(production_finished_at, last cracking day,
-- received_date); unaccounted NIS on an exited batch was really consumed; 'qa' and 'dispatch' count
-- as exited; is_active = false is excluded everywhere -- inactive 'intake' rows carry ~7.76 million
-- kg of junk NIS that would swamp the chart roughly 38x.
--
-- Known artefacts, surfaced rather than hidden: the residual write-off lands on one day, so the
-- history line shows cliffs on batch completion dates (reconciled_kg is returned per point so a
-- tooltip can explain them); and history goes negative for 5 days in April 2026 because batch
-- Bn 32 26 10 records endqty1 = 39,853 against a 12,309.3 kg batch. Plotted qty_kg is clamped to
-- >= 0 (matching 20260713160000_get_stock_soh_history.sql) while intake_kg/cracked_kg/reconciled_kg
-- stay unclamped so the day remains auditable, and history_has_negative_days reports the count.
--
-- Data quality is reported, never silently corrected: see warnings sparse_cracking_capture and
-- recorded_feed_exceeds_intake, and docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md.

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
        WITH fd AS (
            SELECT gs::date AS d
              FROM generate_series(v_today + 1, v_today + v_max_fc, interval '1 day') gs
        ),
        fu AS (
            SELECT p.scheduled_date AS d, SUM(p.predicted_weight_kg)::numeric AS kg
              FROM public.kernel_intake_procurement p
             WHERE p_include_procurement
               AND p.status = 'scheduled'
               AND p.scheduled_date > v_today
               AND COALESCE(p.predicted_weight_kg, 0) > 0
               AND NOT EXISTS (SELECT 1 FROM public.kernel k
                                WHERE k.batch_id = p.batch_id AND k.is_active = true)
             GROUP BY p.scheduled_date
        ),
        proj AS (
            -- No division and no loop: a zero rate cannot divide by zero or hang, and because the
            -- series is cut at the first zero crossing the plain cumulative sum is exact.
            SELECT fd.d,
                   COALESCE(fu.kg, 0) AS intake_kg,
                   v_kg_per_day       AS cracked_kg,
                   v_pool_kg
                     + SUM(COALESCE(fu.kg, 0)) OVER (ORDER BY fd.d ROWS UNBOUNDED PRECEDING)
                     - SUM(v_kg_per_day)       OVER (ORDER BY fd.d ROWS UNBOUNDED PRECEDING) AS level
              FROM fd
              LEFT JOIN fu ON fu.d = fd.d
        )
        SELECT MIN(d) INTO v_run_out FROM proj WHERE level <= 0;

        v_fc_end    := COALESCE(v_run_out, v_today + v_max_fc);
        v_truncated := (v_run_out IS NULL);
        v_days_out  := CASE WHEN v_run_out IS NOT NULL THEN v_run_out - v_today END;

        IF v_truncated THEN
            v_warnings := v_warnings || 'forecast_truncated_at_max_days'::text;
        END IF;

        WITH fd AS (
            SELECT gs::date AS d
              FROM generate_series(v_today + 1, v_fc_end, interval '1 day') gs
        ),
        fu AS (
            SELECT p.scheduled_date AS d, SUM(p.predicted_weight_kg)::numeric AS kg
              FROM public.kernel_intake_procurement p
             WHERE p_include_procurement
               AND p.status = 'scheduled'
               AND p.scheduled_date > v_today
               AND COALESCE(p.predicted_weight_kg, 0) > 0
               AND NOT EXISTS (SELECT 1 FROM public.kernel k
                                WHERE k.batch_id = p.batch_id AND k.is_active = true)
             GROUP BY p.scheduled_date
        ),
        proj AS (
            SELECT fd.d,
                   COALESCE(fu.kg, 0) AS intake_kg,
                   v_pool_kg
                     + SUM(COALESCE(fu.kg, 0)) OVER (ORDER BY fd.d ROWS UNBOUNDED PRECEDING)
                     - SUM(v_kg_per_day)       OVER (ORDER BY fd.d ROWS UNBOUNDED PRECEDING) AS level
              FROM fd
              LEFT JOIN fu ON fu.d = fd.d
        )
        SELECT COALESCE(jsonb_agg(
                   jsonb_build_object(
                       'd',             d,
                       'qty_kg',        ROUND(GREATEST(level, 0), 2),
                       'is_forecast',   true,
                       'intake_kg',     ROUND(intake_kg, 2),
                       'cracked_kg',    ROUND(v_kg_per_day, 2),
                       'reconciled_kg', 0
                   ) ORDER BY d), '[]'::jsonb)
          INTO v_fc_points
          FROM proj;

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
  'Raw-material runway: daily kg of nut-in-shell not yet put into production, actual history plus a '
  'projection to the predicted run-out date. Depletion rate is kg per CALENDAR day, taken from a '
  'human-chosen month (total cracked / days in month) or a typed override in dashboard_targets '
  '(nis_rate_basis_month / nis_crack_rate_kg_per_day). There is deliberately NO automatic average: '
  'cracking capture is too sparse for one to be meaningful, so with no rate configured this returns '
  'kg_per_day 0 and no forecast points rather than inventing a run-out date. History is a signed '
  'three-event ledger (intake, cracked, reconciliation on pool exit) whose terminal value provably '
  'equals the status-based pool; the reconciliation term must never be clamped. See the migration '
  'header and docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md.';

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
