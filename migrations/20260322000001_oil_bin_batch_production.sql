-- Oil bin section in production: Start oil bin (create batch + table row) and Send to stock.
-- Table: oil_bin_batch — one row per production oil bin run (batch_number, shifts, ingredients, start_date, letrerage, FFA).
-- When "Send to stock" is used, we create/update the main oil row and link it.

-- 1. Create oil_bin_batch table
CREATE TABLE IF NOT EXISTS public.oil_bin_batch (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    batch_number character varying NOT NULL,
    shifts character varying,
    ingredients character varying,
    start_date date NOT NULL DEFAULT CURRENT_DATE,
    letrerage numeric,
    ffa numeric,

    status character varying NOT NULL DEFAULT 'in_production',
    oil_id uuid REFERENCES public.oil(id),

    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oil_bin_batch_batch_number ON public.oil_bin_batch(batch_number);
CREATE INDEX IF NOT EXISTS idx_oil_bin_batch_status ON public.oil_bin_batch(status);
CREATE INDEX IF NOT EXISTS idx_oil_bin_batch_start_date ON public.oil_bin_batch(start_date);

ALTER TABLE public.oil_bin_batch ENABLE ROW LEVEL SECURITY;

-- 2. start_oil_bin_batch — create a new oil bin batch (generate batch number, insert row)
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
    v_batch_number := 'OIL-' || to_char(v_date, 'YYYY-MM') || '-' ||
        lpad(
            (1 + COALESCE(
                (SELECT COUNT(*) FROM public.oil_bin_batch
                 WHERE batch_number LIKE 'OIL-' || to_char(v_date, 'YYYY-MM') || '-%'),
                0
            ))::text,
            3, '0'
        );

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

-- 3. send_oil_bin_batch_to_stock — push oil bin batch to stock (create oil row, link, update status)
CREATE OR REPLACE FUNCTION public.send_oil_bin_batch_to_stock(
    p_oil_bin_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_obb RECORD;
    v_oil_id uuid;
BEGIN
    SELECT id, batch_number, shifts, ingredients, start_date, letrerage, ffa, oil_id, status
    INTO v_obb
    FROM public.oil_bin_batch
    WHERE id = p_oil_bin_batch_id;

    IF v_obb.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found');
    END IF;

    IF v_obb.status = 'sent_to_stock' AND v_obb.oil_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This batch has already been sent to stock');
    END IF;

    -- Create oil row (stock batch from production)
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
            'oil_bin_batch_id', v_obb.id
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

-- 4. get_oil_bin_batches — list oil bin batches for the production UI
DO $$
DECLARE
    fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'get_oil_bin_batches'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', fn.sig);
    END LOOP;
END $$;

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
    created_at timestamptz
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
        obb.created_at
    FROM public.oil_bin_batch obb
    WHERE (p_status IS NULL OR obb.status = p_status)
    ORDER BY obb.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

-- 5. update_oil_bin_batch — allow editing shifts, ingredients, letrerage, ffa before sending to stock
CREATE OR REPLACE FUNCTION public.update_oil_bin_batch(
    p_id uuid,
    p_shifts varchar DEFAULT NULL,
    p_ingredients varchar DEFAULT NULL,
    p_letrerage numeric DEFAULT NULL,
    p_ffa numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.oil_bin_batch
    SET shifts     = COALESCE(p_shifts,     shifts),
        ingredients = COALESCE(p_ingredients, ingredients),
        letrerage  = COALESCE(p_letrerage,  letrerage),
        ffa        = COALESCE(p_ffa,        ffa),
        updated_at = NOW()
    WHERE id = p_id AND status = 'in_production';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found or already sent to stock');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- RBAC
DO $$
DECLARE
    v_role_id uuid;
    v_fn varchar;
    v_fns varchar[] := ARRAY['start_oil_bin_batch', 'send_oil_bin_batch_to_stock', 'get_oil_bin_batches', 'update_oil_bin_batch'];
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
