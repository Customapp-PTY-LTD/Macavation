-- Oil Production audit: link person-on-duty (shift) + raw ingredient oil batches to oil_bin_batch rows.
-- On duty save, all in_production bin batches get shift_id + raw_ingredient_audit snapshot.
-- New bin starts auto-link to latest shift for that date + current snapshot when a shift exists.

-- 1. Columns on oil_bin_batch
ALTER TABLE public.oil_bin_batch
    ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.shift(id),
    ADD COLUMN IF NOT EXISTS raw_ingredient_audit jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_oil_bin_batch_shift_id ON public.oil_bin_batch(shift_id);

COMMENT ON COLUMN public.oil_bin_batch.shift_id IS 'Person-on-duty shift this bin batch was linked to for audit.';
COMMENT ON COLUMN public.oil_bin_batch.raw_ingredient_audit IS 'JSON array snapshot of oil rows (supplier raw) in production at link time: oil_id, batch_id, quantity_kg, product_type.';

-- 2. Snapshot of current raw ingredients (oil.status = production)
CREATE OR REPLACE FUNCTION public.get_oil_production_raw_ingredients_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(obj ORDER BY sort_key), '[]'::jsonb)
    FROM (
        SELECT
            jsonb_build_object(
                'oil_id', o.id,
                'batch_id', o.batch_id,
                'quantity_kg', COALESCE(
                    NULLIF((o.intake_data->>'quantity_kg'), '')::numeric,
                    NULLIF((o.intake_data#>>'{items,0,quantity_kg}'), '')::numeric
                ),
                'product_type', NULLIF(trim(COALESCE(
                    o.intake_data->>'product_type',
                    o.production_data->>'name_of_product',
                    ''
                )), '')
            ) AS obj,
            o.batch_id::text AS sort_key
        FROM public.oil o
        WHERE o.is_active = true
          AND o.status = 'production'
    ) s;
$$;

-- 3. After saving person on duty: attach shift + ingredient snapshot to all active oil bin batches
CREATE OR REPLACE FUNCTION public.sync_oil_production_duty_audit(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_snapshot jsonb;
    v_n        integer;
BEGIN
    IF p_shift_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_shift_id is required');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.shift WHERE id = p_shift_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
    END IF;

    v_snapshot := public.get_oil_production_raw_ingredients_snapshot();

    UPDATE public.oil_bin_batch obb
    SET shift_id = p_shift_id,
        raw_ingredient_audit = v_snapshot,
        updated_at = NOW()
    WHERE obb.status = 'in_production';

    GET DIAGNOSTICS v_n = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'linked_bin_batches', v_n,
        'raw_ingredient_count', jsonb_array_length(v_snapshot)
    );
END;
$$;

COMMENT ON FUNCTION public.sync_oil_production_duty_audit IS 'Call after upsert_shift (person on duty save): links shift + raw ingredient snapshot to all oil_bin_batch in_production.';

-- 4. Replace get_oil_bin_batches — add shift + audit columns
DROP FUNCTION IF EXISTS public.get_oil_bin_batches(character varying, integer, integer);

CREATE OR REPLACE FUNCTION public.get_oil_bin_batches(
    p_status varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_number varchar,
    shifts varchar,
    ingredients varchar,
    start_date date,
    letrerage numeric,
    ffa numeric,
    status varchar,
    oil_id uuid,
    created_at timestamptz,
    shift_id uuid,
    raw_ingredient_audit jsonb,
    duty_shift_date date,
    duty_shift_supervisor varchar,
    duty_shift_name varchar
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        obb.id,
        obb.batch_number,
        obb.shifts,
        obb.ingredients,
        obb.start_date,
        obb.letrerage,
        obb.ffa,
        obb.status,
        obb.oil_id,
        obb.created_at,
        obb.shift_id,
        obb.raw_ingredient_audit,
        s.shift_date,
        s.shift_supervisor,
        s.shift_name
    FROM public.oil_bin_batch obb
    LEFT JOIN public.shift s ON s.id = obb.shift_id
    WHERE (p_status IS NULL OR obb.status = p_status)
    ORDER BY obb.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- 5. start_oil_bin_batch — auto-link latest shift for start date + snapshot
CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(
    p_start_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id           uuid;
    v_date         date := COALESCE(p_start_date, CURRENT_DATE);
    v_batch_number varchar;
    v_shift        uuid;
BEGIN
    v_batch_number := public.get_next_oil_batch_number(v_date);

    INSERT INTO public.oil_bin_batch (batch_number, start_date, status)
    VALUES (v_batch_number, v_date, 'in_production')
    RETURNING id INTO v_id;

    SELECT s.id
    INTO v_shift
    FROM public.shift s
    WHERE s.shift_date = v_date
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1;

    IF v_shift IS NOT NULL THEN
        UPDATE public.oil_bin_batch
        SET shift_id = v_shift,
            raw_ingredient_audit = public.get_oil_production_raw_ingredients_snapshot(),
            updated_at = NOW()
        WHERE id = v_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_id,
        'batch_number', v_batch_number,
        'start_date', v_date,
        'shift_linked', v_shift IS NOT NULL
    );
END;
$$;

-- 6. send_oil_bin_batch_to_stock — persist duty audit on stock oil row
CREATE OR REPLACE FUNCTION public.send_oil_bin_batch_to_stock(
    p_oil_bin_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_obb    RECORD;
    v_oil_id uuid;
BEGIN
    SELECT
        id, batch_number, shifts, ingredients, start_date, letrerage, ffa, oil_id, status,
        shift_id, raw_ingredient_audit
    INTO v_obb
    FROM public.oil_bin_batch
    WHERE id = p_oil_bin_batch_id;

    IF v_obb.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found');
    END IF;

    IF v_obb.status = 'sent_to_stock' AND v_obb.oil_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This batch has already been sent to stock');
    END IF;

    INSERT INTO public.oil (
        batch_id,
        production_date,
        status,
        total_oil_litre,
        production_data,
        is_active
    )
    VALUES (
        v_obb.batch_number,
        v_obb.start_date,
        'stock',
        v_obb.letrerage,
        jsonb_build_object(
            'shifts', v_obb.shifts,
            'ingredients', v_obb.ingredients,
            'ffa', v_obb.ffa,
            'oil_bin_batch_id', v_obb.id,
            'duty_shift_id', v_obb.shift_id,
            'raw_ingredient_audit', COALESCE(v_obb.raw_ingredient_audit, '[]'::jsonb)
        ),
        true
    )
    RETURNING id INTO v_oil_id;

    UPDATE public.oil_bin_batch
    SET status = 'sent_to_stock',
        oil_id = v_oil_id,
        updated_at = NOW()
    WHERE id = p_oil_bin_batch_id;

    RETURN jsonb_build_object(
        'success', true,
        'oil_id', v_oil_id,
        'batch_number', v_obb.batch_number
    );
END;
$$;

-- RBAC
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'sync_oil_production_duty_audit', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_oil_production_raw_ingredients_snapshot', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
