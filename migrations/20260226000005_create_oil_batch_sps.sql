-- Migration: Oil batch SPs
-- get_oil_batches    — replaces get_oil_production_sheets (returns flat rows for grid + modal)
-- upsert_oil_production — replaces create_oil_production_sheet + update_oil_production_sheet
-- complete_oil_batch — sets status = 'complete' (release to stock)

-- ============================================================
-- 1. get_oil_batches — list read for grid + modal populateForm
-- Returns flat columns so modal_oil_production_sheet.populateForm() needs no changes.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_oil_batches(
    p_status  varchar DEFAULT NULL,
    p_search  varchar DEFAULT NULL,
    p_limit   integer DEFAULT 100,
    p_offset  integer DEFAULT 0
)
RETURNS TABLE (
    id                    uuid,
    batch_number          varchar,
    production_date       date,
    shift                 varchar,
    product_name          varchar,
    status                varchar,
    total_oil_litre       numeric,
    -- Flat sheet_data fields (backwards compat with populateForm)
    shift_supervisor      varchar,
    supervisor_signature  varchar,
    start_oil_bn          varchar,
    start_oil_litre       numeric,
    ibc1_bn               varchar,
    ibc1_litre            numeric,
    ibc2_bn               varchar,
    ibc2_litre            numeric,
    ibc3_bn               varchar,
    ibc3_litre            numeric,
    recipe_oil_kernel     numeric,
    recipe_cracker_dust   numeric,
    recipe_kernel_dust    numeric,
    recipe_crush          numeric,
    recipe_cake           numeric,
    recipe_notes          varchar,
    general_waste_kg      numeric,
    floor_waste_kg        numeric,
    product_waste_kg      numeric,
    oil_from_filter_kg    numeric,
    raw_materials         jsonb,
    mixes                 jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id,
        b.batch_id                                          AS batch_number,
        o.production_date,
        o.shift,
        o.product_name,
        o.status::varchar,
        o.total_oil_litre,
        -- Flat sheet_data extractions
        (o.sheet_data->>'shift_supervisor')::varchar,
        (o.sheet_data->>'supervisor_signature')::varchar,
        (o.sheet_data->>'start_oil_bn')::varchar,
        (o.sheet_data->>'start_oil_litre')::numeric,
        (o.sheet_data->>'ibc1_bn')::varchar,
        (o.sheet_data->>'ibc1_litre')::numeric,
        (o.sheet_data->>'ibc2_bn')::varchar,
        (o.sheet_data->>'ibc2_litre')::numeric,
        (o.sheet_data->>'ibc3_bn')::varchar,
        (o.sheet_data->>'ibc3_litre')::numeric,
        (o.sheet_data->'recipe'->>'oil_kernel')::numeric,
        (o.sheet_data->'recipe'->>'cracker_dust')::numeric,
        (o.sheet_data->'recipe'->>'kernel_dust')::numeric,
        (o.sheet_data->'recipe'->>'crush')::numeric,
        (o.sheet_data->'recipe'->>'cake')::numeric,
        (o.sheet_data->'recipe'->>'notes')::varchar,
        (o.sheet_data->'waste'->>'general_kg')::numeric,
        (o.sheet_data->'waste'->>'floor_kg')::numeric,
        (o.sheet_data->'waste'->>'product_kg')::numeric,
        (o.sheet_data->'waste'->>'oil_from_filter_kg')::numeric,
        COALESCE(o.sheet_data->'raw_materials', '[]'::jsonb),
        COALESCE(o.sheet_data->'mixes',         '[]'::jsonb)
    FROM public.oil o
    JOIN public.batches b ON b.id = o.batch_id
    WHERE o.is_active = true
      AND (
          p_status IS NULL
          OR o.status = p_status
          OR o.status = ANY(string_to_array(p_status, ','))
      )
      AND (
          p_search IS NULL
          OR b.batch_id     ILIKE '%' || p_search || '%'
          OR o.product_name ILIKE '%' || p_search || '%'
          OR o.shift        ILIKE '%' || p_search || '%'
      )
    ORDER BY o.production_date DESC NULLS LAST, o.created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;


-- ============================================================
-- 2. upsert_oil_production
-- Replaces create_oil_production_sheet + update_oil_production_sheet.
-- Pass p_oil_id = NULL to create; pass an existing uuid to update.
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_oil_production(
    p_oil_id              uuid    DEFAULT NULL,
    p_production_date     date    DEFAULT NULL,
    p_shift               varchar DEFAULT NULL,
    p_shift_supervisor    varchar DEFAULT NULL,
    p_batch_number        varchar DEFAULT NULL,
    p_supervisor_signature varchar DEFAULT NULL,
    p_product_name        varchar DEFAULT NULL,
    p_start_oil_bn        varchar DEFAULT NULL,
    p_start_oil_litre     numeric DEFAULT NULL,
    p_ibc1_bn             varchar DEFAULT NULL,
    p_ibc1_litre          numeric DEFAULT NULL,
    p_ibc2_bn             varchar DEFAULT NULL,
    p_ibc2_litre          numeric DEFAULT NULL,
    p_ibc3_bn             varchar DEFAULT NULL,
    p_ibc3_litre          numeric DEFAULT NULL,
    p_recipe_oil_kernel   numeric DEFAULT NULL,
    p_recipe_cracker_dust numeric DEFAULT NULL,
    p_recipe_kernel_dust  numeric DEFAULT NULL,
    p_recipe_crush        numeric DEFAULT NULL,
    p_recipe_cake         numeric DEFAULT NULL,
    p_recipe_notes        varchar DEFAULT NULL,
    p_general_waste_kg    numeric DEFAULT NULL,
    p_floor_waste_kg      numeric DEFAULT NULL,
    p_product_waste_kg    numeric DEFAULT NULL,
    p_oil_from_filter_kg  numeric DEFAULT NULL,
    p_raw_materials       jsonb   DEFAULT '[]'::jsonb,
    p_mixes               jsonb   DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id    uuid;
    v_oil_id      uuid;
    v_total_litre numeric;
    v_sheet       jsonb;
    v_batch_num   varchar;
BEGIN
    -- Build sheet_data JSONB
    v_sheet := jsonb_build_object(
        'shift_supervisor',     p_shift_supervisor,
        'supervisor_signature', p_supervisor_signature,
        'start_oil_bn',         p_start_oil_bn,
        'start_oil_litre',      p_start_oil_litre,
        'ibc1_bn',              p_ibc1_bn,
        'ibc1_litre',           p_ibc1_litre,
        'ibc2_bn',              p_ibc2_bn,
        'ibc2_litre',           p_ibc2_litre,
        'ibc3_bn',              p_ibc3_bn,
        'ibc3_litre',           p_ibc3_litre,
        'recipe', jsonb_build_object(
            'oil_kernel',   p_recipe_oil_kernel,
            'cracker_dust', p_recipe_cracker_dust,
            'kernel_dust',  p_recipe_kernel_dust,
            'crush',        p_recipe_crush,
            'cake',         p_recipe_cake,
            'notes',        p_recipe_notes
        ),
        'waste', jsonb_build_object(
            'general_kg',         p_general_waste_kg,
            'floor_kg',           p_floor_waste_kg,
            'product_kg',         p_product_waste_kg,
            'oil_from_filter_kg', p_oil_from_filter_kg
        ),
        'raw_materials', COALESCE(p_raw_materials, '[]'::jsonb),
        'mixes',         COALESCE(p_mixes,         '[]'::jsonb)
    );

    -- Total oil = sum of IBC litres
    v_total_litre := COALESCE(p_ibc1_litre, 0)
                   + COALESCE(p_ibc2_litre, 0)
                   + COALESCE(p_ibc3_litre, 0);

    -- ── UPDATE path ──────────────────────────────────────────────────
    IF p_oil_id IS NOT NULL THEN
        UPDATE public.oil
        SET production_date = COALESCE(p_production_date, production_date),
            shift           = COALESCE(p_shift,           shift),
            product_name    = COALESCE(p_product_name,    product_name),
            total_oil_litre = v_total_litre,
            sheet_data      = v_sheet,
            updated_at      = NOW()
        WHERE id = p_oil_id AND is_active = true;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Oil production sheet not found');
        END IF;

        -- Keep batch_id reference for return value
        SELECT batch_id INTO v_batch_id FROM public.oil WHERE id = p_oil_id;

        RETURN jsonb_build_object('success', true, 'id', p_oil_id, 'batch_id', v_batch_id);
    END IF;

    -- ── CREATE path ──────────────────────────────────────────────────
    -- Determine batch number: use p_batch_number or auto-generate
    v_batch_num := COALESCE(
        NULLIF(trim(p_batch_number), ''),
        'OIL-' || to_char(COALESCE(p_production_date, CURRENT_DATE), 'YYYY-MM') || '-' ||
        lpad(
            (1 + COALESCE(
                (SELECT COUNT(*) FROM public.batches
                 WHERE batch_id LIKE 'OIL-' || to_char(COALESCE(p_production_date, CURRENT_DATE), 'YYYY-MM') || '-%'),
                0
            ))::text,
            3, '0'
        )
    );

    -- Insert parent batch
    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (v_batch_num, 'oil', true)
    RETURNING id INTO v_batch_id;

    -- Insert oil row
    INSERT INTO public.oil (
        batch_id, production_date, shift, product_name,
        status, total_oil_litre, sheet_data
    )
    VALUES (
        v_batch_id,
        p_production_date,
        p_shift,
        COALESCE(p_product_name, 'Food grade oil'),
        'production',
        v_total_litre,
        v_sheet
    )
    RETURNING id INTO v_oil_id;

    RETURN jsonb_build_object('success', true, 'id', v_oil_id, 'batch_id', v_batch_id, 'batch_number', v_batch_num);

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists: ' || v_batch_num);
END;
$$;


-- ============================================================
-- 3. complete_oil_batch — advance status to 'complete'
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_oil_batch(
    p_oil_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.oil
    SET status     = 'complete',
        updated_at = NOW()
    WHERE id = p_oil_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;


-- ============================================================
-- RBAC: Grant EXECUTE on all three functions to all roles
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_fn      varchar;
    v_fns     varchar[] := ARRAY[
        'get_oil_batches',
        'upsert_oil_production',
        'complete_oil_batch'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;
