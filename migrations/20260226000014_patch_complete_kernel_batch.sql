-- Migration: patch complete_kernel_batch — add status guard so only qa/complete batches can be released to stock.

CREATE OR REPLACE FUNCTION public.complete_kernel_batch(
    p_kernel_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status varchar;
BEGIN
    SELECT status INTO v_status
    FROM public.kernel
    WHERE id = p_kernel_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    IF v_status = 'complete' THEN
        RETURN jsonb_build_object('success', true, 'already_complete', true);
    END IF;

    IF v_status NOT IN ('qa') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch must be in QA status before releasing to stock (current status: ' || v_status || ')');
    END IF;

    UPDATE public.kernel
    SET status        = 'complete',
        updated_at    = NOW()
    WHERE id = p_kernel_id AND is_active = true;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- RBAC already granted from migration 20260226000002 — no new grant needed.
