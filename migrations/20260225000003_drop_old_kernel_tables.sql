-- Migration: Drop old kernel tables replaced by JSONB columns on kernel table
-- Safe to drop: kernel_production_stages, kernel_production_days, kernel_job_cards, kernel_packing_samples
-- These are replaced by: cracking_data/washing_data/sorting_data/packing_data, job_card_data, qa_data JSONB columns
-- NOT dropped: sample_submissions, receiving_checklists (still used by grower intake modals)
-- NOT dropped: kernel_dispatch_orders, kernel_dispatch_order_lines (still needed for dispatch module)

-- Check row counts before dropping (for safety)
DO $$
DECLARE
    v_stages bigint := 0;
    v_days bigint := 0;
    v_job_cards bigint := 0;
    v_packing bigint := 0;
BEGIN
    SELECT COUNT(*) INTO v_stages FROM public.kernel_production_stages;
    SELECT COUNT(*) INTO v_days FROM public.kernel_production_days;
    SELECT COUNT(*) INTO v_job_cards FROM public.kernel_production_job_cards;
    SELECT COUNT(*) INTO v_packing FROM public.kernel_packing_samples;
    RAISE NOTICE 'Row counts before drop: kernel_production_stages=%, kernel_production_days=%, kernel_job_cards=%, kernel_packing_samples=%',
        v_stages, v_days, v_job_cards, v_packing;
END;
$$;

-- Drop the replaced tables
DROP TABLE IF EXISTS public.kernel_production_days CASCADE;
DROP TABLE IF EXISTS public.kernel_production_stages CASCADE;
DROP TABLE IF EXISTS public.kernel_production_job_cards CASCADE;
DROP TABLE IF EXISTS public.kernel_packing_samples CASCADE;

-- Verify
DO $$
DECLARE
    remaining text;
BEGIN
    SELECT string_agg(tablename, ', ') INTO remaining
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('kernel_production_stages', 'kernel_production_days', 'kernel_production_job_cards', 'kernel_packing_samples');
    IF remaining IS NULL THEN
        RAISE NOTICE 'All 4 tables successfully dropped.';
    ELSE
        RAISE NOTICE 'These tables still exist: %', remaining;
    END IF;
END;
$$;
