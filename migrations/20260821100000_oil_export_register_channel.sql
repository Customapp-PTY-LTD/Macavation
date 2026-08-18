-- Oil sales — fold the export register into the report, without double counting.
--
-- THE DEFECT
-- ----------
-- Every oil sales metric reads data_oil_sales_lines alone. That table holds Pete's local invoice
-- book; the bulk export invoices live in data_oil_export_register, which no resolver has ever
-- touched. Measured against Pete's July 2026 monthly sheet:
--
--     Oil & Protein Sales   sheet 5,134,124.31   portal 905,243.26   (82% short)
--
-- THE TRAP
-- --------
-- Summing the two tables is WRONG. Five of the eight bulk rows in the local book are the same
-- commercial sale as an export invoice, recorded twice at different values:
--
--   qty 22216  local 2026-04-16 IMCD           R1,094,853.36  <->  export 2026-04-16 IMCD    R1,099,692.00
--   qty 87628  local 2026-04-21 Sigma Oil Seeds R0.00         <->  export 2026-04-22 Sigma    R3,016,068.13
--   qty 21136  local 2026-05-27 Gustav Hees    R844,879.90    <->  export 2026-05-27 Heess    R819,548.40
--   qty 21877  local 2026-05-27 IMCD           R1,116,383.31  <->  export 2026-05-19 IMCD     R1,082,911.50
--   qty 22061  local 2026-07-10 Henry Lamotte  R900,618.26    <->  export 2026-07-10 Lamotte  R863,026.32
--
-- Invoice numbers differ (the local book carries the Macavation number, the register the freight
-- forwarder's), dates drift up to 8 days, and even the product classification disagrees — the
-- 22216 kg IMCD load is ZRFOM1 "Food Grade" locally and EVMO on the register. Weight is the one
-- field that matches to the kilogram. Naively adding the channels would overstate by ~R4.9m.
--
-- Pete resolves this by treating the REGISTER as authoritative and dropping the local twin, which
-- is why his July figures reconcile to the cent:
--
--   Crude Cosmetic  4,176,339.39 = 863,026.32 + 864,567.17 + 2,448,745.90   (register crude only)
--   Extra Virgin      635,874.92 = 631,249.92 (register EVMO) + 4,625.00 (local drums, no twin)
--
-- THE DESIGN
-- ----------
-- The duplicate relationship becomes RECORDED DATA — data_oil_sales_lines.export_register_id — not
-- a heuristic re-derived on every query. A resolver that re-matched on weight each time would
-- silently change historical reports whenever a weight was corrected, and would give a human no
-- way to say "these two are not the same sale". The backfill that populates the column
-- (20260821110000) flags what it matched so a human can audit and correct it, following the
-- data_quality_flags convention set by data_nis_intake.
--
-- WHAT STILL WILL NOT RECONCILE, AND WHY THAT IS CORRECT
-- ------------------------------------------------------
-- After this change July resolves to 4,812,214.31 against Pete's 5,134,124.31. The entire residual
-- is R321,910 = his Cake line (307,620) plus Protein + Crispies (14,290). Neither channel exists in
-- any of the five source workbooks, so those two metrics stay honestly short rather than being
-- padded to make a total agree. Recovery goes from 17.6% of the sheet to 93.7%.
--
-- Idempotent throughout. OUT OF SCOPE: applying it. A human runs
--   npm run db:apply -- migrations/20260821100000_oil_export_register_channel.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. export_date becomes nullable.
--
-- Two rows on Pete's YE2026 sheet (Vantage R2,079,000 and Heess R1,485,000) carry customer,
-- country, USD value, loads and rate but no date, and both are inside his own sheet TOTAL of
-- 15,308,646.51. Dropping them would lose R3.56m; inventing a date would put revenue in a month it
-- may not belong to. They load undated and flagged, exactly as data_nis_intake.received_date does
-- for the same reason — visible for a human to complete, and excluded from every period until then.
-- ============================================================================

ALTER TABLE public.data_oil_export_register
    ALTER COLUMN export_date DROP NOT NULL;

COMMENT ON COLUMN public.data_oil_export_register.export_date IS
    'Nullable on purpose: two historical register rows carry real customer, USD value and rate but '
    'no date. They are loaded flagged rather than dropped, and are excluded from every period '
    'report until a human dates them.';

-- ============================================================================
-- 2. The duplicate link.
-- ============================================================================

ALTER TABLE public.data_oil_sales_lines
    ADD COLUMN IF NOT EXISTS export_register_id uuid NULL
        REFERENCES public.data_oil_export_register (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.data_oil_sales_lines.export_register_id IS
    'Set when this local invoice line is the SAME commercial sale as an export register row. The '
    'register is authoritative for value (USD x the rate on the invoice), so a linked local row is '
    'excluded from every oil sales figure to avoid double counting. NULL means a genuine '
    'domestic-only sale. Recorded rather than re-derived: a weight-match heuristic evaluated per '
    'query would mutate published history and leaves no way to record "not the same sale".';

CREATE INDEX IF NOT EXISTS ix_data_oil_sales_lines_export_register
    ON public.data_oil_sales_lines (export_register_id)
    WHERE export_register_id IS NOT NULL;

-- ============================================================================
-- 3. Product-class mapping between the two channels.
--
-- The register says Crude / EVMO; the local book says crude_cosmetic / extra_virgin / protein. The
-- 22216 kg IMCD load proves these disagree per row, so the mapping is stated once here instead of
-- being repeated inside each resolver branch.
--
-- The 34 pre-FYE2027 register rows have NO product class at all — Pete's older sheets carry a
-- "Transaction" column instead. Those resolve as NULL and therefore contribute to the oil sales
-- TOTAL but to no per-product line. That is honest: the workbook does not record which product
-- they were, and guessing would put revenue on the wrong line.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_oil_product_class_for_line(p_product_line text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_product_line
               WHEN 'crude_cosmetic' THEN 'crude'
               WHEN 'extra_virgin'   THEN 'evmo'
               WHEN 'protein'        THEN 'protein'
               ELSE NULL
           END;
$$;

COMMENT ON FUNCTION public.report_oil_product_class_for_line(text) IS
    'Maps a data_oil_sales_lines.product_line to the data_oil_export_register.product_class '
    'vocabulary, so the two sales channels can be totalled per product.';

-- ============================================================================
-- 4. Widen the source_kind vocabulary and repoint the oil sales metrics.
-- ============================================================================

ALTER TABLE public.report_metrics DROP CONSTRAINT IF EXISTS report_metrics_source_kind_check;
ALTER TABLE public.report_metrics ADD CONSTRAINT report_metrics_source_kind_check
    CHECK (source_kind IN (
        -- Superseded. Retained as documentation and still carried by the six oil-production
        -- metrics, whose dataset does not exist; these resolve to NULL.
        'kernel_cracking_kg', 'kernel_packing_kg_total', 'kernel_packing_kg_by_style',
        'kernel_nis_procured_kg', 'oil_produced_by_stream', 'sales_kernel_sum', 'sales_oil_sum',
        'sales_oil_by_product', 'manual',
        -- Live: read from the data page.
        'data_page_production_cracking_kg', 'data_page_production_packing_kg',
        'data_page_kernel_sales_sum', 'data_page_oil_sales_sum', 'data_page_oil_sales_by_product',
        'data_page_nis_procured_kg', 'data_page_oil_produced_by_stream',
        -- Live: both oil sales channels, de-duplicated via export_register_id.
        'data_page_oil_sales_all_channels', 'data_page_oil_sales_by_product_all_channels'
    ));

UPDATE public.report_metrics SET source_kind = 'data_page_oil_sales_all_channels'
 WHERE metric_key = 'oil_sales_excl_vat_zar';
UPDATE public.report_metrics SET source_kind = 'data_page_oil_sales_by_product_all_channels'
 WHERE source_kind = 'data_page_oil_sales_by_product';

-- ============================================================================
-- 5. The combined-channel resolver.
--
-- Replaced in full (a CASE cannot be patched) and identical to 20260821090000 apart from the two
-- new branches. Kept as one function so there is exactly one place that decides what a metric means.
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
    v_class  text;
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

        WHEN 'data_page_nis_procured_kg' THEN
            SELECT SUM(d.nis_kg) INTO v_result
            FROM public.data_nis_intake d
            WHERE d.received_date BETWEEN p_period_start AND p_period_end;

        -- Local book only. Superseded by the all-channels kinds below, kept so a metric still
        -- carrying it keeps its old meaning instead of silently changing.
        WHEN 'data_page_oil_sales_sum' THEN
            SELECT SUM(s.vat_excl_zar) INTO v_result
            FROM public.data_oil_sales_lines s
            WHERE s.sale_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_oil_sales_by_product' THEN
            SELECT SUM(s.vat_excl_zar) INTO v_result
            FROM public.data_oil_sales_lines s
            WHERE s.sale_date BETWEEN p_period_start AND p_period_end
              AND s.product_line = (v_metric.source_args ->> 'product');

        -- Both channels. The register is authoritative, so a local row carrying
        -- export_register_id is excluded rather than added.
        WHEN 'data_page_oil_sales_all_channels' THEN
            SELECT COALESCE((SELECT SUM(e.rand_value)
                             FROM public.data_oil_export_register e
                             WHERE e.export_date BETWEEN p_period_start AND p_period_end), 0)
                 + COALESCE((SELECT SUM(s.vat_excl_zar)
                             FROM public.data_oil_sales_lines s
                             WHERE s.sale_date BETWEEN p_period_start AND p_period_end
                               AND s.export_register_id IS NULL), 0)
              INTO v_result;
            -- All-zero because neither channel had a row is not a figure. Report NULL.
            IF NOT EXISTS (SELECT 1 FROM public.data_oil_export_register e
                            WHERE e.export_date BETWEEN p_period_start AND p_period_end)
               AND NOT EXISTS (SELECT 1 FROM public.data_oil_sales_lines s
                                WHERE s.sale_date BETWEEN p_period_start AND p_period_end
                                  AND s.export_register_id IS NULL)
            THEN
                v_result := NULL;
            END IF;

        WHEN 'data_page_oil_sales_by_product_all_channels' THEN
            v_class := v_metric.source_args ->> 'product';
            SELECT COALESCE((SELECT SUM(e.rand_value)
                             FROM public.data_oil_export_register e
                             WHERE e.export_date BETWEEN p_period_start AND p_period_end
                               AND e.product_class = public.report_oil_product_class_for_line(v_class)), 0)
                 + COALESCE((SELECT SUM(s.vat_excl_zar)
                             FROM public.data_oil_sales_lines s
                             WHERE s.sale_date BETWEEN p_period_start AND p_period_end
                               AND s.product_line = v_class
                               AND s.export_register_id IS NULL), 0)
              INTO v_result;
            IF NOT EXISTS (SELECT 1 FROM public.data_oil_export_register e
                            WHERE e.export_date BETWEEN p_period_start AND p_period_end
                              AND e.product_class = public.report_oil_product_class_for_line(v_class))
               AND NOT EXISTS (SELECT 1 FROM public.data_oil_sales_lines s
                                WHERE s.sale_date BETWEEN p_period_start AND p_period_end
                                  AND s.product_line = v_class
                                  AND s.export_register_id IS NULL)
            THEN
                v_result := NULL;
            END IF;

        ELSE
            -- Superseded kinds, and the six oil-production metrics whose dataset does not exist.
            -- NULL means "the database has no figure", never a substitute for a real zero.
            v_result := NULL;
    END CASE;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.resolve_report_metric_value(text, date, date) IS
    'Computes a report metric for a period from the data-page tables only. Oil sales combine the '
    'local invoice book and the export register, excluding local rows linked to a register row so '
    'the same sale is never counted twice. Returns NULL — not 0 — when no row exists either side.';

-- ============================================================================
-- 6. A section for the export register itself.
--
-- Pete's weekly sheet shows these as "Weeks' Sales Oil and Protein" with a USD price column, which
-- the existing oil_sales_lines section cannot express: it has no USD, no incoterm and no rate.
-- ============================================================================

INSERT INTO public.report_sections (section_key, label, description, render_kind, period_types)
VALUES ('oil_export_lines', 'Oil Export Invoices',
        'Bulk oil export invoices in USD with the rand conversion applied per invoice',
        'line_table', ARRAY['weekly', 'monthly'])
ON CONFLICT (section_key) DO NOTHING;

-- Offer it on both standard templates, defaulting ON: it carries the bulk of oil revenue.
INSERT INTO public.report_template_sections (template_id, section_key, display_order, default_enabled)
SELECT t.id, 'oil_export_lines', 145, true
FROM public.report_templates t
WHERE t.code IN ('standard_weekly', 'standard_monthly')
ON CONFLICT (template_id, section_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.report_lines_oil_export_lines(
    p_period_start date, p_period_end date
)
RETURNS TABLE (sort_index integer, payload jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT (ROW_NUMBER() OVER (ORDER BY e.export_date, e.document_number, e.id))::integer,
           jsonb_build_object(
               'export_date', e.export_date, 'customer_name', e.customer_name,
               'location_country', e.location_country, 'document_number', e.document_number,
               'reference', e.reference, 'product_class', e.product_class,
               'incoterm', e.incoterm, 'weight_kg', e.weight_kg,
               'price_per_kg_usd', e.price_per_kg_usd, 'usd_debit', e.usd_debit,
               'usd_zar_rate', e.usd_zar_rate, 'rand_value', e.rand_value)
    FROM public.data_oil_export_register e
    WHERE e.export_date BETWEEN p_period_start AND p_period_end
    ORDER BY e.export_date, e.document_number, e.id
    LIMIT 500;
$$;

COMMENT ON FUNCTION public.report_lines_oil_export_lines(date, date) IS
    'Export invoices for the period, in USD with the per-invoice rand conversion. Undated register '
    'rows are excluded by the BETWEEN and stay invisible until a human dates them.';

-- ============================================================================
-- 7. Dispatcher: add the export-lines branch. Replaced in full, same reason as always.
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

        ELSIF v_section.section_key = 'oil_export_lines' THEN
            INSERT INTO public.report_instance_lines
                (report_instance_id, section_key, line_type, sort_index, ref_table, payload)
            SELECT p_report_instance_id, 'oil_export_lines', 'oil_export_line',
                   l.sort_index, 'data_oil_export_register', l.payload
            FROM public.report_lines_oil_export_lines(v_inst.period_start, v_inst.period_end) l;
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
-- 8. Grants.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.report_oil_product_class_for_line(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_lines_oil_export_lines(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.populate_report_instance_lines(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_report_metric_value(text, date, date) TO anon, authenticated, service_role;

DO $$
DECLARE v_role record; v_fn text;
BEGIN
    FOR v_role IN SELECT id, role_name FROM public.roles LOOP
        FOREACH v_fn IN ARRAY ARRAY[
            'report_oil_product_class_for_line', 'report_lines_oil_export_lines'
        ] LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true) ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
