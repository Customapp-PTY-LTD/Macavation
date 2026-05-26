-- Kernel dispatch list search: grower (kernel.grower_name), CRM contact names,
-- single-character prefix rules on batches and start-of-word on names.

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
    v_q      text := trim(COALESCE(p_batch_search, ''));
    v_q_norm text;
    v_one    boolean;
BEGIN
    v_q_norm := regexp_replace(lower(v_q), '[.\s\-_/]+', '', 'g');
    v_one    := (char_length(v_q) = 1);

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
                LEFT JOIN public.contacts bc ON bc.id = o.buyer_contact_id
                WHERE
                    (
                        NULLIF(v_q, '') IS NULL
                        OR (
                            v_one
                            AND (
                                (lower(trim(COALESCE(o.buyer_name, ''))) LIKE lower(v_q) || '%'
                                 OR lower(trim(COALESCE(o.buyer_name, ''))) LIKE '% ' || lower(v_q) || '%')
                                OR (lower(trim(COALESCE(bc.company_name, ''))) LIKE lower(v_q) || '%'
                                    OR lower(trim(COALESCE(bc.company_name, ''))) LIKE '% ' || lower(v_q) || '%')
                                OR (lower(trim(COALESCE(bc.trading_name, ''))) LIKE lower(v_q) || '%'
                                    OR lower(trim(COALESCE(bc.trading_name, ''))) LIKE '% ' || lower(v_q) || '%')
                                OR (lower(trim(COALESCE(bc.primary_contact_name, ''))) LIKE lower(v_q) || '%'
                                    OR lower(trim(COALESCE(bc.primary_contact_name, ''))) LIKE '% ' || lower(v_q) || '%')
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
                                    WHERE
                                        (
                                            k2.grower_name IS NOT NULL
                                            AND (
                                                lower(trim(k2.grower_name)) LIKE lower(v_q) || '%'
                                                OR lower(trim(k2.grower_name)) LIKE '% ' || lower(v_q) || '%'
                                            )
                                        )
                                        OR (
                                            raw.bn IS NOT NULL
                                            AND (
                                                lower(raw.bn) LIKE lower(v_q) || '%'
                                                OR (
                                                    v_q_norm <> ''
                                                    AND regexp_replace(lower(raw.bn), '[.\s\-_/]+', '', 'g')
                                                        LIKE v_q_norm || '%'
                                                )
                                            )
                                        )
                                )
                            )
                        )
                        OR (
                            NOT v_one
                            AND (
                                lower(COALESCE(o.buyer_name, '')) LIKE '%' || lower(v_q) || '%'
                                OR lower(COALESCE(bc.company_name, '')) LIKE '%' || lower(v_q) || '%'
                                OR lower(COALESCE(bc.trading_name, '')) LIKE '%' || lower(v_q) || '%'
                                OR lower(COALESCE(bc.primary_contact_name, '')) LIKE '%' || lower(v_q) || '%'
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
                                    WHERE
                                        (
                                            k2.grower_name IS NOT NULL
                                            AND lower(k2.grower_name) LIKE '%' || lower(v_q) || '%'
                                        )
                                        OR (
                                            raw.bn IS NOT NULL
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
    'Lists kernel dispatch baskets. p_batch_search: length=1 uses batch prefix and name word-start; longer uses substring on buyer, contacts (company/trading/primary), grower on lines, and batch text. p_supplier_received_date filters by kernel.received_date on lines.';

GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_dispatch_orders(integer, integer, text, date) TO anon;

NOTIFY pgrst, 'reload schema';
