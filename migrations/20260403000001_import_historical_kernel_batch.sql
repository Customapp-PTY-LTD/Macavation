-- Stock "Add Batch" + historical CSV import: creates batches + kernel row at status complete with packing_data (kg by style).
-- WebPortal: dataFunctions.importHistoricalKernelBatch → import_historical_kernel_batch

CREATE OR REPLACE FUNCTION public.import_historical_kernel_batch(
    p_batch_number character varying,
    p_grower_name character varying DEFAULT NULL,
    p_supplier_id uuid DEFAULT NULL,
    p_received_date date DEFAULT NULL,
    p_production_finished_at timestamptz DEFAULT NULL,
    p_wet_nis_received_kg numeric DEFAULT NULL,
    p_sk_sp_qty numeric DEFAULT 0,
    p_sk_0_qty numeric DEFAULT 0,
    p_sk_1_qty numeric DEFAULT 0,
    p_sk_1s_qty numeric DEFAULT 0,
    p_sk_4l_qty numeric DEFAULT 0,
    p_sk_5_qty numeric DEFAULT 0,
    p_sk_6_qty numeric DEFAULT 0,
    p_bt_78_qty numeric DEFAULT 0,
    p_bt_high_qty numeric DEFAULT 0,
    p_bt_low_qty numeric DEFAULT 0,
    p_best_before_date date DEFAULT NULL,
    p_ffa numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
    v_batch_id  uuid;
    v_kernel_id uuid;
    v_packing   jsonb;
    v_job_card  jsonb;
    v_qa        jsonb;
    v_fin       timestamptz;
BEGIN
    p_batch_number := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF p_batch_number IS NULL OR p_batch_number = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    v_fin := COALESCE(
        p_production_finished_at,
        (p_received_date::timestamp AT TIME ZONE 'UTC') + time '12:00:00',
        NOW()
    );

    v_packing := jsonb_build_array(
        jsonb_build_object(
            'date', COALESCE(p_received_date::text, to_char(current_date, 'YYYY-MM-DD')),
            'sk_sp_qty',   COALESCE(p_sk_sp_qty, 0),
            'sk_0_qty',    COALESCE(p_sk_0_qty, 0),
            'sk_1_qty',    COALESCE(p_sk_1_qty, 0),
            'sk_1s_qty',   COALESCE(p_sk_1s_qty, 0),
            'sk_4l_qty',   COALESCE(p_sk_4l_qty, 0),
            'sk_5_qty',    COALESCE(p_sk_5_qty, 0),
            'sk_6_qty',    COALESCE(p_sk_6_qty, 0),
            'bt_78_qty',   COALESCE(p_bt_78_qty, 0),
            'bt_high_qty', COALESCE(p_bt_high_qty, 0),
            'bt_low_qty',  COALESCE(p_bt_low_qty, 0)
        )
    );

    v_job_card := CASE WHEN p_best_before_date IS NOT NULL
        THEN jsonb_build_object('best_before_date', p_best_before_date::text)
        ELSE '{}'::jsonb END;

    v_qa := CASE WHEN p_ffa IS NOT NULL
        THEN jsonb_build_object('ffa_result', p_ffa::text)
        ELSE '{}'::jsonb END;

    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (p_batch_number, 'kernel', true)
    RETURNING id INTO v_batch_id;

    INSERT INTO public.kernel (
        batch_id, supplier_id, grower_name, status,
        received_date, wet_nis_received_kg, production_finished_at,
        packing_data, job_card_data, qa_data, is_active
    )
    VALUES (
        v_batch_id, p_supplier_id, p_grower_name, 'complete',
        p_received_date, p_wet_nis_received_kg, v_fin,
        v_packing, v_job_card, v_qa, true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_kernel_id,
        'batch_id', v_batch_id,
        'batch_number', p_batch_number
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists: ' || p_batch_number);
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

COMMENT ON FUNCTION public.import_historical_kernel_batch IS
    'Creates kernel batch in stock (status complete) with one packing_data row (kg by style). Used by Stock Add Batch and CSV import.';

GRANT EXECUTE ON FUNCTION public.import_historical_kernel_batch(
    varchar, varchar, uuid, date, timestamptz, numeric,
    numeric, numeric, numeric, numeric, numeric, numeric, numeric,
    numeric, numeric, numeric, date, numeric
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_historical_kernel_batch(
    varchar, varchar, uuid, date, timestamptz, numeric,
    numeric, numeric, numeric, numeric, numeric, numeric, numeric,
    numeric, numeric, numeric, date, numeric
) TO service_role;
GRANT EXECUTE ON FUNCTION public.import_historical_kernel_batch(
    varchar, varchar, uuid, date, timestamptz, numeric,
    numeric, numeric, numeric, numeric, numeric, numeric, numeric,
    numeric, numeric, numeric, date, numeric
) TO anon;

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'import_historical_kernel_batch', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
