-- Report builder — close the gaps that need no new data.
--
-- Three defects, all provable against Pete's July 2026 monthly sheet:
--
--   1. nis_procured_kg has resolved to NULL since 20260819110000, which explained itself with
--      "its dataset does not exist yet". data_nis_intake arrived one migration LATER
--      (20260819130000) and now holds real rows, so the metric is stranded rather than sourceless.
--      'data_page_nis_procured_kg' was even added to the source_kind vocabulary at the time — the
--      resolver branch and the repoint were simply never written.
--
--   2. The three tracking_table sections (nis_procurement_tracking, sound_kernel_recovery_tracking,
--      kernel_sales_tracking) are unreachable code. populate_report_instance_lines filters
--      render_kind = 'line_table', so nothing has ever written a tracking row, and
--      report-pdf-builder.js renders them via a stub commented "No data source exists for these
--      yet". Every figure they need is already in the data-page tables.
--
--   3. kernel_sales_by_style renders empty for the same reason, though it is a pure GROUP BY over
--      data_kernel_sales_lines.
--
-- Unchanged on purpose: the six oil-production metrics (oil_produced_by_stream) still resolve to
-- NULL. No dataset for them exists and inventing a source is worse than an honest blank.
--
-- Central principle preserved from 20260819110000: the resolver reads ONLY data-page tables. Every
-- figure below comes from data_production_daily, data_kernel_sales_lines or data_nis_intake.
--
-- Idempotent: CREATE OR REPLACE / IF NOT EXISTS throughout, and the DO block re-grants without
-- duplicating. Safe to re-run, which matters because the MCP path re-stamps its own version and
-- can replay a file.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260821090000_report_engine_gaps.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. Nut in Shell Procured — point it at the dataset that now exists.
-- ============================================================================

UPDATE public.report_metrics
   SET source_kind = 'data_page_nis_procured_kg'
 WHERE metric_key = 'nis_procured_kg'
   AND source_kind = 'kernel_nis_procured_kg';

-- ============================================================================
-- 2. Tracking-table support.
--
-- Shape of Pete's tracking block, reproduced exactly (July 2026 sheet, rows 26-45):
--
--     Month                  | 2026 YE | 2027 YE | Achieved (%)
--     July - by Month        |   67623 |         |
--     July - Accumulative    |  315068 |         |
--     Month (Accumulative)   | 2026 YE | 2027 YE | Achieved (%)
--     April                  |   44148 | 59428.8 | 0.3461
--     ...
--     March                  |  878329 |         |
--     Total                  |  878329 | 275428  | -0.6864
--
-- "Achieved (%)" is a year-on-year variance, not attainment of a target: Pete's April row is
-- (59428.8 - 44148) / 44148 = 0.3461. Reproduced as variance_pct, NULL when the prior year is zero
-- or absent (his sheet shows #DIV/0! there) so the renderer prints a blank rather than a fake 0.
--
-- The prior-year column is the SAME dataset one financial year back, not a stored snapshot. That is
-- what makes these sections derivable at all, and it means a correction to a historical data-page
-- row flows into the comparative of every future report — which is the intent.
-- ============================================================================

-- Monthly totals for one tracking kind in one financial year, as a full 12-month April-March
-- series. A month with no rows yields NULL, never 0: "nothing captured" and "captured as zero" are
-- different facts and Pete's sheet distinguishes them.
CREATE OR REPLACE FUNCTION public.report_tracking_monthly(
    p_kind text,
    p_fy   integer
)
RETURNS TABLE (
    fy_month_index integer,
    month_label    text,
    monthly_value  numeric,
    cumulative     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH months AS (
        -- April of the prior calendar year through March of p_fy.
        SELECT gs.i AS fy_month_index,
               (MAKE_DATE(p_fy - 1, 4, 1) + ((gs.i - 1) || ' month')::interval)::date AS month_start
        FROM GENERATE_SERIES(1, 12) AS gs(i)
    ),
    sourced AS (
        SELECT m.fy_month_index,
               m.month_start,
               CASE p_kind
                   WHEN 'nis_procurement' THEN (
                       SELECT SUM(d.nis_kg)
                       FROM public.data_nis_intake d
                       WHERE d.received_date >= m.month_start
                         AND d.received_date <  (m.month_start + INTERVAL '1 month')
                   )
                   WHEN 'sound_kernel_recovery' THEN (
                       SELECT SUM(d.sk_packed_kg)
                       FROM public.data_production_daily d
                       WHERE d.production_date >= m.month_start
                         AND d.production_date <  (m.month_start + INTERVAL '1 month')
                   )
                   WHEN 'kernel_sales' THEN (
                       SELECT SUM(s.vat_excl_zar)
                       FROM public.data_kernel_sales_lines s
                       WHERE s.sale_date >= m.month_start
                         AND s.sale_date <  (m.month_start + INTERVAL '1 month')
                   )
                   ELSE NULL
               END AS monthly_value
        FROM months m
    )
    SELECT s.fy_month_index,
           TRIM(TO_CHAR(s.month_start, 'Month')),
           s.monthly_value,
           -- Cumulative ignores NULL months, so the running total does not reset to NULL on a gap.
           SUM(s.monthly_value) OVER (ORDER BY s.fy_month_index
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    FROM sourced s
    ORDER BY s.fy_month_index
    LIMIT 12;
$$;

COMMENT ON FUNCTION public.report_tracking_monthly(text, integer) IS
    'April-March monthly and cumulative series for one tracking kind (nis_procurement, '
    'sound_kernel_recovery, kernel_sales) in one financial year. A month with no captured rows is '
    'NULL, not 0. Unknown kind yields NULLs rather than raising, so a new section cannot break '
    'report generation.';

-- Which tracking kind each section shows, and the unit its renderer should use. A section not in
-- this map writes no rows, exactly as before.
CREATE OR REPLACE FUNCTION public.report_tracking_kind_for_section(p_section_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_section_key
               WHEN 'nis_procurement_tracking'        THEN 'nis_procurement'
               WHEN 'sound_kernel_recovery_tracking'  THEN 'sound_kernel_recovery'
               WHEN 'kernel_sales_tracking'           THEN 'kernel_sales'
               ELSE NULL
           END;
$$;

COMMENT ON FUNCTION public.report_tracking_kind_for_section(text) IS
    'Maps a tracking_table section_key to its tracking kind. NULL for any other section.';

-- The rows for one tracking section: two current-month rows, twelve month rows, one total row.
CREATE OR REPLACE FUNCTION public.report_lines_tracking(
    p_section_key  text,
    p_period_start date
)
RETURNS TABLE (sort_index integer, payload jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH cfg AS (
        SELECT public.report_tracking_kind_for_section(p_section_key) AS kind,
               public.report_fy_of_date(p_period_start)               AS fy_current,
               public.report_fy_month_index(p_period_start)           AS mi,
               TRIM(TO_CHAR(p_period_start, 'Month'))                 AS month_name
    ),
    cur AS (
        SELECT t.* FROM cfg, public.report_tracking_monthly(cfg.kind, cfg.fy_current) t
        WHERE cfg.kind IS NOT NULL
    ),
    prior AS (
        SELECT t.* FROM cfg, public.report_tracking_monthly(cfg.kind, cfg.fy_current - 1) t
        WHERE cfg.kind IS NOT NULL
    ),
    -- The two "this month" rows Pete puts above the grid.
    head AS (
        SELECT 1 AS sort_index,
               jsonb_build_object(
                   'row_kind',      'current_month',
                   'label',         cfg.month_name || ' - by Month',
                   'fy_prior',      cfg.fy_current - 1,
                   'fy_current',    cfg.fy_current,
                   'prior_value',   (SELECT p.monthly_value FROM prior p WHERE p.fy_month_index = cfg.mi),
                   'current_value', (SELECT c.monthly_value FROM cur   c WHERE c.fy_month_index = cfg.mi)
               ) AS payload
        FROM cfg WHERE cfg.kind IS NOT NULL
        UNION ALL
        SELECT 2,
               jsonb_build_object(
                   'row_kind',      'current_month_cumulative',
                   'label',         cfg.month_name || ' - Accumulative',
                   'fy_prior',      cfg.fy_current - 1,
                   'fy_current',    cfg.fy_current,
                   'prior_value',   (SELECT p.cumulative FROM prior p WHERE p.fy_month_index = cfg.mi),
                   'current_value', (SELECT c.cumulative FROM cur   c WHERE c.fy_month_index = cfg.mi)
               )
        FROM cfg WHERE cfg.kind IS NOT NULL
    ),
    -- The twelve cumulative month rows.
    grid AS (
        SELECT 10 + c.fy_month_index AS sort_index,
               jsonb_build_object(
                   'row_kind',      'month',
                   'label',         c.month_label,
                   'fy_prior',      cfg.fy_current - 1,
                   'fy_current',    cfg.fy_current,
                   'prior_value',   p.cumulative,
                   'current_value', c.cumulative
               ) AS payload
        FROM cfg
        JOIN cur   c ON true
        LEFT JOIN prior p ON p.fy_month_index = c.fy_month_index
    ),
    -- Full-year totals: the last non-NULL cumulative in each series.
    foot AS (
        SELECT 90 AS sort_index,
               jsonb_build_object(
                   'row_kind',      'total',
                   'label',         'Total',
                   'fy_prior',      cfg.fy_current - 1,
                   'fy_current',    cfg.fy_current,
                   'prior_value',   (SELECT MAX(p.cumulative) FROM prior p),
                   'current_value', (SELECT MAX(c.cumulative) FROM cur   c)
               ) AS payload
        FROM cfg WHERE cfg.kind IS NOT NULL
    ),
    unioned AS (
        SELECT * FROM head UNION ALL SELECT * FROM grid UNION ALL SELECT * FROM foot
    )
    -- variance_pct is added last so every row computes it the same way, including the total.
    SELECT u.sort_index,
           u.payload || jsonb_build_object(
               'variance_pct',
               CASE
                   WHEN (u.payload ->> 'prior_value') IS NULL
                     OR (u.payload ->> 'current_value') IS NULL
                     OR (u.payload ->> 'prior_value')::numeric = 0
                   THEN NULL
                   ELSE ROUND(((u.payload ->> 'current_value')::numeric
                               - (u.payload ->> 'prior_value')::numeric)
                              / (u.payload ->> 'prior_value')::numeric, 6)
               END)
    FROM unioned u
    ORDER BY u.sort_index
    LIMIT 20;
$$;

COMMENT ON FUNCTION public.report_lines_tracking(text, date) IS
    'Rows for a tracking_table section: this month by-month and cumulative, the twelve April-March '
    'cumulative rows, and a total. variance_pct is year-on-year ((current - prior) / prior), NULL '
    'when the prior year is zero or absent — the blank Pete''s sheet shows as #DIV/0!.';

-- ============================================================================
-- 3. Kernel sales by style — a pure GROUP BY that has been rendering empty.
--
-- price_per_kg is recomputed as value / quantity rather than averaged: averaging the per-line
-- price column would weight a 11 kg carton the same as a 1,900 kg order.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_lines_kernel_sales_by_style(
    p_period_start date, p_period_end date
)
RETURNS TABLE (sort_index integer, payload jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH agg AS (
        SELECT COALESCE(NULLIF(TRIM(s.style_code), ''), '(unspecified)') AS style_code,
               SUM(s.cartons)      AS cartons,
               SUM(s.quantity_kg)  AS quantity_kg,
               SUM(s.vat_excl_zar) AS vat_excl_zar
        FROM public.data_kernel_sales_lines s
        WHERE s.sale_date BETWEEN p_period_start AND p_period_end
        GROUP BY COALESCE(NULLIF(TRIM(s.style_code), ''), '(unspecified)')
    )
    SELECT (ROW_NUMBER() OVER (ORDER BY COALESCE(k.display_order, 9999), a.style_code))::integer,
           jsonb_build_object(
               'style_code',   a.style_code,
               'style_label',  COALESCE(k.label, a.style_code),
               'cartons',      a.cartons,
               'quantity_kg',  a.quantity_kg,
               'price_per_kg', CASE WHEN COALESCE(a.quantity_kg, 0) > 0
                                    THEN ROUND(a.vat_excl_zar / a.quantity_kg, 2)
                                    ELSE NULL END,
               'vat_excl_zar', a.vat_excl_zar)
    FROM agg a
    LEFT JOIN public.kernel_style_registry k ON k.style_code = a.style_code
    ORDER BY COALESCE(k.display_order, 9999), a.style_code
    LIMIT 100;
$$;

COMMENT ON FUNCTION public.report_lines_kernel_sales_by_style(date, date) IS
    'Kernel sales for the period aggregated by style, ordered by the style registry. price_per_kg '
    'is value/quantity (a weighted average), not the mean of the per-line price column.';

-- ============================================================================
-- 4. Teach the dispatcher about tracking_table and the two new line sections.
--
-- Replaced in full rather than patched: it is the one place create and refresh share, so it must
-- stay readable as a single list of what each section writes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.populate_report_instance_lines(p_report_instance_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inst    public.report_instances%ROWTYPE;
    v_section record;
    v_written integer := 0;
    v_n       integer;
BEGIN
    SELECT * INTO v_inst FROM public.report_instances WHERE id = p_report_instance_id;
    IF NOT FOUND THEN RETURN 0; END IF;

    FOR v_section IN
        SELECT ris.section_key, s.render_kind
        FROM public.report_instance_sections ris
        JOIN public.report_sections s ON s.section_key = ris.section_key
        WHERE ris.report_instance_id = p_report_instance_id
          AND ris.is_enabled
          AND s.render_kind IN ('line_table', 'tracking_table')
    LOOP
        DELETE FROM public.report_instance_lines
        WHERE report_instance_id = p_report_instance_id
          AND section_key = v_section.section_key;

        IF v_section.section_key = 'kernel_sales_lines' THEN
            INSERT INTO public.report_instance_lines
                (report_instance_id, section_key, line_type, sort_index, ref_table, payload)
            SELECT p_report_instance_id, 'kernel_sales_lines', 'kernel_sales_line',
                   l.sort_index, 'data_kernel_sales_lines', l.payload
            FROM public.report_lines_kernel_sales_lines(v_inst.period_start, v_inst.period_end) l;
            GET DIAGNOSTICS v_n = ROW_COUNT; v_written := v_written + v_n;

        ELSIF v_section.section_key = 'oil_sales_lines' THEN
            INSERT INTO public.report_instance_lines
                (report_instance_id, section_key, line_type, sort_index, ref_table, payload)
            SELECT p_report_instance_id, 'oil_sales_lines', 'oil_sales_line',
                   l.sort_index, 'data_oil_sales_lines', l.payload
            FROM public.report_lines_oil_sales_lines(v_inst.period_start, v_inst.period_end) l;
            GET DIAGNOSTICS v_n = ROW_COUNT; v_written := v_written + v_n;

        ELSIF v_section.section_key = 'kernel_sales_by_style' THEN
            INSERT INTO public.report_instance_lines
                (report_instance_id, section_key, line_type, sort_index, ref_table, payload)
            SELECT p_report_instance_id, 'kernel_sales_by_style', 'kernel_sales_style_line',
                   l.sort_index, 'data_kernel_sales_lines', l.payload
            FROM public.report_lines_kernel_sales_by_style(v_inst.period_start, v_inst.period_end) l;
            GET DIAGNOSTICS v_n = ROW_COUNT; v_written := v_written + v_n;

        ELSIF v_section.render_kind = 'tracking_table'
              AND public.report_tracking_kind_for_section(v_section.section_key) IS NOT NULL THEN
            INSERT INTO public.report_instance_lines
                (report_instance_id, section_key, line_type, sort_index, ref_table, payload)
            SELECT p_report_instance_id, v_section.section_key, 'tracking_line',
                   l.sort_index, NULL, l.payload
            FROM public.report_lines_tracking(v_section.section_key, v_inst.period_start) l;
            GET DIAGNOSTICS v_n = ROW_COUNT; v_written := v_written + v_n;
        END IF;
        -- Sections whose dataset is not built yet write no lines and render their empty state.
    END LOOP;

    RETURN v_written;
END;
$$;

COMMENT ON FUNCTION public.populate_report_instance_lines(uuid) IS
    'Freezes data-page rows into report_instance_lines for every enabled line_table AND '
    'tracking_table section. Called by both create_report_instance and refresh_report_instance so '
    'metric figures and tabular content can never disagree within one draft.';

-- ============================================================================
-- 5. Resolver: add the Nut in Shell Procured branch.
--
-- Replaced in full (CASE branches are not patchable) and kept byte-identical to 20260819110000
-- apart from the new WHEN. received_date is nullable in data_nis_intake by design — a row awaiting
-- a date is deliberately excluded from every period rather than silently landing in one.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_report_metric_value(
    p_metric_key   text,
    p_period_start date,
    p_period_end   date
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_metric public.report_metrics%ROWTYPE;
    v_result numeric;
BEGIN
    SELECT * INTO v_metric FROM public.report_metrics WHERE metric_key = p_metric_key;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown report metric_key: %', p_metric_key USING ERRCODE = 'no_data_found';
    END IF;

    CASE v_metric.source_kind
        WHEN 'data_page_production_cracking_kg' THEN
            SELECT SUM(d.cracked_kg) INTO v_result
            FROM public.data_production_daily d
            WHERE d.production_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_production_packing_kg' THEN
            SELECT SUM(d.sk_packed_kg) INTO v_result
            FROM public.data_production_daily d
            WHERE d.production_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_kernel_sales_sum' THEN
            SELECT SUM(s.vat_excl_zar) INTO v_result
            FROM public.data_kernel_sales_lines s
            WHERE s.sale_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_oil_sales_sum' THEN
            SELECT SUM(s.vat_excl_zar) INTO v_result
            FROM public.data_oil_sales_lines s
            WHERE s.sale_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_oil_sales_by_product' THEN
            SELECT SUM(s.vat_excl_zar) INTO v_result
            FROM public.data_oil_sales_lines s
            WHERE s.sale_date BETWEEN p_period_start AND p_period_end
              AND s.product_line = (v_metric.source_args ->> 'product');

        WHEN 'data_page_nis_procured_kg' THEN
            SELECT SUM(d.nis_kg) INTO v_result
            FROM public.data_nis_intake d
            WHERE d.received_date BETWEEN p_period_start AND p_period_end;

        ELSE
            -- Superseded kinds, and any metric whose dataset is not built yet (the six oil
            -- production streams). NULL means "the database has no figure", and is never a
            -- substitute for a real zero.
            v_result := NULL;
    END CASE;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.resolve_report_metric_value(text, date, date) IS
    'Computes a report metric for a period, reading exclusively from the data-page tables. Never '
    'reads kernel/oil directly. Returns NULL for the oil-production metrics, whose dataset does '
    'not exist yet.';

-- ============================================================================
-- 6. Grants. Same shape as every report RPC: anon included, because
--    WebPortal/js/data-functions.js calls callSupabaseRpc with the anon key — the portal token is
--    never a Supabase Auth JWT.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.report_tracking_monthly(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_tracking_kind_for_section(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_lines_tracking(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_lines_kernel_sales_by_style(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.populate_report_instance_lines(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_report_metric_value(text, date, date) TO anon, authenticated, service_role;

DO $$
DECLARE v_role record; v_fn text;
BEGIN
    FOR v_role IN SELECT id, role_name FROM public.roles LOOP
        FOREACH v_fn IN ARRAY ARRAY[
            'report_tracking_monthly', 'report_tracking_kind_for_section',
            'report_lines_tracking', 'report_lines_kernel_sales_by_style'
        ] LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true) ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
