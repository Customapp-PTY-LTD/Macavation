-- Run this in Supabase SQL Editor (Macavation project) to check batches created on 2026-03-09
-- and why they might not appear under Grower Intake.

-- 1) All kernel batches with batch or kernel created/updated on 2026-03-09
SELECT
  b.id AS batch_uuid,
  b.batch_id AS batch_number,
  b.batch_type,
  k.id AS kernel_id,
  k.status AS kernel_status,
  k.is_active AS kernel_active,
  k.grower_name,
  k.received_date,
  k.wet_nis_received_kg,
  k.created_at AS kernel_created,
  k.updated_at AS kernel_updated
FROM public.batches b
LEFT JOIN public.kernel k ON k.batch_id = b.id
WHERE b.batch_type = 'kernel'
  AND (
    (b.created_at AT TIME ZONE 'UTC')::date = '2026-03-09'
    OR (k.created_at AT TIME ZONE 'UTC')::date = '2026-03-09'
    OR (k.updated_at AT TIME ZONE 'UTC')::date = '2026-03-09'
  )
ORDER BY COALESCE(k.updated_at, k.created_at) DESC NULLS LAST;

-- 2) What get_kernel_batches returns for Grower Intake (status = 'intake,receiving')
-- Grower Intake only shows rows returned by this.
SELECT *
FROM public.get_kernel_batches(
  p_status := 'intake,receiving',
  p_search := NULL,
  p_limit := 100,
  p_offset := 0
);

-- 3) If the two batches from step 1 have kernel_status = 'production', they will NOT
--    appear in step 2. Grower Intake list only shows status IN ('intake','receiving').
--    To fix existing rows (so they show under Grower Intake), run:
-- UPDATE public.kernel k
-- SET status = 'intake', updated_at = NOW()
-- FROM public.batches b
-- WHERE b.id = k.batch_id
--   AND b.batch_type = 'kernel'
--   AND (k.updated_at AT TIME ZONE 'UTC')::date = '2026-03-09'
--   AND k.status = 'production';
