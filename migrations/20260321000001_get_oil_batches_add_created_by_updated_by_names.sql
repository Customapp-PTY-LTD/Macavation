-- Add created_by, updated_by and resolved user names to get_oil_batches for audit display (e.g. batch detail popup).
-- Names are resolved from public.users (username or email) so the frontend can show "Created by" / "Updated by" without an extra lookup.

DROP FUNCTION IF EXISTS public.get_oil_batches(character varying, character varying, integer, integer);

CREATE OR REPLACE FUNCTION public.get_oil_batches(
    p_status  varchar DEFAULT NULL,
    p_search  varchar DEFAULT NULL,
    p_limit   integer DEFAULT 100,
    p_offset  integer DEFAULT 0
)
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
        (SELECT COALESCE(NULLIF(trim(u_c.username), ''), NULLIF(trim(u_c.email), ''), '') FROM public.users u_c WHERE u_c.id = o.created_by)::text AS created_by_name,
        (SELECT COALESCE(NULLIF(trim(u_u.username), ''), NULLIF(trim(u_u.email), ''), '') FROM public.users u_u WHERE u_u.id = o.updated_by)::text AS updated_by_name
    FROM public.oil o
    WHERE o.is_active = true
      AND (
          p_status IS NULL
          OR o.status = p_status
          OR o.status = ANY(string_to_array(p_status, ','))
      )
      AND (
          p_search IS NULL
          OR o.batch_id ILIKE '%' || p_search || '%'
          OR (o.production_data->>'name_of_product') ILIKE '%' || p_search || '%'
          OR (o.production_data->>'shift_supervisor') ILIKE '%' || p_search || '%'
      )
    ORDER BY o.production_date DESC NULLS LAST, o.created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_oil_batches(varchar, varchar, integer, integer) IS 'List oil batches for grids; includes created_by/updated_by and resolved user names from users table for audit display.';
