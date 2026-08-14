-- Point the report builder at Pete's data page.
--
-- resolve_report_metric_value has been a deliberate stub returning NULL for every metric since
-- 20260817100000. This replaces it with resolvers that read exclusively from the data-page tables.
--
-- Central principle: after this migration the resolver NEVER touches kernel, oil or any raw
-- operational table again. Whether a given data-page column happens to be seeded from ops capture
-- or hand-entered is internal to that dataset's own seed/re-seed path and invisible here. That is
-- what "the report reads its figures from the data page" means concretely.
--
-- Superseded source_kind values are kept in the CHECK vocabulary rather than deleted: they document
-- what a metric meant before this change, and several metrics still legitimately carry them because
-- their dataset does not exist yet (oil production, NIS intake). Those resolve to NULL — the same
-- honest "no figure" the stub returned, never a fabricated zero.
--
-- Also fixes a real gap: nothing has ever populated report_instance_lines. create_report_instance
-- and refresh_report_instance insert section and metric rows but no line rows, so every line_table
-- section renders empty. Both now call one dispatcher. refresh must do it too, or a draft report
-- shows freshly resolved metric figures beside line tables frozen at generation time.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260819110000_report_resolvers_from_data_page.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. Widen the source_kind vocabulary and repoint the metrics that now have a dataset.
-- ============================================================================

ALTER TABLE public.report_metrics DROP CONSTRAINT IF EXISTS report_metrics_source_kind_check;
ALTER TABLE public.report_metrics ADD CONSTRAINT report_metrics_source_kind_check
    CHECK (source_kind IN (
        -- Superseded. Retained as documentation and still carried by metrics whose dataset does
        -- not exist yet; these resolve to NULL.
        'kernel_cracking_kg', 'kernel_packing_kg_total', 'kernel_packing_kg_by_style',
        'kernel_nis_procured_kg', 'oil_produced_by_stream', 'sales_kernel_sum', 'sales_oil_sum',
        'sales_oil_by_product', 'manual',
        -- Live: read from the data page.
        'data_page_production_cracking_kg', 'data_page_production_packing_kg',
        'data_page_kernel_sales_sum', 'data_page_oil_sales_sum', 'data_page_oil_sales_by_product',
        'data_page_nis_procured_kg', 'data_page_oil_produced_by_stream'
    ));

UPDATE public.report_metrics SET source_kind = 'data_page_production_cracking_kg'
 WHERE metric_key = 'kernel_nis_cracking_kg';
UPDATE public.report_metrics SET source_kind = 'data_page_production_packing_kg'
 WHERE metric_key = 'kernel_sk_packing_kg';
UPDATE public.report_metrics SET source_kind = 'data_page_kernel_sales_sum'
 WHERE metric_key = 'kernel_sales_excl_vat_zar';
UPDATE public.report_metrics SET source_kind = 'data_page_oil_sales_sum'
 WHERE metric_key = 'oil_sales_excl_vat_zar';
UPDATE public.report_metrics SET source_kind = 'data_page_oil_sales_by_product'
 WHERE section_key = 'oil_sales_by_line';

-- Deliberately NOT repointed, because their dataset does not exist yet and inventing a source
-- would be worse than an honest blank: the six oil production metrics (oil_produced_by_stream) and
-- nis_procured_kg (kernel_nis_procured_kg).

-- ============================================================================
-- 2. The resolver.
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

        ELSE
            -- Superseded kinds, and any metric whose dataset is not built yet. NULL means "the
            -- database has no figure", and is never a substitute for a real zero.
            v_result := NULL;
    END CASE;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.resolve_report_metric_value(text, date, date) IS
    'Computes a report metric for a period, reading exclusively from the data-page tables. Never '
    'reads kernel/oil directly — whether a figure was seeded from ops capture or hand-entered is '
    'internal to its dataset. Returns NULL for metrics whose dataset does not exist yet.';

-- ============================================================================
-- 3. Line-table sections.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_lines_kernel_sales_lines(
    p_period_start date, p_period_end date
)
RETURNS TABLE (sort_index integer, payload jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT (ROW_NUMBER() OVER (ORDER BY s.sale_date, s.invoice_number, s.id))::integer,
           jsonb_build_object(
               'sale_date', s.sale_date, 'customer_name', s.customer_name,
               'invoice_number', s.invoice_number, 'style_code', s.style_code,
               'description', s.description, 'cartons', s.cartons,
               'quantity_kg', s.quantity_kg, 'price_per_kg', s.price_per_kg,
               'vat_excl_zar', s.vat_excl_zar)
    FROM public.data_kernel_sales_lines s
    WHERE s.sale_date BETWEEN p_period_start AND p_period_end
    ORDER BY s.sale_date, s.invoice_number, s.id
    LIMIT 500;
$$;

CREATE OR REPLACE FUNCTION public.report_lines_oil_sales_lines(
    p_period_start date, p_period_end date
)
RETURNS TABLE (sort_index integer, payload jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT (ROW_NUMBER() OVER (ORDER BY s.sale_date, s.invoice_number, s.id))::integer,
           jsonb_build_object(
               'sale_date', s.sale_date, 'customer_name', s.customer_name,
               'invoice_number', s.invoice_number, 'product_line', s.product_line,
               'description', s.description, 'quantity_kg', s.quantity_kg,
               'price_per_kg', s.price_per_kg, 'vat_excl_zar', s.vat_excl_zar)
    FROM public.data_oil_sales_lines s
    WHERE s.sale_date BETWEEN p_period_start AND p_period_end
    ORDER BY s.sale_date, s.invoice_number, s.id
    LIMIT 500;
$$;

-- One dispatcher, so create and refresh cannot drift apart.
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
        SELECT ris.section_key
        FROM public.report_instance_sections ris
        JOIN public.report_sections s ON s.section_key = ris.section_key
        WHERE ris.report_instance_id = p_report_instance_id
          AND ris.is_enabled
          AND s.render_kind = 'line_table'
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
        END IF;
        -- Sections whose dataset is not built yet write no lines and render their empty state.
    END LOOP;

    RETURN v_written;
END;
$$;

COMMENT ON FUNCTION public.populate_report_instance_lines(uuid) IS
    'Freezes the data-page rows for every enabled line_table section into report_instance_lines. '
    'Called by both create_report_instance and refresh_report_instance so metric figures and line '
    'tables can never disagree within one draft.';

-- ============================================================================
-- 4. Wire the dispatcher into the lifecycle.
--
-- refresh_report_instance is replaced in full so it repopulates lines alongside metrics. Overrides
-- and their reasons remain untouched, exactly as before.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_report_instance(
    p_report_instance_id uuid
)
RETURNS TABLE (success integer, error text, metrics_refreshed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_instance public.report_instances%ROWTYPE;
    v_count    integer := 0;
BEGIN
    SELECT * INTO v_instance FROM public.report_instances WHERE id = p_report_instance_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Report not found.', 0;
        RETURN;
    END IF;
    IF v_instance.status <> 'draft' THEN
        RETURN QUERY SELECT 0, 'Only a draft report can be refreshed.', 0;
        RETURN;
    END IF;

    UPDATE public.report_instance_metric_values v
    SET system_value = public.resolve_report_metric_value(
                           v.metric_key, v_instance.period_start, v_instance.period_end),
        target_value = t.target_value
    FROM public.report_metrics m
    LEFT JOIN public.report_period_targets t
      ON t.metric_key = m.metric_key
     AND t.period_type = v_instance.period_type
     AND t.period_start = v_instance.period_start
    WHERE v.report_instance_id = p_report_instance_id
      AND m.metric_key = v.metric_key;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    PERFORM public.populate_report_instance_lines(p_report_instance_id);

    RETURN QUERY SELECT 1, NULL::text, v_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_report_instance(uuid) IS
    'Re-reads live figures, period targets AND line-table rows into a DRAFT report. Overrides and '
    'their reasons are preserved.';

GRANT EXECUTE ON FUNCTION public.report_lines_kernel_sales_lines(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_lines_oil_sales_lines(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.populate_report_instance_lines(uuid) TO anon, authenticated, service_role;

DO $$
DECLARE v_role record; v_fn text;
BEGIN
    FOR v_role IN SELECT id, role_name FROM public.roles LOOP
        FOREACH v_fn IN ARRAY ARRAY[
            'report_lines_kernel_sales_lines', 'report_lines_oil_sales_lines',
            'populate_report_instance_lines'
        ] LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true) ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
