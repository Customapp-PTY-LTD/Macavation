-- Fix get_batch_remaining_by_style for flattened dispatch (kernel_dispatch_orders.lines jsonb).
-- Replaces dependency on dropped kernel_dispatch_order_lines table.

CREATE OR REPLACE FUNCTION public.get_batch_remaining_by_style(p_batch_id uuid, p_yield_by_style jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_object_agg(
      kv.key,
      GREATEST(0,
        COALESCE((p_yield_by_style->>kv.key)::numeric, 0)
        - COALESCE((
            SELECT SUM(NULLIF(le ->> 'quantity_kg', '')::numeric)
            FROM kernel_dispatch_orders o
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
            WHERE NULLIF(le ->> 'kernel_id', '')::uuid = p_batch_id
              AND le ->> 'style' = kv.key
          ), 0)
      )
    )
    FROM jsonb_each_text(COALESCE(p_yield_by_style, '{}'::jsonb)) AS kv(key, val)),
    '{}'::jsonb
  );
$$;
