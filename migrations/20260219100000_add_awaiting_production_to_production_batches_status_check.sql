-- Allow statuses used by Grower Intake "Release to production" and Kernel Production workflow.
-- Fix: "new row for relation production_batches violates check constraint production_batches_status_check"
-- when setting status to 'awaiting_production', 'awaiting_test', or 'release_ready'.

ALTER TABLE public.production_batches
  DROP CONSTRAINT IF EXISTS production_batches_status_check;

ALTER TABLE public.production_batches
  ADD CONSTRAINT production_batches_status_check CHECK (
    (status)::text = ANY (ARRAY[
      'receiving'::text, 'intake_received'::text, 'quality_pending'::text, 'quality_approved'::text,
      'awaiting_production'::text, 'in_production'::text, 'in_finished_stock'::text,
      'cracking'::text, 'washing'::text, 'sorting_wet'::text, 'drying'::text, 'cooling'::text,
      'sorting_dry'::text, 'butter_separation'::text, 'inspection'::text, 'packing'::text,
      'metal_detection'::text, 'weight_verification'::text, 'sampling'::text,
      'awaiting_test'::text, 'release_ready'::text,
      'pending_release'::text, 'released'::text, 'cold_storage'::text, 'completed'::text, 'hold'::text
    ])
  );
