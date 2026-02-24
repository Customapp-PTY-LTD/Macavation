-- Independent save per tab (ziplock vs 5kg) and "sample step complete" only when both are done.
-- 1. Add completion timestamps and 5kg columns to sample_submissions

ALTER TABLE public.sample_submissions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ziplock_completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS sample_5kg_completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS crack_out_sound_kernel_g numeric NULL,
  ADD COLUMN IF NOT EXISTS crack_out_unsound_kernel_g numeric NULL,
  ADD COLUMN IF NOT EXISTS crack_out_shell_g numeric NULL,
  ADD COLUMN IF NOT EXISTS float_floating_g numeric NULL,
  ADD COLUMN IF NOT EXISTS float_sinking_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_germination_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_late_stinkbug_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_early_stinkbug_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_dark_centre_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_mould_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_rotten_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_immature_split_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_shrivelled_g numeric NULL,
  ADD COLUMN IF NOT EXISTS unsound_nut_borer_g numeric NULL;

-- 2. create_sample_submission_for_batch: create or update by sample_type (ziplock | 5kg)
--    Ziplock save: create/update row with ziplock data, set ziplock_completed_at.
--    5kg save: create/update row with 5kg data, set sample_5kg_completed_at.
CREATE OR REPLACE FUNCTION public.create_sample_submission_for_batch(
    p_batch_id uuid,
    p_moisture_required boolean DEFAULT false,
    p_moisture_result numeric DEFAULT NULL,
    p_peroxide_required boolean DEFAULT false,
    p_peroxide_result numeric DEFAULT NULL,
    p_ffa_required boolean DEFAULT false,
    p_ffa_result numeric DEFAULT NULL,
    p_wet_nut_in_shell_kg numeric DEFAULT 0,
    p_sample_type varchar DEFAULT NULL,
    p_supplier varchar DEFAULT NULL,
    p_supplier_code varchar DEFAULT NULL,
    p_delivery_date date DEFAULT NULL,
    p_job_number varchar DEFAULT NULL,
    p_moisture_content numeric DEFAULT NULL,
    p_crack_out_sound_kernel_g numeric DEFAULT NULL,
    p_crack_out_unsound_kernel_g numeric DEFAULT NULL,
    p_crack_out_shell_g numeric DEFAULT NULL,
    p_float_floating_g numeric DEFAULT NULL,
    p_float_sinking_g numeric DEFAULT NULL,
    p_unsound_germination_g numeric DEFAULT NULL,
    p_unsound_late_stinkbug_g numeric DEFAULT NULL,
    p_unsound_early_stinkbug_g numeric DEFAULT NULL,
    p_unsound_dark_centre_g numeric DEFAULT NULL,
    p_unsound_mould_g numeric DEFAULT NULL,
    p_unsound_rotten_g numeric DEFAULT NULL,
    p_unsound_immature_split_g numeric DEFAULT NULL,
    p_unsound_shrivelled_g numeric DEFAULT NULL,
    p_unsound_nut_borer_g numeric DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch record;
    v_submission_number varchar(50);
    v_id uuid;
    v_existing_id uuid;
    v_is_5kg boolean;
BEGIN
    IF p_batch_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Batch id is required');
    END IF;

    v_is_5kg := (NULLIF(trim(lower(COALESCE(p_sample_type, ''))), '') = '5kg');

    SELECT id, batch_number, grower_name, received_date, supplier_id, sample_submission_id
    INTO v_batch
    FROM production_batches
    WHERE id = p_batch_id;

    IF v_batch.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Batch not found');
    END IF;

    v_existing_id := v_batch.sample_submission_id;

    IF v_existing_id IS NOT NULL THEN
        -- Update existing submission for this batch
        IF v_is_5kg THEN
            UPDATE sample_submissions SET
                wet_nut_in_shell_kg = COALESCE(p_wet_nut_in_shell_kg, wet_nut_in_shell_kg, 0),
                moisture_content_percentage = COALESCE(p_moisture_content, moisture_content_percentage, 0),
                grower_name = COALESCE(NULLIF(trim(p_supplier), ''), grower_name),
                delivery_date = COALESCE(p_delivery_date, delivery_date),
                crack_out_sound_kernel_g = COALESCE(p_crack_out_sound_kernel_g, crack_out_sound_kernel_g),
                crack_out_unsound_kernel_g = COALESCE(p_crack_out_unsound_kernel_g, crack_out_unsound_kernel_g),
                crack_out_shell_g = COALESCE(p_crack_out_shell_g, crack_out_shell_g),
                float_floating_g = COALESCE(p_float_floating_g, float_floating_g),
                float_sinking_g = COALESCE(p_float_sinking_g, float_sinking_g),
                unsound_germination_g = COALESCE(p_unsound_germination_g, unsound_germination_g),
                unsound_late_stinkbug_g = COALESCE(p_unsound_late_stinkbug_g, unsound_late_stinkbug_g),
                unsound_early_stinkbug_g = COALESCE(p_unsound_early_stinkbug_g, unsound_early_stinkbug_g),
                unsound_dark_centre_g = COALESCE(p_unsound_dark_centre_g, unsound_dark_centre_g),
                unsound_mould_g = COALESCE(p_unsound_mould_g, unsound_mould_g),
                unsound_rotten_g = COALESCE(p_unsound_rotten_g, unsound_rotten_g),
                unsound_immature_split_g = COALESCE(p_unsound_immature_split_g, unsound_immature_split_g),
                unsound_shrivelled_g = COALESCE(p_unsound_shrivelled_g, unsound_shrivelled_g),
                unsound_nut_borer_g = COALESCE(p_unsound_nut_borer_g, unsound_nut_borer_g),
                sample_5kg_completed_at = now(),
                updated_at = now()
            WHERE id = v_existing_id;
            v_id := v_existing_id;
        ELSE
            UPDATE sample_submissions SET
                moisture_content_percentage = COALESCE(p_moisture_result, p_moisture_content, moisture_content_percentage, 0),
                ffa_percentage = COALESCE(p_ffa_result, ffa_percentage, 0),
                peroxide_value = COALESCE(p_peroxide_result, peroxide_value, 0),
                ziplock_completed_at = now(),
                updated_at = now()
            WHERE id = v_existing_id;
            v_id := v_existing_id;
        END IF;
        RETURN json_build_object('success', true, 'id', v_id, 'updated', true);
    END IF;

    -- Create new submission
    v_submission_number := 'SMP-' || COALESCE(v_batch.batch_number, 'BATCH') || '-' || to_char(now(), 'YYYYMMDD-HH24MISS');
    IF EXISTS (SELECT 1 FROM sample_submissions WHERE submission_number = v_submission_number) THEN
        v_submission_number := v_submission_number || '-' || substr(gen_random_uuid()::text, 1, 4);
    END IF;

    INSERT INTO sample_submissions (
        submission_number,
        supplier_id,
        grower_name,
        delivery_date,
        batch_number,
        wet_nut_in_shell_kg,
        moisture_content_percentage,
        ffa_percentage,
        peroxide_value,
        status,
        ziplock_completed_at,
        sample_5kg_completed_at,
        crack_out_sound_kernel_g,
        crack_out_unsound_kernel_g,
        crack_out_shell_g,
        float_floating_g,
        float_sinking_g,
        unsound_germination_g,
        unsound_late_stinkbug_g,
        unsound_early_stinkbug_g,
        unsound_dark_centre_g,
        unsound_mould_g,
        unsound_rotten_g,
        unsound_immature_split_g,
        unsound_shrivelled_g,
        unsound_nut_borer_g
    )
    VALUES (
        v_submission_number,
        v_batch.supplier_id,
        COALESCE(NULLIF(trim(v_batch.grower_name), ''), NULLIF(trim(p_supplier), ''), 'Unknown'),
        COALESCE(p_delivery_date, v_batch.received_date),
        v_batch.batch_number,
        COALESCE(p_wet_nut_in_shell_kg, 0),
        COALESCE(p_moisture_result, p_moisture_content, 0),
        COALESCE(p_ffa_result, 0),
        COALESCE(p_peroxide_result, 0),
        'pending',
        CASE WHEN NOT v_is_5kg THEN now() ELSE NULL END,
        CASE WHEN v_is_5kg THEN now() ELSE NULL END,
        p_crack_out_sound_kernel_g,
        p_crack_out_unsound_kernel_g,
        p_crack_out_shell_g,
        p_float_floating_g,
        p_float_sinking_g,
        p_unsound_germination_g,
        p_unsound_late_stinkbug_g,
        p_unsound_early_stinkbug_g,
        p_unsound_dark_centre_g,
        p_unsound_mould_g,
        p_unsound_rotten_g,
        p_unsound_immature_split_g,
        p_unsound_shrivelled_g,
        p_unsound_nut_borer_g
    )
    RETURNING id INTO v_id;

    UPDATE production_batches
    SET sample_submission_id = v_id, updated_at = now()
    WHERE id = p_batch_id;

    RETURN json_build_object('success', true, 'id', v_id, 'submission_number', v_submission_number);
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 3. get_production_batches: return sample_ziplock_done and sample_5kg_done
--    (so UI can show "sample step complete" only when both are true)
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
                     (ss.ziplock_completed_at IS NOT NULL) AS sample_ziplock_done,
                     (ss.sample_5kg_completed_at IS NOT NULL) AS sample_5kg_done,
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
