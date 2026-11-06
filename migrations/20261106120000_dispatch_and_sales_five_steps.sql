-- ============================================================================
-- Dispatch and Sales: five steps, substitutes, stock count flags, customer price end dates,
-- Joslyn's invoice task, and the renamed kernel screens.
--
-- WHY. Mike Potgieter's email of 5 Nov 2026 (mockup: claude.ai/artifact/9EKz5E1GizykCJNYhxW8AT,
-- checked by a Fable review on 6 Nov). Every dispatch shows five steps:
--   1 Dispatch created     row exists
--   2 Stock picked         workflow_stage IN ('approval', 'approved')
--   3 Pricing confirmed    workflow_stage = 'approved'
--   4 Truck loaded         status = 'dispatched' (the truck / inspection form, unchanged)
--   5 Invoice sent         invoice_sent_at IS NOT NULL (new; Joslyn ticks it)
-- Steps 4 and 5 are derived, so the workflow_stage CHECK constraint does not change. Orders made
-- before the workflow (workflow_stage NULL) keep working as before and show no steps.
--
-- Decisions taken for Mike (all easy to change; listed in the PR):
--   * Planned Delivery Date is gone from the screens. delivery_date now always equals the planned
--     collection date (trigger below), so every report, RPC and the oil side keep working.
--   * The truck form can't be saved until Pete has confirmed pricing (workflow orders only).
--   * The sale is recorded at pricing, dated on the collection date; when the truck is loaded the
--     sale lines are re-dated to the real dispatch date and get the delivery note / invoice number.
--   * A customer price that has ended falls back to the standard price list. Pete is reminded
--     expiry_days (default 60) before a customer's price ends.
--   * Substitutes: same style from another batch is Thando's call; a different style is marked
--     needs_approval and Pete accepts it by confirming pricing (or sends it back).
--   * A line picked short flags that batch + style "count needed" on Stock on Hand.
--   * Pick changes notify Joslyn (Palladium Manager), Mike (Procurement Lead) and Pete (Sales Exec)
--     by bell notification, one per role, through the Role Features switch
--     notify-dispatch-pick-changed. Not a task: a task has one shared status.
--   * Orders already dispatched before today are marked invoice sent, so Joslyn starts clean.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.kernel_dispatch_orders
    ADD COLUMN IF NOT EXISTS invoice_sent_at   timestamptz,
    ADD COLUMN IF NOT EXISTS invoice_sent_by   uuid,
    ADD COLUMN IF NOT EXISTS invoice_note      text;

-- Joslyn starts with nothing outstanding: everything already gone out counts as invoiced.
UPDATE public.kernel_dispatch_orders
   SET invoice_sent_at = COALESCE(dispatched_at, updated_at, now()),
       invoice_note = 'Dispatched before the invoice step existed (6 Nov 2026).'
 WHERE status = 'dispatched' AND invoice_sent_at IS NULL;

ALTER TABLE public.kernel_style_prices
    ADD COLUMN IF NOT EXISTS valid_until date;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kernel_style_prices_valid_until_check') THEN
        ALTER TABLE public.kernel_style_prices
            ADD CONSTRAINT kernel_style_prices_valid_until_check CHECK (valid_until IS NULL OR valid_until >= effective_from);
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Planned Delivery Date retired: delivery_date follows the collection date.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_kernel_dispatch_delivery_is_collection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.planned_collection_date IS NOT NULL THEN
        NEW.delivery_date := NEW.planned_collection_date;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_dispatch_delivery_is_collection
    BEFORE INSERT OR UPDATE OF planned_collection_date, delivery_date ON public.kernel_dispatch_orders
    FOR EACH ROW EXECUTE FUNCTION public._trg_kernel_dispatch_delivery_is_collection();

-- 'Bn 01 26 05' (and the odd '02.26.22' import) -> 'BN.01.26.05'. Anything else (oil lots) is unchanged.
-- Same rule as macBatchNo.format in WebPortal/js/batch-number-format.js.
CREATE OR REPLACE FUNCTION public._fmt_batch_number(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT regexp_replace(COALESCE(p, ''), '^(?:[Bb][Nn][ .]?)?(\d{2})[ .](\d{2})[ .](\d+)$', 'BN.\1.\2.\3'); $$;

-- ----------------------------------------------------------------------------
-- 3. Stock count flags ("count needed" on Stock on Hand)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kernel_stock_count_flags (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kernel_id          text NOT NULL,
    batch_number       text,
    style              text NOT NULL,
    asked_cartons      numeric(12,2),
    found_cartons      numeric(12,2),
    dispatch_order_id  uuid REFERENCES public.kernel_dispatch_orders(id) ON DELETE SET NULL,
    note               text,
    flagged_by         uuid,
    flagged_at         timestamptz NOT NULL DEFAULT now(),
    cleared_at         timestamptz,
    cleared_by         uuid,
    cleared_note       text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_stock_count_flags_open
    ON public.kernel_stock_count_flags (kernel_id, style) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kernel_stock_count_flags_dispatch_order_id
    ON public.kernel_stock_count_flags (dispatch_order_id);
ALTER TABLE public.kernel_stock_count_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kernel_stock_count_flags FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_kernel_stock_count_flags()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'flags', COALESCE(jsonb_agg(jsonb_build_object(
               'id', f.id, 'kernel_id', f.kernel_id, 'batch_number', f.batch_number, 'style', f.style,
               'asked_cartons', f.asked_cartons, 'found_cartons', f.found_cartons, 'note', f.note,
               'flagged_at', f.flagged_at, 'flagged_by_label', public.stock_history_user_label(f.flagged_by),
               'buyer_name', o.buyer_name) ORDER BY f.flagged_at DESC), '[]'::jsonb))
    FROM (SELECT * FROM public.kernel_stock_count_flags WHERE cleared_at IS NULL ORDER BY flagged_at DESC LIMIT 500) f
    LEFT JOIN public.kernel_dispatch_orders o ON o.id = f.dispatch_order_id;
$$;

-- Clears the open flags on one batch (one style, or all styles when p_style is NULL).
CREATE OR REPLACE FUNCTION public.clear_kernel_stock_count_flags(
    p_kernel_id text, p_style text DEFAULT NULL, p_note text DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_n integer;
BEGIN
    IF p_kernel_id IS NULL OR trim(p_kernel_id) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a batch.');
    END IF;
    UPDATE public.kernel_stock_count_flags
       SET cleared_at = now(), cleared_by = p_actor_user_id, cleared_note = NULLIF(trim(COALESCE(p_note, '')), '')
     WHERE kernel_id = p_kernel_id AND cleared_at IS NULL AND (p_style IS NULL OR style = p_style);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'cleared', v_n);
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Picking with substitutes
-- ----------------------------------------------------------------------------
-- Bell notification to every role with the given Role Features switch on.
CREATE OR REPLACE FUNCTION public._notify_feature_roles(
    p_feature_key text, p_title text, p_body text, p_link_route text, p_link_params jsonb, p_created_by uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_n integer := 0;
    r   record;
BEGIN
    FOR r IN SELECT DISTINCT rf.role_id
             FROM public.role_features rf
             JOIN public.features f ON f.id = rf.feature_id
             WHERE f.key = p_feature_key AND f.is_active AND rf.value = 'true'
    LOOP
        INSERT INTO public.notifications (title, body, notification_type, severity, link_route, link_params, target_role_id, created_by)
        VALUES (p_title, p_body, 'task', 'warning', p_link_route, p_link_params, r.role_id, p_created_by);
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

-- p_picked:      [{index, cartons}]  for the requested lines (the substitute lines are rebuilt).
-- p_substitutes: [{for_index, kernel_id, batch_number, style, cartons}]
-- Substitute lines always sit after the requested lines, so the requested lines keep their index.
CREATE OR REPLACE FUNCTION public.confirm_kernel_dispatch_pick_with_substitutes(
    p_order_id uuid, p_picked jsonb DEFAULT '[]'::jsonb, p_substitutes jsonb DEFAULT '[]'::jsonb,
    p_note text DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o          public.kernel_dispatch_orders%ROWTYPE;
    v_all      jsonb;
    v_lines    jsonb := '[]'::jsonb;   -- requested lines only
    v_old_subs jsonb := '[]'::jsonb;
    v_subs     jsonb := '[]'::jsonb;
    v_item     jsonb;
    v_line     jsonb;
    v_idx      integer;
    v_new      numeric;
    v_old      numeric;
    v_req      numeric;
    v_short    numeric;
    v_used     numeric;
    v_avail    numeric;
    v_mine     numeric;
    v_total    numeric;
    v_batchno  text;
    v_changes  text[] := '{}';
    v_buyer    text;
    i          integer;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    IF o.status IN ('dispatched', 'cancelled') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This dispatch has already gone out or was cancelled.');
    END IF;
    IF o.workflow_stage = 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pete has already confirmed the pricing. Ask him to send it back first.');
    END IF;

    v_all := CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END;
    FOR i IN 0 .. jsonb_array_length(v_all) - 1 LOOP
        IF (v_all->i) ? 'substitute_for' THEN
            v_old_subs := v_old_subs || jsonb_build_array(v_all->i);
        ELSE
            v_lines := v_lines || jsonb_build_array(v_all->i);
        END IF;
    END LOOP;

    -- Requested lines: lower only (same rule as confirm_kernel_dispatch_pick).
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_picked, '[]'::jsonb)) LOOP
        v_idx := (v_item->>'index')::integer;
        v_new := (v_item->>'cartons')::numeric;
        IF v_idx IS NULL OR v_idx < 0 OR v_idx >= jsonb_array_length(v_lines) THEN
            RETURN jsonb_build_object('success', false, 'error', 'The basket changed while you were picking. Reload and try again.');
        END IF;
        v_line := v_lines->v_idx;
        v_old  := (v_line->>'cartons')::numeric;
        v_req  := COALESCE((v_line->>'requested_cartons')::numeric, v_old);
        IF v_new IS NULL OR v_new < 0 OR v_new <> trunc(v_new) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Picked cartons must be whole numbers.');
        END IF;
        IF v_new > v_req THEN
            RETURN jsonb_build_object('success', false, 'error',
                format('You cannot pick more than was asked for (%s cartons of %s). Use + Substitute for extra cartons from another batch.', v_req, v_line->>'style'));
        END IF;
        v_line := v_line || jsonb_build_object('requested_cartons', v_req, 'cartons', v_new, 'quantity_kg', ROUND(v_new * 11.34, 2));
        v_lines := jsonb_set(v_lines, ARRAY[v_idx::text], v_line);
    END LOOP;

    -- Substitutes
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_substitutes, '[]'::jsonb)) LOOP
        v_idx := (v_item->>'for_index')::integer;
        v_new := (v_item->>'cartons')::numeric;
        IF v_idx IS NULL OR v_idx < 0 OR v_idx >= jsonb_array_length(v_lines) THEN
            RETURN jsonb_build_object('success', false, 'error', 'A substitute points at a line that is not on this dispatch. Reload and try again.');
        END IF;
        IF v_new IS NULL OR v_new <= 0 OR v_new <> trunc(v_new) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Substitute cartons must be whole numbers above 0.');
        END IF;
        IF COALESCE(trim(v_item->>'kernel_id'), '') = '' OR COALESCE(trim(v_item->>'style'), '') = '' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Choose the batch and style for each substitute.');
        END IF;
        v_line  := v_lines->v_idx;
        v_short := COALESCE((v_line->>'requested_cartons')::numeric, (v_line->>'cartons')::numeric) - (v_line->>'cartons')::numeric;
        SELECT COALESCE(SUM((s->>'cartons')::numeric), 0) INTO v_used
        FROM jsonb_array_elements(v_subs) s WHERE (s->'substitute_for'->>'index')::integer = v_idx;
        IF v_used + v_new > v_short THEN
            RETURN jsonb_build_object('success', false, 'error',
                format('Substitutes for %s %s add up to more than the %s cartons that were not found.',
                       public._fmt_batch_number(v_line->>'batch_number'), v_line->>'style', v_short));
        END IF;

        -- Stock check on the substitute batch. Remaining stock already subtracts this order's own
        -- earlier substitute lines (they are still on the row), so add those back first.
        SELECT b.batch_number, (b.remaining_by_style_cartons ->> (v_item->>'style'))::numeric
          INTO v_batchno, v_avail
        FROM public.get_kernel_batches(NULL, NULL, 2000, 0) b
        WHERE b.id::text = v_item->>'kernel_id';
        IF v_batchno IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'That substitute batch was not found.');
        END IF;
        SELECT COALESCE(SUM((s->>'cartons')::numeric), 0) INTO v_mine
        FROM jsonb_array_elements(v_old_subs) s
        WHERE s->>'kernel_id' = v_item->>'kernel_id' AND s->>'style' = v_item->>'style';
        SELECT v_mine - COALESCE(SUM((s->>'cartons')::numeric), 0) INTO v_mine
        FROM jsonb_array_elements(v_subs) s
        WHERE s->>'kernel_id' = v_item->>'kernel_id' AND s->>'style' = v_item->>'style';
        IF COALESCE(v_avail, 0) + v_mine < v_new THEN
            RETURN jsonb_build_object('success', false, 'error',
                format('%s only has %s cartons of %s left.', public._fmt_batch_number(v_batchno),
                       trim(to_char(GREATEST(COALESCE(v_avail, 0) + v_mine, 0), 'FM999G990')), v_item->>'style'));
        END IF;

        v_subs := v_subs || jsonb_build_array(jsonb_build_object(
            'kernel_id', v_item->>'kernel_id',
            'batch_number', v_batchno,
            'style', v_item->>'style',
            'cartons', v_new,
            'requested_cartons', 0,
            'quantity_kg', ROUND(v_new * 11.34, 2),
            'substitute_for', jsonb_build_object('index', v_idx, 'batch_number', v_line->>'batch_number', 'style', v_line->>'style'),
            'needs_approval', (v_item->>'style') IS DISTINCT FROM (v_line->>'style')));
        v_changes := v_changes || format('%s cartons of %s from %s instead of %s %s%s',
            v_new, v_item->>'style', public._fmt_batch_number(v_batchno),
            public._fmt_batch_number(v_line->>'batch_number'), v_line->>'style',
            CASE WHEN (v_item->>'style') IS DISTINCT FROM (v_line->>'style') THEN ' (different style, needs Pete''s OK)' ELSE '' END);
    END LOOP;

    v_all := v_lines || v_subs;
    SELECT COALESCE(SUM((l->>'cartons')::numeric), 0) INTO v_total FROM jsonb_array_elements(v_all) l;
    IF v_total <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nothing was picked. Send the dispatch back to Pete with a note instead.');
    END IF;

    -- Short lines: note the change and flag the batch for a count.
    FOR i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
        v_line := v_lines->i;
        v_req  := (v_line->>'requested_cartons')::numeric;
        CONTINUE WHEN v_req IS NULL OR (v_line->>'cartons')::numeric >= v_req;
        v_changes := array_prepend(format('%s %s: %s asked, %s found',
            public._fmt_batch_number(v_line->>'batch_number'), v_line->>'style', v_req, (v_line->>'cartons')::numeric), v_changes);
        IF COALESCE(v_line->>'kernel_id', '') <> '' THEN
            INSERT INTO public.kernel_stock_count_flags
                (kernel_id, batch_number, style, asked_cartons, found_cartons, dispatch_order_id, note, flagged_by)
            VALUES (v_line->>'kernel_id', v_line->>'batch_number', v_line->>'style', v_req, (v_line->>'cartons')::numeric,
                    p_order_id, NULLIF(trim(COALESCE(p_note, '')), ''), p_actor_user_id)
            ON CONFLICT (kernel_id, style) WHERE cleared_at IS NULL
            DO UPDATE SET asked_cartons = EXCLUDED.asked_cartons, found_cartons = EXCLUDED.found_cartons,
                          dispatch_order_id = EXCLUDED.dispatch_order_id, note = EXCLUDED.note,
                          flagged_by = EXCLUDED.flagged_by, flagged_at = now();
        END IF;
    END LOOP;

    UPDATE public.kernel_dispatch_orders
       SET lines = v_all,
           workflow_stage = 'approval',
           picked_at = now(),
           picked_by = p_actor_user_id,
           pick_note = NULLIF(trim(COALESCE(p_note, '')), ''),
           updated_at = now(),
           updated_by = COALESCE(p_actor_user_id, updated_by)
     WHERE id = p_order_id;

    IF cardinality(v_changes) > 0 THEN
        v_buyer := COALESCE(NULLIF(trim(o.buyer_name), ''), 'customer');
        PERFORM public._notify_feature_roles('notify-dispatch-pick-changed',
            'Pick changed: ' || v_buyer,
            COALESCE(NULLIF(public.stock_history_user_label(p_actor_user_id), ''), 'The picker')
                || ' picked ' || trim(to_char(v_total, 'FM999G990')) || ' cartons. '
                || array_to_string(v_changes, '; ') || '.'
                || COALESCE(' Note: "' || NULLIF(trim(COALESCE(p_note, '')), '') || '"', ''),
            'kernel-dispatch-grid', jsonb_build_object('dispatch_order_id', p_order_id), p_actor_user_id);
    END IF;

    RETURN jsonb_build_object('success', true, 'workflow_stage', 'approval', 'changes', cardinality(v_changes));
EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cartons must be whole numbers.');
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Pricing: per-line reasons, substitutes accepted, sale dated on the collection date.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_kernel_dispatch_sale(p_order_id uuid, p_prices jsonb, p_transport_payer text, p_transport_cost_zar numeric DEFAULT NULL::numeric, p_pallets integer DEFAULT NULL::integer, p_transport_company text DEFAULT NULL::text, p_sale_date date DEFAULT NULL::date, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        v_line := (v_lines->v_idx) || jsonb_build_object('price_per_kg', ROUND(v_price, 4));
        IF NULLIF(trim(COALESCE(v_item->>'price_note', '')), '') IS NOT NULL THEN
            v_line := v_line || jsonb_build_object('price_note', trim(v_item->>'price_note'));
        ELSE
            v_line := v_line - 'price_note';
        END IF;
        v_lines := jsonb_set(v_lines, ARRAY[v_idx::text], v_line);
    END LOOP;

    FOR i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
        v_line := v_lines->i;
        -- Confirming the pricing accepts any different-style substitute.
        IF COALESCE((v_line->>'needs_approval')::boolean, false) THEN
            v_lines := jsonb_set(v_lines, ARRAY[i::text], v_line || jsonb_build_object('substitute_accepted', true));
        END IF;
        IF COALESCE((v_line->>'cartons')::numeric, 0) > 0 THEN
            IF (v_line->>'price_per_kg') IS NULL THEN
                RETURN jsonb_build_object('success', false, 'error', 'Enter a price per kg for every line.');
            END IF;
            v_total := v_total + ROUND((v_line->>'quantity_kg')::numeric * (v_line->>'price_per_kg')::numeric, 2);
        END IF;
    END LOOP;

    v_date := COALESCE(p_sale_date, o.planned_collection_date, o.delivery_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
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
            (v_date, v_cust, COALESCE(NULLIF(trim(o.buyer_name), ''), '(no customer)'),
             NULLIF(trim(COALESCE(o.record->>'delivery_note_number', '')), ''),
             (SELECT item_code FROM public.kernel_style_registry WHERE style_code = v_code),
             (SELECT style_code FROM public.kernel_style_registry WHERE style_code = v_code),
             'Dispatch, batch ' || COALESCE(public._fmt_batch_number(v_line->>'batch_number'), '?') || ', ' || COALESCE(v_line->>'style', '?'),
             (v_line->>'cartons')::numeric, v_kg, (v_line->>'price_per_kg')::numeric, v_value, 0, v_value,
             'dispatch', (SELECT id FROM public.users WHERE id = p_actor_user_id), now(),
             'Recorded when the pricing was confirmed. VAT not calculated.', p_order_id);
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
$function$;

-- ----------------------------------------------------------------------------
-- 6. Workflow read: prices on the collection date, substitutes, customer details, steps 4-5.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_workflow(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    o       public.kernel_dispatch_orders%ROWTYPE;
    v_mode  text := COALESCE((SELECT value #>> '{}' FROM public.kernel_pipeline_settings WHERE key = 'kernel_pricing'), 'single');
    v_on    date;
    v_lines jsonb;
    v_cust  jsonb;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    v_on := COALESCE(o.planned_collection_date, o.delivery_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date);

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
               'price_note', l.v->>'price_note',
               'list_price', public.kernel_style_price_on(l.v->>'style', o.buyer_contact_id, v_on),
               'price_source', CASE
                   WHEN EXISTS (SELECT 1 FROM public.kernel_style_prices s
                                WHERE s.customer_id = o.buyer_contact_id AND o.buyer_contact_id IS NOT NULL
                                  AND s.style_code = public.kernel_style_code_from_dispatch(l.v->>'style')
                                  AND s.effective_from <= v_on AND (s.valid_until IS NULL OR s.valid_until >= v_on))
                   THEN 'customer'
                   WHEN public.kernel_style_price_on(l.v->>'style', o.buyer_contact_id, v_on) IS NOT NULL THEN 'list'
               END,
               'price_valid_until', (SELECT s.valid_until FROM public.kernel_style_prices s
                                     WHERE s.customer_id = o.buyer_contact_id AND o.buyer_contact_id IS NOT NULL
                                       AND s.style_code = public.kernel_style_code_from_dispatch(l.v->>'style')
                                       AND s.effective_from <= v_on AND (s.valid_until IS NULL OR s.valid_until >= v_on)
                                     ORDER BY s.effective_from DESC, s.created_at DESC LIMIT 1),
               'substitute_for', l.v->'substitute_for',
               'needs_approval', COALESCE((l.v->>'needs_approval')::boolean, false),
               'substitute_accepted', COALESCE((l.v->>'substitute_accepted')::boolean, false)
           ) ORDER BY l.ord), '[]'::jsonb)
    INTO v_lines
    FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) WITH ORDINALITY AS l(v, ord)
    LEFT JOIN public.kernel_style_registry r ON r.style_code = public.kernel_style_code_from_dispatch(l.v->>'style');

    SELECT jsonb_build_object(
               'id', c.id,
               'name', COALESCE(NULLIF(trim(c.company_name), ''), c.trading_name),
               'contact_person', c.primary_contact_name,
               'phone', COALESCE(NULLIF(trim(c.primary_contact_mobile), ''), c.primary_contact_phone),
               'email', c.primary_contact_email,
               'vat_number', c.vat_number,
               'address', concat_ws(', ', NULLIF(trim(c.physical_address_line1), ''), NULLIF(trim(c.physical_address_line2), ''),
                                    NULLIF(trim(c.physical_area), ''), NULLIF(trim(c.physical_city), ''),
                                    NULLIF(trim(c.physical_province), ''), NULLIF(trim(c.physical_postal_code), '')))
      INTO v_cust
    FROM public.contacts c WHERE c.id = o.buyer_contact_id;

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
            'sale_value_zar', o.sale_value_zar,
            'dispatched_at', o.dispatched_at,
            'delivery_note_number', o.record->>'delivery_note_number',
            'invoice_sent_at', o.invoice_sent_at,
            'invoice_sent_by_label', public.stock_history_user_label(o.invoice_sent_by),
            'invoice_note', o.invoice_note
        ),
        'customer', v_cust,
        'pricing_mode', v_mode,
        'price_date', v_on,
        'kg_per_carton', 11.34,
        'lines', v_lines
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_stages(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'workflow_stage', workflow_stage,
               'status', status,
               'invoice_sent_at', invoice_sent_at,
               'picked_by_label', public.stock_history_user_label(picked_by),
               'has_pick_changes', EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(lines, '[]'::jsonb)) l
                                           WHERE ((l->>'requested_cartons') IS NOT NULL
                                                  AND (l->>'requested_cartons')::numeric <> (l->>'cartons')::numeric)
                                              OR l ? 'substitute_for'),
               'substitutes', (SELECT COUNT(*) FROM jsonb_array_elements(COALESCE(lines, '[]'::jsonb)) l WHERE l ? 'substitute_for'),
               'needs_approval', EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(lines, '[]'::jsonb)) l
                                         WHERE COALESCE((l->>'needs_approval')::boolean, false)
                                           AND NOT COALESCE((l->>'substitute_accepted')::boolean, false)))), '[]'::jsonb)
    FROM public.kernel_dispatch_orders
    WHERE id = ANY (COALESCE(p_ids, '{}'))
      AND cardinality(COALESCE(p_ids, '{}')) <= 500;
$function$;

-- ----------------------------------------------------------------------------
-- 7. Truck loaded (step 4): only after pricing; re-dates the sale and stamps the invoice number.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_kernel_dispatch_record(p_dispatch_order_id uuid, p_vehicle_clean_yn text DEFAULT NULL::text, p_vehicle_enclosed_yn text DEFAULT NULL::text, p_hazard_substances_yn text DEFAULT NULL::text, p_pest_infestations_yn text DEFAULT NULL::text, p_pallets_condition_yn text DEFAULT NULL::text, p_truck_bin_locked_yn text DEFAULT NULL::text, p_dispatch_person text DEFAULT NULL::text, p_transport_company text DEFAULT NULL::text, p_delivery_note_number text DEFAULT NULL::text, p_date_dispatched date DEFAULT NULL::date, p_truck_registration text DEFAULT NULL::text, p_driver_name text DEFAULT NULL::text, p_time_dispatched time without time zone DEFAULT NULL::time without time zone, p_dispatched_to text DEFAULT NULL::text, p_dispatch_signature text DEFAULT NULL::text, p_attention_cell text DEFAULT NULL::text, p_transporter_id uuid DEFAULT NULL::uuid, p_inspection_comments jsonb DEFAULT NULL::jsonb, p_inspection_photos jsonb DEFAULT NULL::jsonb, p_attachments jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_stage  text;
    v_status text;
BEGIN
    IF p_dispatch_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'dispatch_order_id is required');
    END IF;

    SELECT workflow_stage, status INTO v_stage, v_status
    FROM public.kernel_dispatch_orders WHERE id = p_dispatch_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Dispatch order not found');
    END IF;
    IF v_status = 'cancelled' THEN
        RETURN json_build_object('success', false, 'error', 'This dispatch was cancelled.');
    END IF;
    -- Older orders (no workflow) keep the old behaviour.
    IF v_stage IS NOT NULL AND v_stage <> 'approved' THEN
        RETURN json_build_object('success', false, 'error',
            CASE WHEN v_stage = 'picking' THEN 'Thando has not confirmed the picking yet, so the truck can''t be loaded.'
                 ELSE 'Pete has not confirmed the pricing yet, so the truck can''t be loaded.' END);
    END IF;

    UPDATE public.kernel_dispatch_orders
    SET
        record = jsonb_build_object(
            'vehicle_clean_yn',     p_vehicle_clean_yn,
            'vehicle_enclosed_yn',  p_vehicle_enclosed_yn,
            'hazard_substances_yn', p_hazard_substances_yn,
            'pest_infestations_yn', p_pest_infestations_yn,
            'pallets_condition_yn', p_pallets_condition_yn,
            'truck_bin_locked_yn',  p_truck_bin_locked_yn,
            'dispatch_person',      p_dispatch_person,
            'transport_company',    p_transport_company,
            'delivery_note_number', p_delivery_note_number,
            'date_dispatched',      p_date_dispatched::text,
            'truck_registration',   p_truck_registration,
            'driver_name',          p_driver_name,
            'time_dispatched',      p_time_dispatched::text,
            'dispatched_to',        p_dispatched_to,
            'dispatch_signature',   p_dispatch_signature,
            'attention_cell',       p_attention_cell,
            'transporter_id',       p_transporter_id::text,
            'inspection_comments',  COALESCE(p_inspection_comments, '{}'::jsonb),
            'inspection_photos',    COALESCE(p_inspection_photos, '{}'::jsonb),
            'attachments',          COALESCE(p_attachments, '[]'::jsonb)
        ),
        status        = 'dispatched',
        dispatched_at = COALESCE(dispatched_at, NOW()),
        updated_at    = NOW()
    WHERE id = p_dispatch_order_id;

    UPDATE public.data_kernel_sales_lines
       SET sale_date = COALESCE(p_date_dispatched, sale_date),
           invoice_number = COALESCE(NULLIF(trim(COALESCE(p_delivery_note_number, '')), ''), invoice_number),
           edited_at = now()
     WHERE dispatch_order_id = p_dispatch_order_id AND data_source = 'dispatch';

    RETURN json_build_object('success', true, 'message', 'Dispatch record saved; order marked as dispatched');
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- Undo a dispatch also undoes the invoice step.
CREATE OR REPLACE FUNCTION public.revert_kernel_dispatch_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_status text;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order id is required');
    END IF;

    SELECT lower(trim(coalesce(status, ''))) INTO v_status
    FROM public.kernel_dispatch_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_status IS NULL OR v_status = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    IF v_status <> 'dispatched' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only dispatched orders can be returned to awaiting dispatch');
    END IF;

    UPDATE public.kernel_dispatch_orders
    SET
        status = 'pending',
        record = '{}'::jsonb,
        dispatched_at = NULL,
        invoice_sent_at = NULL,
        invoice_sent_by = NULL,
        invoice_note = NULL,
        updated_at = now()
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'message', 'Order returned to awaiting dispatch; dispatch paperwork was cleared.');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ----------------------------------------------------------------------------
-- 8. Invoice sent (step 5)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_kernel_dispatch_invoice_sent(
    p_order_id uuid, p_sent boolean DEFAULT true, p_note text DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
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
    IF COALESCE(p_sent, true) THEN
        IF o.status IS DISTINCT FROM 'dispatched' THEN
            RETURN jsonb_build_object('success', false, 'error', 'The truck has not been loaded yet.');
        END IF;
        UPDATE public.kernel_dispatch_orders
           SET invoice_sent_at = now(), invoice_sent_by = p_actor_user_id,
               invoice_note = NULLIF(trim(COALESCE(p_note, '')), ''),
               updated_at = now(), updated_by = COALESCE(p_actor_user_id, updated_by)
         WHERE id = p_order_id;
    ELSE
        UPDATE public.kernel_dispatch_orders
           SET invoice_sent_at = NULL, invoice_sent_by = NULL, invoice_note = NULL,
               updated_at = now(), updated_by = COALESCE(p_actor_user_id, updated_by)
         WHERE id = p_order_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'invoice_sent', COALESCE(p_sent, true));
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Tasks: pick -> Production Manager; price -> Sales Exec; invoice -> Palladium Manager.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dispatch_stage_tasks(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o         public.kernel_dispatch_orders%ROWTYPE;
    v_key     text := p_order_id::text;
    v_buyer   text;
    v_cartons numeric;
    v_styles  integer;
    v_changed integer;
    v_subs    integer;
    v_ok      integer;
    v_desc    text;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id;
    IF NOT FOUND OR o.status = 'cancelled' OR o.workflow_stage IS NULL THEN
        PERFORM public._close_tasks('dispatch_pick', v_key);
        PERFORM public._close_tasks('dispatch_approve', v_key);
        PERFORM public._close_tasks('dispatch_invoice', v_key);
        RETURN;
    END IF;

    v_buyer := COALESCE(NULLIF(trim(o.buyer_name), ''), 'customer');

    IF o.workflow_stage = 'approved' THEN
        PERFORM public._close_tasks('dispatch_pick', v_key);
        PERFORM public._close_tasks('dispatch_approve', v_key);
        IF o.status = 'dispatched' AND o.invoice_sent_at IS NULL THEN
            PERFORM public._open_task('dispatch_invoice', v_key,
                'Send the invoice and documents to ' || v_buyer,
                concat_ws(' ',
                    'The truck was loaded' || COALESCE(' on ' || to_char(o.dispatched_at AT TIME ZONE 'Africa/Johannesburg', 'Dy FMDD Mon HH24:MI'), '') || '.',
                    'Delivery note / invoice number: ' || NULLIF(trim(COALESCE(o.record->>'delivery_note_number', '')), '') || '.',
                    'Tick "Invoice sent" on Dispatch and Sales when it has gone.'),
                'kernel_dispatch_order', o.id);
        ELSE
            PERFORM public._close_tasks('dispatch_invoice', v_key);
        END IF;
        RETURN;
    END IF;

    PERFORM public._close_tasks('dispatch_invoice', v_key);
    SELECT COALESCE(SUM(COALESCE((l ->> 'cartons')::numeric, 0)), 0),
           COUNT(DISTINCT l ->> 'style'),
           COUNT(*) FILTER (WHERE (l ->> 'requested_cartons') IS NOT NULL AND NOT l ? 'substitute_for'
                              AND (l ->> 'cartons')::numeric < (l ->> 'requested_cartons')::numeric),
           COUNT(*) FILTER (WHERE l ? 'substitute_for'),
           COUNT(*) FILTER (WHERE COALESCE((l ->> 'needs_approval')::boolean, false))
      INTO v_cartons, v_styles, v_changed, v_subs, v_ok
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) l;

    IF o.workflow_stage = 'picking' THEN
        PERFORM public._close_tasks('dispatch_approve', v_key);
        IF o.status = 'dispatched' THEN
            PERFORM public._close_tasks('dispatch_pick', v_key);
            RETURN;
        END IF;
        PERFORM public._open_task('dispatch_pick', v_key,
            'Pick the dispatch for ' || v_buyer || ': ' || trim(to_char(v_cartons, 'FM999G990')) || ' cartons, '
                || v_styles || CASE WHEN v_styles = 1 THEN ' style' ELSE ' styles' END,
            concat_ws(' ', 'Collected ' || to_char(COALESCE(o.planned_collection_date, o.delivery_date), 'Dy FMDD Mon') || '.',
                'Confirm what is on the shelf. If a line is short, lower it and add a substitute from another batch if you can.',
                CASE WHEN o.review_note IS NOT NULL AND trim(o.review_note) <> '' THEN 'Sent back: "' || trim(o.review_note) || '"' END),
            'kernel_dispatch_order', o.id);
    ELSE
        PERFORM public._close_tasks('dispatch_pick', v_key);
        v_desc := concat_ws(' ',
            'Picked' || COALESCE(' by ' || NULLIF(public.stock_history_user_label(o.picked_by), ''), '') || '.',
            CASE WHEN v_changed = 1 THEN '1 line was short.' WHEN v_changed > 1 THEN v_changed || ' lines were short.' END,
            CASE WHEN v_subs = 1 THEN '1 substitute.' WHEN v_subs > 1 THEN v_subs || ' substitutes.' END,
            CASE WHEN v_ok > 0 THEN 'A different style was substituted and needs your OK.' END,
            CASE WHEN o.pick_note IS NOT NULL AND trim(o.pick_note) <> '' THEN 'Note: "' || trim(o.pick_note) || '"' END);
        PERFORM public._open_task('dispatch_approve', v_key,
            'The dispatch for ' || v_buyer || ' is picked and waiting for your price', v_desc,
            'kernel_dispatch_order', o.id);
    END IF;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_dispatch_stage_tasks
    AFTER INSERT OR UPDATE OF workflow_stage, status, lines, pick_note, review_note, invoice_sent_at, planned_collection_date
    ON public.kernel_dispatch_orders
    FOR EACH ROW EXECUTE FUNCTION public._trg_dispatch_stage_tasks();

-- ----------------------------------------------------------------------------
-- 10. Customer prices: valid until, and a reminder before they end.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kernel_style_price_on(p_style_code text, p_customer_id uuid, p_on date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT price_per_kg
    FROM public.kernel_style_prices
    WHERE style_code = public.kernel_style_code_from_dispatch(p_style_code)
      AND effective_from <= COALESCE(p_on, (now() AT TIME ZONE 'Africa/Johannesburg')::date)
      AND (valid_until IS NULL OR valid_until >= COALESCE(p_on, (now() AT TIME ZONE 'Africa/Johannesburg')::date))
      AND (customer_id IS NULL OR customer_id = p_customer_id)
    ORDER BY (customer_id IS NOT NULL) DESC, effective_from DESC, created_at DESC
    LIMIT 1;
$function$;

-- Each price item may carry valid_until (blank = no end date).
CREATE OR REPLACE FUNCTION public.save_kernel_style_prices(p_effective_from date, p_prices jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_item  jsonb;
    v_code  text;
    v_price numeric;
    v_until date;
    v_n     integer := 0;
BEGIN
    IF p_effective_from IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose the date the new prices apply from.');
    END IF;
    IF p_prices IS NULL OR jsonb_typeof(p_prices) <> 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'No prices to save.');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_prices) LOOP
        v_code := public.kernel_style_code_from_dispatch(v_item->>'style_code');
        IF (v_item->>'price_per_kg') IS NULL OR trim(v_item->>'price_per_kg') = '' THEN
            CONTINUE;
        END IF;
        v_price := (v_item->>'price_per_kg')::numeric;
        IF v_price < 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Prices cannot be negative.');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.kernel_style_registry WHERE style_code = v_code) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unknown style: ' || COALESCE(v_code, '?'));
        END IF;
        v_until := NULLIF(trim(COALESCE(v_item->>'valid_until', '')), '')::date;
        IF v_until IS NOT NULL AND v_until < p_effective_from THEN
            RETURN jsonb_build_object('success', false, 'error', 'The "valid until" date can''t be before the "valid from" date.');
        END IF;
        INSERT INTO public.kernel_style_prices (style_code, customer_id, price_per_kg, effective_from, valid_until, created_by)
        VALUES (v_code, p_customer_id, ROUND(v_price, 4), p_effective_from, v_until, p_actor_user_id)
        ON CONFLICT (style_code, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from)
        DO UPDATE SET price_per_kg = EXCLUDED.price_per_kg, valid_until = EXCLUDED.valid_until,
                      created_by = EXCLUDED.created_by, created_at = now();
        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter at least one price.');
    END IF;
    RETURN jsonb_build_object('success', true, 'saved', v_n);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN jsonb_build_object('success', false, 'error', 'Prices must be numbers (e.g. 145.50) and dates must be real dates.');
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_kernel_style_prices(p_customer_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_on      date := COALESCE(p_as_of, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
    v_mode    text := COALESCE((SELECT value #>> '{}' FROM public.kernel_pipeline_settings WHERE key = 'kernel_pricing'), 'single');
    v_days    integer := COALESCE((SELECT (value ->> 'expiry_days')::integer FROM public.kernel_pipeline_settings WHERE key = 'price_reminder'), 60);
    v_styles  jsonb;
    v_history jsonb;
    v_custs   jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'style_code', r.style_code,
               'label', r.label,
               'list_price', lp.price_per_kg,
               'list_from', lp.effective_from,
               'list_until', lp.valid_until,
               'list_changed_by', public.stock_history_user_label(lp.created_by),
               'list_changed_at', lp.created_at,
               'customer_price', cp.price_per_kg,
               'customer_from', cp.effective_from,
               'customer_until', cp.valid_until,
               'customer_status', CASE
                   WHEN cp.price_per_kg IS NULL THEN 'standard'
                   WHEN cp.valid_until IS NOT NULL AND cp.valid_until <= v_on + v_days THEN 'ending'
                   ELSE 'current' END
           ) ORDER BY r.display_order, r.style_code), '[]'::jsonb)
    INTO v_styles
    FROM public.kernel_style_registry r
    LEFT JOIN LATERAL (
        SELECT price_per_kg, effective_from, valid_until, created_by, created_at FROM public.kernel_style_prices s
        WHERE s.style_code = r.style_code AND s.customer_id IS NULL AND s.effective_from <= v_on
          AND (s.valid_until IS NULL OR s.valid_until >= v_on)
        ORDER BY s.effective_from DESC, s.created_at DESC LIMIT 1
    ) lp ON true
    LEFT JOIN LATERAL (
        SELECT price_per_kg, effective_from, valid_until FROM public.kernel_style_prices s
        WHERE p_customer_id IS NOT NULL AND s.style_code = r.style_code AND s.customer_id = p_customer_id
          AND s.effective_from <= v_on AND (s.valid_until IS NULL OR s.valid_until >= v_on)
        ORDER BY s.effective_from DESC, s.created_at DESC LIMIT 1
    ) cp ON true
    WHERE r.is_active;

    SELECT COALESCE(jsonb_agg(h ORDER BY (h->>'effective_from')::date DESC, h->>'customer_name' NULLS FIRST), '[]'::jsonb)
    INTO v_history
    FROM (
        SELECT jsonb_build_object(
                   'effective_from', s.effective_from,
                   'valid_until', s.valid_until,
                   'customer_id', s.customer_id,
                   'customer_name', COALESCE(c.company_name, c.trading_name),
                   'styles_changed', COUNT(*),
                   'changed_by', public.stock_history_user_label((array_agg(s.created_by ORDER BY s.created_at DESC))[1]),
                   'changed_at', MAX(s.created_at),
                   'is_future', s.effective_from > v_on,
                   'is_ended', s.valid_until IS NOT NULL AND s.valid_until < v_on,
                   'prices', jsonb_agg(jsonb_build_object('style_code', s.style_code, 'price_per_kg', s.price_per_kg) ORDER BY s.style_code)
               ) AS h
        FROM public.kernel_style_prices s
        LEFT JOIN public.contacts c ON c.id = s.customer_id
        WHERE p_customer_id IS NULL OR s.customer_id = p_customer_id OR s.customer_id IS NULL
        GROUP BY s.effective_from, s.valid_until, s.customer_id, c.company_name, c.trading_name
        ORDER BY s.effective_from DESC
        LIMIT 60
    ) x;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id,
               'name', COALESCE(NULLIF(trim(c.company_name), ''), c.trading_name, c.primary_contact_name),
               'has_prices', EXISTS (SELECT 1 FROM public.kernel_style_prices s WHERE s.customer_id = c.id))
               ORDER BY COALESCE(NULLIF(trim(c.company_name), ''), c.trading_name, c.primary_contact_name)), '[]'::jsonb)
    INTO v_custs
    FROM (SELECT * FROM public.contacts WHERE contact_type IN ('kernel_customer', 'customer', 'both') LIMIT 500) c;

    RETURN jsonb_build_object(
        'success', true,
        'mode', v_mode,
        'as_of', v_on,
        'customer_id', p_customer_id,
        'expiry_days', v_days,
        'kg_per_carton', 11.34,
        'styles', v_styles,
        'history', v_history,
        'customers', v_custs
    );
END;
$function$;

-- One task per customer whose prices end within expiry_days with nothing new lined up.
CREATE OR REPLACE FUNCTION public._customer_price_expiry_tasks(p_customer_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    s       jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'price_reminder'), '{}'::jsonb);
    v_on    boolean := COALESCE((s ->> 'expiry_enabled')::boolean, true);
    v_days  integer := COALESCE((s ->> 'expiry_days')::integer, 60);
    v_today date := public._sast_today();
    r       record;
BEGIN
    FOR r IN
        WITH custs AS (
            SELECT DISTINCT customer_id AS id FROM public.kernel_style_prices
            WHERE customer_id IS NOT NULL AND (p_customer_id IS NULL OR customer_id = p_customer_id)
            UNION
            SELECT subject_id FROM public.workflow_tasks
            WHERE kind = 'customer_prices_expiring' AND status NOT IN ('completed', 'dismissed')
              AND subject_id IS NOT NULL AND (p_customer_id IS NULL OR subject_id = p_customer_id)
        ),
        cur AS (
            SELECT DISTINCT ON (p.customer_id, p.style_code) p.customer_id, p.style_code, p.valid_until
            FROM public.kernel_style_prices p
            WHERE p.customer_id IN (SELECT id FROM custs)
              AND p.effective_from <= v_today AND (p.valid_until IS NULL OR p.valid_until >= v_today)
            ORDER BY p.customer_id, p.style_code, p.effective_from DESC, p.created_at DESC
        ),
        ending AS (
            SELECT c.customer_id, c.style_code, c.valid_until
            FROM cur c
            WHERE v_on AND c.valid_until IS NOT NULL AND c.valid_until <= v_today + v_days
              AND NOT EXISTS (SELECT 1 FROM public.kernel_style_prices n
                              WHERE n.customer_id = c.customer_id AND n.style_code = c.style_code
                                AND n.effective_from > v_today)
        )
        SELECT cu.id,
               COALESCE(NULLIF(trim(ct.company_name), ''), ct.trading_name, 'a customer') AS name,
               MIN(e.valid_until) AS first_end,
               array_agg(e.style_code ORDER BY e.style_code) FILTER (WHERE e.style_code IS NOT NULL) AS styles
        FROM custs cu
        LEFT JOIN ending e ON e.customer_id = cu.id
        LEFT JOIN public.contacts ct ON ct.id = cu.id
        GROUP BY cu.id, ct.company_name, ct.trading_name
    LOOP
        IF r.styles IS NULL OR cardinality(r.styles) = 0 THEN
            PERFORM public._close_tasks('customer_prices_expiring', r.id::text);
        ELSE
            PERFORM public._open_task('customer_prices_expiring', r.id::text,
                'Prices for ' || r.name || ' end on ' || to_char(r.first_end, 'FMDD Mon YYYY')
                    || ' (' || (r.first_end - v_today) || CASE WHEN r.first_end - v_today = 1 THEN ' day)' ELSE ' days)' END,
                'Styles: ' || array_to_string(r.styles, ', ')
                    || '. Tell the customer about any price changes, then add the new prices. After that date the standard price is used.',
                'contact', r.id);
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_customer_price_expiry_tasks()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.customer_id IS NOT NULL THEN PERFORM public._customer_price_expiry_tasks(OLD.customer_id); END IF;
        RETURN OLD;
    END IF;
    IF NEW.customer_id IS NOT NULL THEN PERFORM public._customer_price_expiry_tasks(NEW.customer_id); END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_style_prices_customer_expiry
    AFTER INSERT OR UPDATE OR DELETE ON public.kernel_style_prices
    FOR EACH ROW EXECUTE FUNCTION public._trg_customer_price_expiry_tasks();

CREATE OR REPLACE FUNCTION public.get_price_reminder_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'settings',
        '{"enabled": true, "max_age_days": 30, "frequency": "weekly", "scope": "in_stock", "remind_missing": true, "expiry_enabled": true, "expiry_days": 60}'::jsonb
        || COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'price_reminder'), '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.set_price_reminder_settings(p_settings jsonb, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_new  jsonb;
    v_days integer;
    v_exp  integer;
BEGIN
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nothing to save.');
    END IF;
    v_new := (public.get_price_reminder_settings() -> 'settings')
             || (p_settings - ARRAY(SELECT k FROM jsonb_object_keys(p_settings) k
                                    WHERE k NOT IN ('enabled', 'max_age_days', 'frequency', 'scope', 'remind_missing',
                                                    'expiry_enabled', 'expiry_days')));

    IF jsonb_typeof(v_new -> 'enabled') <> 'boolean' OR jsonb_typeof(v_new -> 'remind_missing') <> 'boolean'
       OR jsonb_typeof(v_new -> 'expiry_enabled') <> 'boolean' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose whether the reminder is on.');
    END IF;
    v_days := (v_new ->> 'max_age_days')::integer;
    IF v_days IS NULL OR v_days < 1 OR v_days > 365 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Days must be between 1 and 365.');
    END IF;
    v_exp := (v_new ->> 'expiry_days')::integer;
    IF v_exp IS NULL OR v_exp < 1 OR v_exp > 365 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Days before a customer price ends must be between 1 and 365.');
    END IF;
    IF v_new ->> 'frequency' NOT IN ('daily', 'weekly', 'monthly') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose how often to check.');
    END IF;
    IF v_new ->> 'scope' NOT IN ('in_stock', 'all') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose which styles count.');
    END IF;
    v_new := jsonb_set(jsonb_set(v_new, '{max_age_days}', to_jsonb(v_days)), '{expiry_days}', to_jsonb(v_exp));

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at, updated_by)
    VALUES ('price_reminder', v_new, now(), p_actor_user_id)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;

    PERFORM public._style_prices_task(false);
    PERFORM public._customer_price_expiry_tasks(NULL);
    RETURN jsonb_build_object('success', true, 'settings', v_new);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'Days must be a whole number.');
END;
$$;

CREATE OR REPLACE FUNCTION public.run_procurement_task_checks(p_force_prices boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_today date := public._sast_today();
    v_freq  text := COALESCE((SELECT value ->> 'frequency' FROM public.kernel_pipeline_settings WHERE key = 'price_reminder'), 'weekly');
    v_price_day boolean;
BEGIN
    -- Trucks around today, plus any truck that still has an open task (to close it).
    PERFORM public._procurement_truck_tasks(p.id)
    FROM public.kernel_intake_procurement p
    WHERE p.status = 'scheduled' AND p.scheduled_date BETWEEN v_today - 60 AND v_today + 60;

    PERFORM public._procurement_truck_tasks(t.subject_id)
    FROM public.workflow_tasks t
    WHERE t.kind IN ('truck_due', 'truck_late', 'truck_unconfirmed')
      AND t.status NOT IN ('completed', 'dismissed') AND t.subject_id IS NOT NULL;

    v_price_day := p_force_prices
        OR v_freq = 'daily'
        OR (v_freq = 'weekly' AND extract(isodow FROM v_today) = 1)
        OR (v_freq = 'monthly' AND extract(day FROM v_today) = 1);
    PERFORM public._style_prices_task(v_price_day);
    -- Customer prices ending: daily, so the day count in the title stays right.
    PERFORM public._customer_price_expiry_tasks(NULL);

    PERFORM public._nis_runway_task();
    PERFORM public._nis_unplaced_task(true);

    RETURN jsonb_build_object('success', true, 'ran_on', v_today, 'price_check', v_price_day,
        'open', (SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (
                    SELECT kind, COUNT(*) n FROM public.workflow_tasks
                    WHERE status NOT IN ('completed', 'dismissed') AND kind IS NOT NULL GROUP BY kind) x));
END;
$function$;

-- ----------------------------------------------------------------------------
-- 11. Switches, actions, screen names
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active) VALUES
    ('task-dispatch-invoice',          'Tasks: send dispatch invoices',  'Gets a "Send the invoice" task when a dispatch truck has been loaded.', true),
    ('task-customer-prices-expiring',  'Tasks: customer prices ending',  'Gets a reminder before a customer''s style prices end (days set on the Prices tab).', true),
    ('notify-dispatch-pick-changed',   'Notify: pick changed',           'Gets a bell notification when the picker changes a dispatch (short lines or substitutes).', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM (VALUES
    ('task-dispatch-invoice',         'Palladium Manager'),
    ('task-customer-prices-expiring', 'Sales Exec'),
    ('notify-dispatch-pick-changed',  'Palladium Manager'),
    ('notify-dispatch-pick-changed',  'Procurement Lead'),
    ('notify-dispatch-pick-changed',  'Sales Exec')
) AS g(feature_key, role_name)
JOIN public.features f ON f.key = g.feature_key
JOIN public.roles r ON r.role_name = g.role_name
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

INSERT INTO public.actions (key, module, label, description) VALUES
    ('kernel_dispatch.invoice', 'Dispatch and Sales', 'Mark the invoice as sent', 'Tick step 5 once the invoice and documents have gone to the customer')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM (VALUES
    ('kernel_dispatch.invoice', ARRAY['super_user', 'admin', 'Palladium Manager', 'Sales Exec', 'Procurement Lead']),
    -- Joslyn sees the totals she invoices.
    ('kernel_prices.view',      ARRAY['Palladium Manager'])
) AS g(action_key, roles)
JOIN public.actions a ON a.key = g.action_key
JOIN public.roles r ON r.role_name = ANY (g.roles)
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

UPDATE public.features SET name = g.name, updated_at = now()
FROM (VALUES
    ('grower-intake-grid',      'Receiving'),
    ('kernel-production-grid',  'Production'),
    ('stock-management-kernel', 'Stock on Hand'),
    ('kernel-dispatch-grid',    'Dispatch and Sales'),
    ('nis-storage',             'Silo Holding')
) AS g(key, name)
WHERE public.features.key = g.key;

-- Function permissions (bookkeeping; RPCs are SECURITY DEFINER + anon). NOT EXISTS: no unique key.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY[
    'confirm_kernel_dispatch_pick_with_substitutes', 'mark_kernel_dispatch_invoice_sent',
    'get_kernel_stock_count_flags', 'clear_kernel_stock_count_flags'
]) AS fn
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Procurement Lead', 'Shareholder', 'Palladium Manager', 'Production Manager', 'Factory Manager')
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = fn AND rp.operation = 'EXECUTE');

-- Refresh open dispatch tasks with the new wording, and Joslyn's / Pete's new tasks.
SELECT public._dispatch_stage_tasks(o.id)
FROM public.kernel_dispatch_orders o
WHERE o.workflow_stage IS NOT NULL AND o.status <> 'cancelled';

SELECT public._customer_price_expiry_tasks(NULL);

NOTIFY pgrst, 'reload schema';
