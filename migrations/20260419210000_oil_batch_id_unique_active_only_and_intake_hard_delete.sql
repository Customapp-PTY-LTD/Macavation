-- 1) Allow reusing batch_id after a supplier-intake row is removed: uniqueness only among active oil rows.
-- 2) Supplier intake remove: hard DELETE when safe (no oil_bin_batch link); no dead row left for batch_id.

-- Drop table-level UNIQUE on batch_id (replaced by partial unique index).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'oil'
          AND c.contype = 'u'
          AND pg_get_constraintdef(c.oid) LIKE '%batch_id%'
    LOOP
        EXECUTE format('ALTER TABLE public.oil DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
END $$;

DROP INDEX IF EXISTS public.idx_oil_batch_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_oil_batch_id_unique_active
    ON public.oil (batch_id)
    WHERE (is_active IS TRUE);

CREATE INDEX IF NOT EXISTS idx_oil_batch_id_lookup
    ON public.oil (batch_id);

CREATE OR REPLACE FUNCTION public.deactivate_supplier_intake_oil_batch(p_oil_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT o.status::text INTO v_status
    FROM public.oil o
    WHERE o.id = p_oil_id;

    IF v_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch not found');
    END IF;

    IF v_status NOT IN ('awaiting_test', 'release_ready', 'intake') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Only supplier intake batches (awaiting tests or ready for oil production) can be removed. Batches already in production must be handled in Oil Production.'
        );
    END IF;

    IF EXISTS (SELECT 1 FROM public.oil_bin_batch obb WHERE obb.oil_id = p_oil_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'This batch is linked to oil production (oil bin batch). It cannot be removed from Supplier Intake.'
        );
    END IF;

    DELETE FROM public.oil WHERE id = p_oil_id;

    RETURN jsonb_build_object('success', true, 'id', p_oil_id);
END;
$$;

COMMENT ON FUNCTION public.deactivate_supplier_intake_oil_batch(uuid) IS
    'Removes a supplier intake oil row by DELETE when status is intake/awaiting_test/release_ready and no oil_bin_batch references it. Reuse of batch_id is allowed after removal (partial unique on active rows only).';

NOTIFY pgrst, 'reload schema';
