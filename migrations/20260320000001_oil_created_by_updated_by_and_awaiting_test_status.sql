-- Supplier Intake alignment: created_by/updated_by audit + drop "intake" status in favour of "awaiting_test".
-- Run this migration on your Supabase project to fix: "Could not find the function public.upsert_oil_batch(...) in the schema cache"
-- (e.g. Supabase Dashboard → SQL Editor → paste and run this file, or: supabase db push / supabase migration up)
--
-- 1. Migrate existing oil rows from status 'intake' to 'awaiting_test'.
-- 2. Add p_created_by and p_updated_by to upsert_oil_batch and set oil.created_by / oil.updated_by.
-- 3. Default new batch status to 'awaiting_test' instead of 'intake'.
-- Note: This version of upsert_oil_batch does NOT include p_silos (oil table may not have silos column).
-- If your oil table has a silos column and you need it, add a follow-up migration that alters the function.

-- 1. Data migration: intake -> awaiting_test
UPDATE public.oil
SET status = 'awaiting_test', updated_at = NOW()
WHERE status = 'intake';

-- 2. Drop existing upsert_oil_batch overloads (13-param and 14-param with p_silos)
DROP FUNCTION IF EXISTS public.upsert_oil_batch(uuid, character varying, date, character varying, numeric, jsonb, jsonb, jsonb, jsonb, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone);

DROP FUNCTION IF EXISTS public.upsert_oil_batch(uuid, character varying, date, character varying, numeric, jsonb, jsonb, jsonb, jsonb, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer[]);

-- 3. Create upsert_oil_batch with created_by and updated_by; default status 'awaiting_test'
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
    p_created_by            uuid    DEFAULT NULL,
    p_updated_by            uuid    DEFAULT NULL
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
            updated_by                  = COALESCE(p_updated_by,            updated_by),
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
        created_by,
        updated_by
    )
    VALUES (
        v_batch_id,
        p_production_date,
        COALESCE(NULLIF(trim(p_status), ''), 'awaiting_test'),
        p_total_oil_litre,
        COALESCE(p_intake_data,     '{}'::jsonb),
        COALESCE(p_production_data, '{}'::jsonb),
        COALESCE(p_stock_data,      '{}'::jsonb),
        COALESCE(p_dispatch_data,   '{}'::jsonb),
        p_intake_completed_at,
        p_production_completed_at,
        p_stock_completed_at,
        p_dispatch_completed_at,
        p_created_by,
        COALESCE(p_updated_by, p_created_by)
    )
    RETURNING id INTO v_oil_id;

    RETURN jsonb_build_object('success', true, 'id', v_oil_id, 'batch_id', v_batch_id);

EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch ID already exists: ' || v_batch_id);
END;
$$;

COMMENT ON FUNCTION public.upsert_oil_batch(uuid, character varying, date, character varying, numeric, jsonb, jsonb, jsonb, jsonb, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, uuid, uuid) IS
'Oil batch create/update. Uses awaiting_test as default status for Supplier Intake. Sets created_by on insert, updated_by on insert and update.';
