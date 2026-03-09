-- Return a single oil batch by id (for Add/Edit production data modal).
-- Same shape as one row from get_oil_batches.

CREATE OR REPLACE FUNCTION public.get_oil_batch_by_id(p_oil_id uuid)
RETURNS TABLE (
    id                      uuid,
    batch_id                varchar,
    production_date         date,
    status                  varchar,
    total_oil_litre         numeric,
    name_of_product         varchar,
    shift_supervisor        varchar,
    shift                   varchar,
    intake_completed_at     timestamptz,
    production_completed_at timestamptz,
    stock_completed_at      timestamptz,
    dispatch_completed_at   timestamptz,
    intake_data             jsonb,
    production_data         jsonb,
    stock_data              jsonb,
    dispatch_data           jsonb,
    created_at              timestamptz,
    created_by              uuid,
    updated_by              uuid,
    created_by_name         text,
    updated_by_name         text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id,
        o.batch_id,
        o.production_date,
        o.status,
        o.total_oil_litre,
        (o.production_data->>'name_of_product')::varchar,
        (o.production_data->>'shift_supervisor')::varchar,
        (o.production_data->>'shift')::varchar,
        o.intake_completed_at,
        o.production_completed_at,
        o.stock_completed_at,
        o.dispatch_completed_at,
        o.intake_data,
        o.production_data,
        o.stock_data,
        o.dispatch_data,
        o.created_at,
        o.created_by,
        o.updated_by,
        (SELECT COALESCE(NULLIF(trim(u_c.username), ''), NULLIF(trim(u_c.email), ''), '') FROM public.users u_c WHERE u_c.id = o.created_by)::text,
        (SELECT COALESCE(NULLIF(trim(u_u.username), ''), NULLIF(trim(u_u.email), ''), '') FROM public.users u_u WHERE u_u.id = o.updated_by)::text
    FROM public.oil o
    WHERE o.id = p_oil_id AND o.is_active = true;
END;
$$;

COMMENT ON FUNCTION public.get_oil_batch_by_id(uuid) IS 'Return a single oil batch by id for Add/Edit production data modal; same shape as get_oil_batches.';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_oil_batch_by_id', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
