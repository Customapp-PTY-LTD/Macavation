-- Oil Stock Lots / Ledger (supports spreadsheet-style management for 801/850 and Sold)

CREATE TABLE IF NOT EXISTS public.oil_stock_lots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_code varchar(10) NOT NULL, -- e.g. '801', '850'
    stock_category varchar(20) NOT NULL CHECK (stock_category IN ('raw_material', 'finished_good', 'sold')),
    status varchar(20) NOT NULL DEFAULT 'on_hand' CHECK (status IN ('on_hand', 'dispatched', 'sold', 'hold')),

    counterparty_type varchar(20) NULL CHECK (counterparty_type IN ('supplier', 'customer')),
    counterparty_name text NULL,
    counterparty_contact_id uuid NULL REFERENCES public.contacts(id),

    po_reference varchar(100) NULL,
    batch_number varchar(50) NULL,

    product_code varchar(50) NULL,          -- e.g. ZRNMKD
    product_description text NULL,          -- e.g. "ZRNMKD - Kernel Dust"
    grade varchar(50) NULL,                 -- e.g. 24P, Crude Cosmetic, etc

    ffa numeric(6,3) NULL,
    coa_status varchar(30) NULL,            -- e.g. Received / Pending
    units integer NULL,
    volume numeric(12,2) NULL,
    kilograms numeric(12,2) NOT NULL DEFAULT 0,

    delivery_date date NULL,
    manufacture_date date NULL,
    bb_date date NULL,

    notes text NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oil_stock_lots_location ON public.oil_stock_lots(location_code);
CREATE INDEX IF NOT EXISTS idx_oil_stock_lots_category ON public.oil_stock_lots(stock_category);
CREATE INDEX IF NOT EXISTS idx_oil_stock_lots_status ON public.oil_stock_lots(status);
CREATE INDEX IF NOT EXISTS idx_oil_stock_lots_bb_date ON public.oil_stock_lots(bb_date);
CREATE INDEX IF NOT EXISTS idx_oil_stock_lots_batch ON public.oil_stock_lots(batch_number);

-- Get oil stock lots
CREATE OR REPLACE FUNCTION public.get_oil_stock_lots(
    p_location_code text DEFAULT NULL,
    p_stock_category text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_offset integer DEFAULT 0,
    p_limit integer DEFAULT 200
)
RETURNS TABLE (
    id uuid,
    location_code varchar,
    stock_category varchar,
    status varchar,
    counterparty_type varchar,
    counterparty_name text,
    counterparty_contact_id uuid,
    po_reference varchar,
    batch_number varchar,
    product_code varchar,
    product_description text,
    grade varchar,
    ffa numeric,
    coa_status varchar,
    units integer,
    volume numeric,
    kilograms numeric,
    delivery_date date,
    manufacture_date date,
    bb_date date,
    notes text,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        l.id,
        l.location_code,
        l.stock_category,
        l.status,
        l.counterparty_type,
        l.counterparty_name,
        l.counterparty_contact_id,
        l.po_reference,
        l.batch_number,
        l.product_code,
        l.product_description,
        l.grade,
        l.ffa,
        l.coa_status,
        l.units,
        l.volume,
        l.kilograms,
        l.delivery_date,
        l.manufacture_date,
        l.bb_date,
        l.notes,
        l.created_at,
        l.updated_at
    FROM public.oil_stock_lots l
    WHERE l.is_active = true
      AND (p_location_code IS NULL OR l.location_code = p_location_code)
      AND (p_stock_category IS NULL OR l.stock_category = p_stock_category)
      AND (p_status IS NULL OR l.status = p_status)
      AND (
        p_search IS NULL OR p_search = '' OR
        COALESCE(l.counterparty_name, '') ILIKE '%' || p_search || '%' OR
        COALESCE(l.po_reference, '') ILIKE '%' || p_search || '%' OR
        COALESCE(l.batch_number, '') ILIKE '%' || p_search || '%' OR
        COALESCE(l.product_code, '') ILIKE '%' || p_search || '%' OR
        COALESCE(l.product_description, '') ILIKE '%' || p_search || '%' OR
        COALESCE(l.grade, '') ILIKE '%' || p_search || '%'
      )
    ORDER BY COALESCE(l.bb_date, l.manufacture_date, l.delivery_date, l.created_at) DESC, l.created_at DESC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 1000);
END;
$$;

-- Create oil stock lot
CREATE OR REPLACE FUNCTION public.create_oil_stock_lot_simple(
    p_location_code varchar,
    p_stock_category varchar,
    p_kilograms numeric,
    p_status varchar DEFAULT 'on_hand',
    p_counterparty_type varchar DEFAULT NULL,
    p_counterparty_name text DEFAULT NULL,
    p_counterparty_contact_id uuid DEFAULT NULL,
    p_po_reference varchar DEFAULT NULL,
    p_batch_number varchar DEFAULT NULL,
    p_product_code varchar DEFAULT NULL,
    p_product_description text DEFAULT NULL,
    p_grade varchar DEFAULT NULL,
    p_ffa numeric DEFAULT NULL,
    p_coa_status varchar DEFAULT NULL,
    p_units integer DEFAULT NULL,
    p_volume numeric DEFAULT NULL,
    p_delivery_date date DEFAULT NULL,
    p_manufacture_date date DEFAULT NULL,
    p_bb_date date DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_location_code IS NULL OR p_location_code = '' THEN
        RETURN json_build_object('success', false, 'error', 'Location code is required');
    END IF;
    IF p_stock_category IS NULL OR p_stock_category = '' THEN
        RETURN json_build_object('success', false, 'error', 'Stock category is required');
    END IF;
    IF p_kilograms IS NULL OR p_kilograms <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'Kilograms must be greater than 0');
    END IF;

    INSERT INTO public.oil_stock_lots (
        location_code,
        stock_category,
        status,
        counterparty_type,
        counterparty_name,
        counterparty_contact_id,
        po_reference,
        batch_number,
        product_code,
        product_description,
        grade,
        ffa,
        coa_status,
        units,
        volume,
        kilograms,
        delivery_date,
        manufacture_date,
        bb_date,
        notes,
        created_at,
        updated_at
    ) VALUES (
        p_location_code,
        p_stock_category,
        COALESCE(p_status, 'on_hand'),
        p_counterparty_type,
        p_counterparty_name,
        p_counterparty_contact_id,
        p_po_reference,
        p_batch_number,
        p_product_code,
        p_product_description,
        p_grade,
        p_ffa,
        p_coa_status,
        p_units,
        p_volume,
        p_kilograms,
        p_delivery_date,
        p_manufacture_date,
        p_bb_date,
        p_notes,
        now(),
        now()
    )
    RETURNING id INTO v_id;

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'Oil stock lot created');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to create oil stock lot: ' || SQLERRM);
END;
$$;

-- Update oil stock lot
CREATE OR REPLACE FUNCTION public.update_oil_stock_lot_simple(
    p_id uuid,
    p_location_code varchar DEFAULT NULL,
    p_stock_category varchar DEFAULT NULL,
    p_kilograms numeric DEFAULT NULL,
    p_status varchar DEFAULT NULL,
    p_counterparty_type varchar DEFAULT NULL,
    p_counterparty_name text DEFAULT NULL,
    p_counterparty_contact_id uuid DEFAULT NULL,
    p_po_reference varchar DEFAULT NULL,
    p_batch_number varchar DEFAULT NULL,
    p_product_code varchar DEFAULT NULL,
    p_product_description text DEFAULT NULL,
    p_grade varchar DEFAULT NULL,
    p_ffa numeric DEFAULT NULL,
    p_coa_status varchar DEFAULT NULL,
    p_units integer DEFAULT NULL,
    p_volume numeric DEFAULT NULL,
    p_delivery_date date DEFAULT NULL,
    p_manufacture_date date DEFAULT NULL,
    p_bb_date date DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'ID is required');
    END IF;

    UPDATE public.oil_stock_lots SET
        location_code = COALESCE(p_location_code, location_code),
        stock_category = COALESCE(p_stock_category, stock_category),
        kilograms = COALESCE(p_kilograms, kilograms),
        status = COALESCE(p_status, status),
        counterparty_type = COALESCE(p_counterparty_type, counterparty_type),
        counterparty_name = COALESCE(p_counterparty_name, counterparty_name),
        counterparty_contact_id = COALESCE(p_counterparty_contact_id, counterparty_contact_id),
        po_reference = COALESCE(p_po_reference, po_reference),
        batch_number = COALESCE(p_batch_number, batch_number),
        product_code = COALESCE(p_product_code, product_code),
        product_description = COALESCE(p_product_description, product_description),
        grade = COALESCE(p_grade, grade),
        ffa = COALESCE(p_ffa, ffa),
        coa_status = COALESCE(p_coa_status, coa_status),
        units = COALESCE(p_units, units),
        volume = COALESCE(p_volume, volume),
        delivery_date = COALESCE(p_delivery_date, delivery_date),
        manufacture_date = COALESCE(p_manufacture_date, manufacture_date),
        bb_date = COALESCE(p_bb_date, bb_date),
        notes = COALESCE(p_notes, notes),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Oil stock lot not found');
    END IF;

    RETURN json_build_object('success', true, 'id', p_id, 'message', 'Oil stock lot updated');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to update oil stock lot: ' || SQLERRM);
END;
$$;

-- Soft delete oil stock lot
CREATE OR REPLACE FUNCTION public.deactivate_oil_stock_lot(
    p_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.oil_stock_lots
    SET is_active = false, updated_at = now()
    WHERE id = p_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Oil stock lot not found');
    END IF;

    RETURN json_build_object('success', true, 'id', p_id, 'message', 'Oil stock lot deactivated');
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to deactivate oil stock lot: ' || SQLERRM);
END;
$$;

-- Summary (SOH-style): average FFA + total kilograms grouped by label
CREATE OR REPLACE FUNCTION public.get_oil_stock_summary(
    p_location_code text DEFAULT NULL,
    p_stock_category text DEFAULT NULL,
    p_status text DEFAULT 'on_hand'
)
RETURNS TABLE (
    label text,
    avg_ffa numeric,
    sum_kilograms numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        CASE
            WHEN l.stock_category = 'raw_material' THEN COALESCE(NULLIF(l.product_description, ''), NULLIF(l.product_code, ''), 'Unspecified')
            WHEN l.stock_category = 'finished_good' THEN COALESCE(NULLIF(l.grade, ''), NULLIF(l.product_description, ''), 'Unspecified')
            ELSE COALESCE(NULLIF(l.grade, ''), NULLIF(l.product_description, ''), NULLIF(l.product_code, ''), 'Unspecified')
        END AS label,
        AVG(l.ffa) AS avg_ffa,
        SUM(l.kilograms) AS sum_kilograms
    FROM public.oil_stock_lots l
    WHERE l.is_active = true
      AND (p_location_code IS NULL OR l.location_code = p_location_code)
      AND (p_stock_category IS NULL OR l.stock_category = p_stock_category)
      AND (p_status IS NULL OR l.status = p_status)
    GROUP BY 1
    ORDER BY 3 DESC;
END;
$$;

