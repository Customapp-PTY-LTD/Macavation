-- Deactivate kernel batches that are "in production" (not yet released to stock).
-- Stock (Kernel) only shows kernel with status = 'complete' and is_active = true, so it is unchanged.
-- Kernel Production board will show no batches after this (it will request only in-production statuses).

UPDATE public.kernel
SET is_active = false,
    updated_at = now()
WHERE status IS NOT NULL
  AND status NOT IN ('complete', 'in_finished_stock');
