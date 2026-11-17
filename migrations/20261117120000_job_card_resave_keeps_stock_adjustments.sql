-- Re-saving or releasing an approved job card wiped every stock adjustment on the batch.
--
-- "Adjust Stock" (adjust_kernel_stock_on_hand, 20260402100001) appends a row with
-- "stock_adjustment": true to kernel.packing_data. Since 20261019100000 the remaining stock of a
-- job-card batch is job card + those adjustments - dispatched. But three functions rebuild
-- packing_data from the job card alone, which drops the adjustment rows with no trace:
--   - upsert_kernel_job_card   (saving an approved job card again; 20260617120000)
--   - approve_kernel_job_card  (approving with job-card data)
--   - complete_kernel_batch    (Release to stock, positive release; 20261111090000)
-- Found in review on 3 Nov 2026; noted alongside PR #124.
--
-- Fix: the rebuilt packing_data keeps the batch's existing stock_adjustment rows, appended after
-- the job-card rows, in their original order. Each function's single
--   public.sync_kernel_job_card_to_packing_data(<arg>)
-- inside its UPDATE public.kernel SET packing_data = ... becomes
--   public.kernel_packing_keep_adjustments(public.sync_kernel_job_card_to_packing_data(<arg>), packing_data)
-- where the bare packing_data is the row's value before the update.
--
-- The functions are patched in place from their live definitions (dev and prod bodies are
-- identical for all three as of 17 Nov 2026, md5 checked), and each patch asserts exactly one
-- swap so it fails loudly instead of half-applying if a body changes shape. Re-running is a no-op.

CREATE OR REPLACE FUNCTION public.kernel_packing_keep_adjustments(
    p_new jsonb,
    p_old jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
    SELECT COALESCE(NULLIF(p_new, 'null'::jsonb), '[]'::jsonb)
        || COALESCE((
               SELECT jsonb_agg(e.value ORDER BY e.ordinality)
               FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(p_old) = 'array' THEN p_old ELSE '[]'::jsonb END
                    ) WITH ORDINALITY AS e(value, ordinality)
               WHERE (e.value ->> 'stock_adjustment') = 'true'
           ), '[]'::jsonb);
$function$;

COMMENT ON FUNCTION public.kernel_packing_keep_adjustments(jsonb, jsonb) IS
    'New packing_data (from the job card) plus the stock_adjustment rows of the old packing_data, so a job-card rebuild never drops Adjust Stock entries.';

GRANT EXECUTE ON FUNCTION public.kernel_packing_keep_adjustments(jsonb, jsonb) TO authenticated, service_role;

DO $patch$
DECLARE
    v_fn   text;
    v_def  text;
    v_new  text;
    v_hits int;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'public.upsert_kernel_job_card(uuid,jsonb,boolean,boolean)',
        'public.approve_kernel_job_card(uuid,jsonb)',
        'public.complete_kernel_batch(uuid)'
    ] LOOP
        v_def := pg_get_functiondef(v_fn::regprocedure);

        IF position('kernel_packing_keep_adjustments' IN v_def) > 0 THEN
            RAISE NOTICE '% already keeps stock adjustments; nothing to do', v_fn;
            CONTINUE;
        END IF;

        v_hits := (SELECT count(*) FROM regexp_matches(
            v_def, 'public\.sync_kernel_job_card_to_packing_data\(([a-z_]+)\)', 'g'));
        IF v_hits <> 1 THEN
            RAISE EXCEPTION '% has an unexpected shape (% job-card rebuilds, expected 1); patch by hand', v_fn, v_hits;
        END IF;

        v_new := regexp_replace(
            v_def,
            'public\.sync_kernel_job_card_to_packing_data\(([a-z_]+)\)',
            'public.kernel_packing_keep_adjustments(public.sync_kernel_job_card_to_packing_data(\1), packing_data)');

        EXECUTE v_new;
    END LOOP;
END
$patch$;

NOTIFY pgrst, 'reload schema';
