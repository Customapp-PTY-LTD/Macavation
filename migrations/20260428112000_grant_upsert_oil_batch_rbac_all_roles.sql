-- Supplier Intake: ensure all roles can save Receiver checklist batches.
-- Fixes "Access denied: operation EXECUTE is not allowed" when Save/Create calls upsert_oil_batch.
-- Safe to re-run.

GRANT EXECUTE ON FUNCTION public.upsert_oil_batch(
    uuid,
    character varying,
    date,
    character varying,
    numeric,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    timestamp with time zone,
    timestamp with time zone,
    timestamp with time zone,
    timestamp with time zone,
    uuid,
    uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_oil_batch(
    uuid,
    character varying,
    date,
    character varying,
    numeric,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    timestamp with time zone,
    timestamp with time zone,
    timestamp with time zone,
    timestamp with time zone,
    uuid,
    uuid
) TO service_role;

GRANT EXECUTE ON FUNCTION public.upsert_oil_batch(
    uuid,
    character varying,
    date,
    character varying,
    numeric,
    jsonb,
    jsonb,
    jsonb,
    jsonb,
    timestamp with time zone,
    timestamp with time zone,
    timestamp with time zone,
    timestamp with time zone,
    uuid,
    uuid
) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id,
       'function',
       'upsert_oil_batch',
       'EXECUTE',
       true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions x
    WHERE x.role_id = r.id
      AND x.object_type = 'function'
      AND x.object_name = 'upsert_oil_batch'
      AND x.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true,
    updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'upsert_oil_batch'
  AND operation = 'EXECUTE';

NOTIFY pgrst, 'reload schema';
