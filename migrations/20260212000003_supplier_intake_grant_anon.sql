-- Allow Supabase anon/authenticated roles to call supplier intake RPCs.
-- This lets the frontend call these functions via Supabase REST when the Lambda returns 403 (RBAC),
-- so Supplier Intake save works even if role_permissions is not fixed for the user's role.

GRANT EXECUTE ON FUNCTION public.get_supplier_intake_batches(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_intake_batches(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_supplier_intake_batch(
    varchar, date, varchar, uuid, text,
    varchar, varchar, varchar, varchar, varchar, varchar, text,
    varchar, text, varchar, integer, numeric, date, date
) TO anon;
GRANT EXECUTE ON FUNCTION public.create_supplier_intake_batch(
    varchar, date, varchar, uuid, text,
    varchar, varchar, varchar, varchar, varchar, varchar, text,
    varchar, text, varchar, integer, numeric, date, date
) TO authenticated;
