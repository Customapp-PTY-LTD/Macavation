-- Migration: get_kernel_production_history
-- History-specific read: leaner than get_kernel_batch_detail (no dispatch_data, no stock fields).
-- Used by: modal_batch_history only.

CREATE OR REPLACE FUNCTION public.get_kernel_production_history(
    p_kernel_id uuid
)
RETURNS TABLE (
    id                      uuid,
    batch_number            varchar,
    grower_name             varchar,
    status                  varchar,
    received_date           date,
    production_finished_at  timestamptz,
    intake_data             jsonb,
    cracking_data           jsonb,
    washing_data            jsonb,
    sorting_data            jsonb,
    packing_data            jsonb,
    job_card_data           jsonb,
    qa_data                 jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id,
        b.batch_id                                          AS batch_number,
        k.grower_name,
        k.status::varchar,
        k.received_date,
        k.production_finished_at,
        k.intake_data,
        COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb) AS cracking_data,
        COALESCE(NULLIF(k.washing_data,  'null'::jsonb), '[]'::jsonb) AS washing_data,
        COALESCE(NULLIF(k.sorting_data,  'null'::jsonb), '[]'::jsonb) AS sorting_data,
        COALESCE(NULLIF(k.packing_data,  'null'::jsonb), '[]'::jsonb) AS packing_data,
        COALESCE(k.job_card_data,  '{}'::jsonb)            AS job_card_data,
        COALESCE(k.qa_data,        '{}'::jsonb)            AS qa_data
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id
      AND k.is_active = true;
END;
$$;

-- RBAC
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_kernel_production_history', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
