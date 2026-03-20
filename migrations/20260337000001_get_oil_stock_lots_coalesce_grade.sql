-- Stock Management grid: show Food grade / Cosmetic even when oil_stock_lots.grade is null,
-- by resolving oil_bin_batch.oil_stream for the same batch_number.

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
SET search_path = public
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
        (
            COALESCE(
                NULLIF(trim(l.grade), ''),
                (
                    SELECT CASE trim(lower(COALESCE(obb.oil_stream::text, '')))
                        WHEN 'food_grade' THEN 'Food grade'::varchar
                        WHEN 'cosmetic' THEN 'Cosmetic'::varchar
                        ELSE NULL::varchar
                    END
                    FROM public.oil_bin_batch obb
                    WHERE obb.batch_number = l.batch_number
                    ORDER BY obb.updated_at DESC NULLS LAST
                    LIMIT 1
                )
            )
        )::varchar AS grade,
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
          COALESCE(l.grade, '') ILIKE '%' || p_search || '%' OR
          EXISTS (
              SELECT 1 FROM public.oil_bin_batch obb_s
              WHERE obb_s.batch_number = l.batch_number
                AND COALESCE(obb_s.oil_stream::text, '') ILIKE '%' || p_search || '%'
          )
      )
    ORDER BY COALESCE(l.bb_date, l.manufacture_date, l.delivery_date, l.created_at) DESC, l.created_at DESC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 1000);
END;
$$;

COMMENT ON FUNCTION public.get_oil_stock_lots(text, text, text, text, integer, integer) IS
  'Lists oil_stock_lots; grade coalesced from oil_bin_batch.oil_stream (Food grade | Cosmetic) when lot.grade is empty.';

NOTIFY pgrst, 'reload schema';
