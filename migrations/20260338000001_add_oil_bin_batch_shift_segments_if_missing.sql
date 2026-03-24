-- Projects that applied send_oil_bin_batch_to_stock (grade) before oil_bin_shift_segments:
-- add column so SELECT ... shift_segments does not fail.
-- Does NOT replace functions (keeps current send_oil_bin_batch_to_stock with grade).

ALTER TABLE public.oil_bin_batch
    ADD COLUMN IF NOT EXISTS shift_segments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.oil_bin_batch.shift_segments IS 'JSON array: [{ shift_id, shift_name, shift_date, ingredients[], raw_ingredient_audit }].';

-- Backfill legacy free-text into one segment when segments empty
UPDATE public.oil_bin_batch obb
SET shift_segments = jsonb_build_array(
    jsonb_build_object(
        'shift_name', COALESCE(NULLIF(trim(COALESCE(obb.shifts, '')), ''), 'Shift 1'),
        'ingredients', CASE
            WHEN obb.ingredients IS NOT NULL AND trim(obb.ingredients) <> '' THEN
                jsonb_build_array(jsonb_build_object('description', trim(obb.ingredients)))
            ELSE '[]'::jsonb
        END,
        'shift_id', NULL,
        'shift_date', obb.start_date,
        'raw_ingredient_audit', COALESCE(obb.raw_ingredient_audit, '[]'::jsonb)
    )
)
WHERE jsonb_array_length(COALESCE(obb.shift_segments, '[]'::jsonb)) = 0
  AND (
      (obb.shifts IS NOT NULL AND trim(obb.shifts) <> '')
      OR (obb.ingredients IS NOT NULL AND trim(obb.ingredients) <> '')
      OR jsonb_array_length(COALESCE(obb.raw_ingredient_audit, '[]'::jsonb)) > 0
  );

NOTIFY pgrst, 'reload schema';
