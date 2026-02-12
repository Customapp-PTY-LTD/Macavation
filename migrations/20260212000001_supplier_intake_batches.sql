-- Oil & Protein Supplier Intake: batches of product (oil kernel, cracker dust, kernel dust, crush, cake)
-- Batches sit in supplier intake until added to a production day.

CREATE TABLE IF NOT EXISTS public.supplier_intake_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_type varchar(50) NOT NULL CHECK (product_type IN ('oil_kernel', 'cracker_dust', 'kernel_dust', 'crush', 'cake')),
    date_received date NOT NULL,
    delivery_note_ref varchar(200) NULL,
    supplier_id uuid NULL REFERENCES public.contacts(id),
    supplier_details text NULL,

    vehicle_clean varchar(10) NULL CHECK (vehicle_clean IN ('Yes', 'No')),
    vehicle_enclosed varchar(10) NULL CHECK (vehicle_enclosed IN ('Yes', 'No')),
    hazard_substances varchar(10) NULL CHECK (hazard_substances IN ('Yes', 'No')),
    pest_infestations varchar(10) NULL CHECK (pest_infestations IN ('Yes', 'No')),
    pallets_condition varchar(10) NULL CHECK (pallets_condition IN ('Yes', 'No')),
    raw_materials_condition varchar(10) NULL CHECK (raw_materials_condition IN ('Yes', 'No')),
    receiving_comments text NULL,

    reference varchar(200) NULL,
    description text NULL,
    batch_number varchar(100) NULL,
    carton_bulk_bags integer NULL DEFAULT 1,
    quantity_kg numeric(12,2) NULL,
    manufactured_date date NULL,
    best_before_date date NULL,

    status varchar(30) NOT NULL DEFAULT 'supplier_intake' CHECK (status IN ('supplier_intake', 'added_to_production')),
    production_day_id uuid NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_intake_batches_status ON public.supplier_intake_batches(status);
CREATE INDEX IF NOT EXISTS idx_supplier_intake_batches_date ON public.supplier_intake_batches(date_received);
CREATE INDEX IF NOT EXISTS idx_supplier_intake_batches_product ON public.supplier_intake_batches(product_type);

-- Get supplier intake batches (filter by status)
CREATE OR REPLACE FUNCTION public.get_supplier_intake_batches(p_status text DEFAULT 'supplier_intake')
RETURNS TABLE (
    id uuid,
    product_type varchar,
    date_received date,
    delivery_note_ref varchar,
    supplier_id uuid,
    supplier_details text,
    vehicle_clean varchar,
    vehicle_enclosed varchar,
    hazard_substances varchar,
    pest_infestations varchar,
    pallets_condition varchar,
    raw_materials_condition varchar,
    receiving_comments text,
    reference varchar,
    description text,
    batch_number varchar,
    carton_bulk_bags integer,
    quantity_kg numeric,
    manufactured_date date,
    best_before_date date,
    status varchar,
    production_day_id uuid,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.product_type,
        b.date_received,
        b.delivery_note_ref,
        b.supplier_id,
        b.supplier_details,
        b.vehicle_clean,
        b.vehicle_enclosed,
        b.hazard_substances,
        b.pest_infestations,
        b.pallets_condition,
        b.raw_materials_condition,
        b.receiving_comments,
        b.reference,
        b.description,
        b.batch_number,
        b.carton_bulk_bags,
        b.quantity_kg,
        b.manufactured_date,
        b.best_before_date,
        b.status,
        b.production_day_id,
        b.created_at,
        b.updated_at
    FROM public.supplier_intake_batches b
    WHERE (p_status IS NULL OR p_status = '' OR b.status = p_status)
    ORDER BY b.date_received DESC, b.created_at DESC;
END;
$$;

-- Create supplier intake batch
CREATE OR REPLACE FUNCTION public.create_supplier_intake_batch(
    p_product_type varchar,
    p_date_received date,
    p_delivery_note_ref varchar DEFAULT NULL,
    p_supplier_id uuid DEFAULT NULL,
    p_supplier_details text DEFAULT NULL,
    p_vehicle_clean varchar DEFAULT NULL,
    p_vehicle_enclosed varchar DEFAULT NULL,
    p_hazard_substances varchar DEFAULT NULL,
    p_pest_infestations varchar DEFAULT NULL,
    p_pallets_condition varchar DEFAULT NULL,
    p_raw_materials_condition varchar DEFAULT NULL,
    p_receiving_comments text DEFAULT NULL,
    p_reference varchar DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_batch_number varchar DEFAULT NULL,
    p_carton_bulk_bags integer DEFAULT NULL,
    p_quantity_kg numeric DEFAULT NULL,
    p_manufactured_date date DEFAULT NULL,
    p_best_before_date date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_product_type IS NULL OR p_product_type = '' THEN
        RETURN json_build_object('success', false, 'error', 'Product type is required');
    END IF;
    IF p_date_received IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Date received is required');
    END IF;

    INSERT INTO public.supplier_intake_batches (
        product_type,
        date_received,
        delivery_note_ref,
        supplier_id,
        supplier_details,
        vehicle_clean,
        vehicle_enclosed,
        hazard_substances,
        pest_infestations,
        pallets_condition,
        raw_materials_condition,
        receiving_comments,
        reference,
        description,
        batch_number,
        carton_bulk_bags,
        quantity_kg,
        manufactured_date,
        best_before_date,
        status,
        created_at,
        updated_at
    ) VALUES (
        p_product_type,
        p_date_received,
        p_delivery_note_ref,
        p_supplier_id,
        p_supplier_details,
        p_vehicle_clean,
        p_vehicle_enclosed,
        p_hazard_substances,
        p_pest_infestations,
        p_pallets_condition,
        p_raw_materials_condition,
        p_receiving_comments,
        p_reference,
        p_description,
        p_batch_number,
        COALESCE(p_carton_bulk_bags, 1),
        p_quantity_kg,
        p_manufactured_date,
        p_best_before_date,
        'supplier_intake',
        now(),
        now()
    )
    RETURNING supplier_intake_batches.id INTO v_id;

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'Supplier intake batch created');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to create batch: ' || SQLERRM);
END;
$$;

-- RBAC: allow roles to execute
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_supplier_intake_batches', 'EXECUTE', true
FROM public.roles r
WHERE r.role_name IN ('admin', 'super_user')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_supplier_intake_batch', 'EXECUTE', true
FROM public.roles r
WHERE r.role_name IN ('admin', 'super_user')
ON CONFLICT DO NOTHING;
