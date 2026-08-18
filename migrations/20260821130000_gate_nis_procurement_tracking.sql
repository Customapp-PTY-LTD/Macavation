-- Default the Nut in Shell Procurement Tracking section OFF until its dataset is complete.
--
-- 20260821090000 made all three tracking sections render. Two of them are trustworthy; this one is
-- not yet, and switching it on by default would publish a figure that looks like a collapse in
-- procurement when it is really a half-loaded table.
--
-- MEASURED AGAINST PETE'S JULY 2026 SHEET (FYE 2026 column, the prior-year comparative)
-- ------------------------------------------------------------------------------------
--   Month       data_nis_intake      Pete's sheet     gap
--   Apr 2025          44,148.00         44,148.00     ok
--   May 2025         138,371.00        138,371.00     ok
--   Jun 2025          64,926.00         64,926.00     ok
--   Jul 2025          37,394.00         67,623.00     -30,229
--   Aug 2025          10,388.50         55,316.55     -44,928
--   Sep 2025                  -         56,667.50     missing entirely
--   Oct 2025          35,368.50        139,425.00     -104,057
--   Nov 2025                  -         90,954.00     missing entirely
--   Dec 2025                  -         59,715.50     missing entirely
--   Feb 2026          22,811.50         22,811.50     ok
--   Mar 2026          18,434.50        138,371.50     -119,937
--   FYE 2026 total   371,842.00        878,329.55     42% loaded
--
-- ROOT CAUSE
-- ----------
-- The Kernel Statistics workbook holds procurement on TWO sheets that are complementary, not
-- duplicates: "Procurement (2)" carries Jun 2025 - Feb 2026, and "Procurement" carries Dec 2025 -
-- Mar 2027. Pete's report reads the union of both. data_nis_intake was loaded from one of them, so
-- it is missing most of mid-2025 — precisely the prior-year comparative this section exists to show.
--
-- WHY GATE THE SECTION BUT KEEP THE METRIC
-- ---------------------------------------
-- The nis_procured_kg METRIC stays wired (20260821090000) and is correct for current periods: the
-- resolver returns 16,039.00 kg for July 2026, which is exactly what the "Procurement" sheet holds.
-- Only the multi-year comparative is unreliable, and only the tracking section shows that. Turning
-- the metric off too would discard a figure that is right.
--
-- TO REVERSE THIS, once data_nis_intake is backfilled from BOTH sheets: set default_enabled = true
-- for this section on both templates. No code change is needed — the resolver is already correct and
-- will simply have complete data to read.
--
-- Only DRAFT instances are touched. A published report is immutable by trigger
-- (report_instance_child_lock, 20260817100000) and must stay exactly as it was issued.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260821130000_gate_nis_procurement_tracking.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

UPDATE public.report_template_sections
   SET default_enabled = false
 WHERE section_key = 'nis_procurement_tracking';

UPDATE public.report_instance_sections ris
   SET is_enabled = false
 WHERE ris.section_key = 'nis_procurement_tracking'
   AND ris.is_enabled
   AND EXISTS (
       SELECT 1 FROM public.report_instances ri
       WHERE ri.id = ris.report_instance_id
         AND ri.status = 'draft'
   );

-- Any tracking rows already frozen into a draft for this section are now orphaned content behind a
-- switched-off section. Clear them so a re-enable re-resolves from live data instead of showing a
-- stale freeze.
DELETE FROM public.report_instance_lines l
 WHERE l.section_key = 'nis_procurement_tracking'
   AND EXISTS (
       SELECT 1 FROM public.report_instances ri
       WHERE ri.id = l.report_instance_id
         AND ri.status = 'draft'
   );

COMMENT ON FUNCTION public.report_tracking_monthly(text, integer) IS
    'April-March monthly and cumulative series for one tracking kind (nis_procurement, '
    'sound_kernel_recovery, kernel_sales) in one financial year. A month with no captured rows is '
    'NULL, not 0. Unknown kind yields NULLs rather than raising. NOTE: the nis_procurement kind '
    'reads data_nis_intake, which as at 20260821130000 holds only ~42% of FYE 2026 — see that '
    'migration. kernel_sales reconciles to Pete''s workbook within R14,981 and '
    'sound_kernel_recovery within 1.1%.';

NOTIFY pgrst, 'reload schema';
