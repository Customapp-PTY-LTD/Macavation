-- ============================================================================
-- Reports: section order (Henry, 6 Nov 2026)
-- ============================================================================
-- Kernel first (NIS in, kernel out, kernel stock, kernel sales), then oil, with upcoming sales
-- last on the weekly. Applied to the two standard templates and to every DRAFT report built from
-- them; published and superseded reports are locked by report_instance_child_lock and keep the
-- order they were issued with.
-- Down: not reversible (the previous order is not recorded).
-- ============================================================================

WITH new_order (period_type, section_key, display_order) AS (
    VALUES
        ('weekly', 'nis_procurement_pipeline', 10), ('weekly', 'nis_soh', 20),
        ('weekly', 'kernel_production', 30), ('weekly', 'byproduct_yield', 40),
        ('weekly', 'kernel_soh', 50), ('weekly', 'kernel_sales', 60),
        ('weekly', 'kernel_sales_lines', 70), ('weekly', 'forward_month_grid', 90),
        ('weekly', 'rm_soh', 110), ('weekly', 'oil_production', 120),
        ('weekly', 'oil_soh', 130), ('weekly', 'oil_sales', 140),
        ('weekly', 'oil_sales_lines', 150), ('weekly', 'oil_export_lines', 160),
        ('weekly', 'upcoming_sales', 300),
        ('monthly', 'nis_procured', 10), ('monthly', 'nis_procurement_pipeline', 20),
        ('monthly', 'nis_procurement_tracking', 30), ('monthly', 'nis_soh', 40),
        ('monthly', 'kernel_production', 50), ('monthly', 'sound_kernel_recovery_tracking', 60),
        ('monthly', 'byproduct_yield', 70), ('monthly', 'kernel_soh', 80),
        ('monthly', 'kernel_stock_report', 90), ('monthly', 'kernel_sales', 100),
        ('monthly', 'kernel_sales_by_style', 110), ('monthly', 'kernel_sales_lines', 120),
        ('monthly', 'kernel_sales_tracking', 130), ('monthly', 'upcoming_sales', 140),
        ('monthly', 'rm_soh', 200), ('monthly', 'rm_stock_report', 210),
        ('monthly', 'oil_production', 220), ('monthly', 'oil_soh', 230),
        ('monthly', 'oil_stock_report', 240), ('monthly', 'oil_sales', 250),
        ('monthly', 'oil_sales_by_line', 260), ('monthly', 'oil_sales_lines', 270),
        ('monthly', 'oil_export_lines', 280)
)
UPDATE public.report_template_sections ts
   SET display_order = n.display_order
  FROM public.report_templates t, new_order n
 WHERE ts.template_id = t.id
   AND t.code = 'standard_' || n.period_type
   AND ts.section_key = n.section_key
   AND ts.display_order IS DISTINCT FROM n.display_order;

WITH new_order (period_type, section_key, display_order) AS (
    VALUES
        ('weekly', 'nis_procurement_pipeline', 10), ('weekly', 'nis_soh', 20),
        ('weekly', 'kernel_production', 30), ('weekly', 'byproduct_yield', 40),
        ('weekly', 'kernel_soh', 50), ('weekly', 'kernel_sales', 60),
        ('weekly', 'kernel_sales_lines', 70), ('weekly', 'forward_month_grid', 90),
        ('weekly', 'rm_soh', 110), ('weekly', 'oil_production', 120),
        ('weekly', 'oil_soh', 130), ('weekly', 'oil_sales', 140),
        ('weekly', 'oil_sales_lines', 150), ('weekly', 'oil_export_lines', 160),
        ('weekly', 'upcoming_sales', 300),
        ('monthly', 'nis_procured', 10), ('monthly', 'nis_procurement_pipeline', 20),
        ('monthly', 'nis_procurement_tracking', 30), ('monthly', 'nis_soh', 40),
        ('monthly', 'kernel_production', 50), ('monthly', 'sound_kernel_recovery_tracking', 60),
        ('monthly', 'byproduct_yield', 70), ('monthly', 'kernel_soh', 80),
        ('monthly', 'kernel_stock_report', 90), ('monthly', 'kernel_sales', 100),
        ('monthly', 'kernel_sales_by_style', 110), ('monthly', 'kernel_sales_lines', 120),
        ('monthly', 'kernel_sales_tracking', 130), ('monthly', 'upcoming_sales', 140),
        ('monthly', 'rm_soh', 200), ('monthly', 'rm_stock_report', 210),
        ('monthly', 'oil_production', 220), ('monthly', 'oil_soh', 230),
        ('monthly', 'oil_stock_report', 240), ('monthly', 'oil_sales', 250),
        ('monthly', 'oil_sales_by_line', 260), ('monthly', 'oil_sales_lines', 270),
        ('monthly', 'oil_export_lines', 280)
)
UPDATE public.report_instance_sections ris
   SET display_order = n.display_order
  FROM public.report_instances ri, public.report_templates t, new_order n
 WHERE ris.report_instance_id = ri.id
   AND ri.template_id = t.id
   AND ri.status = 'draft'
   AND t.code = 'standard_' || n.period_type
   AND ris.section_key = n.section_key
   AND ris.display_order IS DISTINCT FROM n.display_order;

NOTIFY pgrst, 'reload schema';
