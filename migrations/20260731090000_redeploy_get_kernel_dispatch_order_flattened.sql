-- Redeploy get_kernel_dispatch_order: the dev database was still running the pre-flatten
-- version of this function (querying the long-dropped kernel_dispatch_order_lines /
-- production_batches tables), even though migrations/20260226000015_flatten_dispatch_to_jsonb.sql
-- replaced it with a jsonb-based version months ago and the dropped tables are gone.
--
-- Confirmed live via `pg_get_functiondef`: every call to get_kernel_dispatch_order was returning
-- {"success": false, "error": "relation \"kernel_dispatch_order_lines\" does not exist"}. The
-- client silently treats that error as "no lines" (data-functions.js getKernelDispatchOrder
-- returns null when raw.success is false), which is the direct cause of the Kernel Dispatch
-- "Order lines (basket)" screen always showing "No lines on this order." — independent of the
-- create_kernel_dispatch_order empty-lines bug fixed in 20260730120000.
--
-- schema_migrations bookkeeping cannot be trusted to detect this kind of drift: version
-- 20260220120000 is recorded as applied under the name "fix_production_batches_status_check_
-- supplier_intake", which does not match the file of that name in this repo
-- (get_kernel_dispatch_orders_and_order_with_lines.sql) — the tracking table's version/name
-- pairing has been corrupted by past out-of-order manual migration application. This redeploy
-- re-asserts the correct function body directly rather than relying on that history.
--
-- Body is byte-for-byte the get_kernel_dispatch_order definition from
-- migrations/20260226000015_flatten_dispatch_to_jsonb.sql (section 7).

CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_order(p_order_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order json;
BEGIN
    IF p_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Order id is required');
    END IF;

    SELECT row_to_json(o) INTO v_order
    FROM (
        SELECT id, buyer_name, buyer_contact_id, delivery_date, best_before_date,
               status, dispatched_at, created_at, updated_at,
               COALESCE(lines,  '[]'::jsonb) AS lines,
               COALESCE(record, '{}'::jsonb) AS record
        FROM public.kernel_dispatch_orders
        WHERE id = p_order_id
        LIMIT 1
    ) o;

    IF v_order IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Order not found');
    END IF;

    RETURN json_build_object('success', true, 'order', v_order);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_order(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_order(uuid) TO anon;

NOTIFY pgrst, 'reload schema';
