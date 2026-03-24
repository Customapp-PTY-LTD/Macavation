-- Ensure oil_bin_batch.oil_stream exists (food_grade | cosmetic) for grade / traceability.
-- Idempotent; safe if 20260331000010 already ran.

ALTER TABLE public.oil_bin_batch
    ADD COLUMN IF NOT EXISTS oil_stream varchar(30);

COMMENT ON COLUMN public.oil_bin_batch.oil_stream IS 'food_grade or cosmetic — product line for this oil bin run (compliance, stock notes).';
