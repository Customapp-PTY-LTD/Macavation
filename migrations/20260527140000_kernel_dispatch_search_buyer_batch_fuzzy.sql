-- Kernel dispatch list search: buyer name, batch_number / BatchNumber JSON keys,
-- batches.batch_id fallback via kernel_id, and fuzzy batch match (ignore . - / spaces).

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
DECLARE
    v_q text := trim(COALESCE(p_batch_search, ''));
    v_q_norm text;
BEGIN
    v_q_norm := regexp_replace(lower(v_q), '[.\s\-_/]+', '', 'g');

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
                        NULLIF(v_q, '') IS NULL
                        OR lower(COALESCE(o.buyer_name, '')) LIKE '%' || lower(v_q) || '%'
                        OR EXISTS (
                            SELECT 1
                            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS elb(line)
                            LEFT JOIN public.kernel k2 ON k2.id = (NULLIF(COALESCE(line->>'kernel_id', line->>'KernelId'), ''))::uuid
                            LEFT JOIN public.batches b2 ON b2.id = k2.batch_id
                            CROSS JOIN LATERAL (
                                SELECT NULLIF(
                                    trim(both FROM COALESCE(
                                        line->>'batch_number',
                                        line->>'BatchNumber',
                                        b2.batch_id::text
                                    )),
                                    ''
                                ) AS bn
                            ) raw
                            WHERE raw.bn IS NOT NULL
                              AND (
                                  raw.bn ILIKE '%' || v_q || '%'
                                  OR (
                                      v_q_norm <> ''
                                      AND regexp_replace(lower(raw.bn), '[.\s\-_/]+', '', 'g')
                                          LIKE '%' || v_q_norm || '%'
                                  )
                              )
                        )
                    )
                    AND (
                        p_supplier_received_date IS NULL
                        OR EXISTS (
                            SELECT 1
                            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS eld(line)
                            JOIN public.kernel k ON k.id = (NULLIF(COALESCE(line->>'kernel_id', line->>'KernelId'), ''))::uuid
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
    'Lists kernel dispatch baskets. p_batch_search matches buyer_name (ILIKE) or any line batch (batch_number / BatchNumber / batches.batch_id via kernel_id), with separator-insensitive batch match. p_supplier_received_date filters lines by kernel.received_date.';

GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO anon;

NOTIFY pgrst, 'reload schema';
