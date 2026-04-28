-- Oil module visibility: ensure all roles can load oil batches list.
-- Fixes "Access denied: operation EXECUTE is not allowed" when Oil Production / Supplier Intake reads get_oil_batches.
-- Safe to re-run.

GRANT EXECUTE ON FUNCTION public.get_oil_batches(
    character varying,
    character varying,
    integer,
    integer
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_oil_batches(
    character varying,
    character varying,
    integer,
    integer
) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_oil_batches(
    character varying,
    character varying,
    integer,
    integer
) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id,
       'function',
       'get_oil_batches',
       'EXECUTE',
       true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = 'get_oil_batches'
      AND x.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true,
    updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'get_oil_batches'
  AND operation = 'EXECUTE';

NOTIFY pgrst, 'reload schema';
