-- Kernel dispatch list: optional filters by batch number (substring) and kernel supplier received date.
-- Drops the 2-arg overload so PostgREST has a single get_kernel_dispatch_orders signature.

DROP FUNCTION IF EXISTS public.get_kernel_dispatch_orders(integer, integer);

CREATE OR REPLACE FUNCTION public.get_kernel_dispatch_orders(
    p_limit                    integer DEFAULT 100,
    p_offset                   integer DEFAULT 0,
    p_batch_search             text DEFAULT NULL,
    p_supplier_received_date   date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN json_build_object(
        'success', true,
        'data', COALESCE(
            (SELECT json_agg(row_to_json(t))
             FROM (
                SELECT
                    o.id,
                    o.buyer_name,
                    o.buyer_contact_id,
                    o.delivery_date,
                    o.best_before_date,
                    o.status,
                    o.dispatched_at,
                    o.created_at,
                    o.updated_at,
                    jsonb_array_length(COALESCE(o.lines, '[]'::jsonb)) AS line_count,
                    (SELECT COALESCE(SUM((el->>'quantity_kg')::numeric), 0)
                     FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS el) AS total_kg
                FROM public.kernel_dispatch_orders o
                WHERE
                    (
                        NULLIF(trim(COALESCE(p_batch_search, '')), '') IS NULL
                        OR EXISTS (
                            SELECT 1
                            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS elb
                            WHERE (elb->>'batch_number') IS NOT NULL
                              AND (elb->>'batch_number') ILIKE '%' || trim(p_batch_search) || '%'
                        )
                    )
                    AND (
                        p_supplier_received_date IS NULL
                        OR EXISTS (
                            SELECT 1
                            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS eld
                            JOIN public.kernel k ON k.id = (NULLIF(eld->>'kernel_id', ''))::uuid
                            WHERE k.received_date IS NOT DISTINCT FROM p_supplier_received_date
                        )
                    )
                ORDER BY o.created_at DESC
                LIMIT p_limit OFFSET p_offset
             ) t),
            '[]'::json
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM, 'data', '[]'::json);
END;
$$;

COMMENT ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) IS
    'Lists kernel dispatch baskets; optional p_batch_search (ILIKE on line batch_number) and p_supplier_received_date (kernel.received_date on line kernel_id).';

GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO anon;

NOTIFY pgrst, 'reload schema';
