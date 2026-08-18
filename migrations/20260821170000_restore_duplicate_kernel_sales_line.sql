-- Count the kernel sales line that appears twice in the workbook, by merging it into one line.
--
-- THE DEFECT
-- ----------
-- The Kernel Statistics workbook, "Sales (Kernel)" sheet, carries TWO byte-identical lines at rows
-- 75 and 76: both 2025-07-08, Wedgewood Nougat (Pty) Ltd - Agency Sales, invoice IN-000000432, item
-- ZRNMS1S, 9 cartons, 102.06 kg at R146.79, R14,981.3874 excl VAT. Only one is in the data page.
--
-- Pete's own July 2025 report counts both - his monthly figure is R932,156.03 where
-- data_kernel_sales_lines sums to R917,174.65, and the R14,981.38 difference is exactly this line.
-- Confirmed as a genuine second consignment rather than a spreadsheet slip (decision recorded
-- 2026-08-18), so the portal should count it too.
--
-- WHY A MERGE AND NOT A SECOND ROW
-- --------------------------------
-- Inserting a second identical row is IMPOSSIBLE by design, and that is not a bug to work around.
-- uq_data_kernel_sales_lines_natural (20260819100000:78) is unique on
-- (invoice_number, COALESCE(item_code,''), quantity_kg, sale_date), and its own comment states why:
-- "Natural key for idempotent backfill and re-import. Invoice numbers repeat across the lines of one
-- invoice, so item and quantity distinguish them." That index is what makes re-importing the
-- workbook safe. Dropping or widening it to admit this one row would trade a live integrity
-- guarantee - the thing that stops a re-import silently doubling every line - for a cosmetic match
-- to how a spreadsheet happened to be typed.
--
-- Two identical lines on one invoice, same item at the same unit price, ARE one line of twice the
-- quantity: 18 cartons, 204.12 kg, R29,962.78. Merging records the same commercial fact, produces
-- the same total, and leaves the natural key intact. price_per_kg is deliberately unchanged - it is
-- a unit price, not an extended amount.
--
-- EXPECTED EFFECT, AND AN HONEST ONE-CENT NOTE
-- --------------------------------------------
-- July 2025 goes from R917,174.65 to R932,156.04. Pete's sheet says R932,156.03. The one cent is
-- rounding, not a missing figure: vat_excl_zar is numeric(14,2), so this line stores R14,981.39 and
-- doubles to R29,962.78, while his sheet sums the unrounded R14,981.3874 twice (R29,962.7748). Every
-- line in the table rounds the same way. Stated rather than papered over, because the tracking
-- sections compare these totals year-on-year.
--
-- It also closes the constant R14,981.38 offset that ran through the kernel_sales_tracking
-- prior-year column from July 2025 onward - the first three months of FYE 2026 already matched Pete's
-- cumulative column to the cent, and now the rest do too, to within that one cent.
--
-- The doubled quantity also flows into kernel_sales_by_style (20260821150000), which is correct:
-- style 1S genuinely sold 204.12 kg on that invoice.
--
-- IDEMPOTENT: guarded on the row still holding its un-merged values, so a second run matches nothing.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260821170000_restore_duplicate_kernel_sales_line.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

UPDATE public.data_kernel_sales_lines s
   SET cartons      = 18,
       quantity_kg  = 204.12,
       vat_excl_zar = 29962.78,
       vat_zar      = 4494.42,
       vat_incl_zar = 34457.20,
       -- ::text is required: against an untyped literal, || resolves to anyarray||anyarray and
       -- fails as a malformed array literal. The cast picks array||element.
       data_quality_flags = s.data_quality_flags || 'duplicate_line_merged_from_workbook'::text,
       notes = 'Appears twice in the Kernel Statistics workbook (Sales (Kernel) rows 75-76) and is '
               || 'counted twice in Pete''s July 2025 report. The two identical lines are merged '
               || 'into this one - 9 cartons/102.06 kg becomes 18/204.12 - because '
               || 'uq_data_kernel_sales_lines_natural forbids a second row with the same invoice, '
               || 'item, quantity and date. Merged by 20260821170000.',
       updated_at = now()
 WHERE s.sale_date      = DATE '2025-07-08'
   AND s.invoice_number = 'IN-000000432'
   AND s.item_code      = 'ZRNMS1S'
   AND s.quantity_kg    = 102.06
   AND s.cartons        = 9
   AND s.vat_excl_zar   = 14981.39;

NOTIFY pgrst, 'reload schema';
