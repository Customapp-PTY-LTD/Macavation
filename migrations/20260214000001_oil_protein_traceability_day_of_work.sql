-- Oil & Protein traceability: produce (batch) → day of work (oil_production_sheets) → oil containers (oil_stock_lots)
-- Traceability: container → production_sheet (day) → batches used that day (supplier_intake_batches where production_day_id = sheet.id)

-- 1. Link supplier intake batches to the production day they were used in
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'supplier_intake_batches_production_day_id_fkey'
    ) THEN
        ALTER TABLE public.supplier_intake_batches
            ADD CONSTRAINT supplier_intake_batches_production_day_id_fkey
            FOREIGN KEY (production_day_id) REFERENCES public.oil_production_sheets(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_intake_batches_production_day ON public.supplier_intake_batches(production_day_id);

-- 2. Function: link an intake batch to a production day (and mark as added_to_production)
CREATE OR REPLACE FUNCTION public.update_supplier_intake_batch_production_day(
    p_batch_id uuid,
    p_production_sheet_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_batch_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Batch ID is required');
    END IF;
    IF p_production_sheet_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Production sheet (day of work) ID is required');
    END IF;

    UPDATE public.supplier_intake_batches
    SET production_day_id = p_production_sheet_id,
        status = 'added_to_production',
        updated_at = now()
    WHERE id = p_batch_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Supplier intake batch not found');
    END IF;

    RETURN json_build_object('success', true, 'id', p_batch_id, 'message', 'Batch linked to production day');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed: ' || SQLERRM);
END;
$$;

-- 3. If oil_stock_lots exists, add link to production day for containers produced
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oil_stock_lots') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'oil_stock_lots' AND column_name = 'oil_production_sheet_id') THEN
            ALTER TABLE public.oil_stock_lots
                ADD COLUMN oil_production_sheet_id uuid NULL REFERENCES public.oil_production_sheets(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_oil_stock_lots_production_sheet ON public.oil_stock_lots(oil_production_sheet_id);
        END IF;
    END IF;
END $$;

-- 4. Get supplier intake batches linked to a production day (traceability)
CREATE OR REPLACE FUNCTION public.get_supplier_intake_batches_by_production_day(p_production_sheet_id uuid)
RETURNS TABLE (
    id uuid,
    product_type varchar,
    date_received date,
    batch_number varchar,
    quantity_kg numeric,
    status varchar,
    production_day_id uuid,
    supplier_id uuid,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.product_type,
        b.date_received,
        b.batch_number,
        b.quantity_kg,
        b.status,
        b.production_day_id,
        b.supplier_id,
        b.created_at
    FROM public.supplier_intake_batches b
    WHERE b.production_day_id = p_production_sheet_id
    ORDER BY b.product_type, b.batch_number;
END;
$$;

-- RBAC
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_supplier_intake_batch_production_day', 'EXECUTE', true
FROM public.roles r WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_supplier_intake_batches_by_production_day', 'EXECUTE', true
FROM public.roles r WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT DO NOTHING;
