-- Replace the six fictional "Oil Processing" metrics with the real production split.
--
-- Context. oil_cosmetic_produced_kg, oil_ev_produced_kg, oil_bgrade_produced_kg,
-- oil_protein_produced_kg, oil_filter_fines_produced_kg and oil_cake_produced_kg
-- (migrations/20260817090000_report_builder_foundations.sql:484-501) all carry
-- source_kind = 'oil_produced_by_stream', which resolve_report_metric_value has never had a CASE
-- branch for — they have always resolved to NULL and rendered "No system data" on every weekly
-- and monthly report, confirmed live on dev 2026-09-14. The reason is not a missing resolver
-- branch: no table or form in this repo ever captured six separate produced-oil figures.
-- modal-oil-production (WebPortal/modules/modals/modal-oil-production/) calls
-- create_oil_production_sheet / update_oil_production_sheet, two functions that were dropped by
-- migrations/20260226000006_replace_oil_with_new_schema.sql:16-18 and never recreated — that
-- module has been dead, unreachable code the whole time.
--
-- What IS real: every finished oil_bin_batch is sent to stock via send_oil_bin_batch_to_stock
-- (migrations/20260341000006_oil_stock_ffa_from_supplier_intake_audit.sql:86-205), which inserts
-- one public.oil_stock_lots row per batch with kilograms (litres * 0.92) and a grade derived
-- 1:1 from oil_bin_batch.oil_stream ('food_grade' -> 'Food grade', 'cosmetic' -> 'Cosmetic',
-- line 118-122). A second, parallel flow — migrations/20260333000001_protein_bin_batch.sql:
-- 207-233 — sends finished protein_bin_batch rows to the same table with grade = 'Protein
-- powder'. Both omit counterparty_type entirely, which every other insert path into
-- oil_stock_lots (supplier receipts, the 2025 year-end stock-on-hand seed) sets — so
-- "counterparty_type IS NULL" cleanly isolates genuine production lots from purchased or
-- opening-balance stock.
--
-- This migration repoints two of the six existing metrics at that real data (cosmetic, protein),
-- adds a third for food grade (the one real stream that had no metric_key at all), and switches
-- off the three streams (EV, B-grade, filter fines, cake) that nothing in this repo has ever
-- captured. "Switches off" is is_active = false, not a delete: the metric_key stays valid for any
-- historical report_instance_metric_values row that already references it.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260914093000_oil_production_real_stream_split.sql
-- against dev (nmdmddugxclpqrwylyfa) and, after sign-off, npm run db:apply-prod for the same file
-- against prod (sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. Widen the resolver's source_kind vocabulary FIRST — the UPDATE/INSERT below need
-- 'oil_stock_lot_grade_kg' to already be legal. Full restatement required (a CHECK constraint
-- cannot be patched) — copied from
-- migrations/20260914091500_byproduct_yield_report_section.sql plus 'oil_stock_lot_grade_kg'.
-- ============================================================================

ALTER TABLE public.report_metrics DROP CONSTRAINT IF EXISTS report_metrics_source_kind_check;
ALTER TABLE public.report_metrics ADD CONSTRAINT report_metrics_source_kind_check
    CHECK (source_kind IN (
        -- Superseded. Retained as documentation.
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
        'data_page_production_shell_kg',
        -- Live: real produced-oil kg by grade, from oil_stock_lots.
        'oil_stock_lot_grade_kg'
    ));

-- ============================================================================
-- 2. Repoint the two streams that have real data.
-- ============================================================================

UPDATE public.report_metrics
   SET source_kind = 'oil_stock_lot_grade_kg',
       source_args = '{"grade": "Cosmetic"}'::jsonb
 WHERE metric_key = 'oil_cosmetic_produced_kg';

UPDATE public.report_metrics
   SET source_kind = 'oil_stock_lot_grade_kg',
       source_args = '{"grade": "Protein powder"}'::jsonb
 WHERE metric_key = 'oil_protein_produced_kg';

-- ============================================================================
-- 3. Add the one real stream with no existing metric_key: food grade.
-- ============================================================================

INSERT INTO public.report_metrics
    (metric_key, label, section_key, division, unit, aggregation, source_kind, source_args, period_types, display_order)
VALUES
    ('oil_food_grade_produced_kg', 'Food Grade Oil Produced', 'oil_production', 'oil', 'kg',
        'sum_over_period', 'oil_stock_lot_grade_kg', '{"grade": "Food grade"}'::jsonb,
        ARRAY['weekly', 'monthly'], 5)
ON CONFLICT (metric_key) DO UPDATE
    SET source_kind = EXCLUDED.source_kind,
        source_args = EXCLUDED.source_args;

-- ============================================================================
-- 4. Switch off the three streams with no capture anywhere in this repo.
-- ============================================================================

UPDATE public.report_metrics
   SET is_active = false
 WHERE metric_key IN (
       'oil_ev_produced_kg', 'oil_bgrade_produced_kg',
       'oil_filter_fines_produced_kg', 'oil_cake_produced_kg'
   );

-- ============================================================================
-- 5. Update the section description to describe what it now actually shows.
-- ============================================================================

UPDATE public.report_sections
   SET description = 'Food grade, cosmetic and protein oil produced, by stock grade'
 WHERE section_key = 'oil_production';

-- ============================================================================
-- 6. resolve_report_metric_value — replaced in full, identical to
-- migrations/20260914091500_byproduct_yield_report_section.sql apart from the one new branch.
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

        -- Real produced-oil kg by grade, from finished oil_bin_batch / protein_bin_batch runs
        -- sent to stock. counterparty_type IS NULL is what distinguishes a production lot from a
        -- supplier receipt or the 2025 opening-balance seed, neither of which sets it.
        WHEN 'oil_stock_lot_grade_kg' THEN
            SELECT SUM(l.kilograms) INTO v_result
            FROM public.oil_stock_lots l
            WHERE l.grade = (v_metric.source_args ->> 'grade')
              AND l.counterparty_type IS NULL
              AND l.manufacture_date BETWEEN p_period_start AND p_period_end;
            IF NOT EXISTS (SELECT 1 FROM public.oil_stock_lots l
                            WHERE l.grade = (v_metric.source_args ->> 'grade')
                              AND l.counterparty_type IS NULL
                              AND l.manufacture_date BETWEEN p_period_start AND p_period_end)
            THEN
                v_result := NULL;
            END IF;

        ELSE
            -- Superseded kinds, and the streams with no real capture (EV, B-grade, filter
            -- fines, cake) — switched off via is_active rather than removed. NULL means "the
            -- database has no figure", never a substitute for a real zero.
            v_result := NULL;
    END CASE;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.resolve_report_metric_value(text, date, date) IS
    'Computes a report metric for a period from the data-page tables only. Oil sales combine the '
    'local invoice book and the export register, excluding local rows linked to a register row so '
    'the same sale is never counted twice. Oil production is read by grade from oil_stock_lots '
    '(food grade, cosmetic, protein), production-only lots identified by counterparty_type IS '
    'NULL. Returns NULL — not 0 — when no row exists.';

-- ============================================================================
-- 7. Verification.
-- ============================================================================

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
    FROM public.report_metrics
    WHERE metric_key IN ('oil_cosmetic_produced_kg', 'oil_protein_produced_kg', 'oil_food_grade_produced_kg')
      AND source_kind = 'oil_stock_lot_grade_kg';
    IF v_count <> 3 THEN
        RAISE EXCEPTION 'Migration incomplete - expected 3 metrics repointed to oil_stock_lot_grade_kg, found %', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.report_metrics
    WHERE metric_key IN ('oil_ev_produced_kg', 'oil_bgrade_produced_kg', 'oil_filter_fines_produced_kg', 'oil_cake_produced_kg')
      AND is_active = false;
    IF v_count <> 4 THEN
        RAISE EXCEPTION 'Migration incomplete - expected 4 unbacked oil metrics deactivated, found %', v_count;
    END IF;

    IF to_regprocedure('public.resolve_report_metric_value(text, date, date)') IS NULL THEN
        RAISE EXCEPTION 'Migration incomplete - resolve_report_metric_value missing';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
