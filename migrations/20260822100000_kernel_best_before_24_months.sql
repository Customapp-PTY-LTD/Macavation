-- Kernel Best Before: move the shelf-life rule from 18 months to 24 months, measured from
-- the PACKING START date.
--
-- Two parts, both idempotent and safe to re-run:
--
--   A. get_kernel_batches fallback. The function previously fell back to
--      packing_completion_date + 18 months, which disagreed with the job card (it has always
--      used packing START). This rewrites that one expression in place so the function keeps
--      its ~22k characters of unrelated logic byte-for-byte, and brings the fallback in line
--      with the front end: packing_start_date + 24 months.
--
--   B. Backfill of existing batches. Two populations:
--        - Batches with a real packing start date  -> packing_start + 24 months.
--        - Batches imported from spreadsheets, which carry a best-before but NO packing start
--          (their packing_completion_date is a single bulk-seeded placeholder and is useless
--          for arithmetic). Their stored dates are genuinely "real packing date + 18 months",
--          so shifting them by +6 months lands them at 24 months from the same packing date.
--      The previous value is kept in best_before_date_prev_18m so this is reversible, and a
--      best_before_rule tag records which rule produced the date and guards re-runs.
--
-- Front end counterpart: _common.KERNEL_BEST_BEFORE_MONTHS in WebPortal/js/common.js.
-- Keep the two in step.

-- ---------------------------------------------------------------------------
-- Part A: repoint the get_kernel_batches fallback
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
    v_def  text;
    v_old  text := '((NULLIF(k.job_card_data->>''packing_completion_date'', ''''))::date + interval ''18 months'')::date';
    v_new  text := '((NULLIF(k.job_card_data->>''packing_start_date'', ''''))::date + interval ''24 months'')::date';
    v_hits int;
BEGIN
    SELECT pg_get_functiondef(p.oid)
      INTO v_def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_kernel_batches'
       AND pg_get_function_identity_arguments(p.oid)
           = 'p_status character varying, p_search character varying, p_limit integer, p_offset integer';

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'get_kernel_batches(varchar,varchar,int,int) not found - refusing to guess';
    END IF;

    IF position(v_new in v_def) > 0 THEN
        RAISE NOTICE 'get_kernel_batches already on the 24 month rule - nothing to do';
        RETURN;
    END IF;

    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 occurrence of the 18 month fallback in get_kernel_batches, found %', v_hits;
    END IF;

    EXECUTE replace(v_def, v_old, v_new);
    RAISE NOTICE 'get_kernel_batches fallback repointed to packing_start_date + 24 months';
END
$mig$;

-- ---------------------------------------------------------------------------
-- Part B1: batches that have a real packing start date -> start + 24 months
-- ---------------------------------------------------------------------------
UPDATE public.kernel k
   SET job_card_data = COALESCE(k.job_card_data, '{}'::jsonb) || jsonb_build_object(
           'best_before_date',          (((k.job_card_data->>'packing_start_date')::date + interval '24 months')::date)::text,
           'best_before_date_prev_18m', k.job_card_data->>'best_before_date',
           'best_before_rule',          'packing_start_plus_24m'
       ),
       updated_at = now()
 WHERE k.is_active = true
   AND NULLIF(k.job_card_data->>'packing_start_date', '') IS NOT NULL
   AND COALESCE(k.job_card_data->>'best_before_rule', '') NOT IN ('packing_start_plus_24m', 'imported_shifted_to_24m');

-- ---------------------------------------------------------------------------
-- Part B2: spreadsheet-imported batches with no packing start -> stored date + 6 months
-- ---------------------------------------------------------------------------
UPDATE public.kernel k
   SET job_card_data = COALESCE(k.job_card_data, '{}'::jsonb) || jsonb_build_object(
           'best_before_date',          (((k.job_card_data->>'best_before_date')::date + interval '6 months')::date)::text,
           'best_before_date_prev_18m', k.job_card_data->>'best_before_date',
           'best_before_rule',          'imported_shifted_to_24m'
       ),
       updated_at = now()
 WHERE k.is_active = true
   AND NULLIF(k.job_card_data->>'packing_start_date', '') IS NULL
   AND NULLIF(k.job_card_data->>'best_before_date', '') IS NOT NULL
   AND COALESCE(k.job_card_data->>'best_before_rule', '') NOT IN ('packing_start_plus_24m', 'imported_shifted_to_24m');
