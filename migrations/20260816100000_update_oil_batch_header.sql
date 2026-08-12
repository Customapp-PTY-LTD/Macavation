-- update_oil_batch_header — edit an oil batch's header details from "Find a batch".
--
-- WHY A NEW FUNCTION rather than extending upsert_oil_batch: that function's UPDATE path
-- deliberately never writes batch_id (p_batch_id is consulted only on the CREATE path, where it
-- seeds the generated 'OIL-YYYY-MM-NNN' number). Several existing callers in
-- WebPortal/js/data-functions.js pass p_batch_id alongside p_oil_id on update; today that value
-- is ignored, so teaching upsert_oil_batch to honour it would silently start RENAMING batches
-- from call sites that never intended it. A separate, narrowly-scoped function leaves every
-- existing path byte-for-byte unchanged.
--
-- This is the oil counterpart to update_kernel_stock_batch_info and covers the same idea: header
-- details only. Production-stage data (intake_data, production_data, stock_data, dispatch_data)
-- and status are NOT editable here — status drives the pipeline routing in
-- WebPortal/js/batch-status.js, and the stage blobs belong to their own modules.
--
-- NULL semantics follow upsert_oil_batch's existing COALESCE convention for this table: a NULL
-- optional parameter means LEAVE UNCHANGED, not "clear". Only p_batch_id is required.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260816100000_update_oil_batch_header.sql

CREATE OR REPLACE FUNCTION public.update_oil_batch_header(
    p_oil_id          uuid,
    p_batch_id        character varying,
    p_production_date date DEFAULT NULL,
    p_total_oil_litre numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id varchar := NULLIF(trim(COALESCE(p_batch_id, '')), '');
    v_id       uuid;
BEGIN
    IF p_oil_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil batch is required');
    END IF;

    IF v_batch_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    IF p_total_oil_litre IS NOT NULL AND p_total_oil_litre < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Total oil (L) cannot be negative');
    END IF;

    -- Checked explicitly rather than leaning on the unique_violation handler so the message names
    -- the clash, and so a rename onto a DEACTIVATED batch's number is still reported clearly.
    IF EXISTS (
        SELECT 1 FROM public.oil o
        WHERE lower(trim(o.batch_id)) = lower(v_batch_id)
          AND o.id <> p_oil_id
    ) THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Batch number ' || v_batch_id || ' is already used by another oil batch');
    END IF;

    UPDATE public.oil
       SET batch_id        = v_batch_id,
           production_date = COALESCE(p_production_date, production_date),
           total_oil_litre = COALESCE(p_total_oil_litre, total_oil_litre),
           updated_at      = now()
     WHERE id = p_oil_id
       AND is_active = true
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil batch not found');
    END IF;

    RETURN jsonb_build_object('success', true, 'id', v_id, 'batch_id', v_batch_id);

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false,
            'error', 'Batch number ' || v_batch_id || ' is already in use');
END;
$$;

COMMENT ON FUNCTION public.update_oil_batch_header(uuid, character varying, date, numeric) IS
    'Edits an oil batch''s header details (batch number, production date, total oil litres) from '
    'Find a batch. Oil counterpart to update_kernel_stock_batch_info. Does not touch status or any '
    'production-stage jsonb. NULL optional parameters mean leave unchanged.';

GRANT EXECUTE ON FUNCTION public.update_oil_batch_header(uuid, character varying, date, numeric) TO anon, authenticated, service_role;

-- RBAC: the portal-facing write layer. roles.id is uuid on both dev and prod; the loop below is
-- type-agnostic so it runs unchanged on either.
DO $$
DECLARE
    v_role record;
BEGIN
    FOR v_role IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role.id, 'function', 'update_oil_batch_header', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
