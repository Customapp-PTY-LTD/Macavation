-- Seed oil_stock_lots from Macadamia Oil SOH and Production Figures YE'25 (12).xlsx
-- Sheets: RM SOH - 801 (supplier-level raws), FG SOH - 850 (finished on hand), PROTEIN POWDER SOH, Sold (historical dispatch).
-- Skipped: YE'25/YE'26 Production, Forecast, pivot-only blocks (no batch-level rows).
-- Idempotent: delete prior rows tagged in notes, then insert.

DELETE FROM public.oil_stock_lots
WHERE notes = 'SOH YE25 xlsx seed v1';