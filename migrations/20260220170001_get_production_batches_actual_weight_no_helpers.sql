-- Fallback: use this if 20260220170000 fails (e.g. get_batch_yield_by_style or contacts missing).
-- Same as 20260220170000 but without get_batch_yield_by_style, get_batch_remaining_by_style, and without contacts/sample_submissions joins.
-- Ensures get_production_batches returns actual_wet_nis_kg and wet_nis_weight_difference_kg so Actual column persists after refresh.

ALTER TABLE public.production_batches
  ADD COLUMN IF NOT EXISTS actual_wet_nis_kg numeric,
  ADD COLUMN IF NOT EXISTS wet_nis_weight_difference_kg numeric;

CREATE OR REPLACE FUNCTION public.get_production_batches(p_batch_type character varying DEFAULT 'kernel'::character varying, p_status character varying DEFAULT NULL::character varying, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_result json;
BEGIN
    SELECT json_build_object(
        'success', true,
        'data', COALESCE(
            (SELECT json_agg(row_to_json(t))
             FROM (
                 SELECT
                     pb.id,
                     pb.batch_number,
                     pb.batch_type,
                     pb.supplier_id,
                     pb.grower_name,
                     pb.wet_nis_received_kg,
                     pb.actual_wet_nis_kg,
                     pb.wet_nis_weight_difference_kg,
                     (pb.wet_nis_received_kg - (SELECT COALESCE(SUM(l.quantity_kg), 0)::numeric FROM public.kernel_dispatch_order_lines l WHERE l.production_batch_id = pb.id)) AS remaining_kg,
                     pb.received_date,
                     pb.receiving_moisture_percentage,
                     pb.start_date,
                     pb.estimated_completion_date,
                     pb.current_step,
                     pb.status,
                     pb.stage,
                     pb.sample_submission_id,
                     pb.receiving_checklist_id,
                     pb.production_finished_at,
                     pb.created_at,
                     pb.updated_at,
                     NULL::json AS yield_by_style,
                     NULL::json AS remaining_by_style
                 FROM public.production_batches pb
                 WHERE (p_batch_type IS NULL OR pb.batch_type = p_batch_type)
                   AND (p_status IS NULL OR pb.status = p_status)
                 ORDER BY pb.received_date DESC NULLS LAST, pb.batch_number
                 LIMIT p_limit
                 OFFSET p_offset
             ) t),
            '[]'::json
        )
    ) INTO v_result;
    RETURN v_result;
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM, 'data', '[]'::json);
END;
$function$;
