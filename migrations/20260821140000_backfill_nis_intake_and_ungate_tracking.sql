-- Complete data_nis_intake from BOTH Procurement sheets, and re-enable the tracking section.
--
-- 20260821130000 switched Nut in Shell Procurement Tracking off because data_nis_intake held only
-- ~42% of FYE 2026. This is the backfill that migration named as the condition for reversing it.
--
-- ROOT CAUSE
-- ----------
-- The Kernel Statistics workbook carries procurement on two sheets that are COMPLEMENTARY, not
-- duplicates, and the original load took one of them:
--   "Procurement (2)"  Jun 2025 - Feb 2026
--   "Procurement"      Dec 2025 - Mar 2027
-- Pete's report reads the union. 28 deliveries totalling 393,357.05 kg were missing.
--
-- THE DEDUPLICATION TRAP
-- ----------------------
-- The two sheets overlap, and the obvious key is wrong. data_nis_intake's own unique index is
-- (batch_number, received_date, nis_kg) — which would have ACCEPTED a double count, because batch
-- BN 60.1.25.56 (Brechoost CC, 28,660.50 kg) appears on both sheets with DIFFERENT dates:
-- 2025-12-09 on "Procurement" and 2025-12-01 on "Procurement (2)". One delivery, two recorded dates.
--
-- So the union below keys on (batch_number, nis_kg) and drops the date from the key. All 104
-- batch+kg groups across both sheets were checked for date conflicts: exactly one exists, the row
-- above, and it does not cross a month boundary, so no period figure depends on which date wins.
-- "Procurement" wins, being the current ledger. Without this, December would have loaded as
-- 88,376.00 against Pete's 59,715.50.
--
-- Rows with no batch number are excluded: those are the sheets' own summary cells (one carries
-- 1,201,217.19 kg), not deliveries. The three genuinely undated rows that DO carry a batch number
-- are already loaded and are untouched here.
--
-- RECONCILIATION AFTER THIS MIGRATION (FYE 2026, against Pete's July report)
-- -------------------------------------------------------------------------
--   Apr 44,148.00   May 138,371.00   Jun 64,926.00   Jul 67,623.00   Aug 55,316.55
--   Sep 56,667.50   Oct 139,425.00   Nov 90,954.00   Dec 59,715.50   Jan 0   Feb 22,811.50
-- Eleven of twelve months then match his sheet EXACTLY (they were 42% complete before).
--
-- March is the exception and is left alone deliberately: Pete's sheet claims 138,371.50 for March
-- 2026 where both source sheets hold four deliveries totalling 18,434.50. His March figure is within
-- R0.50 of his own May figure (138,371.00), which points at a copy or formula error in his
-- accumulative column rather than 119,937 kg of nut that no delivery row anywhere records.
-- Inventing rows to close that gap is the one thing this migration will not do. FYE 2026 therefore
-- lands at 758,392.55 against his 878,329.55 — 86%, up from 42%, with the whole residual in one
-- unsourced cell.
--
-- PERCENTAGE SCALING, AND ONE INCONSISTENCY IN THE SOURCE
-- -------------------------------------------------------
-- The loader's existing convention was read off batch BN 44.1.24.62: moisture, FFA, SKR and USKR
-- are stored x100 (sheet 0.02 -> 2.0000); PV is stored as-is. Confirmed against the sheets' own
-- ranges - FFA 0.0002..0.0064, SKR 0.0465..0.3603, USKR 0.0214..0.2988 are all plainly fractions,
-- while PV 0.1..5.5 straddles 1.0 and is plainly not.
--
-- Moisture is the exception: 163 rows record it as a fraction (0.0095..0.067) but TWO record it as
-- an already-multiplied percentage (2.55). Blanket x100 put 255% moisture into a column that
-- CHECKs 0..100, which is how this was caught. Moisture is therefore scaled only when the raw value
-- is below 1. The gap between 0.067 and 2.55 is wide enough that the rule cannot misfire, and
-- macadamia NIS moisture never legitimately approaches either 0.067% or 255%.
--
-- IDEMPOTENT: a row inserts only if no row already holds that (batch_number, nis_kg) — the same key
-- the union uses, so a re-run cannot introduce the date-variant duplicate either.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260821140000_backfill_nis_intake_and_ungate_tracking.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. The 28 missing deliveries.
-- ============================================================================

WITH incoming (received_date, supplier_name, supplier_number, job_number, batch_number,
               nis_kg, moisture_pct, pv, ffa_pct, sample_skr_pct, sample_uskr_pct, status_note) AS (
    VALUES
(DATE '2025-07-17', 'Agristar Macadamias (Pty) Ltd NutsAll', 44, '28', 'BN 44.2.25.28', 30229.0, 1.9, 2.57, 0.52, 16.25, 15.91, 'Completed'),
    (DATE '2025-08-01', 'Ropa Miller', 51, '31', 'BN 51.1.25.31', 1796.5, 3.0, 0.1, 0.14, 17.43, 7.49, 'Completed'),
    (DATE '2025-08-05', 'Eucalypt Forestry Services CC', 7, '32', 'BN 7.7.25.32', 3695.0, 3.85, 0.1, 0.14, 22.83, 9.28, 'Completed'),
    (DATE '2025-08-27', 'Foster Farming Pty Ltd', 54, '37', 'BN 54.6.25.37', 4895.0, 3.7, 0.1, 0.02, 16.54, 12.57, 'Completed'),
    (DATE '2025-08-27', 'Big 5 Mac', 55, '38', 'BN 55.1.25.38', 26154.5, 1.75, 2.18, 0.23, 22.95, 18.98, 'Completed'),
    (DATE '2025-08-29', 'Mac-Eden Estate', 56, '39', 'BN 56.1.25.39', 8387.05, 4.2, 0.1, 0.15, 23.43, 5.35, 'Completed'),
    (DATE '2025-09-04', 'Agristar Macadamias (Pty) Ltd NutsAll', 44, '40', 'BN 44.2.25.40', 30740.0, 1.95, 0.11, 0.18, 21.48, 7.94, 'Completed'),
    (DATE '2025-09-22', 'The Two Rivers Trust', 57, '42', 'BN 57.1.25.42', 1395.5, 3.65, 0.1, 0.18, 27.45, 3.09, 'Completed'),
    (DATE '2025-09-23', 'Big 5 Mac', 55, '43', 'BN 55.1.25.43.1', 10551.0, 2.2, 0.44, 0.21, 15.63, 13.64, 'Completed'),
    (DATE '2025-09-23', 'Big 5 Mac', 55, '43', 'BN 55.1.25.43.2', 13981.0, 2.2, 1.77, 0.24, 16.58, 13.99, 'Completed'),
    (DATE '2025-10-08', 'Mac-Eden Estate', 56, '45', 'BN 56.1.25.45', 8643.5, 4.15, 0.2, 0.28, 28.21, 9.22, 'Completed'),
    (DATE '2025-10-09', 'Fyvie Estates Trading', 23, '46', 'BN 23.6.25.46', 14938.5, 4.7, 0.1, 0.13, 24.81, 4.68, 'Completed'),
    (DATE '2025-10-14', 'Big 5 Mac', 55, '47', 'BN 55.1.25.47.1', 8403.5, 2.75, 2.04, 0.38, 22.41, 13.55, 'Completed'),
    (DATE '2025-10-14', 'Big 5 Mac', 55, '47', 'BN 55.1.25.47.2', 4596.0, 2.75, 0.1, 0.22, 19.88, 20.35, 'Completed'),
    (DATE '2025-10-14', 'Big 5 Mac', 55, '47', 'BN 55.1.25.47.3', 6041.0, 1.75, 0.73, 0.36, 16.1, 11.24, 'Completed'),
    (DATE '2025-10-23', 'AP Vos & Seuns (Pty) Ltd', 32, '48', 'BN 32.4.25.48', 28055.0, 4.2, 0.65, 0.35, 15.06, 15.34, 'Completed'),
    (DATE '2025-10-24', 'AP Vos & Seuns (Pty) Ltd', 32, '44', 'BN 32.4.25.44', 33379.0, 2.55, 0.25, 0.15, 18.8, 16.39, 'Completed'),
    (DATE '2025-11-07', 'Big 5 Mac', 55, '50', 'BN 55.1.25.50.1', 6001.0, 2.45, 4.67, 0.44, 19.02, 7.86, 'Completed'),
    (DATE '2025-11-07', 'Big 5 Mac', 55, '50', 'BN 55.1.25.50.2', 7115.0, 2.45, 0.3, 0.19, 17.66, 5.1, 'Completed'),
    (DATE '2025-11-07', 'Big 5 Mac', 55, '50', 'BN 55.1.25.50.2', 6537.5, 1.75, 0.3, 0.19, 19.13, 5.75, 'Completed'),
    (DATE '2025-11-07', 'Big 5 Mac', 55, '50', 'BN 55.1.25.50.3', 5990.5, 2.35, 0.76, 0.16, 20.89, 5.35, 'Completed'),
    (DATE '2025-11-11', 'Big 5 Mac', 55, '51', 'BN 55.1.25.51.1', 23310.0, 3.25, 2.95, 0.26, 25.72, 14.66, 'Completed'),
    (DATE '2025-11-12', 'AP Vos & Seuns (Pty) Ltd', 32, '52', 'BN 32.4.25.52', 35000.0, 3.35, 0.1, 0.2, NULL, NULL, NULL),
    (DATE '2025-11-28', 'Talbot', 59, '54', 'BN 59.1.25.54', 7000.0, 4.6, 1.07, 0.58, NULL, NULL, 'Completed'),
    (DATE '2025-12-09', 'AP Vos & Seuns (Pty) Ltd', 32, '55', 'BN 32.4.25.55', 31055.0, 2.7, 0.68, 0.62, NULL, NULL, 'Completed'),
    (DATE '2025-12-09', 'Brechoost CC', 60, '60', 'BN 60.1.25.56', 28660.5, 2.8, 0.32, 0.64, 11.38, 15.44, 'Completed'),
    (DATE '2026-04-18', 'Hohls Farming', 62, '12', 'BN 62.26.12', 5072.5, 3.55, 1.52, 0.56, NULL, NULL, 'Invoice Requested'),
    (DATE '2026-05-22', 'AH Bennett SP', 16, '23', 'BN 16.26.23', 1734.0, 3.95, 0.24, 0.19, NULL, NULL, NULL)
),
-- Reuse the supplier_id already recorded against that supplier name on existing rows, so the
-- backfill is linked the same way the original load was. A name with no existing link, or an
-- ambiguous one, stays NULL rather than guessing at the contacts table.
supplier_link AS (
    SELECT supplier_name, MIN(supplier_id::text)::uuid AS supplier_id
    FROM public.data_nis_intake
    WHERE supplier_id IS NOT NULL
    GROUP BY supplier_name
    HAVING COUNT(DISTINCT supplier_id) = 1
)
INSERT INTO public.data_nis_intake
    (received_date, supplier_id, supplier_name, supplier_number, job_number, batch_number,
     nis_kg, moisture_pct, pv, ffa_pct, sample_skr_pct, sample_uskr_pct, status_note,
     data_source, data_quality_flags, notes)
SELECT i.received_date, sl.supplier_id, i.supplier_name, i.supplier_number, i.job_number,
       i.batch_number, i.nis_kg, i.moisture_pct, i.pv, i.ffa_pct, i.sample_skr_pct,
       i.sample_uskr_pct, i.status_note,
       'backfill',
       CASE WHEN i.received_date IS NULL
            THEN ARRAY['missing_date']::text[] ELSE ARRAY[]::text[] END,
       'Backfilled from Kernel Statistics workbook, Procurement + Procurement (2)'
FROM incoming i
LEFT JOIN supplier_link sl ON sl.supplier_name = i.supplier_name
WHERE NOT EXISTS (
    SELECT 1 FROM public.data_nis_intake e
    WHERE e.batch_number = i.batch_number
      AND e.nis_kg       = i.nis_kg
);

-- ============================================================================
-- 2. Reverse the gate from 20260821130000.
--
-- The prior-year comparative is now sound for eleven of twelve months, which is what the section
-- exists to show. Only DRAFT instances are re-enabled; a published report stays exactly as issued.
-- ============================================================================

UPDATE public.report_template_sections
   SET default_enabled = true
 WHERE section_key = 'nis_procurement_tracking';

UPDATE public.report_instance_sections ris
   SET is_enabled = true
 WHERE ris.section_key = 'nis_procurement_tracking'
   AND NOT ris.is_enabled
   AND EXISTS (
       SELECT 1 FROM public.report_instances ri
       WHERE ri.id = ris.report_instance_id
         AND ri.status = 'draft'
   );

COMMENT ON FUNCTION public.report_tracking_monthly(text, integer) IS
    'April-March monthly and cumulative series for one tracking kind (nis_procurement, '
    'sound_kernel_recovery, kernel_sales) in one financial year. A month with no captured rows is '
    'NULL, not 0. Unknown kind yields NULLs rather than raising. All three kinds reconcile to '
    'Pete''s workbook as at 20260821140000: kernel_sales within R14,981, sound_kernel_recovery '
    'within 1.1%, nis_procurement exactly for eleven of twelve FYE 2026 months (March excepted — '
    'his sheet claims 138,371.50 against 18,434.50 of actual delivery rows).';

NOTIFY pgrst, 'reload schema';
