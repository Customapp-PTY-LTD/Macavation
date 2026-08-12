-- Backfill stock_soh_history from what the database already knows.
--
-- WHY: without this the History screen is empty until the next edit, which makes a brand-new
-- audit trail look broken and hides months of real movements that ARE reconstructable — dispatch
-- order lines, manual corrections stamped into kernel.packing_data, and oil lot intakes.
--
-- WHAT IT CANNOT RECOVER IS THE ACTOR. Nothing recorded who did any of this: created_by is
-- populated on 1 of 34 kernel_dispatch_orders and 0 of 228 oil_stock_lots on dev, and the
-- packing_data adjustment rows carry only {date, stock_adjustment, adjustment_reason} — no user
-- at all. Where created_by happens to exist it is used; everywhere else user_id stays NULL.
-- Every row written here is tagged detail->>'backfilled' = 'true' so the UI can label it
-- "Unknown (before audit trail)" rather than implying nobody touched it. Guessing an actor would
-- be worse than admitting there isn't one.
--
-- Timestamps are the best available proxy (order created_at, lot created_at, the adjustment
-- row's own date at 12:00 Africa/Johannesburg since only a date was stored) — not the true
-- moment of the edit. That is recorded in detail->>'occurred_at_source'.
--
-- IDEMPOTENT: the whole thing is skipped if any backfilled row already exists, so re-running the
-- migration cannot double-count.
--
-- OUT OF SCOPE: applying this migration. Apply 20260816090000 first.

DO $$
DECLARE
    v_existing bigint;
    v_inserted bigint;
BEGIN
    SELECT count(*) INTO v_existing
    FROM public.stock_soh_history
    WHERE detail ->> 'backfilled' = 'true';

    IF v_existing > 0 THEN
        RAISE NOTICE 'stock_soh_history backfill skipped: % backfilled rows already present.', v_existing;
        RETURN;
    END IF;

    -- ------------------------------------------------------------------
    -- 1. Manual kernel corrections stamped into kernel.packing_data.
    -- ------------------------------------------------------------------
    WITH keys(style, qty_key, cartons_key) AS (
        VALUES
            ('SP',              'sk_sp_qty',   'sk_sp_cartons'),
            ('0',               'sk_0_qty',    'sk_0_cartons'),
            ('1',               'sk_1_qty',    'sk_1_cartons'),
            ('1S',              'sk_1s_qty',   'sk_1s_cartons'),
            ('4L',              'sk_4l_qty',   'sk_4l_cartons'),
            ('5',               'sk_5_qty',    'sk_5_cartons'),
            ('6',               'sk_6_qty',    'sk_6_cartons'),
            ('7/8',             'bt_78_qty',   'bt_78_cartons'),
            ('Butter High Oil', 'bt_high_qty', 'bt_high_cartons'),
            ('Butter Low Oil',  'bt_low_qty',  'bt_low_cartons')
    ),
    adj AS (
        -- batches.batch_id is the human batch label ("55.26.13"); kernel.batch_id is the uuid FK.
        SELECT k.id AS kernel_id,
               b.batch_id AS batch_number,
               elem,
               -- Stored as a bare date; 12:00 SAST keeps it on the right calendar day in UTC.
               CASE
                   WHEN (elem ->> 'date') ~ '^\d{4}-\d{2}-\d{2}' THEN ((elem ->> 'date')::date + time '12:00') AT TIME ZONE 'Africa/Johannesburg'
                   WHEN (elem ->> 'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN (to_date(elem ->> 'date', 'DD/MM/YYYY') + time '12:00') AT TIME ZONE 'Africa/Johannesburg'
                   ELSE k.updated_at
               END AS occurred_at
        FROM public.kernel k
        LEFT JOIN public.batches b ON b.id = k.batch_id
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) = 'array'
                 THEN COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)
                 ELSE '[]'::jsonb END) AS elem
        WHERE (elem ->> 'stock_adjustment')::boolean IS TRUE
    )
    INSERT INTO public.stock_soh_history (
        occurred_at, stream, event_type, action, source_table, source_id,
        batch_number, style, qty_kg, cartons, reason, detail, user_id, user_name
    )
    SELECT adj.occurred_at,
           'kernel', 'adjustment', 'manual_adjustment', 'kernel', adj.kernel_id,
           adj.batch_number, keys.style,
           NULLIF(COALESCE(NULLIF(TRIM(adj.elem ->> keys.qty_key), '')::numeric, 0), 0),
           NULLIF(COALESCE(NULLIF(TRIM(adj.elem ->> keys.cartons_key), '')::numeric, 0), 0),
           NULLIF(TRIM(COALESCE(adj.elem ->> 'adjustment_reason', '')), ''),
           jsonb_build_object('backfilled', true, 'occurred_at_source', 'packing_data.date'),
           NULL, NULL
    FROM adj
    CROSS JOIN keys
    WHERE COALESCE(NULLIF(TRIM(adj.elem ->> keys.qty_key), '')::numeric, 0) <> 0
       OR COALESCE(NULLIF(TRIM(adj.elem ->> keys.cartons_key), '')::numeric, 0) <> 0;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RAISE NOTICE 'Backfilled % kernel manual adjustment row(s).', v_inserted;

    -- ------------------------------------------------------------------
    -- 2. Kernel dispatch order lines. Negative: a dispatch line removes stock.
    -- ------------------------------------------------------------------
    INSERT INTO public.stock_soh_history (
        occurred_at, stream, event_type, action, source_table, source_id,
        batch_number, style, qty_kg, cartons, reason, detail, user_id, user_name
    )
    SELECT o.created_at,
           'kernel', 'dispatch_out', 'dispatch_order_created', 'kernel_dispatch_orders', o.id,
           t.batch_number, t.style,
           NULLIF(-t.qty_kg, 0), NULLIF(-t.cartons, 0), NULL,
           jsonb_build_object('backfilled', true, 'occurred_at_source', 'kernel_dispatch_orders.created_at',
                              'buyer_name', o.buyer_name, 'status', o.status,
                              'dispatched_at', o.dispatched_at),
           o.created_by, public.stock_history_user_label(o.created_by)
    FROM public.kernel_dispatch_orders o
    CROSS JOIN LATERAL public.dispatch_line_totals(o.lines, 'kernel') t
    WHERE t.qty_kg <> 0 OR t.cartons <> 0;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RAISE NOTICE 'Backfilled % kernel dispatch line(s).', v_inserted;

    -- ------------------------------------------------------------------
    -- 3. Oil & protein dispatch order lines.
    -- ------------------------------------------------------------------
    INSERT INTO public.stock_soh_history (
        occurred_at, stream, event_type, action, source_table, source_id,
        batch_number, style, qty_kg, cartons, reason, detail, user_id, user_name
    )
    SELECT o.created_at,
           'oil', 'dispatch_out', 'dispatch_order_created', 'oil_dispatch_orders', o.id,
           t.batch_number, t.style,
           NULLIF(-t.qty_kg, 0), NULLIF(-t.cartons, 0), NULL,
           jsonb_build_object('backfilled', true, 'occurred_at_source', 'oil_dispatch_orders.created_at',
                              'buyer_name', o.buyer_name, 'status', o.status,
                              'dispatched_at', o.dispatched_at),
           o.created_by, public.stock_history_user_label(o.created_by)
    FROM public.oil_dispatch_orders o
    CROSS JOIN LATERAL public.dispatch_line_totals(o.lines, 'oil') t
    WHERE t.qty_kg <> 0 OR t.cartons <> 0;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RAISE NOTICE 'Backfilled % oil dispatch line(s).', v_inserted;

    -- ------------------------------------------------------------------
    -- 4. Oil & protein lot intakes.
    -- ------------------------------------------------------------------
    INSERT INTO public.stock_soh_history (
        occurred_at, stream, event_type, action, source_table, source_id,
        batch_number, style, qty_kg, cartons, reason, detail, user_id, user_name
    )
    SELECT l.created_at,
           'oil', 'stock_in', 'lot_added', 'oil_stock_lots', l.id,
           l.batch_number,
           COALESCE(NULLIF(TRIM(l.grade), ''), NULLIF(TRIM(l.product_description), '')),
           l.kilograms, NULL, NULLIF(TRIM(l.notes), ''),
           jsonb_build_object('backfilled', true, 'occurred_at_source', 'oil_stock_lots.created_at',
                              'location_code', l.location_code, 'stock_category', l.stock_category,
                              'status', l.status),
           l.created_by, public.stock_history_user_label(l.created_by)
    FROM public.oil_stock_lots l
    WHERE COALESCE(l.is_active, true) = true
      AND COALESCE(l.kilograms, 0) <> 0;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RAISE NOTICE 'Backfilled % oil/protein lot intake(s).', v_inserted;

    -- ------------------------------------------------------------------
    -- 5. Shell waste lots.
    -- ------------------------------------------------------------------
    INSERT INTO public.stock_soh_history (
        occurred_at, stream, event_type, action, source_table, source_id,
        batch_number, style, qty_kg, cartons, reason, detail, user_id, user_name
    )
    SELECT s.created_at,
           'shell',
           CASE WHEN LOWER(COALESCE(s.status, '')) = 'dispatched' THEN 'dispatch_out' ELSE 'stock_in' END,
           CASE WHEN LOWER(COALESCE(s.status, '')) = 'dispatched' THEN 'lot_dispatched' ELSE 'lot_added' END,
           'shell_stock_lot', s.id,
           COALESCE(s.source_batch_number, s.lot_number), NULL,
           CASE WHEN LOWER(COALESCE(s.status, '')) = 'dispatched'
                THEN -COALESCE(s.quantity_kg, 0) ELSE COALESCE(s.quantity_kg, 0) END,
           NULL, NULLIF(TRIM(s.notes), ''),
           jsonb_build_object('backfilled', true, 'occurred_at_source', 'shell_stock_lot.created_at',
                              'lot_number', s.lot_number, 'status', s.status),
           s.created_by, public.stock_history_user_label(s.created_by)
    FROM public.shell_stock_lot s
    WHERE COALESCE(s.quantity_kg, 0) <> 0;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RAISE NOTICE 'Backfilled % shell lot movement(s).', v_inserted;
END;
$$;
