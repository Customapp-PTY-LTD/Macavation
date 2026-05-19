-- Lightweight map for portal when get_kernel_batches proxy omits has_jobcard_approved.

CREATE OR REPLACE FUNCTION public.get_kernel_jobcard_approval_map(p_kernel_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        jsonb_object_agg(id::text, COALESCE(jobcard_approved, false)),
        '{}'::jsonb
    )
    FROM public.kernel
    WHERE is_active = true
      AND (p_kernel_ids IS NULL OR id = ANY(p_kernel_ids));
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_jobcard_approval_map(uuid[]) TO PUBLIC;

NOTIFY pgrst, 'reload schema';
