-- Migration: 20260226000010 — upsert_batch + initialize_kernel_for_batch
-- Applies upsert_batch to the DB (previously local-only in 20260226000009) and
-- adds initialize_kernel_for_batch for creating a kernel row for a given batch UUID.
-- RBAC: both functions granted EXECUTE to all roles (roles.id is UUID).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. upsert_batch
--    Creates or returns a batch row in the batches table.
--    Pass no p_batch_id to auto-generate: KERNEL-YYYY-MM-NNN / OIL-YYYY-MM-NNN.
--    Pass p_batch_id to update is_active on an existing row (or create with that id).
--    Returns: { success, id (uuid), batch_id (varchar) }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_batch(
    p_batch_id   varchar DEFAULT NULL,
    p_batch_type varchar DEFAULT 'oil',
    p_is_active  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_uuid   uuid;
    v_batch_id_out varchar;
    v_today        date := CURRENT_DATE;
BEGIN
    -- ── UPDATE path: human-readable batch_id provided and already exists ─────
    IF p_batch_id IS NOT NULL THEN
        SELECT id INTO v_batch_uuid
        FROM public.batches
        WHERE batch_id = p_batch_id;

        IF v_batch_uuid IS NOT NULL THEN
            UPDATE public.batches
            SET is_active  = p_is_active,
                updated_at = NOW()
            WHERE id = v_batch_uuid;
            RETURN jsonb_build_object('success', true, 'id', v_batch_uuid, 'batch_id', p_batch_id);
        END IF;
        -- batch_id provided but not yet in table → use it for INSERT
        v_batch_id_out := p_batch_id;
    END IF;

    -- ── CREATE path: auto-generate batch_id ─────────────────────────────────
    IF v_batch_id_out IS NULL THEN
        v_batch_id_out :=
            upper(p_batch_type) || '-' ||
            to_char(v_today, 'YYYY-MM') || '-' ||
            lpad(
                (1 + COALESCE(
                    (SELECT COUNT(*) FROM public.batches
                     WHERE batch_id LIKE upper(p_batch_type) || '-' || to_char(v_today, 'YYYY-MM') || '-%'),
                    0
                ))::text,
                3, '0'
            );
    END IF;

    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (v_batch_id_out, COALESCE(p_batch_type, 'oil'), p_is_active)
    RETURNING id INTO v_batch_uuid;

    RETURN jsonb_build_object('success', true, 'id', v_batch_uuid, 'batch_id', v_batch_id_out);

EXCEPTION
    WHEN unique_violation THEN
        -- Race condition: concurrent insert used the same generated batch_id
        SELECT id INTO v_batch_uuid FROM public.batches WHERE batch_id = v_batch_id_out;
        RETURN jsonb_build_object('success', true, 'id', v_batch_uuid, 'batch_id', v_batch_id_out);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. initialize_kernel_for_batch
--    Creates a kernel row (status='intake') linked to a batch UUID.
--    Idempotent: if a kernel row already exists for this batch, returns it.
--    Returns: { success, id (kernel uuid), batch_uuid, existing (bool) }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.initialize_kernel_for_batch(
    p_batch_uuid          uuid,
    p_supplier_id         uuid    DEFAULT NULL,
    p_grower_name         varchar DEFAULT NULL,
    p_received_date       date    DEFAULT NULL,
    p_wet_nis_received_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_kernel_id uuid;
BEGIN
    -- Return existing kernel if already initialized for this batch
    SELECT id INTO v_kernel_id
    FROM public.kernel
    WHERE batch_id = p_batch_uuid AND is_active = true
    LIMIT 1;

    IF v_kernel_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success',    true,
            'id',         v_kernel_id,
            'batch_uuid', p_batch_uuid,
            'existing',   true
        );
    END IF;

    INSERT INTO public.kernel (
        batch_id,
        supplier_id,
        grower_name,
        status,
        received_date,
        wet_nis_received_kg,
        is_active
    )
    VALUES (
        p_batch_uuid,
        p_supplier_id,
        p_grower_name,
        'intake',
        COALESCE(p_received_date, CURRENT_DATE),
        p_wet_nis_received_kg,
        true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object(
        'success',    true,
        'id',         v_kernel_id,
        'batch_uuid', p_batch_uuid,
        'existing',   false
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC: grant EXECUTE on both functions to every role
-- Note: roles.id is UUID — do NOT use integer here
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_role_id uuid;
    v_fn      varchar;
    v_fns     varchar[] := ARRAY['upsert_batch', 'initialize_kernel_for_batch'];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
