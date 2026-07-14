-- Archive UI: record who archived, list with restore hints, restore soft-archived batches.

-- ============================================================
-- 1. _archive_kernel_batch — set deactivated_by from audit actor
-- ============================================================
CREATE OR REPLACE FUNCTION public._archive_kernel_batch(
    p_kernel_id uuid,
    p_deactivation_type varchar
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row   RECORD;
    v_actor uuid;
BEGIN
    SELECT a.actor INTO v_actor
    FROM audit.current_actor() a
    LIMIT 1;

    SELECT
        k.id AS kernel_id,
        k.batch_id AS batch_uuid,
        b.batch_id AS batch_number,
        k.status,
        k.grower_name,
        k.supplier_id,
        k.received_date,
        k.wet_nis_received_kg,
        k.actual_wet_nis_kg,
        k.production_finished_at,
        k.packing_data,
        k.job_card_data,
        k.qa_data,
        k.intake_data,
        k.cracking_data,
        k.washing_data,
        k.sorting_data,
        k.dispatch_data,
        k.jobcard_approved,
        k.created_at,
        k.updated_at
    INTO v_row
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id
      AND b.batch_type = 'kernel';

    IF v_row.kernel_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.kernel_batch_archive (
        batch_number,
        batch_uuid,
        kernel_id,
        status,
        grower_name,
        supplier_id,
        received_date,
        deactivation_type,
        deactivated_by,
        snapshot
    )
    VALUES (
        v_row.batch_number,
        v_row.batch_uuid,
        v_row.kernel_id,
        v_row.status,
        v_row.grower_name,
        v_row.supplier_id,
        v_row.received_date,
        p_deactivation_type,
        v_actor,
        jsonb_build_object(
            'wet_nis_received_kg', v_row.wet_nis_received_kg,
            'actual_wet_nis_kg', v_row.actual_wet_nis_kg,
            'production_finished_at', v_row.production_finished_at,
            'jobcard_approved', v_row.jobcard_approved,
            'packing_data', v_row.packing_data,
            'job_card_data', v_row.job_card_data,
            'qa_data', v_row.qa_data,
            'intake_data', v_row.intake_data,
            'cracking_data', v_row.cracking_data,
            'washing_data', v_row.washing_data,
            'sorting_data', v_row.sorting_data,
            'dispatch_data', v_row.dispatch_data,
            'kernel_created_at', v_row.created_at,
            'kernel_updated_at', v_row.updated_at
        )
    );
END;
$$;

-- ============================================================
-- 2. get_kernel_batch_archive — list with actor name + restore hints
-- ============================================================
DROP FUNCTION IF EXISTS public.get_kernel_batch_archive(varchar, integer, integer);

CREATE OR REPLACE FUNCTION public.get_kernel_batch_archive(
    p_search varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_number varchar,
    batch_uuid uuid,
    kernel_id uuid,
    status varchar,
    grower_name varchar,
    supplier_id uuid,
    received_date date,
    deactivation_type varchar,
    deactivated_at timestamptz,
    deactivated_by uuid,
    deactivated_by_name text,
    can_restore boolean,
    number_in_use boolean,
    snapshot jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        a.id,
        a.batch_number,
        a.batch_uuid,
        a.kernel_id,
        a.status,
        a.grower_name,
        a.supplier_id,
        a.received_date,
        a.deactivation_type,
        a.deactivated_at,
        a.deactivated_by,
        COALESCE(
            NULLIF(trim(u.username), ''),
            NULLIF(trim(u.email), ''),
            'Unknown user'
        ) AS deactivated_by_name,
        (
            a.deactivation_type = 'soft_delete'
            AND EXISTS (
                SELECT 1 FROM public.kernel k
                WHERE k.id = a.kernel_id AND NOT k.is_active
            )
        ) AS can_restore,
        public.kernel_batch_number_in_use_active(a.batch_number) AS number_in_use,
        a.snapshot
    FROM public.kernel_batch_archive a
    LEFT JOIN public.users u ON u.id = a.deactivated_by
    WHERE (
        p_search IS NULL
        OR a.batch_number ILIKE '%' || p_search || '%'
        OR a.grower_name ILIKE '%' || p_search || '%'
        OR COALESCE(u.username, u.email, '') ILIKE '%' || p_search || '%'
    )
    ORDER BY a.deactivated_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_kernel_batch_archive(varchar, integer, integer) IS
    'Archived kernel batches with who archived, restore eligibility, and doppelganger hint.';

-- ============================================================
-- 3. restore_kernel_batch_from_archive
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_kernel_batch_from_archive(
    p_archive_id   uuid,
    p_batch_number varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_arch       RECORD;
    v_target_bn  varchar;
    v_rowcount   integer;
BEGIN
    IF p_archive_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Archive entry is required');
    END IF;

    SELECT
        a.id,
        a.batch_number,
        a.batch_uuid,
        a.kernel_id,
        a.deactivation_type,
        (
            a.deactivation_type = 'soft_delete'
            AND EXISTS (
                SELECT 1 FROM public.kernel k
                WHERE k.id = a.kernel_id AND NOT k.is_active
            )
        ) AS can_restore
    INTO v_arch
    FROM public.kernel_batch_archive a
    WHERE a.id = p_archive_id;

    IF v_arch.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Archive entry not found');
    END IF;

    IF NOT COALESCE(v_arch.can_restore, false) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'This batch cannot be restored (permanent delete or already active)'
        );
    END IF;

    v_target_bn := NULLIF(trim(COALESCE(p_batch_number, v_arch.batch_number, '')), '');
    IF v_target_bn IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    IF public.kernel_batch_number_in_use_active(v_target_bn) THEN
        RETURN jsonb_build_object(
            'success', false,
            'needs_new_number', true,
            'error', 'Batch number "' || v_target_bn || '" is already in use by an active batch. Enter a new batch number.'
        );
    END IF;

    UPDATE public.kernel
    SET is_active = true,
        updated_at = now()
    WHERE id = v_arch.kernel_id
      AND NOT is_active;

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;

    IF v_rowcount = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch is already active or missing');
    END IF;

    UPDATE public.batches
    SET
        is_active = true,
        batch_id = v_target_bn,
        updated_at = now()
    WHERE id = v_arch.batch_uuid
      AND batch_type = 'kernel';

    IF NOT FOUND THEN
        UPDATE public.kernel
        SET is_active = false,
            updated_at = now()
        WHERE id = v_arch.kernel_id;
        RETURN jsonb_build_object('success', false, 'error', 'Batch header not found');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'kernel_id', v_arch.kernel_id,
        'batch_number', v_target_bn,
        'reactivated', true
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object(
            'success', false,
            'needs_new_number', true,
            'error', 'That batch number is already in use. Enter a different batch number.'
        );
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.restore_kernel_batch_from_archive(uuid, varchar) IS
    'Reactivate a soft-archived kernel batch. Prompt for p_batch_number when the original number is taken.';

GRANT EXECUTE ON FUNCTION public.restore_kernel_batch_from_archive(uuid, varchar) TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY['restore_kernel_batch_from_archive'];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        FOR v_role_id IN SELECT id FROM public.roles LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
