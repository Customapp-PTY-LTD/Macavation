-- Remove physical silo occupancy feature (public.silo, assignment RPCs, kernel.silos).
-- Cracking process field silo1 / "Silo Qty" in production stages is unrelated and kept.

-- 1. release_kernel_to_production — drop optional p_silos overload, recreate kernel_id-only
DROP FUNCTION IF EXISTS public.release_kernel_to_production(uuid, integer[]);
DROP FUNCTION IF EXISTS public.release_kernel_to_production(uuid);

CREATE OR REPLACE FUNCTION public.release_kernel_to_production(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_has_ziplock boolean;
    v_has_5kg     boolean;
    v_status      varchar;
BEGIN
    SELECT
        (intake_data #>> '{ziplock_sample,completed_at}') IS NOT NULL,
        (intake_data #>> '{five_kg_sample,completed_at}') IS NOT NULL,
        status
    INTO v_has_ziplock, v_has_5kg, v_status
    FROM public.kernel
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;

    IF NOT v_has_ziplock THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ziplock sample not completed — save it before releasing.');
    END IF;

    IF NOT v_has_5kg THEN
        RETURN jsonb_build_object('success', false, 'error', '5kg sample not completed — save it before releasing.');
    END IF;

    IF v_status NOT IN ('intake', 'receiving') THEN
        RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'already_released', true);
    END IF;

    UPDATE public.kernel
    SET status     = 'production',
        updated_at = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'release_kernel_to_production', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

-- 2. delete_kernel_batch_permanent — stop clearing silo rows (table is being dropped)
CREATE OR REPLACE FUNCTION public.delete_kernel_batch_permanent(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id uuid;
    v_bn       text;
    r          RECORD;
    v_new_lines jsonb;
    v_deleted  integer;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel id is required');
    END IF;

    SELECT k.batch_id, b.batch_id
    INTO v_batch_id, v_bn
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id;

    IF v_batch_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.batches WHERE id = v_batch_id AND batch_type = 'kernel') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not a kernel batch');
    END IF;

    PERFORM public._archive_kernel_batch(p_kernel_id, 'permanent_delete');

    FOR r IN
        SELECT o.id, o.lines
        FROM public.kernel_dispatch_orders o
        WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS e
            WHERE NULLIF(trim(e ->> 'kernel_id'), '') = p_kernel_id::text
        )
    LOOP
        SELECT COALESCE(
            (SELECT jsonb_agg(e)
             FROM jsonb_array_elements(COALESCE(r.lines, '[]'::jsonb)) AS e
             WHERE NULLIF(trim(e ->> 'kernel_id'), '') IS NULL
                OR NULLIF(trim(e ->> 'kernel_id'), '') <> p_kernel_id::text),
            '[]'::jsonb
        )
        INTO v_new_lines;

        IF v_new_lines IS NULL
           OR v_new_lines = '[]'::jsonb
           OR jsonb_array_length(v_new_lines) = 0
        THEN
            DELETE FROM public.kernel_dispatch_orders WHERE id = r.id;
        ELSE
            UPDATE public.kernel_dispatch_orders
            SET lines = v_new_lines, updated_at = NOW()
            WHERE id = r.id;
        END IF;
    END LOOP;

    DELETE FROM public.batches
    WHERE id = v_batch_id AND batch_type = 'kernel';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch could not be deleted');
    END IF;

    RETURN jsonb_build_object('success', true, 'batch_number', v_bn);
END;
$$;

COMMENT ON FUNCTION public.delete_kernel_batch_permanent(uuid) IS
    'Hard delete: archives batch, removes kernel batch header (batches + kernel CASCADE), strips dispatch lines. Irreversible.';

-- 3. Drop silo RPCs and permissions
DELETE FROM public.role_permissions
WHERE object_type = 'function'
  AND object_name IN ('get_silos', 'set_silo_empty', 'assign_kernel_to_silos');

DROP FUNCTION IF EXISTS public.assign_kernel_to_silos(uuid, integer[]);
DROP FUNCTION IF EXISTS public.get_silos();
DROP FUNCTION IF EXISTS public.set_silo_empty(integer);

-- 4. Drop schema objects
ALTER TABLE public.kernel DROP COLUMN IF EXISTS silos;
ALTER TABLE public.oil DROP COLUMN IF EXISTS silos;
DROP TABLE IF EXISTS public.silo;

NOTIFY pgrst, 'reload schema';
