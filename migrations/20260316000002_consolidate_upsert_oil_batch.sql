-- Consolidate upsert_oil_batch into a single function (optional p_silos) to resolve
-- "Could not choose the best candidate function" when both 13-param and 14-param versions existed.

DROP FUNCTION IF EXISTS public.upsert_oil_batch(uuid, character varying, date, character varying, numeric, jsonb, jsonb, jsonb, jsonb, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone);

DROP FUNCTION IF EXISTS public.upsert_oil_batch(uuid, character varying, date, character varying, numeric, jsonb, jsonb, jsonb, jsonb, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer[]);

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
    p_dispatch_completed_at   timestamptz DEFAULT NULL,
    p_silos                 integer[] DEFAULT NULL
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
            silos                       = CASE WHEN p_silos IS NOT NULL THEN p_silos ELSE silos END,
            updated_at                  = NOW()
        WHERE id = p_oil_id AND is_active = true
        RETURNING id INTO v_oil_id;

        IF v_oil_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Oil batch not found');
        END IF;

        RETURN jsonb_build_object('success', true, 'id', v_oil_id);
    END IF;

    -- ── CREATE path ──────────────────────────────────────────────────
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
        dispatch_completed_at,
        silos
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
        p_dispatch_completed_at,
        COALESCE(p_silos, ARRAY[]::integer[])
    )
    RETURNING id INTO v_oil_id;

    RETURN jsonb_build_object('success', true, 'id', v_oil_id, 'batch_id', v_batch_id);

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch ID already exists: ' || v_batch_id);
END;
$$;
