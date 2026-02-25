-- Migration: SPs for the new oil/shift/product/oil_bin schema
-- get_oil_batches       — grid list + modal detail (flat production_data fields)
-- upsert_oil_batch      — create / update an oil record
-- get_shift_list        — list shifts for grid
-- upsert_shift          — create / update a shift
-- get_product_list      — list products
-- upsert_product        — create / update a product
-- get_oil_bin_list      — list oil bins
-- upsert_oil_bin        — create / update an oil bin


-- ============================================================
-- 1. get_oil_batches — list read for grid
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_oil_batches(
    p_status  varchar DEFAULT NULL,
    p_search  varchar DEFAULT NULL,
    p_limit   integer DEFAULT 100,
    p_offset  integer DEFAULT 0
)
RETURNS TABLE (
    id                      uuid,
    batch_id                varchar,
    production_date         date,
    status                  varchar,
    total_oil_litre         numeric,
    -- Extracted from production_data for display
    name_of_product         varchar,
    shift_supervisor        varchar,
    shift                   varchar,
    -- Stage completion timestamps
    intake_completed_at     timestamptz,
    production_completed_at timestamptz,
    stock_completed_at      timestamptz,
    dispatch_completed_at   timestamptz,
    -- Full JSONB columns for detail views
    intake_data             jsonb,
    production_data         jsonb,
    stock_data              jsonb,
    dispatch_data           jsonb,
    created_at              timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id,
        o.batch_id,
        o.production_date,
        o.status,
        o.total_oil_litre,
        (o.production_data->>'name_of_product')::varchar,
        (o.production_data->>'shift_supervisor')::varchar,
        (o.production_data->>'shift')::varchar,
        o.intake_completed_at,
        o.production_completed_at,
        o.stock_completed_at,
        o.dispatch_completed_at,
        o.intake_data,
        o.production_data,
        o.stock_data,
        o.dispatch_data,
        o.created_at
    FROM public.oil o
    WHERE o.is_active = true
      AND (
          p_status IS NULL
          OR o.status = p_status
          OR o.status = ANY(string_to_array(p_status, ','))
      )
      AND (
          p_search IS NULL
          OR o.batch_id ILIKE '%' || p_search || '%'
          OR (o.production_data->>'name_of_product') ILIKE '%' || p_search || '%'
          OR (o.production_data->>'shift_supervisor') ILIKE '%' || p_search || '%'
      )
    ORDER BY o.production_date DESC NULLS LAST, o.created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;


-- ============================================================
-- 2. upsert_oil_batch — create / update an oil record
-- Pass p_oil_id = NULL to create a new batch.
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_oil_batch(
    p_oil_id                uuid    DEFAULT NULL,
    p_batch_id              varchar DEFAULT NULL,
    p_production_date       date    DEFAULT NULL,
    p_status                varchar DEFAULT NULL,
    p_total_oil_litre       numeric DEFAULT NULL,
    p_intake_data           jsonb   DEFAULT NULL,
    p_production_data       jsonb   DEFAULT NULL,
    p_stock_data            jsonb   DEFAULT NULL,
    p_dispatch_data         jsonb   DEFAULT NULL,
    p_intake_completed_at     timestamptz DEFAULT NULL,
    p_production_completed_at timestamptz DEFAULT NULL,
    p_stock_completed_at      timestamptz DEFAULT NULL,
    p_dispatch_completed_at   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_oil_id    uuid;
    v_batch_id  varchar;
BEGIN
    -- ── UPDATE path ──────────────────────────────────────────────────
    IF p_oil_id IS NOT NULL THEN
        UPDATE public.oil
        SET production_date             = COALESCE(p_production_date,       production_date),
            status                      = COALESCE(p_status,                status),
            total_oil_litre             = COALESCE(p_total_oil_litre,       total_oil_litre),
            intake_data                 = COALESCE(p_intake_data,           intake_data),
            production_data             = COALESCE(p_production_data,       production_data),
            stock_data                  = COALESCE(p_stock_data,            stock_data),
            dispatch_data               = COALESCE(p_dispatch_data,         dispatch_data),
            intake_completed_at         = COALESCE(p_intake_completed_at,   intake_completed_at),
            production_completed_at     = COALESCE(p_production_completed_at, production_completed_at),
            stock_completed_at          = COALESCE(p_stock_completed_at,    stock_completed_at),
            dispatch_completed_at       = COALESCE(p_dispatch_completed_at, dispatch_completed_at),
            updated_at                  = NOW()
        WHERE id = p_oil_id AND is_active = true
        RETURNING id INTO v_oil_id;

        IF v_oil_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Oil batch not found');
        END IF;

        RETURN jsonb_build_object('success', true, 'id', v_oil_id);
    END IF;

    -- ── CREATE path ──────────────────────────────────────────────────
    -- Auto-generate batch_id if not provided
    v_batch_id := COALESCE(
        NULLIF(trim(p_batch_id), ''),
        'OIL-' || to_char(COALESCE(p_production_date, CURRENT_DATE), 'YYYY-MM') || '-' ||
        lpad(
            (1 + COALESCE(
                (SELECT COUNT(*) FROM public.oil
                 WHERE batch_id LIKE 'OIL-' || to_char(COALESCE(p_production_date, CURRENT_DATE), 'YYYY-MM') || '-%'),
                0
            ))::text,
            3, '0'
        )
    );

    INSERT INTO public.oil (
        batch_id,
        production_date,
        status,
        total_oil_litre,
        intake_data,
        production_data,
        stock_data,
        dispatch_data,
        intake_completed_at,
        production_completed_at,
        stock_completed_at,
        dispatch_completed_at
    )
    VALUES (
        v_batch_id,
        p_production_date,
        COALESCE(p_status, 'intake'),
        p_total_oil_litre,
        COALESCE(p_intake_data,     '{}'::jsonb),
        COALESCE(p_production_data, '{}'::jsonb),
        COALESCE(p_stock_data,      '{}'::jsonb),
        COALESCE(p_dispatch_data,   '{}'::jsonb),
        p_intake_completed_at,
        p_production_completed_at,
        p_stock_completed_at,
        p_dispatch_completed_at
    )
    RETURNING id INTO v_oil_id;

    RETURN jsonb_build_object('success', true, 'id', v_oil_id, 'batch_id', v_batch_id);

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch ID already exists: ' || v_batch_id);
END;
$$;


-- ============================================================
-- 3. get_shift_list — list shifts
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_shift_list(
    p_date_from date    DEFAULT NULL,
    p_date_to   date    DEFAULT NULL,
    p_search    varchar DEFAULT NULL,
    p_limit     integer DEFAULT 100,
    p_offset    integer DEFAULT 0
)
RETURNS TABLE (
    id               uuid,
    shift_date       date,
    shift_name       varchar,
    shift_supervisor varchar,
    shift_tracking   jsonb,
    created_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.shift_date,
        s.shift_name,
        s.shift_supervisor,
        s.shift_tracking,
        s.created_at
    FROM public.shift s
    WHERE (p_date_from IS NULL OR s.shift_date >= p_date_from)
      AND (p_date_to   IS NULL OR s.shift_date <= p_date_to)
      AND (
          p_search IS NULL
          OR s.shift_name       ILIKE '%' || p_search || '%'
          OR s.shift_supervisor ILIKE '%' || p_search || '%'
      )
    ORDER BY s.shift_date DESC, s.created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;


-- ============================================================
-- 4. upsert_shift — create / update a shift record
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_shift(
    p_shift_id       uuid    DEFAULT NULL,
    p_shift_date     date    DEFAULT NULL,
    p_shift_name     varchar DEFAULT NULL,
    p_shift_supervisor varchar DEFAULT NULL,
    p_shift_tracking jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_shift_id IS NOT NULL THEN
        UPDATE public.shift
        SET shift_date       = COALESCE(p_shift_date,       shift_date),
            shift_name       = COALESCE(p_shift_name,       shift_name),
            shift_supervisor = COALESCE(p_shift_supervisor, shift_supervisor),
            shift_tracking   = COALESCE(p_shift_tracking,   shift_tracking),
            updated_at       = NOW()
        WHERE id = p_shift_id
        RETURNING id INTO v_id;

        IF v_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Shift not found');
        END IF;

        RETURN jsonb_build_object('success', true, 'id', v_id);
    END IF;

    INSERT INTO public.shift (shift_date, shift_name, shift_supervisor, shift_tracking)
    VALUES (p_shift_date, p_shift_name, p_shift_supervisor, COALESCE(p_shift_tracking, '{}'::jsonb))
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;


-- ============================================================
-- 5. get_product_list — list products
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_product_list(
    p_type    varchar DEFAULT NULL,
    p_search  varchar DEFAULT NULL,
    p_limit   integer DEFAULT 100,
    p_offset  integer DEFAULT 0
)
RETURNS TABLE (
    id            uuid,
    product_name  varchar,
    product_type  varchar,
    product_specs jsonb,
    is_active     boolean,
    created_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.product_name,
        p.product_type,
        p.product_specs,
        p.is_active,
        p.created_at
    FROM public.product p
    WHERE p.is_active = true
      AND (p_type   IS NULL OR p.product_type = p_type)
      AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%')
    ORDER BY p.product_name
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;


-- ============================================================
-- 6. upsert_product — create / update a product
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_product(
    p_product_id   uuid    DEFAULT NULL,
    p_product_name varchar DEFAULT NULL,
    p_product_type varchar DEFAULT NULL,
    p_product_specs jsonb  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_product_id IS NOT NULL THEN
        UPDATE public.product
        SET product_name  = COALESCE(p_product_name,  product_name),
            product_type  = COALESCE(p_product_type,  product_type),
            product_specs = COALESCE(p_product_specs, product_specs),
            updated_at    = NOW()
        WHERE id = p_product_id
        RETURNING id INTO v_id;

        IF v_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Product not found');
        END IF;

        RETURN jsonb_build_object('success', true, 'id', v_id);
    END IF;

    INSERT INTO public.product (product_name, product_type, product_specs)
    VALUES (p_product_name, p_product_type, COALESCE(p_product_specs, '{}'::jsonb))
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id);

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Product name already exists: ' || p_product_name);
END;
$$;


-- ============================================================
-- 7. get_oil_bin_list — list oil bins
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_oil_bin_list(
    p_search varchar DEFAULT NULL,
    p_limit  integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id           uuid,
    bin_name     varchar,
    start_oil_bn varchar,
    bin_data     jsonb,
    is_active    boolean,
    created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ob.id,
        ob.bin_name,
        ob.start_oil_bn,
        ob.bin_data,
        ob.is_active,
        ob.created_at
    FROM public.oil_bin ob
    WHERE ob.is_active = true
      AND (p_search IS NULL OR ob.bin_name ILIKE '%' || p_search || '%')
    ORDER BY ob.bin_name
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;


-- ============================================================
-- 8. upsert_oil_bin — create / update an oil bin
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_oil_bin(
    p_bin_id       uuid    DEFAULT NULL,
    p_bin_name     varchar DEFAULT NULL,
    p_start_oil_bn varchar DEFAULT NULL,
    p_bin_data     jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_bin_id IS NOT NULL THEN
        UPDATE public.oil_bin
        SET bin_name     = COALESCE(p_bin_name,     bin_name),
            start_oil_bn = COALESCE(p_start_oil_bn, start_oil_bn),
            bin_data     = COALESCE(p_bin_data,     bin_data),
            updated_at   = NOW()
        WHERE id = p_bin_id
        RETURNING id INTO v_id;

        IF v_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Oil bin not found');
        END IF;

        RETURN jsonb_build_object('success', true, 'id', v_id);
    END IF;

    INSERT INTO public.oil_bin (bin_name, start_oil_bn, bin_data)
    VALUES (p_bin_name, p_start_oil_bn, COALESCE(p_bin_data, '{}'::jsonb))
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id);

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bin name already exists: ' || p_bin_name);
END;
$$;


-- ============================================================
-- RBAC: Grant EXECUTE on all 8 functions to all roles
-- ============================================================
DO $$
DECLARE
    v_role_id uuid;
    v_fn      varchar;
    v_fns     varchar[] := ARRAY[
        'get_oil_batches',
        'upsert_oil_batch',
        'get_shift_list',
        'upsert_shift',
        'get_product_list',
        'upsert_product',
        'get_oil_bin_list',
        'upsert_oil_bin'
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
