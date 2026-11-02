-- =============================================================================
-- Kernel dispatch approval -> sale (Mike + Pete, 26 Oct 2026).
--
--   Step 1  Pete picks batches/styles (existing Send to Dispatch)   stage 'picking'
--   Step 2  Thando picks the stock, may lower cartons + leave a note -> stage 'approval'
--   Step 3  Pete checks, prices each line, transport + pallets       -> stage 'approved'
--           and the sale is written to data_kernel_sales_lines (data_source 'dispatch'),
--           which the Kernel Dashboard already reads.
--   Step 4  The existing dispatch form (inspection) sends it out     status 'dispatched'
--
-- workflow_stage is separate from status so nothing in the existing pending/dispatched
-- flow changes. Orders created before this migration keep workflow_stage NULL and are
-- left alone. Stock is still derived from lines.cartons, so lowering a picked quantity
-- returns the difference to stock straight away (that is intended).
-- VAT is not calculated for dispatch sales (exports can be zero-rated): vat_zar = 0 and
-- vat_incl_zar = vat_excl_zar; the dashboard sums vat_excl_zar only.
-- Depends on 20261028090200_kernel_style_prices.sql.
-- =============================================================================

ALTER TABLE public.kernel_dispatch_orders
    ADD COLUMN IF NOT EXISTS workflow_stage      text CHECK (workflow_stage IN ('picking', 'approval', 'approved')),
    ADD COLUMN IF NOT EXISTS picked_at           timestamptz,
    ADD COLUMN IF NOT EXISTS picked_by           uuid,
    ADD COLUMN IF NOT EXISTS pick_note           text,
    ADD COLUMN IF NOT EXISTS review_note         text,
    ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
    ADD COLUMN IF NOT EXISTS approved_by         uuid,
    ADD COLUMN IF NOT EXISTS transport_payer     text CHECK (transport_payer IN ('macavation', 'customer')),
    ADD COLUMN IF NOT EXISTS transport_cost_zar  numeric(14,2) CHECK (transport_cost_zar IS NULL OR transport_cost_zar >= 0),
    ADD COLUMN IF NOT EXISTS transport_company   text,
    ADD COLUMN IF NOT EXISTS pallets             integer CHECK (pallets IS NULL OR pallets >= 0),
    ADD COLUMN IF NOT EXISTS sale_value_zar      numeric(14,2);

-- New orders enter the workflow; existing rows stay NULL (ADD COLUMN above had no default).
ALTER TABLE public.kernel_dispatch_orders ALTER COLUMN workflow_stage SET DEFAULT 'picking';
CREATE INDEX IF NOT EXISTS idx_kernel_dispatch_orders_workflow_stage ON public.kernel_dispatch_orders(workflow_stage);

ALTER TABLE public.data_kernel_sales_lines
    ADD COLUMN IF NOT EXISTS dispatch_order_id uuid REFERENCES public.kernel_dispatch_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_data_kernel_sales_lines_dispatch_order_id ON public.data_kernel_sales_lines(dispatch_order_id);

ALTER TABLE public.data_kernel_sales_lines DROP CONSTRAINT IF EXISTS data_kernel_sales_lines_source_check;
ALTER TABLE public.data_kernel_sales_lines ADD CONSTRAINT data_kernel_sales_lines_source_check
    CHECK (data_source = ANY (ARRAY['manual', 'backfill', 'imported', 'dispatch']));

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_workflow(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o       public.kernel_dispatch_orders%ROWTYPE;
    v_mode  text := COALESCE((SELECT value #>> '{}' FROM public.kernel_pipeline_settings WHERE key = 'kernel_pricing'), 'single');
    v_on    date;
    v_lines jsonb;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    v_on := COALESCE(o.delivery_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'index', l.ord - 1,
               'kernel_id', l.v->>'kernel_id',
               'batch_number', l.v->>'batch_number',
               'style', l.v->>'style',
               'style_code', public.kernel_style_code_from_dispatch(l.v->>'style'),
               'style_label', r.label,
               'cartons', (l.v->>'cartons')::numeric,
               'requested_cartons', COALESCE((l.v->>'requested_cartons')::numeric, (l.v->>'cartons')::numeric),
               'quantity_kg', (l.v->>'quantity_kg')::numeric,
               'price_per_kg', (l.v->>'price_per_kg')::numeric,
               'list_price', public.kernel_style_price_on(l.v->>'style', o.buyer_contact_id, v_on)
           ) ORDER BY l.ord), '[]'::jsonb)
    INTO v_lines
    FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) WITH ORDINALITY AS l(v, ord)
    LEFT JOIN public.kernel_style_registry r ON r.style_code = public.kernel_style_code_from_dispatch(l.v->>'style');

    RETURN jsonb_build_object(
        'success', true,
        'order', jsonb_build_object(
            'id', o.id,
            'buyer_name', o.buyer_name,
            'buyer_contact_id', o.buyer_contact_id,
            'delivery_date', o.delivery_date,
            'planned_collection_date', o.planned_collection_date,
            'status', o.status,
            'workflow_stage', o.workflow_stage,
            'created_at', o.created_at,
            'created_by_label', public.stock_history_user_label(o.created_by),
            'picked_at', o.picked_at,
            'picked_by_label', public.stock_history_user_label(o.picked_by),
            'pick_note', o.pick_note,
            'review_note', o.review_note,
            'approved_at', o.approved_at,
            'approved_by_label', public.stock_history_user_label(o.approved_by),
            'transport_payer', o.transport_payer,
            'transport_cost_zar', o.transport_cost_zar,
            'transport_company', COALESCE(o.transport_company, o.record->>'transport_company'),
            'pallets', o.pallets,
            'sale_value_zar', o.sale_value_zar
        ),
        'pricing_mode', v_mode,
        'kg_per_carton', 11.34,
        'lines', v_lines
    );
END;
$$;

-- Light lookup for the dispatch grid: stage per order id.
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_stages(p_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'workflow_stage', workflow_stage,
               'picked_by_label', public.stock_history_user_label(picked_by),
               'has_pick_changes', EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(lines, '[]'::jsonb)) l
                                           WHERE (l->>'requested_cartons') IS NOT NULL
                                             AND (l->>'requested_cartons')::numeric <> (l->>'cartons')::numeric))), '[]'::jsonb)
    FROM public.kernel_dispatch_orders
    WHERE id = ANY (COALESCE(p_ids, '{}'))
      AND cardinality(COALESCE(p_ids, '{}')) <= 500;
$$;

-- ---------------------------------------------------------------------------
-- Step 2: Thando confirms what was picked. Cartons can only go down (or stay).
-- p_picked = [{ "index": 0, "cartons": 38 }, ...]; lines not listed are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_kernel_dispatch_pick(
    p_order_id      uuid,
    p_picked        jsonb DEFAULT '[]'::jsonb,
    p_note          text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o        public.kernel_dispatch_orders%ROWTYPE;
    v_lines  jsonb;
    v_item   jsonb;
    v_idx    integer;
    v_new    numeric;
    v_old    numeric;
    v_line   jsonb;
    v_total  numeric;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    IF o.status IN ('dispatched', 'cancelled') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This dispatch has already gone out or was cancelled.');
    END IF;
    IF o.workflow_stage = 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pete has already approved this dispatch. Ask him to send it back first.');
    END IF;

    v_lines := COALESCE(o.lines, '[]'::jsonb);
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_picked, '[]'::jsonb)) LOOP
        v_idx := (v_item->>'index')::integer;
        v_new := (v_item->>'cartons')::numeric;
        IF v_idx IS NULL OR v_idx < 0 OR v_idx >= jsonb_array_length(v_lines) THEN
            RETURN jsonb_build_object('success', false, 'error', 'The basket changed while you were picking. Reload and try again.');
        END IF;
        v_line := v_lines->v_idx;
        v_old  := (v_line->>'cartons')::numeric;
        IF v_new IS NULL OR v_new < 0 OR v_new <> trunc(v_new) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Picked cartons must be whole numbers.');
        END IF;
        IF v_new > COALESCE((v_line->>'requested_cartons')::numeric, v_old) THEN
            RETURN jsonb_build_object('success', false, 'error',
                format('You cannot pick more than was asked for (%s cartons of %s).', COALESCE((v_line->>'requested_cartons')::numeric, v_old), v_line->>'style'));
        END IF;
        IF v_new <> v_old OR (v_line ? 'requested_cartons') THEN
            v_line := v_line
                || jsonb_build_object('requested_cartons', COALESCE((v_line->>'requested_cartons')::numeric, v_old))
                || jsonb_build_object('cartons', v_new, 'quantity_kg', ROUND(v_new * 11.34, 2));
            v_lines := jsonb_set(v_lines, ARRAY[v_idx::text], v_line);
        END IF;
    END LOOP;

    SELECT COALESCE(SUM((l->>'cartons')::numeric), 0) INTO v_total FROM jsonb_array_elements(v_lines) l;
    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nothing was picked. Send the dispatch back to Pete with a note instead.');
    END IF;

    UPDATE public.kernel_dispatch_orders
       SET lines = v_lines,
           workflow_stage = 'approval',
           picked_at = now(),
           picked_by = p_actor_user_id,
           pick_note = NULLIF(trim(COALESCE(p_note, '')), ''),
           updated_at = now(),
           updated_by = COALESCE(p_actor_user_id, updated_by)
     WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'workflow_stage', 'approval');
END;
$$;

-- ---------------------------------------------------------------------------
-- Pete sends a dispatch back to picking (removes any sale it had recorded).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_back_kernel_dispatch(
    p_order_id      uuid,
    p_note          text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o public.kernel_dispatch_orders%ROWTYPE;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    IF o.status IN ('dispatched', 'cancelled') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This dispatch has already gone out or was cancelled.');
    END IF;
    IF o.workflow_stage IS NULL OR o.workflow_stage = 'picking' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This dispatch is already waiting to be picked.');
    END IF;

    DELETE FROM public.data_kernel_sales_lines WHERE dispatch_order_id = p_order_id AND data_source = 'dispatch';

    UPDATE public.kernel_dispatch_orders
       SET workflow_stage = 'picking',
           review_note = NULLIF(trim(COALESCE(p_note, '')), ''),
           approved_at = NULL, approved_by = NULL, sale_value_zar = NULL,
           updated_at = now(), updated_by = COALESCE(p_actor_user_id, updated_by)
     WHERE id = p_order_id;
    RETURN jsonb_build_object('success', true, 'workflow_stage', 'picking');
END;
$$;

-- ---------------------------------------------------------------------------
-- Step 3: Pete prices and approves; the sale is (re)written to the sales lines.
-- p_prices = [{ "index": 0, "price_per_kg": 145.5 }, ...] for every line with cartons > 0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_kernel_dispatch_sale(
    p_order_id           uuid,
    p_prices             jsonb,
    p_transport_payer    text,
    p_transport_cost_zar numeric DEFAULT NULL,
    p_pallets            integer DEFAULT NULL,
    p_transport_company  text DEFAULT NULL,
    p_sale_date          date DEFAULT NULL,
    p_actor_user_id      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o         public.kernel_dispatch_orders%ROWTYPE;
    v_lines   jsonb;
    v_item    jsonb;
    v_idx     integer;
    v_price   numeric;
    v_line    jsonb;
    v_total   numeric := 0;
    v_date    date;
    v_cust    uuid;
    v_code    text;
    v_kg      numeric;
    v_value   numeric;
    i         integer;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    IF o.status = 'cancelled' THEN
        RETURN jsonb_build_object('success', false, 'error', 'This dispatch was cancelled.');
    END IF;
    IF o.workflow_stage IS DISTINCT FROM 'approval' AND o.workflow_stage IS DISTINCT FROM 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Thando has not confirmed the picking for this dispatch yet.');
    END IF;
    IF p_transport_payer IS NULL OR p_transport_payer NOT IN ('macavation', 'customer') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose who pays for transport.');
    END IF;
    IF p_transport_cost_zar IS NOT NULL AND p_transport_cost_zar < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transport cost cannot be negative.');
    END IF;
    IF p_pallets IS NOT NULL AND p_pallets < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pallets cannot be negative.');
    END IF;

    v_lines := COALESCE(o.lines, '[]'::jsonb);
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_prices, '[]'::jsonb)) LOOP
        v_idx   := (v_item->>'index')::integer;
        v_price := (v_item->>'price_per_kg')::numeric;
        IF v_idx IS NULL OR v_idx < 0 OR v_idx >= jsonb_array_length(v_lines) THEN
            RETURN jsonb_build_object('success', false, 'error', 'The basket changed. Reload and try again.');
        END IF;
        IF v_price IS NULL OR v_price < 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Enter a price per kg for every line.');
        END IF;
        v_lines := jsonb_set(v_lines, ARRAY[v_idx::text], (v_lines->v_idx) || jsonb_build_object('price_per_kg', ROUND(v_price, 4)));
    END LOOP;

    FOR i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
        v_line := v_lines->i;
        IF COALESCE((v_line->>'cartons')::numeric, 0) > 0 THEN
            IF (v_line->>'price_per_kg') IS NULL THEN
                RETURN jsonb_build_object('success', false, 'error', 'Enter a price per kg for every line.');
            END IF;
            v_total := v_total + ROUND((v_line->>'quantity_kg')::numeric * (v_line->>'price_per_kg')::numeric, 2);
        END IF;
    END LOOP;

    v_date := COALESCE(p_sale_date, o.delivery_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
    SELECT id INTO v_cust FROM public.contacts WHERE id = o.buyer_contact_id;

    DELETE FROM public.data_kernel_sales_lines WHERE dispatch_order_id = p_order_id AND data_source = 'dispatch';

    FOR i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
        v_line := v_lines->i;
        v_kg := COALESCE((v_line->>'quantity_kg')::numeric, 0);
        CONTINUE WHEN COALESCE((v_line->>'cartons')::numeric, 0) <= 0;
        v_code  := public.kernel_style_code_from_dispatch(v_line->>'style');
        v_value := ROUND(v_kg * (v_line->>'price_per_kg')::numeric, 2);
        INSERT INTO public.data_kernel_sales_lines
            (sale_date, customer_id, customer_name, invoice_number, item_code, style_code, description,
             cartons, quantity_kg, price_per_kg, vat_excl_zar, vat_zar, vat_incl_zar,
             data_source, edited_by, edited_at, notes, dispatch_order_id)
        VALUES
            (v_date, v_cust, COALESCE(NULLIF(trim(o.buyer_name), ''), '(no customer)'), NULL,
             (SELECT item_code FROM public.kernel_style_registry WHERE style_code = v_code),
             (SELECT style_code FROM public.kernel_style_registry WHERE style_code = v_code),
             'Dispatch, batch ' || COALESCE(v_line->>'batch_number', '?') || ', ' || COALESCE(v_line->>'style', '?'),
             (v_line->>'cartons')::numeric, v_kg, (v_line->>'price_per_kg')::numeric, v_value, 0, v_value,
             'dispatch', (SELECT id FROM public.users WHERE id = p_actor_user_id), now(),
             'Recorded when the dispatch was approved. VAT not calculated.', p_order_id);
    END LOOP;

    UPDATE public.kernel_dispatch_orders
       SET lines = v_lines,
           workflow_stage = 'approved',
           approved_at = now(),
           approved_by = p_actor_user_id,
           transport_payer = p_transport_payer,
           transport_cost_zar = p_transport_cost_zar,
           transport_company = NULLIF(trim(COALESCE(p_transport_company, '')), ''),
           pallets = p_pallets,
           sale_value_zar = v_total,
           review_note = NULL,
           updated_at = now(),
           updated_by = COALESCE(p_actor_user_id, updated_by)
     WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'workflow_stage', 'approved', 'sale_value_zar', v_total);
EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Prices must be numbers, e.g. 145.50.');
END;
$$;

-- ---------------------------------------------------------------------------
-- Keep the recorded sale honest: if an approved basket is edited (cartons, batch or
-- style change through the existing edit screens), it drops back to 'approval' and its
-- sale lines are removed; a cancelled dispatch loses its sale lines too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._kernel_dispatch_lines_core(p_lines jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kernel_id', l->>'kernel_id', 'style', l->>'style',
               'cartons', (l->>'cartons')::numeric) ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS t(l, ord);
$$;

CREATE OR REPLACE FUNCTION public.trg_kernel_dispatch_sale_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        DELETE FROM public.data_kernel_sales_lines WHERE dispatch_order_id = NEW.id AND data_source = 'dispatch';
        NEW.sale_value_zar := NULL;
    ELSIF OLD.workflow_stage = 'approved' AND NEW.workflow_stage = 'approved'
          AND public._kernel_dispatch_lines_core(OLD.lines) IS DISTINCT FROM public._kernel_dispatch_lines_core(NEW.lines) THEN
        DELETE FROM public.data_kernel_sales_lines WHERE dispatch_order_id = NEW.id AND data_source = 'dispatch';
        NEW.workflow_stage := 'approval';
        NEW.approved_at := NULL;
        NEW.approved_by := NULL;
        NEW.sale_value_zar := NULL;
        NEW.review_note := 'The basket was changed after approval, so it needs approving again.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kernel_dispatch_sale_guard ON public.kernel_dispatch_orders;
CREATE TRIGGER kernel_dispatch_sale_guard
    BEFORE UPDATE ON public.kernel_dispatch_orders
    FOR EACH ROW EXECUTE FUNCTION public.trg_kernel_dispatch_sale_guard();

-- ---------------------------------------------------------------------------
-- Kernel Dashboard: dispatch-side figures (waiting counts, transport, price vs list).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kernel_dashboard_dispatch_sales(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    v_res   jsonb;
BEGIN
    SELECT jsonb_build_object(
        'success', true,
        'awaiting_pick', (SELECT COUNT(*) FROM public.kernel_dispatch_orders
                          WHERE workflow_stage = 'picking' AND status NOT IN ('dispatched', 'cancelled')),
        'awaiting_approval', (SELECT COUNT(*) FROM public.kernel_dispatch_orders
                              WHERE workflow_stage = 'approval' AND status NOT IN ('dispatched', 'cancelled')),
        'dispatch_count', (SELECT COUNT(*) FROM public.kernel_dispatch_orders
                           WHERE workflow_stage = 'approved' AND status <> 'cancelled'
                             AND COALESCE(delivery_date, approved_at::date) BETWEEN p_from AND p_to),
        'transport_paid_zar', (SELECT COALESCE(SUM(transport_cost_zar), 0) FROM public.kernel_dispatch_orders
                               WHERE workflow_stage = 'approved' AND transport_payer = 'macavation' AND status <> 'cancelled'
                                 AND COALESCE(delivery_date, approved_at::date) BETWEEN p_from AND p_to),
        'dispatch_sales_zar', (SELECT COALESCE(SUM(vat_excl_zar), 0) FROM public.data_kernel_sales_lines
                               WHERE data_source = 'dispatch' AND sale_date BETWEEN p_from AND p_to),
        'by_style', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'style_code', s.style_code, 'label', r.label,
                       'kg', s.kg, 'zar', s.zar,
                       'avg_price', CASE WHEN s.kg > 0 THEN ROUND(s.zar / s.kg, 2) END,
                       'list_price', public.kernel_style_price_on(s.style_code, NULL, v_today)
                   ) ORDER BY s.zar DESC)
            FROM (
                SELECT style_code, SUM(quantity_kg) AS kg, SUM(vat_excl_zar) AS zar
                FROM public.data_kernel_sales_lines
                WHERE sale_date BETWEEN p_from AND p_to AND style_code IS NOT NULL
                GROUP BY style_code
            ) s
            LEFT JOIN public.kernel_style_registry r ON r.style_code = s.style_code
        ), '[]'::jsonb)
    ) INTO v_res;
    RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_workflow(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_stages(uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_kernel_dispatch_pick(uuid, jsonb, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_back_kernel_dispatch(uuid, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_kernel_dispatch_sale(uuid, jsonb, text, numeric, integer, text, date, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dashboard_dispatch_sales(date, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
