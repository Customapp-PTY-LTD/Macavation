-- One-off: clear Oil + Protein production module data (Supabase).
-- Does NOT touch kernel, kernel_dispatch_orders, or kernel stock.
-- Run manually or via MCP execute_sql when you need an empty oil/protein workspace.

BEGIN;

UPDATE public.silo SET oil_batch_id = NULL WHERE oil_batch_id IS NOT NULL;

UPDATE public.protein_bin_batch SET stock_lot_id = NULL WHERE stock_lot_id IS NOT NULL;

DELETE FROM public.oil_bin_batch;

DELETE FROM public.oil_dispatch_orders;

DELETE FROM public.protein_bin_batch;

DELETE FROM public.oil_stock_lots;

DELETE FROM public.oil_production_sheets;

DELETE FROM public.oil_bin;

DELETE FROM public.oil;

COMMIT;
