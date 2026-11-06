-- ============================================================================
-- Step 5 (Invoice sent) keeps the customer's PO and our invoice (Henry, 6 Nov 2026).
--
-- Joslyn types the customer's PO number and our invoice number, and can attach the PO and the
-- invoice (images / PDF, uploaded the same way as the dispatch form's attachments). Both numbers
-- are required to tick step 5. They stay on the dispatch so anyone can open them later.
-- Undoing step 5 keeps the numbers and files, so redoing it starts filled in.
--
-- Documents are stored as [{ name, file_id, file_link }]; anything else in the payload is dropped.
-- ============================================================================

ALTER TABLE public.kernel_dispatch_orders
    ADD COLUMN IF NOT EXISTS po_reference      text,
    ADD COLUMN IF NOT EXISTS invoice_reference text,
    ADD COLUMN IF NOT EXISTS po_documents      jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS invoice_documents jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Keeps only { name, file_id, file_link } objects; file_link only when it is https.
CREATE OR REPLACE FUNCTION public._clean_dispatch_documents(p jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'name', left(NULLIF(trim(d->>'name'), ''), 200),
               'file_id', left(NULLIF(trim(d->>'file_id'), ''), 300),
               'file_link', CASE WHEN d->>'file_link' ~* '^https://' THEN left(d->>'file_link', 2000) END
           ))), '[]'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END) AS e(d)
    WHERE jsonb_typeof(d) = 'object' AND (NULLIF(trim(d->>'file_id'), '') IS NOT NULL OR d->>'file_link' ~* '^https://');
$$;

-- New parameters change the signature. Rename the old one out of the way (and shut it off) so no
-- ambiguous overload is left behind; it can be dropped later in Studio.
DO $$
BEGIN
    IF to_regprocedure('public.mark_kernel_dispatch_invoice_sent(uuid, boolean, text, uuid)') IS NOT NULL THEN
        ALTER FUNCTION public.mark_kernel_dispatch_invoice_sent(uuid, boolean, text, uuid)
            RENAME TO mark_kernel_dispatch_invoice_sent_pre_20261106;
        REVOKE EXECUTE ON FUNCTION public.mark_kernel_dispatch_invoice_sent_pre_20261106(uuid, boolean, text, uuid)
            FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_kernel_dispatch_invoice_sent(
    p_order_id uuid,
    p_sent boolean DEFAULT true,
    p_note text DEFAULT NULL,
    p_po_reference text DEFAULT NULL,
    p_invoice_reference text DEFAULT NULL,
    p_po_documents jsonb DEFAULT NULL,
    p_invoice_documents jsonb DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o public.kernel_dispatch_orders%ROWTYPE;
    v_po  text := left(NULLIF(trim(COALESCE(p_po_reference, '')), ''), 100);
    v_inv text := left(NULLIF(trim(COALESCE(p_invoice_reference, '')), ''), 100);
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Dispatch not found.');
    END IF;
    IF COALESCE(p_sent, true) THEN
        IF o.status IS DISTINCT FROM 'dispatched' THEN
            RETURN jsonb_build_object('success', false, 'error', 'The truck has not been loaded yet.');
        END IF;
        IF v_po IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Enter the customer''s PO number.');
        END IF;
        IF v_inv IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Enter our invoice number.');
        END IF;
        UPDATE public.kernel_dispatch_orders
           SET invoice_sent_at = now(), invoice_sent_by = p_actor_user_id,
               invoice_note = NULLIF(trim(COALESCE(p_note, '')), ''),
               po_reference = v_po,
               invoice_reference = v_inv,
               po_documents = public._clean_dispatch_documents(p_po_documents),
               invoice_documents = public._clean_dispatch_documents(p_invoice_documents),
               updated_at = now(), updated_by = COALESCE(p_actor_user_id, updated_by)
         WHERE id = p_order_id;
    ELSE
        -- Undo: the PO / invoice numbers and files stay, so redoing step 5 starts filled in.
        UPDATE public.kernel_dispatch_orders
           SET invoice_sent_at = NULL, invoice_sent_by = NULL, invoice_note = NULL,
               updated_at = now(), updated_by = COALESCE(p_actor_user_id, updated_by)
         WHERE id = p_order_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'invoice_sent', COALESCE(p_sent, true));
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_kernel_dispatch_invoice_sent(uuid, boolean, text, text, text, jsonb, jsonb, uuid) TO anon, authenticated, service_role;

-- Workflow payload: same as 20261106120000, plus the four new fields on the order.
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
            'invoice_note', o.invoice_note,
            'po_reference', o.po_reference,
            'invoice_reference', o.invoice_reference,
            'po_documents', COALESCE(o.po_documents, '[]'::jsonb),
            'invoice_documents', COALESCE(o.invoice_documents, '[]'::jsonb)
        ),
        'customer', v_cust,
        'pricing_mode', v_mode,
        'price_date', v_on,
        'kg_per_carton', 11.34,
        'lines', v_lines
    );
END;
$function$;

NOTIFY pgrst, 'reload schema';
