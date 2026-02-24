-- Ensure get_production_batches returns actual_wet_nis_kg and wet_nis_weight_difference_kg
-- so the Grower Intake "Actual" column persists after page refresh (data comes from API).
-- Run this on the Supabase project your Lambda uses (SUPABASE_URL).

-- 1. Ensure columns exist
ALTER TABLE public.production_batches
  ADD COLUMN IF NOT EXISTS actual_wet_nis_kg numeric,
  ADD COLUMN IF NOT EXISTS wet_nis_weight_difference_kg numeric;

-- 2. Replace get_production_batches to include actual weight columns in the SELECT.
--    Matches derive_grower_name shape; add actual_wet_nis_kg and wet_nis_weight_difference_kg.
--    If your project lacks get_batch_yield_by_style / get_batch_remaining_by_style, replace those
--    two lines with: NULL::json AS yield_by_style, NULL::json AS remaining_by_style
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
                     COALESCE(pb.grower_name, c.company_name, c.trading_name, c.primary_contact_name) AS grower_name,
                     pb.wet_nis_received_kg,
                     pb.actual_wet_nis_kg,
                     pb.wet_nis_weight_difference_kg,
                     ss.wet_nut_in_shell_kg AS supplied_wet_kg,
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
                     public.get_batch_yield_by_style(pb.id) AS yield_by_style,
                     public.get_batch_remaining_by_style(pb.id, public.get_batch_yield_by_style(pb.id)) AS remaining_by_style
                 FROM public.production_batches pb
                 LEFT JOIN public.sample_submissions ss ON pb.sample_submission_id = ss.id
                 LEFT JOIN public.contacts c ON pb.supplier_id = c.id
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
