-- New "Byproduct Yield" report section, backed by real, already-captured data.
--
-- Context. Five columns on public.data_production_daily — oil_kernel_kg, cracker_dust_kg,
-- shell_fines_kg, compost_kg, shell_kg — are typed in on the Production tab of Sales &
-- Production Data on 55-58% of the last 618 production days
-- (migrations/20260819090000_data_page_production_daily.sql:90-97), but nothing in this repo
-- ever reads them: not a calculation, not a report, not a dashboard. This section gives them a
-- destination, following the exact pattern already used for cracked_kg/sk_packed_kg
-- (migrations/20260821100000_oil_export_register_channel.sql:174-182) — a plain per-column
-- SUM over the period, no new capture required.
--
-- uncracks_pct is deliberately NOT included here, for the same reason wholes_pct has no metric
-- key (migrations/20260825091000_daily_production_report.sql:320-323): report_metrics only
-- supports sum_over_period / as_at_period_end / count_over_period aggregation, none of which is a
-- correct way to combine a daily percentage across a period. Giving it a report destination is a
-- separate decision, not a same-shape fix.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260914091500_byproduct_yield_report_section.sql
-- against dev (nmdmddugxclpqrwylyfa) and, after sign-off, npm run db:apply-prod for the same file
-- against prod (sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. The section.
-- ============================================================================

INSERT INTO public.report_sections (section_key, label, description, render_kind, period_types)
VALUES
    ('byproduct_yield', 'Byproduct Yield',
     'Oil kernel, cracker dust, shell fines, compost and shell recovered per period',
     'metric_table', ARRAY['weekly', 'monthly'])
ON CONFLICT (section_key) DO NOTHING;

-- ============================================================================
-- 2. Widen the resolver's source_kind vocabulary FIRST — the metric rows inserted next need
-- the new values to already be legal. Full restatement required (a CHECK constraint cannot be
-- patched) — copied from migrations/20260821100000_oil_export_register_channel.sql:126-138 plus
-- the five new values.
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
        'data_page_oil_sales_all_channels', 'data_page_oil_sales_by_product_all_channels',
        -- Live: the five byproduct columns on data_production_daily.
        'data_page_production_oil_kernel_kg', 'data_page_production_cracker_dust_kg',
        'data_page_production_shell_fines_kg', 'data_page_production_compost_kg',
        'data_page_production_shell_kg'
    ));

-- ============================================================================
-- 3. The five metrics.
-- ============================================================================

INSERT INTO public.report_metrics
    (metric_key, label, section_key, division, unit, aggregation, source_kind, source_args, period_types, display_order)
VALUES
    ('byproduct_oil_kernel_kg', 'Oil Kernel', 'byproduct_yield', 'kernel', 'kg',
        'sum_over_period', 'data_page_production_oil_kernel_kg', '{}'::jsonb,
        ARRAY['weekly', 'monthly'], 10),
    ('byproduct_cracker_dust_kg', 'Cracker Dust', 'byproduct_yield', 'kernel', 'kg',
        'sum_over_period', 'data_page_production_cracker_dust_kg', '{}'::jsonb,
        ARRAY['weekly', 'monthly'], 20),
    ('byproduct_shell_fines_kg', 'Shell Fines', 'byproduct_yield', 'kernel', 'kg',
        'sum_over_period', 'data_page_production_shell_fines_kg', '{}'::jsonb,
        ARRAY['weekly', 'monthly'], 30),
    ('byproduct_compost_kg', 'Compost', 'byproduct_yield', 'kernel', 'kg',
        'sum_over_period', 'data_page_production_compost_kg', '{}'::jsonb,
        ARRAY['weekly', 'monthly'], 40),
    ('byproduct_shell_kg', 'Shell', 'byproduct_yield', 'kernel', 'kg',
        'sum_over_period', 'data_page_production_shell_kg', '{}'::jsonb,
        ARRAY['weekly', 'monthly'], 50)
ON CONFLICT (metric_key) DO NOTHING;

-- ============================================================================
-- 4. Attach the section to both standard templates, same shape as
-- migrations/20260817090000_report_builder_foundations.sql:398-407, switched on by default (this
-- is real recovered tonnage, not a heavier planning section).
-- ============================================================================

INSERT INTO public.report_template_sections (template_id, section_key, display_order, default_enabled)
SELECT t.id,
       'byproduct_yield',
       (SELECT COALESCE(MAX(ts.display_order), 0) + 10
        FROM public.report_template_sections ts
        WHERE ts.template_id = t.id),
       true
FROM public.report_templates t
WHERE t.period_type IN ('weekly', 'monthly')
ON CONFLICT (template_id, section_key) DO NOTHING;

-- ============================================================================
-- 5. resolve_report_metric_value — replaced in full (a CASE cannot be patched), identical to
-- migrations/20260821100000_oil_export_register_channel.sql:152-259 apart from the five new
-- branches.
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

        WHEN 'data_page_production_oil_kernel_kg' THEN
            SELECT SUM(d.oil_kernel_kg) INTO v_result
            FROM public.data_production_daily d
            WHERE d.production_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_production_cracker_dust_kg' THEN
            SELECT SUM(d.cracker_dust_kg) INTO v_result
            FROM public.data_production_daily d
            WHERE d.production_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_production_shell_fines_kg' THEN
            SELECT SUM(d.shell_fines_kg) INTO v_result
            FROM public.data_production_daily d
            WHERE d.production_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_production_compost_kg' THEN
            SELECT SUM(d.compost_kg) INTO v_result
            FROM public.data_production_daily d
            WHERE d.production_date BETWEEN p_period_start AND p_period_end;

        WHEN 'data_page_production_shell_kg' THEN
            SELECT SUM(d.shell_kg) INTO v_result
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
            -- Superseded kinds, and the six oil-production-by-stream metrics whose dataset does
            -- not exist. NULL means "the database has no figure", never a substitute for a real
            -- zero.
            v_result := NULL;
    END CASE;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.resolve_report_metric_value(text, date, date) IS
    'Computes a report metric for a period from the data-page tables only. Oil sales combine the '
    'local invoice book and the export register, excluding local rows linked to a register row so '
    'the same sale is never counted twice. Returns NULL — not 0 — when no row exists either side. '
    'Now also resolves the five byproduct_yield metrics from data_production_daily.';

-- ============================================================================
-- 6. Verification.
-- ============================================================================

DO $$
DECLARE
    v_count integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.report_sections WHERE section_key = 'byproduct_yield') THEN
        RAISE EXCEPTION 'Migration incomplete - byproduct_yield section missing';
    END IF;

    SELECT count(*) INTO v_count FROM public.report_metrics WHERE section_key = 'byproduct_yield';
    IF v_count <> 5 THEN
        RAISE EXCEPTION 'Migration incomplete - expected 5 byproduct_yield metrics, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.report_template_sections
    WHERE section_key = 'byproduct_yield';
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'Migration incomplete - expected byproduct_yield attached to 2 templates, found %', v_count;
    END IF;

    IF to_regprocedure('public.resolve_report_metric_value(text, date, date)') IS NULL THEN
        RAISE EXCEPTION 'Migration incomplete - resolve_report_metric_value missing';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
