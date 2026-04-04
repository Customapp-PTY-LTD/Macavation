-- Job card shortcut: mark batch release-ready without production stages or end-sample modal.
-- When p_finalize_without_production = true (with normal job card save): sets production_finished_at,
-- status → qa (unless complete/dispatch), seeds empty qa_data with audit flag so has_qa is true.

DROP FUNCTION IF EXISTS public.upsert_kernel_job_card(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.upsert_kernel_job_card(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.upsert_kernel_job_card(
    p_kernel_id                     uuid,
    p_job_card_data                 jsonb,
    p_jobcard_approved              boolean DEFAULT NULL,
    p_finalize_without_production   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel
    SET
        job_card_data = p_job_card_data,
        jobcard_approved = CASE
            WHEN p_jobcard_approved IS TRUE THEN true
            WHEN p_finalize_without_production IS TRUE THEN true
            ELSE jobcard_approved
        END,
        production_finished_at = CASE
            WHEN p_finalize_without_production IS TRUE THEN COALESCE(production_finished_at, NOW())
            ELSE production_finished_at
        END,
        status = CASE
            WHEN p_finalize_without_production IS TRUE
                 AND COALESCE(status::text, '') NOT IN ('complete', 'dispatch', 'qa')
                THEN 'qa'::varchar
            ELSE status
        END,
        qa_data = CASE
            WHEN p_finalize_without_production IS TRUE
                 AND (qa_data IS NULL OR qa_data = '{}'::jsonb OR qa_data = 'null'::jsonb)
                THEN jsonb_build_object(
                    'job_card_only_release_ready', true,
                    'recorded_at', to_jsonb(NOW())
                )
            ELSE qa_data
        END,
        updated_at = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'finalized_without_production', COALESCE(p_finalize_without_production, false)
    );
END;
$$;

COMMENT ON FUNCTION public.upsert_kernel_job_card(uuid, jsonb, boolean, boolean) IS
  'Saves job_card_data; optional p_jobcard_approved sets jobcard_approved. p_finalize_without_production marks production finished, moves to qa, seeds qa_data if empty (job-card-only release path).';

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT id AS role_id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (r.role_id, 'function', 'upsert_kernel_job_card', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
