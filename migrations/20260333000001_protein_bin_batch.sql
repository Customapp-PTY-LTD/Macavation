-- Protein production batches (parallel to oil_bin_batch): start → link raw ingredients → send to stock (oil_stock_lots by kg).
-- Applied via MCP as protein_bin_batch_core + protein_bin_batch_rbac if split for tooling.

CREATE TABLE IF NOT EXISTS public.protein_bin_batch (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number varchar(80) NOT NULL,
    start_date date,
    status varchar(30) NOT NULL DEFAULT 'in_production' CHECK (status IN ('in_production', 'sent_to_stock')),
    ingredients text,
    batch_weight_kg numeric(14, 3),
    raw_ingredient_audit jsonb NOT NULL DEFAULT '[]'::jsonb,
    stock_lot_id uuid REFERENCES public.oil_stock_lots(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_protein_bin_batch_number ON public.protein_bin_batch(batch_number);
CREATE INDEX IF NOT EXISTS idx_protein_bin_batch_status ON public.protein_bin_batch(status);

COMMENT ON TABLE public.protein_bin_batch IS 'Protein powder production runs; batch_weight_kg used when sending to stock (oil_stock_lots by kg).';
COMMENT ON COLUMN public.protein_bin_batch.raw_ingredient_audit IS 'Same shape as oil: [{ oil_id, batch_id, quantity_kg, product_type }]';

-- Next PP-YYYY-MM-NNN (protein only)
CREATE OR REPLACE FUNCTION public.get_next_protein_batch_number(p_date date DEFAULT NULL)
RETURNS varchar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_date   date := COALESCE(p_date, CURRENT_DATE);
    v_prefix varchar := 'PP-' || to_char(v_date, 'YYYY-MM') || '-';
    v_max    int;
    v_next   int;
BEGIN
    SELECT COALESCE(MAX(n), 0) INTO v_max
    FROM (
        SELECT (regexp_replace(batch_number, '^PP-[0-9]{4}-[0-9]{2}-', ''))::int AS n
        FROM public.protein_bin_batch
        WHERE batch_number LIKE v_prefix || '%'
          AND batch_number ~ '^PP-[0-9]{4}-[0-9]{2}-[0-9]+$'
    ) t;

    v_next := v_max + 1;
    RETURN v_prefix || lpad(v_next::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.start_protein_bin_batch(p_start_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id           uuid;
    v_date         date := COALESCE(p_start_date, CURRENT_DATE);
    v_batch_number varchar;
BEGIN
    v_batch_number := public.get_next_protein_batch_number(v_date);

    INSERT INTO public.protein_bin_batch (batch_number, start_date, status)
    VALUES (v_batch_number, v_date, 'in_production')
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_id,
        'batch_number', v_batch_number,
        'start_date', v_date
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_protein_bin_batches(
    p_status varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_number varchar,
    start_date date,
    ingredients text,
    batch_weight_kg numeric,
    status varchar,
    stock_lot_id uuid,
    raw_ingredient_audit jsonb,
    created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p.id,
        p.batch_number,
        p.start_date,
        p.ingredients,
        p.batch_weight_kg,
        p.status,
        p.stock_lot_id,
        p.raw_ingredient_audit,
        p.created_at
    FROM public.protein_bin_batch p
    WHERE (p_status IS NULL OR p.status = p_status)
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
$$;

CREATE OR REPLACE FUNCTION public.update_protein_bin_batch(
    p_id uuid,
    p_ingredients text DEFAULT NULL,
    p_batch_weight_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.protein_bin_batch
    SET ingredients = COALESCE(p_ingredients, ingredients),
        batch_weight_kg = COALESCE(p_batch_weight_kg, batch_weight_kg),
        updated_at = NOW()
    WHERE id = p_id AND status = 'in_production';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Protein batch not found or already sent to stock');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_protein_bin_batch_raw_ingredient_links(
    p_protein_bin_batch_id uuid,
    p_raw_ingredient_audit jsonb,
    p_ingredients text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.protein_bin_batch
    SET raw_ingredient_audit = COALESCE(p_raw_ingredient_audit, '[]'::jsonb),
        ingredients = CASE
            WHEN p_ingredients IS NULL THEN ingredients
            ELSE p_ingredients
        END,
        updated_at = NOW()
    WHERE id = p_protein_bin_batch_id AND status = 'in_production';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Protein batch not found or already sent to stock');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.send_protein_bin_batch_to_stock(p_protein_bin_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row  RECORD;
    v_lot_id uuid;
    v_kg     numeric;
    v_notes  text;
BEGIN
    SELECT
        id, batch_number, start_date, ingredients, batch_weight_kg, status, stock_lot_id, raw_ingredient_audit
    INTO v_row
    FROM public.protein_bin_batch
    WHERE id = p_protein_bin_batch_id;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Protein batch not found');
    END IF;

    IF v_row.status = 'sent_to_stock' AND v_row.stock_lot_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This batch has already been sent to stock');
    END IF;

    IF v_row.batch_weight_kg IS NULL OR v_row.batch_weight_kg <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch weight (kg) must be set before sending to stock');
    END IF;

    v_kg := ROUND(v_row.batch_weight_kg::numeric, 3);
    IF v_kg < 0.01 THEN
        v_kg := 0.01;
    END IF;

    v_notes := format(
        'From protein production. protein_bin_batch.id=%s. raw_ingredient_audit=%s',
        v_row.id,
        COALESCE(v_row.raw_ingredient_audit::text, '[]')
    );

    INSERT INTO public.oil_stock_lots (
        location_code,
        stock_category,
        status,
        batch_number,
        product_description,
        grade,
        ffa,
        kilograms,
        volume,
        manufacture_date,
        notes,
        created_at,
        updated_at
    )
    VALUES (
        '801',
        'finished_good',
        'on_hand',
        v_row.batch_number,
        COALESCE(NULLIF(trim(COALESCE(v_row.ingredients, '')), ''), 'Protein powder — production'),
        'Protein powder',
        NULL,
        v_kg,
        NULL,
        v_row.start_date,
        v_notes,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_lot_id;

    UPDATE public.protein_bin_batch
    SET status = 'sent_to_stock',
        stock_lot_id = v_lot_id,
        updated_at = NOW()
    WHERE id = p_protein_bin_batch_id;

    RETURN jsonb_build_object(
        'success', true,
        'oil_stock_lot_id', v_lot_id,
        'batch_number', v_row.batch_number
    );
END;
$$;

-- RBAC: same roles as update_oil_bin_batch
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id, 'function', v.fn, 'EXECUTE', true
FROM public.role_permissions rp
CROSS JOIN (VALUES
    ('start_protein_bin_batch'),
    ('get_protein_bin_batches'),
    ('update_protein_bin_batch'),
    ('set_protein_bin_batch_raw_ingredient_links'),
    ('send_protein_bin_batch_to_stock')
) AS v(fn)
WHERE rp.object_type = 'function'
  AND rp.object_name = 'update_oil_bin_batch'
  AND rp.operation = 'EXECUTE'
  AND COALESCE(rp.allowed, false) = true
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions x
      WHERE x.role_id = rp.role_id AND x.object_type = 'function'
        AND x.object_name = v.fn AND x.operation = 'EXECUTE'
  );

NOTIFY pgrst, 'reload schema';
