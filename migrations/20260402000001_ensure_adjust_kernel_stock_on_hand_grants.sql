-- Idempotent: ensure manual kernel stock adjustment RPC is executable via API/PostgREST.
-- (Live project already had grants; this documents and aligns new environments.)

GRANT EXECUTE ON FUNCTION public.adjust_kernel_stock_on_hand(uuid, varchar, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_kernel_stock_on_hand(uuid, varchar, numeric, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_kernel_stock_on_hand(uuid, varchar, numeric, numeric, text) TO anon;
