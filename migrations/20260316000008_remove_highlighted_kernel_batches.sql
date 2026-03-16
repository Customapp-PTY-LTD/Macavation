-- Remove the 5 highlighted batches from Stock (Kernel): deactivate kernel rows so they no longer show.
-- Batch IDs: 57.1.25.42, 56.1.25.45, 55.1.25.43.1, 55.1.25.38, 54.6.25.37

UPDATE public.kernel k
SET is_active = false, updated_at = now()
FROM public.batches b
WHERE k.batch_id = b.id
  AND b.batch_type = 'kernel'
  AND b.batch_id IN (
    '57.1.25.42',
    '56.1.25.45',
    '55.1.25.43.1',
    '55.1.25.38',
    '54.6.25.37'
  );
