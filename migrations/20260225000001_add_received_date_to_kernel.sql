-- Migration: Add received_date to kernel table
-- This column was missed during the consolidation migration.
-- Every grid displays received_date so it needs to be a scalar column.

ALTER TABLE public.kernel
ADD COLUMN IF NOT EXISTS received_date date NULL;

-- Backfill from production_batches (the original source)
UPDATE public.kernel k
SET received_date = pb.received_date
FROM public.batches b
JOIN public.production_batches pb ON pb.id = b.id
WHERE k.batch_id = b.id
  AND pb.received_date IS NOT NULL;

-- Index for common filtering/sorting by date
CREATE INDEX IF NOT EXISTS idx_kernel_received_date ON public.kernel (received_date);
