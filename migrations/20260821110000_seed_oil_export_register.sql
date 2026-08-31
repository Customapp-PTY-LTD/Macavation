-- Seed the oil export register from "Oil Sales (1).xlsx", and link its local twins.
--
-- data_oil_export_register has been EMPTY since it was created (20260819100000). The workbook holds
-- 46 export invoice rows worth R52,527,303.40, which is the bulk of Macavation's oil revenue and the
-- reason the July 2026 report resolved 82% short. 45 rows load: one pair shares an invoice number
-- and is the same invoice revalued — see section 1 below.
--
-- WHICH SHEETS, AND WHY NOT ALL OF THEM
-- -------------------------------------
-- The workbook has six sheets and they overlap:
--   Sheet    - a pivot of the others, not source rows.
--   YE25     - the 2023-04..2025-03 ledger, 21 rows.
--   YE26     - byte-identical to YE25. Loading both would duplicate every row.
--   YE2025   - the FYE-2025 slice of YE25 (13 of the same rows). Also a duplicate.
--   YE2026   - 2025-05..2026-02, 13 rows.
--   YE2027   - 2026-04..2026-08, 12 rows.
-- Canonical, non-overlapping set = YE25 + YE2026 + YE2027 = 21 + 13 + 12 = 46 rows. The per-sheet
-- totals below each match that sheet's own TOTAL cell, which is how the selection was verified:
--   YE25   R22,287,875.58   YE2026  R15,308,646.51   YE2027  R14,930,781.31   sum R52,527,303.40
--
-- Two YE2026 rows have no date (Vantage R2,079,000 and Heess R1,485,000) yet are inside that
-- sheet's own total. They load with export_date NULL and data_quality_flags = {missing_date}, per
-- 20260821100000 - visible for a human to complete, and excluded from every period until dated.
--
-- product_class is only recorded on the YE2027 sheet; the 34 older rows resolve NULL and therefore
-- count toward the oil sales TOTAL but toward no per-product line. The workbook does not say which
-- product they were and guessing would put revenue on the wrong line.
--
-- NET LOADED: 45 rows, R50,297,015.42 (= R52,527,303.40 less the R2,230,287.98 revaluation dropped
-- in section 1). The FYE2027 figures this feature was built to fix are untouched by that drop: July
-- 2026 crude still resolves to R4,176,339.39, matching Pete's sheet exactly.
--
-- IDEMPOTENT: a row inserts only if its document_number is not already present (or, for the two rows
-- that have no document number, only if no row already matches on customer + date + USD). Re-running
-- adds nothing.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260821110000_seed_oil_export_register.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. The 46 invoices.
-- ============================================================================

WITH incoming (export_date, customer_name, location_country, document_number, reference,
               product_class, price_per_kg_usd, incoterm, weight_kg, usd_debit, load_count,
               usd_zar_rate, rand_value, data_quality_flags) AS (
    VALUES
    ('2023-04-12'::date, 'Vantage', 'Spain', 'IN-000227184', '52200056', NULL, NULL, NULL, NULL, 98496.0, 2.0, 18.4369, 1444272.9984, ARRAY[]::text[]),
    ('2023-07-01'::date, 'Vantage', 'Spain', 'IN-000236390', '52200056', NULL, NULL, NULL, NULL, 145920.0, 3.0, 18.8512, 2750767.104, ARRAY[]::text[]),
    ('2023-09-26'::date, 'Lamotte', 'Germany', 'IN-000247026', '#8011065', NULL, NULL, NULL, NULL, 48720.0, 1.0, 19.0677, 928978.344, ARRAY[]::text[]),
    ('2023-12-29'::date, 'Lamotte', 'Germany', 'IN-000253784', 'PO 8011533', NULL, NULL, NULL, NULL, 50580.0, 1.0, 18.3051, 925871.958, ARRAY[]::text[]),
    ('2024-01-18'::date, 'IMCD', 'Netherlands', 'IN-000257352', 'PO 117237 OP', NULL, NULL, NULL, NULL, 48288.0, 1.0, 18.9423, 914685.7824, ARRAY[]::text[]),
    ('2024-02-20'::date, 'Vantage', 'Spain', 'IN-000259789', '240700065', NULL, NULL, NULL, NULL, 2096.16, NULL, 18.9136, 39645.9318, ARRAY[]::text[]),
    ('2024-03-08'::date, 'Vantage', 'Spain', 'IN-000260929', '240700178', NULL, NULL, NULL, NULL, 3162.72, NULL, 18.7262, 39253.1114, ARRAY[]::text[]),
    ('2024-03-11'::date, 'Vantage', 'Spain', 'IN-000260674', '52200056', NULL, NULL, NULL, NULL, 130420.8, 3.0, 18.6856, 39168.0073, ARRAY[]::text[]),
    ('2024-04-01'::date, 'Vantage', 'Spain', 'IN-000263059', '240700178', NULL, NULL, NULL, NULL, 3162.72, NULL, 18.9399, 99602.6613, ARRAY[]::text[]),
    ('2024-04-01'::date, 'Vantage', 'Spain', 'IN-000263061', '52200056', NULL, NULL, NULL, NULL, 130420.8, 3.0, 18.9399, 2569759.5712, ARRAY[]::text[]),
    ('2024-04-08'::date, 'Lamotte', 'Germany', 'IN-000263548', '8011919', NULL, NULL, NULL, NULL, 45450.0, 1.0, 18.6421, 755415.1762, ARRAY[]::text[]),
    ('2024-04-15'::date, 'Lamotte', 'Germany', 'IN-000263549', '8011919', NULL, NULL, NULL, NULL, 45990.0, 1.0, 19.0224, 1645665.8688, ARRAY[]::text[]),
    ('2024-07-25'::date, 'Lamotte', 'Germany', 'IN-000271080', 'Call off Order 8012117', NULL, NULL, NULL, NULL, 44786.25, 1.0, 18.3854, 810830.5207, ARRAY[]::text[]),
    ('2024-09-23'::date, 'Gustav', 'Germany', 'IN-000272756', 'Purchase Contract 30034952', NULL, NULL, NULL, NULL, 39331.5, 1.0, 17.3688, 683140.9572, ARRAY[]::text[]),
    ('2024-10-16'::date, 'Vantage', 'Spain', 'IN-000277392', '52200056', NULL, NULL, NULL, NULL, 130334.4, 3.0, 17.6242, 2297039.5325, ARRAY[]::text[]),
    ('2024-12-04'::date, 'Lamotte', 'Germany', 'IN-000281471', 'PO# 8012927', NULL, NULL, NULL, NULL, 45309.38, 1.0, 18.173, 823407.3627, ARRAY[]::text[]),
    ('2025-01-15'::date, 'Gustav', 'Germany', 'IN-000281978', '#30034952', NULL, NULL, NULL, NULL, 39278.85, 1.0, 18.7652, 737075.476, ARRAY[]::text[]),
    ('2025-01-28'::date, 'IMCD', 'Netherlands', 'IN-000284672', '124751 OP', NULL, NULL, NULL, NULL, 48600.0, 1.0, 18.6785, 907775.1, ARRAY[]::text[]),
    ('2025-02-19'::date, 'Gustav', 'Germany', 'IN-000285146', 'Call Off 4029948', NULL, NULL, NULL, NULL, 39001.95, 1.0, 18.5272, 722596.928, ARRAY[]::text[]),
    ('2025-03-12'::date, 'Vantage', 'Spain', 'IN-000285938', '52200056 - 3 X FLEXI', NULL, NULL, NULL, NULL, 126067.2, 3.0, 18.5128, 2333856.8602, ARRAY[]::text[]),
    ('2025-03-14'::date, 'Lamotte', 'Germany', 'IN-000287024', 'QEB25-002097', NULL, NULL, NULL, NULL, 44734.5, 1.0, 18.3095, 819066.3277, ARRAY[]::text[]),
    ('2025-05-14'::date, 'Lamotte', 'Germany', 'IN-000290759', 'QEB25-003416', NULL, NULL, NULL, NULL, 44734.5, 1.0, 18.8278, 842250.41, ARRAY[]::text[]),
    ('2025-05-28'::date, 'IMCD', 'Netherlands', 'IN-000291690', '#127442 OP', NULL, NULL, NULL, NULL, 52315.9, 1.0, 18.4, 962612.56, ARRAY[]::text[]),
    ('2025-07-11'::date, 'Gustav', 'Germany', 'IN-000295393', 'PO4030908', NULL, NULL, NULL, NULL, 38681.18, 1.0, 17.8062, 688764.83, ARRAY[]::text[]),
    ('2025-08-12'::date, 'Lamotte', 'Germany', 'IN-000296705', 'QEB25-005239', NULL, NULL, NULL, NULL, 53983.84, 1.0, 17.8062, 961247.05, ARRAY[]::text[]),
    ('2025-08-22'::date, 'Vantage', 'Spain', 'IN-000285938', '52200056-3 FLEXI', NULL, NULL, NULL, NULL, 126067.2, 3.0, 17.6913, 2230287.98, ARRAY[]::text[]),
    ('2025-12-12'::date, 'Lamotte', 'Germany', 'IN-000310283', 'QEB25-008311', NULL, NULL, NULL, NULL, 45271.12, 1.0, 17.0162, 770342.43, ARRAY[]::text[]),
    ('2025-12-18'::date, 'Vantage', 'Spain', 'IN-000311200', '250700861', NULL, NULL, NULL, NULL, 2737.0, 4.0, 18.159, 49701.26, ARRAY['bad_load_count']),
    ('2026-01-22'::date, 'Essen', 'Mexico', 'IN-000313231', 'ESSEN MX-MAC26001', NULL, NULL, NULL, NULL, 113362.55, 3.0, 17.0162, 1928999.82, ARRAY[]::text[]),
    ('2026-02-11'::date, 'Lamotte', 'Germany', 'IN-000315540', 'QEK25-00892', NULL, NULL, NULL, NULL, 45000.0, 1.0, 16.0, 720000.0, ARRAY[]::text[]),
    ('2026-02-06'::date, 'Hees', 'Germany', 'IN-000314367', 'PO4032035, 4032036', NULL, NULL, NULL, NULL, 79637.0, 2.0, 16.0, 1950440.17, ARRAY[]::text[]),
    ('2026-02-11'::date, 'Hees', 'Germany', 'IN-000315531', '4032037', NULL, NULL, NULL, NULL, 40000.0, 1.0, 16.0, 640000.0, ARRAY[]::text[]),
    (NULL, 'Vantage', 'Spain', NULL, NULL, NULL, NULL, NULL, NULL, 126000.0, 3.0, 16.5, 2079000.0, ARRAY['missing_date']),
    (NULL, 'Heess', 'Germany', NULL, NULL, NULL, NULL, NULL, NULL, 90000.0, 2.0, 16.5, 1485000.0, ARRAY['missing_date']),
    ('2026-04-16'::date, 'IMCD', 'Netherlands', 'IN-000321358', 'PO136216', 'evmo', 3.0, 'CFR', 22216.0, 66648.0, 1.0, 16.5, 1099692.0, ARRAY[]::text[]),
    ('2026-04-22'::date, 'Sigma Oil', 'Netherlands', 'IN-000000710', 'PO2026 -165', 'crude', 2.1, 'FOB', 87628.0, 184018.8, 4.0, 16.39, 3016068.132, ARRAY[]::text[]),
    ('2026-05-19'::date, 'IMCD', 'Netherlands', 'IN-000325950', 'PO137393', 'evmo', 3.0, 'CFR', 21877.0, 65631.0, 1.0, 16.5, 1082911.5, ARRAY[]::text[]),
    ('2026-05-27'::date, 'Gustav Heess', 'Germany', 'IN-000325464', 'PO4032721', 'crude', 2.35, 'CFR', 21136.0, 49669.6, 1.0, 16.5, 819548.4, ARRAY[]::text[]),
    ('2026-06-09'::date, 'Sigma Oil', 'Netherlands', 'IN-000000764', 'QU-000000001', 'crude', 2.2, 'FOB', 43965.0, 96723.0, 2.0, 16.5, 1595929.5, ARRAY[]::text[]),
    ('2026-06-22'::date, 'Gustav Heess', 'Germany', 'IN-000328242', '#4032876', 'crude', 2.35, 'CFR', 21982.0, 51657.7, 1.0, 16.5, 852352.05, ARRAY[]::text[]),
    ('2026-06-22'::date, 'Henry-Lamotte', 'Germany', 'IN-000327588', 'QEB26-003675', 'crude', 2.4, 'CFR', 21919.5, 52606.8, 1.0, 16.5, 868012.2, ARRAY[]::text[]),
    ('2026-07-10'::date, 'Henry Lamotte', 'Germany', 'IN-000331516', 'QEB26-003958', 'crude', 2.4, 'CFR', 22061.0, 52946.4, 1.0, 16.3, 863026.32, ARRAY[]::text[]),
    ('2026-07-23'::date, 'Henry-Lamotte', 'Germany', 'IN-000332732', 'QEK26-000601', 'crude', 2.4, 'CFR', 21859.0, 52461.6, 1.0, 16.48, 864567.168, ARRAY[]::text[]),
    ('2026-07-23'::date, 'Gustav Heess', 'Germany', 'IN-000332660', '#4033044', 'evmo', 4.2, 'CIF', 9120.0, 38304.0, 1.0, 16.48, 631249.92, ARRAY[]::text[]),
    ('2026-07-27'::date, 'GICS', 'Mexico', 'IN-000000817', 'ALM-MAC26001', 'crude', 2.05, 'EXW', 71059.5, 145671.975, 3.0, 16.81, 2448745.8997, ARRAY[]::text[]),
    ('2026-08-05'::date, 'Sigma Oil', 'Netherlands', 'IN-000000823', 'PO2026-220', 'crude', 2.2, 'FOB', 21926.0, 48237.2, 1.0, 16.35, 788678.22, ARRAY[]::text[])
),
-- One invoice number appears TWICE in the workbook, and uq_data_oil_export_register_document
-- (20260819100000) correctly forbids that:
--
--   IN-000285938  Vantage  Spain  $126,067.20  3 loads
--       YE25   sheet: 2025-03-12 @ 18.5128  ->  R2,333,856.86
--       YE2026 sheet: 2025-08-22 @ 17.6913  ->  R2,230,287.98
--
-- Same customer, same country, same USD to the cent, same load count, same contract reference
-- (52200056 3 FLEXI) — one invoice, re-listed in the next financial year's sheet and revalued at a
-- later rate, almost certainly on payment receipt. Pete's own totals count it in BOTH years, so his
-- FYE2025 and FYE2026 figures overlap by R2.23m.
--
-- The EARLIEST occurrence wins. An export invoice belongs to the period it was issued, which is what
-- export_date means for all 45 other rows; keeping the restatement would attribute FYE2025 revenue to
-- FYE2026. The skipped row is R2,230,287.98 in Aug 2025 — historical only, well before the FYE2027
-- figures, and it touches no tracking section that exists today.
--
-- This is flagged rather than resolved: 'duplicate_invoice_earliest_kept' marks the surviving row so
-- the decision is visible on the data page and Pete can overrule it if these really were two
-- shipments that happened to invoice at an identical dollar value.
deduped AS (
    SELECT i.*,
           -- Earliest export_date first, so rank 1 is the original invoice.
           ROW_NUMBER() OVER (PARTITION BY i.document_number
                              ORDER BY i.export_date NULLS LAST) AS dup_rank,
           COUNT(*)     OVER (PARTITION BY i.document_number) AS dup_count
    FROM incoming i
)
INSERT INTO public.data_oil_export_register
    (export_date, customer_name, location_country, document_number, reference, product_class,
     price_per_kg_usd, incoterm, weight_kg, usd_debit, load_count, usd_zar_rate, rand_value,
     data_source, data_quality_flags, notes)
SELECT i.export_date, i.customer_name, i.location_country, i.document_number, i.reference,
       i.product_class, i.price_per_kg_usd, i.incoterm, i.weight_kg, i.usd_debit, i.load_count,
       i.usd_zar_rate, i.rand_value,
       'backfill',
       -- ::text is required, not cosmetic: against an untyped literal, || resolves to
       -- anyarray||anyarray and fails as a malformed array literal. The cast picks array||element.
       CASE WHEN i.document_number IS NOT NULL AND i.dup_count > 1
            THEN i.data_quality_flags || 'duplicate_invoice_earliest_kept'::text
            ELSE i.data_quality_flags END,
       'Loaded from Oil Sales (1).xlsx'
FROM deduped i
-- Keep rank 1 of each document_number. The two undated rows share a NULL partition and would rank
-- 1 and 2 against each other, so they are exempted — they are distinct invoices, not duplicates.
WHERE (i.document_number IS NULL OR i.dup_rank = 1)
-- Idempotence, and the unique-document contract, in one guard: never insert a document_number that
-- is already present, whatever its date or value.
  AND NOT EXISTS (
    SELECT 1 FROM public.data_oil_export_register e
    WHERE e.document_number IS NOT NULL
      AND i.document_number IS NOT NULL
      AND e.document_number = i.document_number
)
  AND NOT EXISTS (
    -- The two undated rows carry no document number, so they need their own identity check.
    SELECT 1 FROM public.data_oil_export_register e
    WHERE e.document_number IS NULL
      AND i.document_number IS NULL
      AND COALESCE(e.export_date, DATE '1900-01-01') = COALESCE(i.export_date, DATE '1900-01-01')
      AND COALESCE(e.usd_debit, 0) = COALESCE(i.usd_debit, 0)
      AND COALESCE(e.customer_name, '') = COALESCE(i.customer_name, '')
);

-- ============================================================================
-- 2. Link the local twins.
--
-- Five local bulk rows are the same commercial sale as a register row. Weight is the only field
-- that agrees to the kilogram - invoice numbers, dates (up to 8 days apart) and even the product
-- classification differ. So the match is on exact weight within a 10-day window.
--
-- Two deliberate guards:
--   * Only link when the register row has EXACTLY ONE candidate local row and vice versa. An
--     ambiguous match is left unlinked, which under-counts nothing (both rows stay visible) and is
--     safer than picking arbitrarily.
--   * Only bulk rows (>= 1000 kg). Every real twin is a container load; the domestic drum sales
--     that share a customer are 11-155 kg and must never be suppressed.
--
-- Every link is flagged 'export_twin_auto_linked' so a human can audit the five and unlink any
-- that are genuinely separate sales - the whole reason this is stored rather than re-derived.
-- ============================================================================

WITH candidate AS (
    SELECT s.id AS local_id,
           e.id AS register_id,
           COUNT(*) OVER (PARTITION BY s.id) AS matches_for_local,
           COUNT(*) OVER (PARTITION BY e.id) AS matches_for_register
    FROM public.data_oil_sales_lines s
    JOIN public.data_oil_export_register e
      ON e.weight_kg IS NOT NULL
     AND s.quantity_kg IS NOT NULL
     AND ABS(e.weight_kg - s.quantity_kg) < 0.51
     AND e.export_date IS NOT NULL
     AND ABS(e.export_date - s.sale_date) <= 10
    WHERE s.quantity_kg >= 1000
      AND s.export_register_id IS NULL
)
UPDATE public.data_oil_sales_lines s
   SET export_register_id = c.register_id,
       data_quality_flags = CASE
           WHEN 'export_twin_auto_linked' = ANY (s.data_quality_flags)
           THEN s.data_quality_flags
           ELSE s.data_quality_flags || 'export_twin_auto_linked'::text
       END
  FROM candidate c
 WHERE s.id = c.local_id
   AND c.matches_for_local = 1
   AND c.matches_for_register = 1;

NOTIFY pgrst, 'reload schema';
