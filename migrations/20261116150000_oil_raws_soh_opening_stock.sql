-- ============================================================================
-- Oil raws: load Mike's stock-on-hand sheet as bags in stock + a stock count (16 Nov 2026)
-- ============================================================================
-- Source: "Macadamia Oil Raws and FG SOH YE'27.xlsx", tab "RM Stock on Hand", Receiving Register
-- (rows 52-247; none ticked "Issued to Production"). Mike: "load that into stock ... as of right now
-- the stock is correct", then New delivery adds and ticking bags into production takes them out.
--
-- 1. One oil row per batch, status release_ready (tested, waiting to go into production), so each
--    batch shows on Raw Materials and can be ticked into production like a normal delivery.
--    191 bags. Skipped 5 exact repeats on the sheet (same batch number, product and kg
--    listed twice): BN 7.26.330, BN 7.26.200, BN 7.26.219, BN 7.26.220, BN 7.26.347.
--    FFA on the sheet is a fraction (0.025) -> stored as percent (2.5), like New delivery.
--    73 Green Farms bags have no delivery date on the sheet: dated 2026-11-15 (the count day).
--    Supplier is the sheet's name; supplier_id is linked only where a contacts row has that exact name.
--    Fixed ids (md5 of the batch number) + ON CONFLICT DO NOTHING: safe to run twice.
-- 2. A stock count dated 2026-11-15 = the sheet totals, via save_oil_raw_count(), so the sheet is the
--    new starting point: bags dated on/before it are in the count (not "received" again), and bags
--    ticked into production from 16 Nov are subtracted. Crush and oil cake: 0 (not on the sheet).
--      crude kernel 46,873.72 | food grade kernel 5,953.50 | kernel dust 19,721.70 | cracker dust 90,173.10
--    Skipped if a count for 2026-11-15 already exists, or if a later count was already saved.
-- Not loaded: the finished-goods tabs (FG Stock on Hand, FG Sold).
-- Down: DELETE FROM oil WHERE intake_data->>'source' = 'soh_sheet_2026_11_16';
--       DELETE FROM oil_raw_counts WHERE count_date = '2026-11-15' AND notes LIKE 'Opening stock from%';
--       then restore kernel_pipeline_settings 'oil_raw_stock' (count_date 2026-10-26, counts 13350/0/8636/66059).
-- ============================================================================

BEGIN;

WITH src (batch_id, product_type, grade, kg, received, dated, supplier, ffa, units) AS (
  VALUES
    ('BN 5.26.342', 'oil_kernel', 'crude', 817.0, '2026-02-11', true, 'Macavation', NULL, 1.0),
    ('BN 5.26.349', 'cracker_dust', NULL, 607.5, '2026-03-11', true, 'Macavation', NULL, 1.0),
    ('BN 7.26.193', 'cracker_dust', NULL, 583.0, '2026-07-20', true, 'Green Farms Nut Company', 2.0, NULL),
    ('BN 7.26.195', 'cracker_dust', NULL, 581.0, '2026-07-20', true, 'Green Farms Nut Company', 2.0, NULL),
    ('BN 7.26.200', 'cracker_dust', NULL, 747.0, '2026-07-20', true, 'Green Farms Nut Company', 2.0, NULL),
    ('BN 7.26.330', 'cracker_dust', NULL, 688.0, '2026-07-20', true, 'Green Farms Nut Company', 2.0, NULL),
    ('BN 7.26.219', 'cracker_dust', NULL, 655.0, '2026-07-20', true, 'Green Farms Nut Company', 2.0, NULL),
    ('BN 7.26.220', 'cracker_dust', NULL, 617.0, '2026-07-20', true, 'Green Farms Nut Company', 2.0, NULL),
    ('BN 7.26.347', 'cracker_dust', NULL, 600.0, '2026-07-20', true, 'Green Farms Nut Company', 2.0, NULL),
    ('BN 12.26.134', 'kernel_dust', NULL, 1175.0, '2026-10-01', true, 'Mayo Macs', 2.0, 1.0),
    ('BN 12.26.135', 'kernel_dust', NULL, 1130.0, '2026-10-01', true, 'Mayo Macs', 2.0, 1.0),
    ('BN 12.26.136', 'kernel_dust', NULL, 1169.0, '2026-10-01', true, 'Mayo Macs', 2.0, 1.0),
    ('BN 2.26.95', 'cracker_dust', NULL, 1250.0, '2026-10-15', true, 'Golden Macadamias Processing', 2.5, 50.0),
    ('BN 2.26.96', 'cracker_dust', NULL, 1250.0, '2026-10-15', true, 'Golden Macadamias Processing', 2.5, 50.0),
    ('BN 2.26.97', 'cracker_dust', NULL, 1250.0, '2026-10-15', true, 'Golden Macadamias Processing', 2.5, 50.0),
    ('BN 11.26.14', 'kernel_dust', NULL, 999.5, '2026-10-21', true, 'Nutaria', 2.0, 1.0),
    ('BN 11.26.18', 'kernel_dust', NULL, 1001.0, '2026-10-21', true, 'Nutaria', 2.0, 1.0),
    ('BN 11.26.26', 'kernel_dust', NULL, 999.5, '2026-10-21', true, 'Nutaria', 2.0, 1.0),
    ('BN 11.26.28', 'kernel_dust', NULL, 1000.5, '2026-10-21', true, 'Nutaria', 2.0, 1.0),
    ('BN 5.26.336', 'cracker_dust', NULL, 560.0, '2026-10-27', true, 'Macavation', NULL, 1.0),
    ('BN 5.26.337', 'cracker_dust', NULL, 680.0, '2026-10-27', true, 'Macavation', NULL, 1.0),
    ('BN 5.26.338', 'oil_kernel', 'crude', 671.0, '2026-10-27', true, 'Macavation', NULL, 1.0),
    ('BN 5.26.339', 'oil_kernel', 'crude', 696.0, '2026-10-27', true, 'Macavation', NULL, 1.0),
    ('BN 5.26.340', 'oil_kernel', 'crude', 819.0, '2026-10-27', true, 'Macavation', NULL, 1.0),
    ('BN 2.26.122', 'kernel_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 1.5, 120.0),
    ('BN 2.26.129', 'kernel_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 1.5, 120.0),
    ('BN 2.26.134', 'cracker_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 120.0),
    ('BN 2.26.135', 'cracker_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 120.0),
    ('BN 2.26.136', 'cracker_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 120.0),
    ('BN 2.26.138', 'cracker_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 120.0),
    ('BN 2.26.139', 'cracker_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 120.0),
    ('BN 2.26.140', 'cracker_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 120.0),
    ('BN 2.26.141', 'cracker_dust', NULL, 1360.8, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 120.0),
    ('BN 2.26.142', 'cracker_dust', NULL, 1417.5, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 56.7),
    ('BN 2.26.143', 'cracker_dust', NULL, 1250.0, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 50.0),
    ('BN 2.26.144', 'cracker_dust', NULL, 1250.0, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 50.0),
    ('BN 2.26.145', 'cracker_dust', NULL, 1250.0, '2026-10-29', true, 'Golden Macadamias Processing', 3.0, 50.0),
    ('BN 9.26.73', 'oil_kernel', 'crude', 1000.0, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.75', 'oil_kernel', 'crude', 1000.0, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.79', 'oil_kernel', 'crude', 1031.94, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.80', 'oil_kernel', 'crude', 1031.94, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.81', 'oil_kernel', 'crude', 1031.94, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.82', 'oil_kernel', 'crude', 1031.94, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.83', 'oil_kernel', 'crude', 1031.94, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.84', 'oil_kernel', 'crude', 1031.94, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.85', 'oil_kernel', 'crude', 1031.94, '2026-10-29', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 1.26.345', 'cracker_dust', NULL, 1200.0, '2026-10-30', true, 'Global Macadamias', NULL, 48.0),
    ('BN 1.26.346', 'cracker_dust', NULL, 1200.0, '2026-10-30', true, 'Global Macadamias', NULL, 48.0),
    ('BN 1.26.350', 'cracker_dust', NULL, 1225.0, '2026-10-30', true, 'Global Macadamias', NULL, 49.0),
    ('BN 1.26.355', 'oil_kernel', 'food_grade', 1190.7, '2026-10-30', true, 'Global Macadamias', NULL, 105.0),
    ('BN 1.26.356', 'oil_kernel', 'food_grade', 1190.7, '2026-10-30', true, 'Global Macadamias', NULL, 105.0),
    ('BN 1.26.357', 'oil_kernel', 'food_grade', 1190.7, '2026-10-30', true, 'Global Macadamias', NULL, 105.0),
    ('BN 1.26.358', 'oil_kernel', 'food_grade', 1190.7, '2026-10-30', true, 'Global Macadamias', NULL, 105.0),
    ('BN 1.26.360', 'oil_kernel', 'food_grade', 1190.7, '2026-10-30', true, 'Global Macadamias', NULL, 105.0),
    ('BN 1.26.362', 'oil_kernel', 'crude', 550.0, '2026-10-30', true, 'Global Macadamias', NULL, 22.0),
    ('BN 9.26.86', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.87', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.88', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.89', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.90', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.91', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.92', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.93', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.94', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.95', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.96', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.97', 'oil_kernel', 'crude', 1009.26, '2026-11-06', true, 'Ivory Macadamias', NULL, 89.0),
    ('BN 9.26.98', 'oil_kernel', 'crude', 1000.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 40.0),
    ('BN 9.26.99', 'oil_kernel', 'crude', 1000.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 40.0),
    ('BN 9.26.100', 'oil_kernel', 'crude', 1000.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 40.0),
    ('BN 9.26.101', 'oil_kernel', 'crude', 1000.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 40.0),
    ('BN 9.26.102', 'oil_kernel', 'crude', 1002.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 167.0),
    ('BN 9.26.103', 'oil_kernel', 'crude', 1031.94, '2026-11-06', true, 'Ivory Macadamias', NULL, 91.0),
    ('BN 9.26.104', 'oil_kernel', 'crude', 1031.94, '2026-11-06', true, 'Ivory Macadamias', NULL, 91.0),
    ('BN 9.26.105', 'oil_kernel', 'crude', 1031.94, '2026-11-06', true, 'Ivory Macadamias', NULL, 91.0),
    ('BN 9.26.106', 'oil_kernel', 'crude', 1031.94, '2026-11-06', true, 'Ivory Macadamias', NULL, 91.0),
    ('BN 9.26.107', 'oil_kernel', 'crude', 800.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 100.0),
    ('BN 9.26.108', 'oil_kernel', 'crude', 929.88, '2026-11-06', true, 'Ivory Macadamias', NULL, 82.0),
    ('BN 9.26.109', 'oil_kernel', 'crude', 720.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 120.0),
    ('BN 9.26.110', 'oil_kernel', 'crude', 996.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 166.0),
    ('BN 9.26.111', 'oil_kernel', 'crude', 557.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.112', 'oil_kernel', 'crude', 535.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.113', 'oil_kernel', 'crude', 287.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.114', 'oil_kernel', 'crude', 368.38, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.115', 'oil_kernel', 'crude', 400.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.116', 'oil_kernel', 'crude', 575.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.117', 'oil_kernel', 'crude', 335.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.118', 'oil_kernel', 'crude', 575.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.119', 'oil_kernel', 'crude', 637.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 1.0),
    ('BN 9.26.120', 'cracker_dust', NULL, 400.0, '2026-11-06', true, 'Ivory Macadamias', NULL, 20.0),
    ('BN 5.26.350', 'cracker_dust', NULL, 791.0, '2026-11-09', true, 'Macavation', NULL, 1.0),
    ('BN 5.26.351', 'oil_kernel', 'crude', 659.0, '2026-11-09', true, 'Macavation', NULL, 1.0),
    ('BN 5.26.352', 'oil_kernel', 'crude', 732.0, '2026-11-09', true, 'Macavation', NULL, 1.0),
    ('BN 2.26.146', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.147', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.148', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.149', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.150', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.151', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.152', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.153', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.154', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.155', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.156', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.157', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.158', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.159', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.160', 'cracker_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.161', 'oil_kernel', 'crude', 1250.0, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.162', 'oil_kernel', 'crude', 1250.0, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.163', 'oil_kernel', 'crude', 1250.0, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.164', 'kernel_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.165', 'kernel_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.166', 'kernel_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.167', 'kernel_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.168', 'kernel_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.169', 'kernel_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 2.26.170', 'kernel_dust', NULL, 1360.8, '2026-11-11', true, 'Golden Macadamias Processing', NULL, NULL),
    ('BN 7.26.327', 'cracker_dust', NULL, 676.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, NULL),
    ('BN 7.26.263', 'cracker_dust', NULL, 542.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.359', 'cracker_dust', NULL, 550.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.267', 'cracker_dust', NULL, 579.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, NULL),
    ('BN 7.26.270', 'cracker_dust', NULL, 602.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.280', 'cracker_dust', NULL, 598.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.281', 'cracker_dust', NULL, 503.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.284', 'cracker_dust', NULL, 596.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.285', 'cracker_dust', NULL, 526.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.286', 'cracker_dust', NULL, 551.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.287', 'cracker_dust', NULL, 565.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.288', 'cracker_dust', NULL, 558.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.289', 'cracker_dust', NULL, 534.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.290', 'cracker_dust', NULL, 504.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.291', 'cracker_dust', NULL, 742.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.292', 'cracker_dust', NULL, 485.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.293', 'cracker_dust', NULL, 597.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.300', 'cracker_dust', NULL, 445.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.304', 'cracker_dust', NULL, 448.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.307', 'cracker_dust', NULL, 607.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, NULL),
    ('BN 7.26.308', 'cracker_dust', NULL, 505.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.309', 'cracker_dust', NULL, 635.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.310', 'cracker_dust', NULL, 547.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.312', 'cracker_dust', NULL, 492.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, NULL),
    ('BN 7.26.313', 'cracker_dust', NULL, 377.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, NULL),
    ('BN 7.26.326', 'cracker_dust', NULL, 726.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.328', 'cracker_dust', NULL, 469.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.329', 'cracker_dust', NULL, 486.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.331', 'cracker_dust', NULL, 556.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.332', 'cracker_dust', NULL, 687.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.333', 'cracker_dust', NULL, 588.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.335', 'cracker_dust', NULL, 546.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.336', 'cracker_dust', NULL, 596.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.337', 'cracker_dust', NULL, 535.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.338', 'cracker_dust', NULL, 647.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.339', 'cracker_dust', NULL, 531.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.340', 'cracker_dust', NULL, 677.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.342', 'cracker_dust', NULL, 589.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.343', 'cracker_dust', NULL, 585.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.344', 'cracker_dust', NULL, 529.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.345', 'cracker_dust', NULL, 569.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.346', 'cracker_dust', NULL, 617.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.348', 'cracker_dust', NULL, 622.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.349', 'cracker_dust', NULL, 373.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, NULL),
    ('BN 7.26.350', 'cracker_dust', NULL, 557.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.351', 'cracker_dust', NULL, 604.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.352', 'cracker_dust', NULL, 537.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.353', 'cracker_dust', NULL, 495.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.354', 'cracker_dust', NULL, 534.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.355', 'cracker_dust', NULL, 441.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.356', 'cracker_dust', NULL, 541.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.357', 'cracker_dust', NULL, 524.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.358', 'cracker_dust', NULL, 510.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.360', 'cracker_dust', NULL, 473.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.363', 'cracker_dust', NULL, 630.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.364', 'cracker_dust', NULL, 502.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.365', 'cracker_dust', NULL, 507.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.366', 'cracker_dust', NULL, 506.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.367', 'cracker_dust', NULL, 599.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.368', 'cracker_dust', NULL, 494.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.369', 'cracker_dust', NULL, 479.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.370', 'cracker_dust', NULL, 494.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.371', 'cracker_dust', NULL, 495.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.372', 'cracker_dust', NULL, 519.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.373', 'cracker_dust', NULL, 559.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.374', 'cracker_dust', NULL, 551.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.375', 'cracker_dust', NULL, 597.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.376', 'cracker_dust', NULL, 500.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.377', 'cracker_dust', NULL, 580.5, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.378', 'cracker_dust', NULL, 581.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.379', 'cracker_dust', NULL, 571.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.334', 'cracker_dust', NULL, 635.0, '2026-11-15', false, 'Green Farms Nut Company', 2.5, 1.0),
    ('BN 7.26.303', 'cracker_dust', NULL, 470.0, '2026-11-15', false, 'Green Farms Nut Company', 3.0, 1.0)
)
INSERT INTO public.oil (id, batch_id, status, is_active, intake_data, created_at, updated_at)
SELECT
    -- fixed id per batch (md5 of the batch number) so a re-run inserts nothing new
    md5('oil-soh-2026-11-15|' || s.batch_id)::uuid,
    s.batch_id,
    'release_ready',
    true,
    jsonb_strip_nulls(jsonb_build_object(
        'product_type',      s.product_type,
        'quantity_kg',       s.kg::numeric,
        'date_received',     s.received,
        'supplier',          s.supplier,
        'supplier_details',  s.supplier,
        'ffa',               s.ffa::numeric,
        'official_ffa',      s.ffa::numeric,
        'carton_bulk_bags',  s.units::numeric,
        'delivery_group_id', md5('oil-soh-group|' || s.supplier || '|' || s.received || CASE WHEN s.dated THEN '' ELSE '|undated' END)::uuid::text,
        'supplier_id',       (SELECT c.id::text FROM public.contacts c
                               WHERE c.deleted_at IS NULL AND lower(btrim(c.company_name)) = lower(s.supplier)
                               ORDER BY (c.contact_type = 'supplier') DESC, c.created_at LIMIT 1),
        'source',            'soh_sheet_2026_11_16',
        'receiving_comments','Loaded from the oil raws stock-on-hand sheet (Macadamia Oil Raws and FG SOH YE27), 16 Nov 2026.'
                             || CASE WHEN s.dated THEN '' ELSE ' No delivery date on the sheet; dated the stock count day.' END
    )) || jsonb_build_object('grade', s.grade),
    now(),
    now()
  FROM src s
ON CONFLICT DO NOTHING;

DO $$
DECLARE
    v_prev date := COALESCE((SELECT (value->>'count_date')::date FROM public.kernel_pipeline_settings
                              WHERE key = 'oil_raw_stock'), DATE '2026-10-26');
    v_res  jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.oil_raw_counts WHERE count_date = DATE '2026-11-15') OR v_prev > DATE '2026-11-15' THEN
        RAISE NOTICE 'oil SOH count: skipped (count already saved for or after 2026-11-15)';
        RETURN;
    END IF;
    v_res := public.save_oil_raw_count(DATE '2026-11-15', jsonb_build_object(
        'crude_kernel', 46873.72, 'food_grade_kernel', 5953.5,
        'kernel_dust', 19721.7, 'cracker_dust', 90173.1,
        'crush', 0, 'cake', 0),
        'Opening stock from the oil raws stock-on-hand sheet (Macadamia Oil Raws and FG SOH YE27), sent by Mike 16 Nov 2026.',
        NULL);
    IF COALESCE((v_res->>'success')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'save_oil_raw_count failed: %', v_res;
    END IF;
END;
$$;

COMMIT;
