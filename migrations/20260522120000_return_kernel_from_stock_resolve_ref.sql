-- Send back to production: resolve kernel by kernel.id, batches.id (batch_id FK), or batch_number.
-- Reactivates inactive kernel rows when sending back from stock (test / legacy batches).

DROP FUNCTION IF EXISTS public.return_kernel_from_stock_to_production(uuid);

CREATE OR REPLACE FUNCTION public.return_kernel_from_stock_to_production(
    p_kernel_id     uuid DEFAULT NULL,
    p_batch_number  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_kernel_id uuid;
    v_status    varchar;
    v_was_inactive boolean := false;
    v_ref       text;
BEGIN
    v_ref := NULLIF(btrim(p_batch_number), '');

    IF p_kernel_id IS NOT NULL THEN
        SELECT k.id, NOT k.is_active
        INTO v_kernel_id, v_was_inactive
        FROM public.kernel k
        WHERE (k.id = p_kernel_id OR k.batch_id = p_kernel_id)
        ORDER BY k.is_active DESC, CASE WHEN k.id = p_kernel_id THEN 0 ELSE 1 END
        LIMIT 1;
    END IF;

    IF v_kernel_id IS NULL AND v_ref IS NOT NULL THEN
        SELECT k.id, NOT k.is_active
        INTO v_kernel_id, v_was_inactive
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE b.batch_id = v_ref
        ORDER BY k.is_active DESC, k.updated_at DESC NULLS LAST
        LIMIT 1;
    END IF;

    IF v_kernel_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Kernel batch not found. Refresh Stock (Kernel) and try again.'
        );
    END IF;

    IF v_was_inactive THEN
        UPDATE public.kernel SET is_active = true, updated_at = NOW() WHERE id = v_kernel_id;
    END IF;

    SELECT status::varchar INTO v_status FROM public.kernel WHERE id = v_kernel_id;

    IF v_status IN ('qa', 'production') THEN
        RETURN jsonb_build_object(
            'success', true,
            'kernel_id', v_kernel_id,
            'status', v_status,
            'already_in_production', true,
            'reactivated', v_was_inactive
        );
    END IF;

    IF v_status NOT IN ('complete', 'in_finished_stock') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Batch must be in finished stock (complete) to send back to production (current status: '
                || COALESCE(v_status, '?') || ')'
        );
    END IF;

    UPDATE public.kernel
    SET
        status = 'qa',
        jobcard_approved = false,
        is_active = true,
        updated_at = NOW()
    WHERE id = v_kernel_id;

    RETURN jsonb_build_object(
        'success', true,
        'kernel_id', v_kernel_id,
        'status', 'qa',
        'reactivated', v_was_inactive
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.return_kernel_from_stock_to_production(uuid, text) TO authenticated, service_role, anon;

NOTIFY pgrst, 'reload schema';
