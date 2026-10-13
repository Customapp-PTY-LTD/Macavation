-- Send to Dispatch: Planned Collection Date (Mike's list, 12 Oct 2026, item 1d.iii).
-- delivery_date is unchanged and is now labelled "Planned Delivery Date" in the portal.
--
--   1. kernel_dispatch_orders.planned_collection_date (nullable - old orders have none).
--   2. create_kernel_dispatch_order: both overloads (implementation + actor wrapper from
--      20260816090100) are retired and recreated with p_planned_collection_date DEFAULT NULL.
--      CREATE OR REPLACE with an extra param alone would leave a second overload behind and
--      PostgREST would refuse every call with PGRST203. The old signatures are RENAMED to
--      <name>_pre_20261013 with EXECUTE revoked (not dropped - the Supabase connector refuses
--      deletes); remove them in Studio once this has been live a while. Bodies are the live dev definitions (13 Oct 2026)
--      plus the new column and a "collection after delivery" check.
--   3. update_kernel_dispatch_order: same retire/recreate, so the edit modal can change the date.
--   4. get_kernel_dispatch_orders / get_kernel_dispatch_order return the new column. They use
--      explicit column lists; rewritten in place (signature unchanged) rather than hand-copied.
--
-- Prod: the portal sends p_planned_collection_date as soon as this ships, so this migration must
-- be on prod BEFORE the code is promoted (requires 20260816090000/090100 there too).

-- 1. COLUMN ---------------------------------------------------------------------

ALTER TABLE public.kernel_dispatch_orders
    ADD COLUMN IF NOT EXISTS planned_collection_date date NULL;

-- 2. create_kernel_dispatch_order ------------------------------------------------

DO $retire$
BEGIN
    IF to_regprocedure('public.create_kernel_dispatch_order(text, date, jsonb, uuid, uuid, date)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.create_kernel_dispatch_order(text, date, jsonb, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
        ALTER FUNCTION public.create_kernel_dispatch_order(text, date, jsonb, uuid, uuid, date) RENAME TO create_kernel_dispatch_order_pre_20261013;
    END IF;
    IF to_regprocedure('public.create_kernel_dispatch_order(text, date, jsonb, uuid, date)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.create_kernel_dispatch_order(text, date, jsonb, uuid, date) FROM PUBLIC, anon, authenticated;
        ALTER FUNCTION public.create_kernel_dispatch_order(text, date, jsonb, uuid, date) RENAME TO create_kernel_dispatch_order_pre_20261013;
    END IF;
END
$retire$;

CREATE OR REPLACE FUNCTION public.create_kernel_dispatch_order(
    p_buyer_name text,
    p_delivery_date date,
    p_lines jsonb,
    p_buyer_contact_id uuid DEFAULT NULL::uuid,
    p_best_before_date date DEFAULT NULL::date,
    p_planned_collection_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_order_id   uuid;
    v_lines      jsonb := '[]'::jsonb;
    v_line       jsonb;
    v_cartons    numeric;
    v_quantity_kg numeric;
    v_kg_per_carton constant numeric := 11.34;
    i            int;
BEGIN
    IF p_buyer_name IS NULL OR trim(p_buyer_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Buyer name is required');
    END IF;
    IF p_delivery_date IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery date is required');
    END IF;
    IF p_planned_collection_date IS NOT NULL AND p_planned_collection_date > p_delivery_date THEN
        RETURN jsonb_build_object('success', false, 'error', 'Planned collection date cannot be after the planned delivery date');
    END IF;
    IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'At least one line is required');
    END IF;

    -- Normalize lines: cartons is source of truth; quantity_kg = cartons * 11.34
    FOR i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
        v_line := p_lines->i;
        -- Prefer cartons; if missing, derive from quantity_kg
        v_cartons := (v_line->>'cartons')::numeric;
        IF v_cartons IS NULL OR v_cartons < 0 THEN
            v_cartons := (v_line->>'quantity_kg')::numeric / NULLIF(v_kg_per_carton, 0);
            IF v_cartons IS NULL OR v_cartons < 0 THEN
                v_cartons := 0;
            END IF;
        END IF;
        v_quantity_kg := ROUND(v_cartons * v_kg_per_carton, 2);

        v_lines := v_lines || jsonb_build_object(
            'kernel_id',    v_line->>'kernel_id',
            'batch_number', v_line->>'batch_number',
            'style',        v_line->>'style',
            'cartons',      v_cartons,
            'quantity_kg',  v_quantity_kg
        );
    END LOOP;

    INSERT INTO public.kernel_dispatch_orders (
        buyer_name, buyer_contact_id, delivery_date, planned_collection_date, best_before_date, lines, status
    ) VALUES (
        p_buyer_name, p_buyer_contact_id, p_delivery_date, p_planned_collection_date, p_best_before_date,
        v_lines, 'pending'
    )
    RETURNING id INTO v_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Actor wrapper (20260816090100): records who dispatched in stock history.
CREATE OR REPLACE FUNCTION public.create_kernel_dispatch_order(
    p_buyer_name text,
    p_delivery_date date,
    p_lines jsonb,
    p_actor_user_id uuid,
    p_buyer_contact_id uuid DEFAULT NULL::uuid,
    p_best_before_date date DEFAULT NULL::date,
    p_planned_collection_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.create_kernel_dispatch_order(p_buyer_name, p_delivery_date, p_lines, p_buyer_contact_id,
                                               p_best_before_date, p_planned_collection_date);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_kernel_dispatch_order(text, date, jsonb, uuid, date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_kernel_dispatch_order(text, date, jsonb, uuid, uuid, date, date) TO anon, authenticated, service_role;

-- 3. update_kernel_dispatch_order -------------------------------------------------

DO $retire$
BEGIN
    IF to_regprocedure('public.update_kernel_dispatch_order(uuid, text, date, date, jsonb)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.update_kernel_dispatch_order(uuid, text, date, date, jsonb) FROM PUBLIC, anon, authenticated;
        ALTER FUNCTION public.update_kernel_dispatch_order(uuid, text, date, date, jsonb) RENAME TO update_kernel_dispatch_order_pre_20261013;
    END IF;
END
$retire$;

CREATE OR REPLACE FUNCTION public.update_kernel_dispatch_order(
    p_order_id uuid,
    p_buyer_name text DEFAULT NULL::text,
    p_delivery_date date DEFAULT NULL::date,
    p_best_before_date date DEFAULT NULL::date,
    p_lines jsonb DEFAULT NULL::jsonb,
    p_planned_collection_date date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_status text;
    v_cur_delivery date;
    v_cur_collection date;
    v_normalized jsonb := '[]'::jsonb;
    v_line jsonb;
    v_cartons numeric;
    v_quantity_kg numeric;
    v_kg_per_carton constant numeric := 11.34;
    i int;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order id is required');
    END IF;

    SELECT status, delivery_date, planned_collection_date
      INTO v_status, v_cur_delivery, v_cur_collection
    FROM public.kernel_dispatch_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF lower(trim(coalesce(v_status, ''))) = 'dispatched' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot edit an order that has already been dispatched');
    END IF;

    IF p_buyer_name IS NOT NULL AND trim(p_buyer_name) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Buyer name cannot be empty');
    END IF;

    IF COALESCE(p_planned_collection_date, v_cur_collection) IS NOT NULL
       AND COALESCE(p_planned_collection_date, v_cur_collection) > COALESCE(p_delivery_date, v_cur_delivery) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Planned collection date cannot be after the planned delivery date');
    END IF;

    IF p_lines IS NOT NULL THEN
        IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'At least one line is required');
        END IF;
        FOR i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
            v_line := p_lines->i;
            v_cartons := (v_line->>'cartons')::numeric;
            IF v_cartons IS NULL OR v_cartons < 0 THEN
                v_cartons := (v_line->>'quantity_kg')::numeric / NULLIF(v_kg_per_carton, 0);
                IF v_cartons IS NULL OR v_cartons < 0 THEN
                    v_cartons := 0;
                END IF;
            END IF;
            v_quantity_kg := ROUND(v_cartons * v_kg_per_carton, 2);
            v_normalized := v_normalized || jsonb_build_object(
                'kernel_id',    v_line->>'kernel_id',
                'batch_number', v_line->>'batch_number',
                'style',        v_line->>'style',
                'cartons',      v_cartons,
                'quantity_kg',  v_quantity_kg
            );
        END LOOP;
    END IF;

    UPDATE public.kernel_dispatch_orders
    SET
        buyer_name = CASE WHEN p_buyer_name IS NOT NULL THEN trim(p_buyer_name) ELSE buyer_name END,
        delivery_date = COALESCE(p_delivery_date, delivery_date),
        planned_collection_date = COALESCE(p_planned_collection_date, planned_collection_date),
        best_before_date = CASE WHEN p_best_before_date IS NOT NULL THEN p_best_before_date ELSE best_before_date END,
        lines = CASE WHEN p_lines IS NOT NULL THEN v_normalized ELSE lines END,
        updated_at = NOW()
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'message', 'Dispatch order updated');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_kernel_dispatch_order(uuid, text, date, date, jsonb, date) TO anon, authenticated, service_role;

-- 4. READS RETURN planned_collection_date ------------------------------------------

DO $mig$
DECLARE
    v_def  text;
    v_hits int;
BEGIN
    -- 4a. list
    SELECT pg_get_functiondef('public.get_kernel_dispatch_orders(integer,integer,text,date)'::regprocedure) INTO v_def;
    IF position('planned_collection_date' in v_def) = 0 THEN
        v_hits := (length(v_def) - length(replace(v_def, 'o.delivery_date,', ''))) / length('o.delivery_date,');
        IF v_hits <> 1 THEN
            RAISE EXCEPTION 'get_kernel_dispatch_orders: expected 1 "o.delivery_date," found %', v_hits;
        END IF;
        EXECUTE replace(v_def, 'o.delivery_date,', 'o.delivery_date, o.planned_collection_date,');
    END IF;

    -- 4b. single
    SELECT pg_get_functiondef('public.get_kernel_dispatch_order(uuid)'::regprocedure) INTO v_def;
    IF position('planned_collection_date' in v_def) = 0 THEN
        v_hits := (length(v_def) - length(replace(v_def, 'delivery_date, best_before_date,', ''))) / length('delivery_date, best_before_date,');
        IF v_hits <> 1 THEN
            RAISE EXCEPTION 'get_kernel_dispatch_order: expected 1 "delivery_date, best_before_date," found %', v_hits;
        END IF;
        EXECUTE replace(v_def, 'delivery_date, best_before_date,', 'delivery_date, planned_collection_date, best_before_date,');
    END IF;
END
$mig$;

NOTIFY pgrst, 'reload schema';
