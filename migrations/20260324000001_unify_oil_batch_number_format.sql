-- Unify oil batch number format: one shared sequence for OIL-YYYY-MM-NNN across oil and oil_bin_batch.
-- So "Start oil bin" and upsert_oil_batch (create) both use the same next number from the start of the flow.

-- 1. Helper: get next OIL-YYYY-MM-NNN from both oil.batch_id and oil_bin_batch.batch_number
CREATE OR REPLACE FUNCTION public.get_next_oil_batch_number(p_date date DEFAULT NULL)
RETURNS varchar
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_date   date := COALESCE(p_date, CURRENT_DATE);
    v_prefix varchar := 'OIL-' || to_char(v_date, 'YYYY-MM') || '-';
    v_max    int;
    v_next   int;
BEGIN
    SELECT COALESCE(MAX(n), 0) INTO v_max
    FROM (
        SELECT (regexp_replace(batch_id, '^OIL-[0-9]{4}-[0-9]{2}-', ''))::int AS n
        FROM public.oil
        WHERE batch_id LIKE v_prefix || '%'
          AND batch_id ~ '^OIL-[0-9]{4}-[0-9]{2}-[0-9]+$'
        UNION ALL
        SELECT (regexp_replace(batch_number, '^OIL-[0-9]{4}-[0-9]{2}-', ''))::int AS n
        FROM public.oil_bin_batch
        WHERE batch_number LIKE v_prefix || '%'
          AND batch_number ~ '^OIL-[0-9]{4}-[0-9]{2}-[0-9]+$'
    ) t;

    v_next := v_max + 1;
    RETURN v_prefix || lpad(v_next::text, 3, '0');
END;
$$;

COMMENT ON FUNCTION public.get_next_oil_batch_number(date) IS 'Next OIL-YYYY-MM-NNN for the given date; considers both oil.batch_id and oil_bin_batch.batch_number so one sequence from start of flow.';

-- 2. start_oil_bin_batch: use shared helper
CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(
    p_start_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
    v_date date := COALESCE(p_start_date, CURRENT_DATE);
    v_batch_number varchar;
BEGIN
    v_batch_number := public.get_next_oil_batch_number(v_date);

    INSERT INTO public.oil_bin_batch (batch_number, start_date, status)
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

-- 3. upsert_oil_batch: use shared helper when creating (p_batch_id null/empty)
DROP FUNCTION IF EXISTS public.upsert_oil_batch(uuid, character varying, date, character varying, numeric, jsonb, jsonb, jsonb, jsonb, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, uuid, uuid);

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

    -- CREATE path: use shared OIL-YYYY-MM-NNN sequence when p_batch_id not provided
    v_batch_id := COALESCE(
        NULLIF(trim(p_batch_id), ''),
        public.get_next_oil_batch_number(COALESCE(p_production_date, CURRENT_DATE))
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

-- RBAC for new function
DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_next_oil_batch_number', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
