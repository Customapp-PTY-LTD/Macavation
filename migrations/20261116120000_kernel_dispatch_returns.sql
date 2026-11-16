-- ============================================================================
-- Returns on a completed kernel sale (Mike, 16 Nov 2026).
--
-- Wedgewood sent rejected stock back. On a sale whose truck has been loaded, Mike, Pete or Joslyn
-- record a return: why (rejected / returned / not ordered / damaged / other), a note, the date,
-- and how many cartons of each batch and style came back.
--
--   1. Recording the return takes the sale off the sales figures straight away: one NEGATIVE row
--      per returned line goes into data_kernel_sales_lines (data_source 'return', dated the day it
--      came back, at the price it was sold for). Every sales reader sums these rows, so dashboards,
--      reports and the weekly report drop by the returned value.
--   2. The cartons are HELD ASIDE (not in Stock on Hand) until someone with pricing rights
--      (Pete / Mike, kernel_dispatch.approve) decides per line: back into stock, or written off.
--      "Back into stock" goes through adjust_kernel_stock_on_hand, so Stock on Hand goes up on the
--      same batch and style and the stock history shows it with the reason.
--   3. Joslyn records how the customer was paid back: a credit note or a refund, with its number.
--
-- The order's own lines are never edited (the sale guard trigger would wipe the sale), and while a
-- return is open the order cannot be unlocked ("Undo truck loaded") or have its lines changed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The returns table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kernel_dispatch_returns (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          uuid NOT NULL REFERENCES public.kernel_dispatch_orders (id) ON DELETE RESTRICT,
    returned_on       date NOT NULL,
    reason            text NOT NULL,
    note              text NULL,
    -- [{ index, kernel_id, batch_number, style, cartons, quantity_kg, price_per_kg, value_zar,
    --    back_cartons, write_off_cartons }]  (the last two are set by the decision)
    lines             jsonb NOT NULL DEFAULT '[]'::jsonb,
    total_cartons     numeric(12, 2) NOT NULL DEFAULT 0,
    total_kg          numeric(14, 2) NOT NULL DEFAULT 0,
    value_zar         numeric(14, 2) NOT NULL DEFAULT 0,
    status            text NOT NULL DEFAULT 'waiting',
    decided_at        timestamptz NULL,
    decided_by        uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    decision_note     text NULL,
    settle_type       text NULL,
    settle_reference  text NULL,
    settle_note       text NULL,
    settled_at        timestamptz NULL,
    settled_by        uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    cancelled_at      timestamptz NULL,
    cancelled_by      uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kernel_dispatch_returns_reason_check CHECK (reason IN ('rejected', 'returned', 'not_ordered', 'damaged', 'other')),
    CONSTRAINT kernel_dispatch_returns_status_check CHECK (status IN ('waiting', 'decided', 'cancelled')),
    CONSTRAINT kernel_dispatch_returns_settle_check CHECK (settle_type IS NULL OR settle_type IN ('credit_note', 'refund')),
    CONSTRAINT kernel_dispatch_returns_cartons_check CHECK (total_cartons > 0)
);

COMMENT ON TABLE public.kernel_dispatch_returns IS
    'Stock a customer sent back after the truck was loaded. waiting = held aside for a decision; '
    'decided = each line went back into stock or was written off; cancelled = recorded by mistake.';

CREATE INDEX IF NOT EXISTS ix_kernel_dispatch_returns_order ON public.kernel_dispatch_returns (order_id);
CREATE INDEX IF NOT EXISTS ix_kernel_dispatch_returns_open ON public.kernel_dispatch_returns (created_at DESC) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS ix_kernel_dispatch_returns_created_by ON public.kernel_dispatch_returns (created_by);
CREATE INDEX IF NOT EXISTS ix_kernel_dispatch_returns_decided_by ON public.kernel_dispatch_returns (decided_by);
CREATE INDEX IF NOT EXISTS ix_kernel_dispatch_returns_settled_by ON public.kernel_dispatch_returns (settled_by);
CREATE INDEX IF NOT EXISTS ix_kernel_dispatch_returns_cancelled_by ON public.kernel_dispatch_returns (cancelled_by);

ALTER TABLE public.kernel_dispatch_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kernel_dispatch_returns FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kernel_dispatch_returns TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Sales lines can carry a return (negative) row
-- ----------------------------------------------------------------------------
ALTER TABLE public.data_kernel_sales_lines
    ADD COLUMN IF NOT EXISTS dispatch_return_id uuid NULL REFERENCES public.kernel_dispatch_returns (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_data_kernel_sales_lines_return ON public.data_kernel_sales_lines (dispatch_return_id);

ALTER TABLE public.data_kernel_sales_lines DROP CONSTRAINT IF EXISTS data_kernel_sales_lines_source_check;
ALTER TABLE public.data_kernel_sales_lines ADD CONSTRAINT data_kernel_sales_lines_source_check
    CHECK (data_source IN ('manual', 'backfill', 'imported', 'dispatch', 'return'));
-- Only a return row may be negative.
ALTER TABLE public.data_kernel_sales_lines DROP CONSTRAINT IF EXISTS data_kernel_sales_lines_qty_check;
ALTER TABLE public.data_kernel_sales_lines ADD CONSTRAINT data_kernel_sales_lines_qty_check
    CHECK (quantity_kg >= 0 OR data_source = 'return');
ALTER TABLE public.data_kernel_sales_lines DROP CONSTRAINT IF EXISTS data_kernel_sales_lines_cartons_check;
ALTER TABLE public.data_kernel_sales_lines ADD CONSTRAINT data_kernel_sales_lines_cartons_check
    CHECK (cartons IS NULL OR cartons >= 0 OR data_source = 'return');

-- ----------------------------------------------------------------------------
-- 3. Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fmt_cartons(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT rtrim(to_char(COALESCE(p, 0), 'FM999G990D99'), '.'); $$;

CREATE OR REPLACE FUNCTION public._kernel_return_reason_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
    SELECT CASE p WHEN 'rejected' THEN 'Rejected by the customer' WHEN 'returned' THEN 'Returned'
                  WHEN 'not_ordered' THEN 'Not ordered' WHEN 'damaged' THEN 'Damaged' ELSE 'Other' END;
$$;

-- Cartons per order line already on a return that is not cancelled: { "<index>": cartons }.
CREATE OR REPLACE FUNCTION public._kernel_dispatch_returned_by_line(p_order_id uuid, p_skip_return uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(jsonb_object_agg(idx, n), '{}'::jsonb)
    FROM (
        SELECT l->>'index' AS idx, SUM((l->>'cartons')::numeric) AS n
        FROM public.kernel_dispatch_returns r
        CROSS JOIN LATERAL jsonb_array_elements(r.lines) l
        WHERE r.order_id = p_order_id AND r.status <> 'cancelled'
          AND (p_skip_return IS NULL OR r.id <> p_skip_return)
        GROUP BY l->>'index'
    ) x;
$$;

-- Opens / closes the two My Day tasks for one return.
CREATE OR REPLACE FUNCTION public._kernel_return_tasks(p_return_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r       public.kernel_dispatch_returns%ROWTYPE;
    v_buyer text;
    v_key   text := p_return_id::text;
BEGIN
    SELECT * INTO r FROM public.kernel_dispatch_returns WHERE id = p_return_id;
    IF NOT FOUND OR r.status = 'cancelled' THEN
        PERFORM public._close_tasks('dispatch_return_decide', v_key);
        PERFORM public._close_tasks('dispatch_return_credit', v_key);
        RETURN;
    END IF;
    SELECT COALESCE(NULLIF(trim(o.buyer_name), ''), 'the customer') INTO v_buyer
    FROM public.kernel_dispatch_orders o WHERE o.id = r.order_id;

    IF r.status = 'waiting' THEN
        PERFORM public._open_task('dispatch_return_decide', v_key,
            'Decide on the stock ' || v_buyer || ' sent back: ' || public._fmt_cartons(r.total_cartons) || ' cartons',
            concat_ws(' ', public._kernel_return_reason_label(r.reason) || '.',
                CASE WHEN NULLIF(trim(COALESCE(r.note, '')), '') IS NOT NULL THEN '"' || trim(r.note) || '"' END,
                'It is held aside until you choose: back into stock, or write it off.'),
            'kernel_dispatch_order', r.order_id);
    ELSE
        PERFORM public._close_tasks('dispatch_return_decide', v_key);
    END IF;

    IF r.settled_at IS NULL AND r.value_zar > 0 THEN
        PERFORM public._open_task('dispatch_return_credit', v_key,
            'Credit note or refund for ' || v_buyer,
            concat_ws(' ', v_buyer || ' sent back ' || public._fmt_cartons(r.total_cartons) || ' cartons on '
                || to_char(r.returned_on, 'FMDD Mon YYYY') || '.',
                'Record the credit note or refund number on Dispatch and Sales, under Returns.'),
            'kernel_dispatch_order', r.order_id);
    ELSE
        PERFORM public._close_tasks('dispatch_return_credit', v_key);
    END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Read: what can still come back on a sale
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_return_lines(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o      public.kernel_dispatch_orders%ROWTYPE;
    v_done jsonb;
    v_out  jsonb;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    v_done := public._kernel_dispatch_returned_by_line(p_order_id);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'index', l.ord - 1,
               'kernel_id', l.v->>'kernel_id',
               'batch_number', l.v->>'batch_number',
               'style', l.v->>'style',
               'cartons', COALESCE((l.v->>'cartons')::numeric, 0),
               'quantity_kg', COALESCE((l.v->>'quantity_kg')::numeric, 0),
               'price_per_kg', (l.v->>'price_per_kg')::numeric,
               'returned_cartons', COALESCE((v_done->>((l.ord - 1)::text))::numeric, 0),
               'returnable_cartons', GREATEST(0, COALESCE((l.v->>'cartons')::numeric, 0)
                                                 - COALESCE((v_done->>((l.ord - 1)::text))::numeric, 0))
           ) ORDER BY l.ord), '[]'::jsonb)
      INTO v_out
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) WITH ORDINALITY AS l(v, ord)
    WHERE COALESCE((l.v->>'cartons')::numeric, 0) > 0;

    RETURN jsonb_build_object('success', true,
        'order', jsonb_build_object('id', o.id, 'buyer_name', o.buyer_name, 'status', o.status,
                                    'dispatched_at', o.dispatched_at, 'invoice_reference', o.invoice_reference),
        'lines', v_out);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Read: the returns list (one order, or the latest across all orders)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_returns(p_order_id uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'returns', COALESCE(jsonb_agg(x ORDER BY x->>'sort_key' DESC), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
                   'id', r.id,
                   'order_id', r.order_id,
                   'buyer_name', o.buyer_name,
                   'invoice_reference', o.invoice_reference,
                   'dispatched_at', o.dispatched_at,
                   'returned_on', r.returned_on,
                   'reason', r.reason,
                   'reason_label', public._kernel_return_reason_label(r.reason),
                   'note', r.note,
                   'lines', r.lines,
                   'total_cartons', r.total_cartons,
                   'total_kg', r.total_kg,
                   'value_zar', r.value_zar,
                   'status', r.status,
                   'decided_at', r.decided_at,
                   'decided_by_label', public.stock_history_user_label(r.decided_by),
                   'decision_note', r.decision_note,
                   'settle_type', r.settle_type,
                   'settle_reference', r.settle_reference,
                   'settle_note', r.settle_note,
                   'settled_at', r.settled_at,
                   'settled_by_label', public.stock_history_user_label(r.settled_by),
                   'created_at', r.created_at,
                   'created_by_label', public.stock_history_user_label(r.created_by),
                   'sort_key', to_char(r.returned_on, 'YYYYMMDD') || to_char(r.created_at, 'YYYYMMDDHH24MISS')
               ) AS x
        FROM public.kernel_dispatch_returns r
        JOIN public.kernel_dispatch_orders o ON o.id = r.order_id
        WHERE r.status <> 'cancelled' AND (p_order_id IS NULL OR r.order_id = p_order_id)
        ORDER BY r.returned_on DESC, r.created_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
    ) s;
$$;

-- ----------------------------------------------------------------------------
-- 6. Record a return (Mike / Pete / Joslyn: kernel_dispatch.return)
--    p_lines = [{ index, cartons }]   (index = the line on the order)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_kernel_dispatch_return(
    p_order_id uuid,
    p_reason text,
    p_note text DEFAULT NULL,
    p_returned_on date DEFAULT NULL,
    p_lines jsonb DEFAULT '[]'::jsonb,
    p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o        public.kernel_dispatch_orders%ROWTYPE;
    v_today  date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    v_on     date := COALESCE(p_returned_on, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
    v_note   text := left(NULLIF(trim(COALESCE(p_note, '')), ''), 1000);
    v_done   jsonb;
    v_item   jsonb;
    v_idx    integer;
    v_n      numeric;
    v_line   jsonb;
    v_sent   numeric;
    v_kg     numeric;
    v_price  numeric;
    v_value  numeric;
    v_out    jsonb := '[]'::jsonb;
    v_seen   integer[] := ARRAY[]::integer[];
    v_tc     numeric := 0;
    v_tk     numeric := 0;
    v_tv     numeric := 0;
    v_id     uuid;
    v_cust   uuid;
    v_code   text;
BEGIN
    IF NOT public.has_action(p_actor_user_id, 'kernel_dispatch.return') THEN
        RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to record a return.');
    END IF;
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    IF o.status IS DISTINCT FROM 'dispatched' THEN
        RETURN jsonb_build_object('success', false, 'error', 'A return can only be recorded once the truck has been loaded.');
    END IF;
    IF p_reason IS NULL OR p_reason NOT IN ('rejected', 'returned', 'not_ordered', 'damaged', 'other') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose why the stock came back.');
    END IF;
    IF p_reason = 'other' AND v_note IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Add a note saying why the stock came back.');
    END IF;
    IF v_on > v_today THEN
        RETURN jsonb_build_object('success', false, 'error', 'The return date cannot be in the future.');
    END IF;
    IF o.dispatched_at IS NOT NULL AND v_on < (o.dispatched_at AT TIME ZONE 'Africa/Johannesburg')::date THEN
        RETURN jsonb_build_object('success', false, 'error', 'The return date cannot be before the truck was loaded.');
    END IF;

    v_done := public._kernel_dispatch_returned_by_line(p_order_id);
    FOR v_item IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END) LOOP
        v_idx := (v_item->>'index')::integer;
        v_n   := ROUND((v_item->>'cartons')::numeric, 2);
        CONTINUE WHEN v_n IS NULL OR v_n = 0;
        IF v_n < 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Cartons cannot be negative.');
        END IF;
        IF v_idx IS NULL OR v_idx < 0 OR v_idx >= jsonb_array_length(COALESCE(o.lines, '[]'::jsonb)) OR v_idx = ANY (v_seen) THEN
            RETURN jsonb_build_object('success', false, 'error', 'The sale changed. Reload and try again.');
        END IF;
        v_seen := v_seen || v_idx;
        v_line := o.lines->v_idx;
        v_sent := COALESCE((v_line->>'cartons')::numeric, 0);
        IF v_n > v_sent - COALESCE((v_done->>(v_idx::text))::numeric, 0) THEN
            RETURN jsonb_build_object('success', false, 'error',
                'Batch ' || COALESCE(public._fmt_batch_number(v_line->>'batch_number'), '?') || ' ' || COALESCE(v_line->>'style', '')
                || ': only ' || public._fmt_cartons(GREATEST(0, v_sent - COALESCE((v_done->>(v_idx::text))::numeric, 0)))
                || ' cartons can still come back.');
        END IF;
        -- kg in the same proportion as the line itself (keeps its own kg per carton).
        v_kg    := CASE WHEN v_sent > 0 THEN ROUND(COALESCE((v_line->>'quantity_kg')::numeric, 0) * v_n / v_sent, 2) ELSE 0 END;
        v_price := (v_line->>'price_per_kg')::numeric;
        v_value := CASE WHEN v_price IS NOT NULL THEN ROUND(v_kg * v_price, 2) ELSE 0 END;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'index', v_idx, 'kernel_id', v_line->>'kernel_id', 'batch_number', v_line->>'batch_number',
            'style', v_line->>'style', 'cartons', v_n, 'quantity_kg', v_kg,
            'price_per_kg', v_price, 'value_zar', v_value));
        v_tc := v_tc + v_n; v_tk := v_tk + v_kg; v_tv := v_tv + v_value;
    END LOOP;

    IF v_tc <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter how many cartons came back on at least one line.');
    END IF;

    INSERT INTO public.kernel_dispatch_returns
        (order_id, returned_on, reason, note, lines, total_cartons, total_kg, value_zar, status, created_by)
    VALUES (p_order_id, v_on, p_reason, v_note, v_out, v_tc, v_tk, v_tv, 'waiting',
            (SELECT id FROM public.users WHERE id = p_actor_user_id))
    RETURNING id INTO v_id;

    -- Take it off the sales figures: one negative row per priced line, dated the day it came back.
    SELECT id INTO v_cust FROM public.contacts WHERE id = o.buyer_contact_id;
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_out) LOOP
        CONTINUE WHEN (v_line->>'price_per_kg') IS NULL;
        v_code := public.kernel_style_code_from_dispatch(v_line->>'style');
        INSERT INTO public.data_kernel_sales_lines
            (sale_date, customer_id, customer_name, invoice_number, item_code, style_code, description,
             cartons, quantity_kg, price_per_kg, vat_excl_zar, vat_zar, vat_incl_zar,
             data_source, edited_by, edited_at, notes, dispatch_order_id, dispatch_return_id)
        VALUES
            (v_on, v_cust, COALESCE(NULLIF(trim(o.buyer_name), ''), '(no customer)'),
             NULL,
             (SELECT item_code FROM public.kernel_style_registry WHERE style_code = v_code),
             (SELECT style_code FROM public.kernel_style_registry WHERE style_code = v_code),
             'Return (' || public._kernel_return_reason_label(p_reason) || '), batch '
                 || COALESCE(public._fmt_batch_number(v_line->>'batch_number'), '?') || ', ' || COALESCE(v_line->>'style', '?'),
             -(v_line->>'cartons')::numeric, -(v_line->>'quantity_kg')::numeric, (v_line->>'price_per_kg')::numeric,
             -(v_line->>'value_zar')::numeric, 0, -(v_line->>'value_zar')::numeric,
             'return', (SELECT id FROM public.users WHERE id = p_actor_user_id), now(),
             'Customer return recorded on Dispatch and Sales. VAT not calculated.', p_order_id, v_id);
    END LOOP;

    PERFORM public._kernel_return_tasks(v_id);
    RETURN jsonb_build_object('success', true, 'return_id', v_id, 'total_cartons', v_tc, 'value_zar', v_tv);
EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cartons must be numbers, e.g. 12.');
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Decide (Pete / Mike: kernel_dispatch.approve)
--    p_lines = [{ index, back_cartons }]  (index = the line on the order). The rest is written off.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_kernel_dispatch_return(
    p_return_id uuid,
    p_lines jsonb DEFAULT '[]'::jsonb,
    p_note text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r       public.kernel_dispatch_returns%ROWTYPE;
    v_buyer text;
    v_line  jsonb;
    v_back  numeric;
    v_lines jsonb := '[]'::jsonb;
    v_res   jsonb;
    v_note  text := left(NULLIF(trim(COALESCE(p_note, '')), ''), 1000);
BEGIN
    IF NOT public.has_action(p_actor_user_id, 'kernel_dispatch.approve') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only Pete or Mike can decide where returned stock goes.');
    END IF;
    SELECT * INTO r FROM public.kernel_dispatch_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND OR r.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Return not found.');
    END IF;
    IF r.status <> 'waiting' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This return has already been decided.');
    END IF;
    SELECT COALESCE(NULLIF(trim(buyer_name), ''), 'customer') INTO v_buyer FROM public.kernel_dispatch_orders WHERE id = r.order_id;

    PERFORM public.stock_history_set_actor(p_actor_user_id);
    FOR v_line IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
        SELECT ROUND((x->>'back_cartons')::numeric, 2) INTO v_back
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END) x
        WHERE (x->>'index')::integer = (v_line->>'index')::integer
        LIMIT 1;
        v_back := COALESCE(v_back, 0);
        IF v_back < 0 OR v_back > (v_line->>'cartons')::numeric THEN
            RAISE EXCEPTION 'Batch % %: back into stock must be between 0 and % cartons.',
                COALESCE(public._fmt_batch_number(v_line->>'batch_number'), '?'), COALESCE(v_line->>'style', ''),
                public._fmt_cartons((v_line->>'cartons')::numeric);
        END IF;
        IF v_back > 0 AND NOT EXISTS (SELECT 1 FROM public.kernel WHERE id = (v_line->>'kernel_id')::uuid AND is_active) THEN
            RAISE EXCEPTION 'Batch % has been removed from the system, so its cartons cannot go back into stock. Write them off instead.',
                COALESCE(public._fmt_batch_number(v_line->>'batch_number'), '?');
        END IF;
        IF v_back > 0 THEN
            v_res := public.adjust_kernel_stock_on_hand(
                (v_line->>'kernel_id')::uuid, (v_line->>'style')::varchar, 0, v_back,
                'Returned by ' || v_buyer || ' (' || public._kernel_return_reason_label(r.reason) || ')' || COALESCE(': ' || r.note, ''));
            IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
                RAISE EXCEPTION 'Batch % %: %', COALESCE(public._fmt_batch_number(v_line->>'batch_number'), '?'),
                    COALESCE(v_line->>'style', ''), COALESCE(v_res->>'error', 'could not be put back into stock');
            END IF;
        END IF;
        v_lines := v_lines || jsonb_build_array(v_line || jsonb_build_object(
            'back_cartons', v_back, 'write_off_cartons', (v_line->>'cartons')::numeric - v_back));
    END LOOP;

    UPDATE public.kernel_dispatch_returns
       SET lines = v_lines, status = 'decided', decided_at = now(),
           decided_by = (SELECT id FROM public.users WHERE id = p_actor_user_id),
           decision_note = v_note, updated_at = now()
     WHERE id = p_return_id;
    PERFORM public._kernel_return_tasks(p_return_id);
    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN raise_exception THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
    WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cartons must be numbers, e.g. 12.');
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Undo the decision (takes the "back into stock" cartons out again; refused if they were sold)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_kernel_dispatch_return_decision(p_return_id uuid, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r      public.kernel_dispatch_returns%ROWTYPE;
    v_line jsonb;
    v_back numeric;
    v_res  jsonb;
    v_have numeric;
BEGIN
    IF NOT public.has_action(p_actor_user_id, 'kernel_dispatch.approve') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only Pete or Mike can change this decision.');
    END IF;
    SELECT * INTO r FROM public.kernel_dispatch_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND OR r.status <> 'decided' THEN
        RETURN jsonb_build_object('success', false, 'error', 'There is no decision to undo.');
    END IF;

    PERFORM public.stock_history_set_actor(p_actor_user_id);
    FOR v_line IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
        v_back := COALESCE((v_line->>'back_cartons')::numeric, 0);
        CONTINUE WHEN v_back <= 0;
        -- Still on the shelf? (Stock on Hand for this batch and style.)
        SELECT COALESCE((b.remaining_by_style_cartons->>(v_line->>'style'))::numeric, 0) INTO v_have
        FROM public.get_kernel_batches(NULL, NULL, 5000, 0) b
        WHERE b.id = (v_line->>'kernel_id')::uuid;
        IF COALESCE(v_have, 0) < v_back THEN
            RAISE EXCEPTION 'Batch % %: only % cartons are left in stock, so the % that went back cannot be taken out again.',
                COALESCE(public._fmt_batch_number(v_line->>'batch_number'), '?'), COALESCE(v_line->>'style', ''),
                public._fmt_cartons(COALESCE(v_have, 0)), public._fmt_cartons(v_back);
        END IF;
        v_res := public.adjust_kernel_stock_on_hand(
            (v_line->>'kernel_id')::uuid, (v_line->>'style')::varchar, 0, -v_back, 'Return decision undone');
        IF NOT COALESCE((v_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'Batch % %: %', COALESCE(public._fmt_batch_number(v_line->>'batch_number'), '?'),
                COALESCE(v_line->>'style', ''), COALESCE(v_res->>'error', 'could not be taken out of stock');
        END IF;
    END LOOP;

    UPDATE public.kernel_dispatch_returns
       SET lines = (SELECT COALESCE(jsonb_agg((l - 'back_cartons' - 'write_off_cartons') ORDER BY ord), '[]'::jsonb)
                    FROM jsonb_array_elements(r.lines) WITH ORDINALITY AS t(l, ord)),
           status = 'waiting', decided_at = NULL, decided_by = NULL, decision_note = NULL, updated_at = now()
     WHERE id = p_return_id;
    PERFORM public._kernel_return_tasks(p_return_id);
    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN raise_exception THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
    WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cartons must be numbers, e.g. 12.');
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Credit note or refund (Joslyn / Mike / Pete: kernel_dispatch.return). p_type NULL clears it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_kernel_dispatch_return(
    p_return_id uuid,
    p_type text,
    p_reference text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r     public.kernel_dispatch_returns%ROWTYPE;
    v_ref text := left(NULLIF(trim(COALESCE(p_reference, '')), ''), 100);
BEGIN
    IF NOT public.has_action(p_actor_user_id, 'kernel_dispatch.return') THEN
        RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to record a credit note or refund.');
    END IF;
    SELECT * INTO r FROM public.kernel_dispatch_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND OR r.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Return not found.');
    END IF;
    IF p_type IS NULL THEN
        UPDATE public.kernel_dispatch_returns
           SET settle_type = NULL, settle_reference = NULL, settle_note = NULL, settled_at = NULL, settled_by = NULL, updated_at = now()
         WHERE id = p_return_id;
        UPDATE public.data_kernel_sales_lines SET invoice_number = NULL, updated_at = now() WHERE dispatch_return_id = p_return_id;
    ELSE
        IF p_type NOT IN ('credit_note', 'refund') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Choose credit note or refund.');
        END IF;
        IF v_ref IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error',
                CASE WHEN p_type = 'credit_note' THEN 'Enter the credit note number.' ELSE 'Enter the refund reference.' END);
        END IF;
        UPDATE public.kernel_dispatch_returns
           SET settle_type = p_type, settle_reference = v_ref,
               settle_note = left(NULLIF(trim(COALESCE(p_note, '')), ''), 1000),
               settled_at = now(), settled_by = (SELECT id FROM public.users WHERE id = p_actor_user_id), updated_at = now()
         WHERE id = p_return_id;
        UPDATE public.data_kernel_sales_lines SET invoice_number = v_ref, updated_at = now() WHERE dispatch_return_id = p_return_id;
    END IF;
    PERFORM public._kernel_return_tasks(p_return_id);
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. Cancel a return recorded by mistake (only before the decision). Puts the sale back.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_kernel_dispatch_return(p_return_id uuid, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r public.kernel_dispatch_returns%ROWTYPE;
BEGIN
    IF NOT public.has_action(p_actor_user_id, 'kernel_dispatch.return') THEN
        RETURN jsonb_build_object('success', false, 'error', 'You do not have permission to change a return.');
    END IF;
    SELECT * INTO r FROM public.kernel_dispatch_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND OR r.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Return not found.');
    END IF;
    IF r.status = 'decided' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This return has been decided. Undo the decision first.');
    END IF;
    IF r.settled_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'A credit note or refund is recorded on this return. Clear it first.');
    END IF;
    DELETE FROM public.data_kernel_sales_lines WHERE dispatch_return_id = p_return_id;
    UPDATE public.kernel_dispatch_returns
       SET status = 'cancelled', cancelled_at = now(),
           cancelled_by = (SELECT id FROM public.users WHERE id = p_actor_user_id), updated_at = now()
     WHERE id = p_return_id;
    PERFORM public._kernel_return_tasks(p_return_id);
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 11. While a return is open, the sale stays as it went out.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_kernel_dispatch_return_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF OLD.status = 'dispatched'
       AND (NEW.status IS DISTINCT FROM 'dispatched'
            OR public._kernel_dispatch_lines_core(OLD.lines) IS DISTINCT FROM public._kernel_dispatch_lines_core(NEW.lines))
       AND EXISTS (SELECT 1 FROM public.kernel_dispatch_returns r WHERE r.order_id = OLD.id AND r.status <> 'cancelled') THEN
        RAISE EXCEPTION 'This sale has a return recorded against it, so it cannot be unlocked or changed. Cancel the return first.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kernel_dispatch_return_guard ON public.kernel_dispatch_orders;
CREATE TRIGGER kernel_dispatch_return_guard
    BEFORE UPDATE ON public.kernel_dispatch_orders
    FOR EACH ROW EXECUTE FUNCTION public.trg_kernel_dispatch_return_guard();

-- ----------------------------------------------------------------------------
-- 12. Kernel dashboard: "Sales from dispatches" nets off returns too.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p WHERE p.oid = 'public.get_kernel_dashboard_dispatch_sales'::regproc;
    IF v_def IS NOT NULL AND position('WHERE data_source = ''dispatch'' AND sale_date BETWEEN p_from AND p_to' IN v_def) > 0 THEN
        EXECUTE replace(v_def,
            'WHERE data_source = ''dispatch'' AND sale_date BETWEEN p_from AND p_to',
            'WHERE data_source IN (''dispatch'', ''return'') AND sale_date BETWEEN p_from AND p_to');
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 13. Grants, action, task switches
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_return_lines(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_returns(uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_kernel_dispatch_return(uuid, text, text, date, jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_kernel_dispatch_return(uuid, jsonb, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_kernel_dispatch_return_decision(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_kernel_dispatch_return(uuid, text, text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_kernel_dispatch_return(uuid, uuid) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public._kernel_dispatch_returned_by_line(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kernel_return_tasks(uuid) FROM PUBLIC, anon, authenticated;

INSERT INTO public.actions (key, module, label, description) VALUES
    ('kernel_dispatch.return', 'Dispatch and Sales', 'Record a customer return',
     'Record stock a customer sent back after the truck was loaded, and the credit note or refund for it')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.actions a
JOIN public.roles r ON r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
WHERE a.key = 'kernel_dispatch.return'
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

INSERT INTO public.features (key, name, description, is_active) VALUES
    ('task-dispatch-return-decide', 'Tasks: decide on returned stock', 'Gets a task when a customer sends stock back, to put it back into stock or write it off.', true),
    ('task-dispatch-return-credit', 'Tasks: credit note for a return', 'Gets a task to record the credit note or refund for stock a customer sent back.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM (VALUES
    ('task-dispatch-return-decide', 'Sales Exec'),
    ('task-dispatch-return-credit', 'Palladium Manager')
) AS g(feature_key, role_name)
JOIN public.features f ON f.key = g.feature_key
JOIN public.roles r ON r.role_name = g.role_name
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY[
    'get_kernel_dispatch_return_lines', 'get_kernel_dispatch_returns', 'record_kernel_dispatch_return',
    'decide_kernel_dispatch_return', 'undo_kernel_dispatch_return_decision', 'settle_kernel_dispatch_return',
    'cancel_kernel_dispatch_return'
]) AS fn
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Procurement Lead', 'Shareholder', 'Palladium Manager', 'Production Manager', 'Factory Manager')
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
