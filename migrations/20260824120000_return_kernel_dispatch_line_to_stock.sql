-- Send ONE line of a kernel dispatch order back to stock.
--
-- WHY THIS IS A NEW FUNCTION AND NOT A FLAG ON update_kernel_dispatch_order
-- -----------------------------------------------------------------------------
-- Kernel stock on hand is DERIVED, not stored. get_kernel_batches computes
--   remaining_by_style_cartons = yield cartons - SUM(kernel_dispatch_orders.lines cartons)
-- across every order regardless of dispatched_at (see 20260305000003 and the root-cause notes
-- in 20260730120000). There is no kernel_stock table to credit. So "send this line back to
-- stock" is exactly "remove this line object from kernel_dispatch_orders.lines" - the cartons
-- reappear on hand the moment the subtraction stops.
--
-- update_kernel_dispatch_order cannot express it. That function rewrites the WHOLE lines array
-- from what the Edit modal posts, and it rejects an empty array outright:
--   IF jsonb_array_length(COALESCE(p_lines,'[]'::jsonb)) = 0 THEN ... 'At least one line is
--   required'
-- On dev right now 5 of the 17 pending orders hold exactly ONE line, so "send the only line
-- back" is the common case, not an edge case - and through the existing RPC it is impossible.
-- Widening that guard would also make emptying an order a silent side effect of an ordinary
-- save, which is precisely the state 20260730120000 was written to stamp out ("A basket created
-- with zero lines renders 'No lines on this order.' forever ... dispatching it looks like it did
-- nothing to stock on hand"). A single-purpose RPC keeps the destructive path explicit.
--
-- WHY THE LAST LINE CANCELS THE ORDER RATHER THAN DELETING THE ROW
-- -----------------------------------------------------------------------------
-- 'cancelled' is already in kernel_dispatch_orders_status_check ('pending','confirmed',
-- 'dispatched','cancelled') and nothing in the database has ever set it, so no existing row
-- changes meaning. A DELETE would be worse than wrong - it would be INVISIBLE: the
-- stock_soh_history audit trail is written by stock_history_kernel_dispatch, an
-- AFTER INSERT OR UPDATE trigger (20260816090000). It does not fire on DELETE, so deleting the
-- row would return the cartons to stock with no record of who did it. An UPDATE to
-- lines='[]' + status='cancelled' fires the trigger, and trg_stock_history_dispatch already
-- computes the credit correctly for a removed line - its own comment: "a new 12-carton line is
-- -12 on hand, deleting it is +12 back". This migration therefore needs NO audit code of its
-- own; it just has to reach stock through an UPDATE.
--
-- WHY THE CALLER PASSES AN INDEX PLUS AN EXPECTED kernel_id/style
-- -----------------------------------------------------------------------------
-- Line objects in the lines jsonb have no id - they are {kernel_id, batch_number, style,
-- cartons, quantity_kg}. Nothing prevents two lines sharing (kernel_id, style), so matching on
-- content could remove the wrong one. (No order on dev holds such a pair today, but that is
-- data, not a constraint.) The index is the only exact address. An index is also fragile: it
-- shifts if someone else edits the order while the modal sits open, so the expected kernel_id
-- and style are verified against the line found at that index and a mismatch is refused rather
-- than guessed at. Both are optional so the function is still usable from SQL by hand.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260824120000_return_kernel_dispatch_line_to_stock.sql
-- against dev/UAT (nmdmddugxclpqrwylyfa, which demo shares) and, after sign-off,
--   npm run db:apply-prod -- migrations/20260824120000_return_kernel_dispatch_line_to_stock.sql
-- against prod (sofanhfpxifgdtooefzq). Re-running is safe: every statement below is idempotent.

-- ============================================================================
-- 1. return_kernel_dispatch_line_to_stock - remove one line, credit stock.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.return_kernel_dispatch_line_to_stock(
    p_order_id            uuid,
    p_line_index          integer,
    p_expected_kernel_id  text DEFAULT NULL,
    p_expected_style      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status    text;
    v_lines     jsonb;
    v_line      jsonb;
    v_count     integer;
    v_new       jsonb;
    v_cancelled boolean := false;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order id is required');
    END IF;

    IF p_line_index IS NULL OR p_line_index < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'A valid line number is required');
    END IF;

    SELECT lower(trim(coalesce(o.status, ''))), COALESCE(o.lines, '[]'::jsonb)
      INTO v_status, v_lines
      FROM public.kernel_dispatch_orders o
     WHERE o.id = p_order_id
     FOR UPDATE;

    IF v_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Order not found');
    END IF;

    -- Same rule as update_kernel_dispatch_order: a dispatched order is closed. The Kernel
    -- Dispatch grid's "Edit" on a dispatched basket already calls revert_kernel_dispatch_order
    -- to put it back to pending first; that is the supported route.
    IF v_status = 'dispatched' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'This order has already been dispatched. Put it back to awaiting dispatch first, then send a line back to stock.'
        );
    END IF;

    IF v_status = 'cancelled' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'This order is cancelled - its stock has already gone back.'
        );
    END IF;

    v_count := jsonb_array_length(v_lines);

    IF p_line_index > v_count - 1 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'That line is no longer on this order. Close this window, reopen it and try again.'
        );
    END IF;

    v_line := v_lines -> p_line_index;

    -- Stale-window guard: the index must still address the line the caller believes it does.
    IF p_expected_kernel_id IS NOT NULL
       AND COALESCE(v_line ->> 'kernel_id', '') <> p_expected_kernel_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'This order changed while the window was open. Close this window, reopen it and try again.'
        );
    END IF;

    IF p_expected_style IS NOT NULL
       AND COALESCE(v_line ->> 'style', '') <> p_expected_style THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'This order changed while the window was open. Close this window, reopen it and try again.'
        );
    END IF;

    -- jsonb - integer deletes the array element at that index.
    v_new := v_lines - p_line_index;

    IF jsonb_array_length(v_new) = 0 THEN
        v_cancelled := true;
        UPDATE public.kernel_dispatch_orders
           SET lines = '[]'::jsonb,
               status = 'cancelled',
               updated_at = now()
         WHERE id = p_order_id;
    ELSE
        UPDATE public.kernel_dispatch_orders
           SET lines = v_new,
               updated_at = now()
         WHERE id = p_order_id;
    END IF;

    RETURN jsonb_build_object(
        'success',         true,
        'order_cancelled', v_cancelled,
        'remaining_lines', jsonb_array_length(v_new),
        'batch_number',    v_line ->> 'batch_number',
        'style',           v_line ->> 'style',
        'cartons',         COALESCE(NULLIF(v_line ->> 'cartons', '')::numeric, 0),
        'quantity_kg',     COALESCE(NULLIF(v_line ->> 'quantity_kg', '')::numeric, 0),
        'message',         CASE
                               WHEN v_cancelled
                               THEN 'Sent back to stock. That was the last line on the order, so the order has been cancelled.'
                               ELSE 'Sent back to stock.'
                           END
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.return_kernel_dispatch_line_to_stock(uuid, integer, text, text) IS
    'Removes one line from kernel_dispatch_orders.lines, which returns its cartons to derived '
    'kernel stock on hand (get_kernel_batches subtracts dispatch lines from yield). Refuses a '
    'dispatched or cancelled order. Removing the last line sets status = cancelled rather than '
    'leaving a zero-line basket. The stock_history_kernel_dispatch trigger records the credit.';

-- ============================================================================
-- 2. Actor-carrying overload.
--
-- Same pattern and the same reasoning as 20260816090100: p_actor_user_id is REQUIRED and has no
-- default, so PostgREST's name-based overload resolution stays unambiguous (a defaulted actor
-- parameter would match both candidates and fail the request with PGRST203). Postgres requires
-- parameters without defaults to precede those with defaults, so it sits third.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.return_kernel_dispatch_line_to_stock(
    p_order_id            uuid,
    p_line_index          integer,
    p_actor_user_id       uuid,
    p_expected_kernel_id  text DEFAULT NULL,
    p_expected_style      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.return_kernel_dispatch_line_to_stock(
        p_order_id, p_line_index, p_expected_kernel_id, p_expected_style);
END;
$$;

COMMENT ON FUNCTION public.return_kernel_dispatch_line_to_stock(uuid, integer, uuid, text, text) IS
    'Actor-carrying overload of return_kernel_dispatch_line_to_stock. Sets the transaction-local '
    'actor GUC so the stock_soh_history row names the user, then delegates.';

-- ============================================================================
-- 3. Grants. Every portal RPC arrives as anon (this repo does not use Supabase auth).
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.return_kernel_dispatch_line_to_stock(uuid, integer, text, text)
    TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.return_kernel_dispatch_line_to_stock(uuid, integer, uuid, text, text)
    TO authenticated, service_role, anon;

-- ============================================================================
-- 4. RBAC. The Lambda layer keys on object_name only, so ONE row per role covers both
--    overloads - they cannot drift apart.
-- ============================================================================

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'return_kernel_dispatch_line_to_stock', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.object_type = 'function'
      AND rp.object_name = 'return_kernel_dispatch_line_to_stock'
      AND rp.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true, updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'return_kernel_dispatch_line_to_stock'
  AND operation = 'EXECUTE'
  AND allowed IS DISTINCT FROM true;

-- ============================================================================
-- 5. Extend the new-role grant trigger.
--
-- The array below is the LIVE list as deployed on dev (verified with pg_get_functiondef before
-- writing this file) plus the one new name. It is reproduced in full because CREATE OR REPLACE
-- overwrites the whole body - dropping a name here would silently stop granting that function to
-- roles created afterwards.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.grant_login_menu_permissions_for_new_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fn text;
    v_fns text[] := ARRAY[
        'get_users',
        'get_roles',
        'get_user_by_id',
        'get_features_for_role',
        'get_role_by_id',
        'get_features',
        'get_role_features',
        'save_kernel_dispatch_record',
        'revert_kernel_dispatch_order',
        'create_kernel_dispatch_order',
        'update_kernel_dispatch_order_cartons',
        'update_kernel_dispatch_order',
        'get_kernel_dispatch_orders',
        'get_kernel_dispatch_order',
        'update_kernel_stock_batch_info',
        'adjust_kernel_stock_on_hand',
        'return_kernel_dispatch_line_to_stock'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        SELECT NEW.id, 'function', v_fn, 'EXECUTE', true
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.role_permissions rp
            WHERE rp.role_id = NEW.id
              AND rp.object_type = 'function'
              AND rp.object_name = v_fn
              AND rp.operation = 'EXECUTE'
        );
    END LOOP;
    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
