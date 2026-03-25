-- Oil ingredient (oil create via upsert_oil_batch), oil bin batches, protein bin batches:
-- Numbers are user-supplied only (no auto sequence).

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
AS $func$
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

    v_batch_id := NULLIF(trim(COALESCE(p_batch_id, '')), '');
    IF v_batch_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'batch_id is required when creating an oil batch');
    END IF;

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
$func$;

DROP FUNCTION IF EXISTS public.start_oil_bin_batch(date);
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(varchar);
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(date, varchar);

CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(
    p_batch_number varchar,
    p_start_date   date    DEFAULT NULL,
    p_stream       varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
    v_id           uuid;
    v_date         date := COALESCE(p_start_date, CURRENT_DATE);
    v_bn           varchar;
    v_shift        uuid;
    v_stream       varchar;
BEGIN
    v_bn := trim(COALESCE(p_batch_number, ''));
    IF v_bn = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'batch_number is required');
    END IF;

    v_stream := lower(trim(COALESCE(p_stream, '')));
    IF v_stream = '' THEN
        v_stream := NULL;
    ELSIF v_stream NOT IN ('food_grade', 'cosmetic') THEN
        RETURN jsonb_build_object('success', false, 'error', 'oil_stream must be food_grade or cosmetic');
    END IF;

    BEGIN
        INSERT INTO public.oil_bin_batch (batch_number, start_date, status, oil_stream)
        VALUES (v_bn, v_date, 'in_production', v_stream)
        RETURNING id INTO v_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists: ' || v_bn);
    END;

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
        'batch_number', v_bn,
        'start_date', v_date,
        'oil_stream', v_stream,
        'shift_linked', v_shift IS NOT NULL
    );
END;
$func$;

DROP FUNCTION IF EXISTS public.start_protein_bin_batch(date);

CREATE OR REPLACE FUNCTION public.start_protein_bin_batch(
    p_batch_number varchar,
    p_start_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
    v_id           uuid;
    v_date         date := COALESCE(p_start_date, CURRENT_DATE);
    v_bn           varchar;
BEGIN
    v_bn := trim(COALESCE(p_batch_number, ''));
    IF v_bn = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'batch_number is required');
    END IF;

    BEGIN
        INSERT INTO public.protein_bin_batch (batch_number, start_date, status)
        VALUES (v_bn, v_date, 'in_production')
        RETURNING id INTO v_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists: ' || v_bn);
    END;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_id,
        'batch_number', v_bn,
        'start_date', v_date
    );
END;
$func$;

NOTIFY pgrst, 'reload schema';
