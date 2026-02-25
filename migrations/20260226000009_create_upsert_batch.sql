-- Migration: upsert_batch
-- Step 1 of the oil intake two-step save:
--   1. upsert_batch  → creates/returns a row in batches, returns { success, id, batch_id }
--   2. upsert_oil_batch → creates the oil row linked to that batch
--
-- Also called by kernel when creating a new batch via create_kernel_batch.

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
    -- ── UPDATE path: batch_id provided and already exists ────────────────
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
        -- batch_id provided but doesn't exist yet → use it for the INSERT
        v_batch_id_out := p_batch_id;
    END IF;

    -- ── CREATE path: auto-generate batch_id if not supplied ──────────────
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
        -- Race condition: batch_id was generated but inserted by a concurrent request
        SELECT id INTO v_batch_uuid FROM public.batches WHERE batch_id = v_batch_id_out;
        RETURN jsonb_build_object('success', true, 'id', v_batch_uuid, 'batch_id', v_batch_id_out);
END;
$$;

-- ── RBAC ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_role_id integer;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'upsert_batch', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
