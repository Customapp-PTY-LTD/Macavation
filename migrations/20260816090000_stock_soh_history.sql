-- Stock-on-hand edit history — WHO changed stock on hand, WHEN, and by how much.
--
-- WHY: nothing in this database records who moved stock. kernel, kernel_dispatch_orders,
-- oil_stock_lots and oil_dispatch_orders all carry created_by/updated_by columns, but the RPCs
-- that write them never populate them — on dev, oil_stock_lots is 0/228 populated,
-- kernel_dispatch_orders 1/34, kernel 3/106. And updated_by, even when set, only ever names the
-- LAST editor; it cannot answer "who took 35 cartons off batch 55.26.13 in May".
--
-- The existing get_stock_soh_history(text,integer) (20260713160000) is a DIFFERENT thing despite
-- the similar name: it reconstructs a daily kg line-chart series for the dashboard. It has no
-- concept of an actor. This migration adds the audit trail; that function is left untouched, and
-- the reader added here is deliberately named get_stock_edit_history to avoid colliding with it.
--
-- Three event classes, matching how stock on hand actually moves on the Stock Management screen:
--   stock_in     — kernel released to stock / packing recorded, oil & shell lots added
--   dispatch_out — kernel and oil dispatch order lines (creating an order is what drops on-hand:
--                  get_kernel_batches subtracts kernel_dispatch_orders.lines regardless of
--                  dispatched_at — see 20260730120000)
--   adjustment   — manual corrections (adjust_kernel_stock_on_hand), lot kg edits, deactivations
--
-- HOW capture works — triggers, not edits to the ~9 existing mutation RPCs. Triggers see every
-- write on the underlying tables, including code paths this migration does not know about and
-- any future ones, and they cannot be bypassed by a caller that forgets to log. The cost is that
-- a trigger cannot see the app user: this repo does NOT use Supabase auth (auth.uid() appears
-- once in 297 migrations), sign-in is public.auth_login_email against users.password_hash, and
-- every RPC reaches PostgREST as anon. So the actor is carried in a transaction-local GUC that
-- the companion migration's wrapper overloads set — see 20260816090100. Rows written by any path
-- that does not set it record user_id NULL, which the reader renders as "Unknown".
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260816090000_stock_soh_history.sql   (dev/UAT nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. stock_soh_history — one row per stock-on-hand movement.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stock_soh_history (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    stream        text NOT NULL,
    event_type    text NOT NULL,
    action        text NOT NULL,
    source_table  text NULL,
    source_id     uuid NULL,
    batch_number  text NULL,
    style         text NULL,
    qty_kg        numeric NULL,
    cartons       numeric NULL,
    reason        text NULL,
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    user_id       uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    user_name     text NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stock_soh_history_stream_check
        CHECK (stream IN ('kernel', 'oil', 'shell')),
    CONSTRAINT stock_soh_history_event_type_check
        CHECK (event_type IN ('stock_in', 'dispatch_out', 'adjustment'))
);

COMMENT ON TABLE public.stock_soh_history IS
    'Audit trail of stock-on-hand movements: who changed stock, when, and by how much. Written '
    'by AFTER triggers on kernel, kernel_dispatch_orders, oil_stock_lots, oil_dispatch_orders and '
    'shell_stock_lot. Read through get_stock_edit_history. Distinct from get_stock_soh_history, '
    'which is the dashboard chart series and has no actor.';
COMMENT ON COLUMN public.stock_soh_history.qty_kg IS
    'Signed delta in kg. Negative = stock left on-hand. NULL when the event carries no kg figure.';
COMMENT ON COLUMN public.stock_soh_history.cartons IS
    'Signed delta in cartons (kernel). Negative = stock left on-hand.';
COMMENT ON COLUMN public.stock_soh_history.user_name IS
    'Display name snapshotted at write time. Kept alongside user_id on purpose: an audit row must '
    'stay legible after the user is renamed or deleted (the FK is ON DELETE SET NULL).';
COMMENT ON COLUMN public.stock_soh_history.detail IS
    'Free-form context. detail->>''backfilled'' = "true" marks rows reconstructed by '
    '20260816090200 from pre-existing data, whose actor is unknowable.';

ALTER TABLE public.stock_soh_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_soh_history FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS ix_stock_soh_history_occurred
    ON public.stock_soh_history (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_stock_soh_history_stream_occurred
    ON public.stock_soh_history (stream, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_stock_soh_history_event_occurred
    ON public.stock_soh_history (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_stock_soh_history_source
    ON public.stock_soh_history (source_id);
CREATE INDEX IF NOT EXISTS ix_stock_soh_history_user
    ON public.stock_soh_history (user_id);
CREATE INDEX IF NOT EXISTS ix_stock_soh_history_batch
    ON public.stock_soh_history (batch_number);

-- ============================================================================
-- 2. Actor plumbing.
--
-- set_config(..., is_local => true) scopes the value to the CURRENT TRANSACTION. PostgREST runs
-- each RPC in its own transaction on a pooled connection, so a transaction-local setting is the
-- only safe choice here — a session-level one would leak the actor to the next unrelated request
-- that reuses the connection.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.stock_history_set_actor(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    PERFORM set_config('macavation.actor_user_id', COALESCE(p_user_id::text, ''), true);
END;
$$;

COMMENT ON FUNCTION public.stock_history_set_actor(uuid) IS
    'Records the acting user for the current TRANSACTION so stock_soh_history triggers can '
    'attribute the change. Called by the wrapper overloads in 20260816090100, never by the '
    'browser directly.';

CREATE OR REPLACE FUNCTION public.stock_history_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
    v_raw text;
BEGIN
    -- missing_ok => true: current_setting throws rather than returning NULL without it, and an
    -- unset actor is the normal case for any path that has not been wrapped.
    v_raw := NULLIF(current_setting('macavation.actor_user_id', true), '');
    IF v_raw IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN v_raw::uuid;
EXCEPTION WHEN others THEN
    -- A malformed GUC must never abort the business transaction it is riding on.
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.stock_history_user_label(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    -- No users.username column exists on either project, and scripts/verify-no-username.mjs
    -- gates the repo against reintroducing one — email is the fallback label for an account with
    -- no name captured.
    SELECT COALESCE(
               NULLIF(TRIM(BOTH ' ' FROM CONCAT_WS(' ', NULLIF(TRIM(u.first_name), ''), NULLIF(TRIM(u.last_name), ''))), ''),
               NULLIF(TRIM(u.email), '')
           )
    FROM public.users u
    WHERE u.id = p_user_id;
$$;

-- ============================================================================
-- 3. stock_soh_history_log — the single insert path every trigger goes through.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.stock_soh_history_log(
    p_stream       text,
    p_event_type   text,
    p_action       text,
    p_source_table text DEFAULT NULL,
    p_source_id    uuid DEFAULT NULL,
    p_batch_number text DEFAULT NULL,
    p_style        text DEFAULT NULL,
    p_qty_kg       numeric DEFAULT NULL,
    p_cartons      numeric DEFAULT NULL,
    p_reason       text DEFAULT NULL,
    p_detail       jsonb DEFAULT '{}'::jsonb,
    p_user_id      uuid DEFAULT NULL,
    p_occurred_at  timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := COALESCE(p_user_id, public.stock_history_actor());
BEGIN
    INSERT INTO public.stock_soh_history (
        occurred_at, stream, event_type, action, source_table, source_id,
        batch_number, style, qty_kg, cartons, reason, detail, user_id, user_name
    ) VALUES (
        COALESCE(p_occurred_at, now()), p_stream, p_event_type, p_action, p_source_table, p_source_id,
        p_batch_number, p_style, p_qty_kg, p_cartons, p_reason, COALESCE(p_detail, '{}'::jsonb),
        v_user_id, public.stock_history_user_label(v_user_id)
    );
END;
$$;

COMMENT ON FUNCTION public.stock_soh_history_log(text, text, text, text, uuid, text, text, numeric, numeric, text, jsonb, uuid, timestamptz) IS
    'Internal writer for stock_soh_history. Not granted to anon/authenticated — a client-callable '
    'audit writer with a caller-supplied user_id would let anyone forge history rows. Reached only '
    'from SECURITY DEFINER triggers, which run as the function owner.';

REVOKE ALL ON FUNCTION public.stock_soh_history_log(text, text, text, text, uuid, text, text, numeric, numeric, text, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_history_set_actor(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 4. Kernel — packing_data per-style totals, and release-to-stock.
--
-- Rather than diffing appended array elements (adjust_kernel_stock_on_hand appends, the job-card
-- sync in 20260517120000 can rewrite), this compares the per-style TOTAL before and after. That
-- is robust to append, edit and wholesale replacement alike, and the delta it yields is exactly
-- the change to stock on hand.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kernel_style_totals(p_packing jsonb)
RETURNS TABLE (style text, qty_kg numeric, cartons numeric)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
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
    elems AS (
        SELECT e FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(COALESCE(NULLIF(p_packing, 'null'::jsonb), '[]'::jsonb)) = 'array'
                 THEN COALESCE(NULLIF(p_packing, 'null'::jsonb), '[]'::jsonb)
                 ELSE '[]'::jsonb END
        ) AS e
    )
    SELECT k.style,
           COALESCE(SUM(COALESCE(NULLIF(TRIM(elems.e ->> k.qty_key), '')::numeric, 0)), 0),
           COALESCE(SUM(COALESCE(NULLIF(TRIM(elems.e ->> k.cartons_key), '')::numeric, 0)), 0)
    FROM keys k
    LEFT JOIN elems ON true
    GROUP BY k.style;
$$;

CREATE OR REPLACE FUNCTION public.trg_stock_history_kernel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_number text;
    v_is_adjustment boolean := false;
    v_reason text;
    v_row record;
BEGIN
    -- Mind the naming: kernel.batch_id is the uuid FK to batches.id, while the human-readable
    -- batch label ("55.26.13") is batches.batch_id, a varchar. There is no batches.batch_number.
    SELECT b.batch_id INTO v_batch_number
    FROM public.batches b WHERE b.id = NEW.batch_id;

    -- Released to stock. get_kernel_batches only counts a batch as finished stock once status
    -- reaches 'complete', so this transition is the moment its packed kg become stock on hand.
    IF TG_OP = 'UPDATE'
       AND LOWER(COALESCE(NEW.status, '')) = 'complete'
       AND LOWER(COALESCE(OLD.status, '')) <> 'complete' THEN
        PERFORM public.stock_soh_history_log(
            'kernel', 'stock_in', 'released_to_stock', 'kernel', NEW.id,
            v_batch_number, NULL, NULL, NULL, NULL,
            jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status)
        );
    END IF;

    IF TG_OP = 'UPDATE' AND COALESCE(NEW.packing_data, '[]'::jsonb) IS DISTINCT FROM COALESCE(OLD.packing_data, '[]'::jsonb) THEN
        -- Was the change a manual correction? adjust_kernel_stock_on_hand tags its appended row
        -- with stock_adjustment = true and carries the operator's note in adjustment_reason.
        SELECT true,
               NULLIF(TRIM(COALESCE(e ->> 'adjustment_reason', '')), '')
          INTO v_is_adjustment, v_reason
        FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(COALESCE(NULLIF(NEW.packing_data, 'null'::jsonb), '[]'::jsonb)) = 'array'
                      THEN COALESCE(NULLIF(NEW.packing_data, 'null'::jsonb), '[]'::jsonb)
                      ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS t(e, ord)
        WHERE (e ->> 'stock_adjustment')::boolean IS TRUE
          AND t.ord > jsonb_array_length(
                  CASE WHEN jsonb_typeof(COALESCE(NULLIF(OLD.packing_data, 'null'::jsonb), '[]'::jsonb)) = 'array'
                       THEN COALESCE(NULLIF(OLD.packing_data, 'null'::jsonb), '[]'::jsonb)
                       ELSE '[]'::jsonb END)
        ORDER BY t.ord DESC
        LIMIT 1;

        v_is_adjustment := COALESCE(v_is_adjustment, false);

        FOR v_row IN
            SELECT n.style,
                   (n.qty_kg  - o.qty_kg)  AS d_qty,
                   (n.cartons - o.cartons) AS d_cartons
            FROM public.kernel_style_totals(NEW.packing_data) n
            JOIN public.kernel_style_totals(OLD.packing_data) o ON o.style = n.style
            WHERE (n.qty_kg - o.qty_kg) <> 0 OR (n.cartons - o.cartons) <> 0
        LOOP
            PERFORM public.stock_soh_history_log(
                'kernel',
                CASE WHEN v_is_adjustment THEN 'adjustment'
                     WHEN v_row.d_qty < 0 OR v_row.d_cartons < 0 THEN 'adjustment'
                     ELSE 'stock_in' END,
                CASE WHEN v_is_adjustment THEN 'manual_adjustment' ELSE 'packing_recorded' END,
                'kernel', NEW.id, v_batch_number, v_row.style,
                NULLIF(v_row.d_qty, 0), NULLIF(v_row.d_cartons, 0), v_reason,
                jsonb_build_object('status', NEW.status)
            );
        END LOOP;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stock_history_kernel ON public.kernel;
CREATE TRIGGER stock_history_kernel
    AFTER UPDATE ON public.kernel
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_stock_history_kernel();

-- ============================================================================
-- 5. Kernel & oil dispatch orders — per (batch, style) line diff.
--
-- Creating an order is what drops on-hand (get_kernel_batches subtracts .lines), so INSERT logs
-- the full line set as negative. UPDATE logs only the delta, so editing an order from 10 to 12
-- cartons records -2, not another -12. Setting dispatched_at is logged as a zero-quantity marker
-- event: it is worth seeing in the trail, but it moves no stock a second time.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_line_totals(p_lines jsonb, p_stream text)
RETURNS TABLE (ref_id uuid, batch_number text, style text, qty_kg numeric, cartons numeric)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
    SELECT NULLIF(TRIM(COALESCE(e ->> 'kernel_id', e ->> 'oil_batch_id', '')), '')::uuid,
           NULLIF(TRIM(COALESCE(e ->> 'batch_number', '')), ''),
           COALESCE(NULLIF(TRIM(COALESCE(e ->> 'style', e ->> 'grade', '')), ''), '—'),
           COALESCE(SUM(COALESCE(NULLIF(TRIM(e ->> 'quantity_kg'), '')::numeric, 0)), 0),
           COALESCE(SUM(COALESCE(NULLIF(TRIM(e ->> 'cartons'), '')::numeric, 0)), 0)
    FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(COALESCE(NULLIF(p_lines, 'null'::jsonb), '[]'::jsonb)) = 'array'
                  THEN COALESCE(NULLIF(p_lines, 'null'::jsonb), '[]'::jsonb)
                  ELSE '[]'::jsonb END
         ) AS e
    GROUP BY 1, 2, 3;
$$;

CREATE OR REPLACE FUNCTION public.trg_stock_history_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stream text := CASE WHEN TG_TABLE_NAME = 'kernel_dispatch_orders' THEN 'kernel' ELSE 'oil' END;
    v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN '[]'::jsonb ELSE COALESCE(OLD.lines, '[]'::jsonb) END;
    v_row record;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.dispatched_at IS NOT NULL
       AND OLD.dispatched_at IS NULL THEN
        PERFORM public.stock_soh_history_log(
            v_stream, 'dispatch_out', 'dispatch_completed', TG_TABLE_NAME, NEW.id,
            NULL, NULL, NULL, NULL, NULL,
            jsonb_build_object('buyer_name', NEW.buyer_name, 'status', NEW.status,
                               'note', 'Marked dispatched; quantities were already deducted when the order lines were saved.')
        );
    END IF;

    IF TG_OP = 'INSERT' OR COALESCE(NEW.lines, '[]'::jsonb) IS DISTINCT FROM v_old THEN
        -- New lines counted positive, old lines negative, then summed per (batch, style): the
        -- result is the net change. This deliberately avoids a FULL OUTER JOIN — matching on a
        -- nullable ref_id needs IS NOT DISTINCT FROM, and Postgres rejects that as a FULL JOIN
        -- condition ("FULL JOIN is only supported with merge-joinable or hash-joinable join
        -- conditions"). GROUP BY treats NULL keys as equal, so unmatched lines still pair up.
        FOR v_row IN
            SELECT d.ref_id,
                   MAX(d.batch_number) AS batch_number,
                   d.style,
                   SUM(d.qty_kg)  AS d_qty,
                   SUM(d.cartons) AS d_cartons
            FROM (
                SELECT n.ref_id, n.batch_number, n.style, n.qty_kg, n.cartons
                FROM public.dispatch_line_totals(COALESCE(NEW.lines, '[]'::jsonb), v_stream) n
                UNION ALL
                SELECT o.ref_id, o.batch_number, o.style, -o.qty_kg, -o.cartons
                FROM public.dispatch_line_totals(v_old, v_stream) o
            ) d
            GROUP BY d.ref_id, d.style
            HAVING SUM(d.qty_kg) <> 0 OR SUM(d.cartons) <> 0
        LOOP
            PERFORM public.stock_soh_history_log(
                v_stream, 'dispatch_out',
                CASE WHEN TG_OP = 'INSERT' THEN 'dispatch_order_created' ELSE 'dispatch_order_lines_changed' END,
                TG_TABLE_NAME, NEW.id, v_row.batch_number, v_row.style,
                -- A dispatch line REMOVES stock, so the on-hand delta is the negative of the line
                -- quantity: a new 12-carton line is -12 on hand, deleting it is +12 back.
                NULLIF(-v_row.d_qty, 0), NULLIF(-v_row.d_cartons, 0), NULL,
                jsonb_build_object('buyer_name', NEW.buyer_name, 'status', NEW.status,
                                   'source_ref_id', v_row.ref_id)
            );
        END LOOP;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stock_history_kernel_dispatch ON public.kernel_dispatch_orders;
CREATE TRIGGER stock_history_kernel_dispatch
    AFTER INSERT OR UPDATE ON public.kernel_dispatch_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_stock_history_dispatch();

DROP TRIGGER IF EXISTS stock_history_oil_dispatch ON public.oil_dispatch_orders;
CREATE TRIGGER stock_history_oil_dispatch
    AFTER INSERT OR UPDATE ON public.oil_dispatch_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_stock_history_dispatch();

-- ============================================================================
-- 6. Oil & protein lots.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_stock_history_oil_lot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_label text;
BEGIN
    v_label := COALESCE(NULLIF(TRIM(NEW.grade), ''), NULLIF(TRIM(NEW.product_description), ''));

    IF TG_OP = 'INSERT' THEN
        IF COALESCE(NEW.is_active, true) AND COALESCE(NEW.kilograms, 0) <> 0 THEN
            PERFORM public.stock_soh_history_log(
                'oil', 'stock_in', 'lot_added', 'oil_stock_lots', NEW.id,
                NEW.batch_number, v_label, NEW.kilograms, NULL, NULLIF(TRIM(NEW.notes), ''),
                jsonb_build_object('location_code', NEW.location_code,
                                   'stock_category', NEW.stock_category, 'status', NEW.status)
            );
        END IF;
        RETURN NULL;
    END IF;

    -- Deactivation removes the whole lot from on-hand.
    IF COALESCE(OLD.is_active, true) AND NOT COALESCE(NEW.is_active, true) THEN
        PERFORM public.stock_soh_history_log(
            'oil', 'adjustment', 'lot_deactivated', 'oil_stock_lots', NEW.id,
            NEW.batch_number, v_label, -COALESCE(OLD.kilograms, 0), NULL, NULLIF(TRIM(NEW.notes), ''),
            jsonb_build_object('location_code', NEW.location_code, 'status', NEW.status)
        );
        RETURN NULL;
    END IF;

    IF NOT COALESCE(OLD.is_active, true) AND COALESCE(NEW.is_active, true) THEN
        PERFORM public.stock_soh_history_log(
            'oil', 'stock_in', 'lot_reactivated', 'oil_stock_lots', NEW.id,
            NEW.batch_number, v_label, COALESCE(NEW.kilograms, 0), NULL, NULLIF(TRIM(NEW.notes), ''),
            jsonb_build_object('location_code', NEW.location_code, 'status', NEW.status)
        );
        RETURN NULL;
    END IF;

    IF COALESCE(NEW.kilograms, 0) <> COALESCE(OLD.kilograms, 0) AND COALESCE(NEW.is_active, true) THEN
        PERFORM public.stock_soh_history_log(
            'oil', 'adjustment', 'lot_quantity_changed', 'oil_stock_lots', NEW.id,
            NEW.batch_number, v_label,
            COALESCE(NEW.kilograms, 0) - COALESCE(OLD.kilograms, 0), NULL, NULLIF(TRIM(NEW.notes), ''),
            jsonb_build_object('from_kg', OLD.kilograms, 'to_kg', NEW.kilograms,
                               'location_code', NEW.location_code, 'status', NEW.status)
        );
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stock_history_oil_lot ON public.oil_stock_lots;
CREATE TRIGGER stock_history_oil_lot
    AFTER INSERT OR UPDATE ON public.oil_stock_lots
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_stock_history_oil_lot();

-- ============================================================================
-- 7. Shell waste lots — saleable stock on the same screen.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_stock_history_shell_lot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public.stock_soh_history_log(
            'shell', 'stock_in', 'lot_added', 'shell_stock_lot', NEW.id,
            COALESCE(NEW.source_batch_number, NEW.lot_number), NULL,
            NEW.quantity_kg, NULL, NULLIF(TRIM(NEW.notes), ''),
            jsonb_build_object('lot_number', NEW.lot_number, 'status', NEW.status)
        );
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM public.stock_soh_history_log(
            'shell', 'adjustment', 'lot_deleted', 'shell_stock_lot', OLD.id,
            COALESCE(OLD.source_batch_number, OLD.lot_number), NULL,
            -COALESCE(OLD.quantity_kg, 0), NULL, NULL,
            jsonb_build_object('lot_number', OLD.lot_number, 'status', OLD.status)
        );
        RETURN NULL;
    END IF;

    IF LOWER(COALESCE(NEW.status, '')) = 'dispatched' AND LOWER(COALESCE(OLD.status, '')) <> 'dispatched' THEN
        PERFORM public.stock_soh_history_log(
            'shell', 'dispatch_out', 'lot_dispatched', 'shell_stock_lot', NEW.id,
            COALESCE(NEW.source_batch_number, NEW.lot_number), NULL,
            -COALESCE(NEW.quantity_kg, 0), NULL, NULLIF(TRIM(NEW.notes), ''),
            jsonb_build_object('lot_number', NEW.lot_number, 'status', NEW.status)
        );
    ELSIF COALESCE(NEW.quantity_kg, 0) <> COALESCE(OLD.quantity_kg, 0) THEN
        PERFORM public.stock_soh_history_log(
            'shell', 'adjustment', 'lot_quantity_changed', 'shell_stock_lot', NEW.id,
            COALESCE(NEW.source_batch_number, NEW.lot_number), NULL,
            COALESCE(NEW.quantity_kg, 0) - COALESCE(OLD.quantity_kg, 0), NULL, NULLIF(TRIM(NEW.notes), ''),
            jsonb_build_object('from_kg', OLD.quantity_kg, 'to_kg', NEW.quantity_kg,
                               'lot_number', NEW.lot_number, 'status', NEW.status)
        );
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS stock_history_shell_lot ON public.shell_stock_lot;
CREATE TRIGGER stock_history_shell_lot
    AFTER INSERT OR UPDATE OR DELETE ON public.shell_stock_lot
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_stock_history_shell_lot();

-- ============================================================================
-- 8. get_stock_edit_history — the reader the portal calls.
--
-- Named to avoid colliding with get_stock_soh_history(text,integer), the dashboard chart series.
-- Every row carries total_count so the UI can paginate without a second round trip, and p_limit
-- is hard-capped at 200 per BluePrint/supabase-database-rules.md ("ALWAYS use LIMIT").
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_stock_edit_history(
    p_stream     text DEFAULT NULL,
    p_event_type text DEFAULT NULL,
    p_search     text DEFAULT NULL,
    p_date_from  date DEFAULT NULL,
    p_date_to    date DEFAULT NULL,
    p_user_id    uuid DEFAULT NULL,
    p_limit      integer DEFAULT 50,
    p_offset     integer DEFAULT 0
)
RETURNS TABLE (
    id           uuid,
    occurred_at  timestamptz,
    stream       text,
    event_type   text,
    action       text,
    batch_number text,
    style        text,
    qty_kg       numeric,
    cartons      numeric,
    reason       text,
    detail       jsonb,
    user_id      uuid,
    user_name    text,
    backfilled   boolean,
    total_count  bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit  integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
    v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
    v_stream text := NULLIF(LOWER(TRIM(COALESCE(p_stream, ''))), '');
    v_event  text := NULLIF(LOWER(TRIM(COALESCE(p_event_type, ''))), '');
    v_search text := NULLIF(TRIM(COALESCE(p_search, '')), '');
BEGIN
    RETURN QUERY
    WITH filtered AS (
        SELECT h.*
        FROM public.stock_soh_history h
        WHERE (v_stream IS NULL OR h.stream = v_stream)
          AND (v_event IS NULL OR h.event_type = v_event)
          AND (p_user_id IS NULL OR h.user_id = p_user_id)
          AND (p_date_from IS NULL OR (h.occurred_at AT TIME ZONE 'Africa/Johannesburg')::date >= p_date_from)
          AND (p_date_to IS NULL OR (h.occurred_at AT TIME ZONE 'Africa/Johannesburg')::date <= p_date_to)
          AND (
                v_search IS NULL
                OR h.batch_number ILIKE '%' || v_search || '%'
                OR h.style        ILIKE '%' || v_search || '%'
                OR h.user_name    ILIKE '%' || v_search || '%'
                OR h.reason       ILIKE '%' || v_search || '%'
                OR h.action       ILIKE '%' || v_search || '%'
              )
    ),
    counted AS (SELECT count(*) AS n FROM filtered)
    SELECT f.id, f.occurred_at, f.stream, f.event_type, f.action, f.batch_number, f.style,
           f.qty_kg, f.cartons, f.reason, f.detail, f.user_id, f.user_name,
           COALESCE((f.detail ->> 'backfilled')::boolean, false),
           c.n
    FROM filtered f CROSS JOIN counted c
    ORDER BY f.occurred_at DESC, f.id DESC
    LIMIT v_limit OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION public.get_stock_edit_history(text, text, text, date, date, uuid, integer, integer) IS
    'Paged stock-on-hand edit history: who changed stock, when, and by how much. Read-only. '
    'p_limit is capped at 200; total_count is repeated on every row for pagination.';

-- ============================================================================
-- 9. RBAC — read-only function, granted to every role, matching the precedent set by
-- get_stock_soh_history (20260713160000). Per docs/RBAC_NEW_FUNCTION_CHECKLIST.md the internal
-- writer and the trigger functions are granted to NO role: they are unreachable from the portal.
-- roles.id is uuid on both dev (nmdmddugxclpqrwylyfa) and prod (sofanhfpxifgdtooefzq); the DO
-- block below is type-agnostic so it runs unchanged on either.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_stock_edit_history(text, text, text, date, date, uuid, integer, integer) TO anon, authenticated, service_role;

DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_stock_edit_history', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
