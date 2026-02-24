-- Fix: allow status 'supplier_intake' and 'oil_production' when creating batches from Supplier Intake.
-- Run this in Supabase SQL Editor if you see: "violates check constraint production_batches_status_check"

ALTER TABLE public.production_batches
  DROP CONSTRAINT IF EXISTS production_batches_status_check;

ALTER TABLE public.production_batches
  ADD CONSTRAINT production_batches_status_check CHECK (
    status::text = ANY (ARRAY[
      'receiving','cracking','washing','sorting_wet','drying','cooling','sorting_dry',
      'butter_separation','inspection','packing','metal_detection','weight_verification',
      'sampling','pending_release','released','cold_storage','completed','hold',
      'supplier_intake','oil_production','awaiting_production','intake_received',
      'quality_pending','quality_approved','awaiting_test','release_ready',
      'in_production','in_finished_stock'
    ]::text[])
  );
