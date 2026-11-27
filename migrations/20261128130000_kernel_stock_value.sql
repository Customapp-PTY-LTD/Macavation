-- ============================================================================
-- Kernel stock on hand: value in rand and a shelf-life summary (Mike's MacView, round 3).
--
-- Henry (27 Nov 2026): value stock at the LATEST STYLE PRICE (Kernel style prices, the list Pete
-- keeps), not at an average of recent sales. Show which price and date the value uses.
--
-- get_kernel_stock_prices() returns, per style in kernel_style_registry, the price in force today:
--   * the latest list price (customer_id IS NULL, effective_from <= today), else
--   * when there is no list price (e.g. pricing mode "per customer"), the average of each
--     customer's own latest price for that style, flagged basis = 'customer_average', else
--   * nothing (basis = 'none'): the page says the style has no price instead of valuing it at R0.
-- Role-gated: a caller without "See costs and prices" (portal_actor_sees_prices, 20261128110000)
-- gets sees_prices = false and no prices at all. Shelf-life figures need no prices and are worked
-- out on the page from each batch's best-before date and the configurable best-before bands.
--
-- Idempotent. Needs 20261028090200 (kernel_style_prices) and 20261128110000.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kernel_stock_prices()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    v_styles jsonb;
BEGIN
    IF NOT public.portal_actor_sees_prices() THEN
        RETURN jsonb_build_object('success', true, 'sees_prices', false, 'styles', '[]'::jsonb);
    END IF;

    WITH list AS (
        SELECT DISTINCT ON (p.style_code) p.style_code, p.price_per_kg, p.effective_from
        FROM public.kernel_style_prices p
        WHERE p.customer_id IS NULL AND p.effective_from <= v_today
        ORDER BY p.style_code, p.effective_from DESC
    ), cust_latest AS (
        SELECT DISTINCT ON (p.style_code, p.customer_id) p.style_code, p.customer_id, p.price_per_kg, p.effective_from
        FROM public.kernel_style_prices p
        WHERE p.customer_id IS NOT NULL AND p.effective_from <= v_today
        ORDER BY p.style_code, p.customer_id, p.effective_from DESC
    ), cust AS (
        SELECT style_code, avg(price_per_kg) AS price, max(effective_from) AS effective_from, count(*) AS n
        FROM cust_latest GROUP BY style_code
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'style_code', r.style_code, 'label', r.label,
               'price', COALESCE(l.price_per_kg, c.price),
               'effective_from', COALESCE(l.effective_from, c.effective_from),
               'basis', CASE WHEN l.style_code IS NOT NULL THEN 'list' WHEN c.style_code IS NOT NULL THEN 'customer_average' ELSE 'none' END,
               'customers', c.n)
             ORDER BY r.style_code), '[]'::jsonb)
    INTO v_styles
    FROM public.kernel_style_registry r
    LEFT JOIN list l ON l.style_code = r.style_code
    LEFT JOIN cust c ON c.style_code = r.style_code
    WHERE r.is_active;

    RETURN jsonb_build_object('success', true, 'sees_prices', true, 'as_of', v_today, 'styles', v_styles);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_stock_prices() TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', 'get_kernel_stock_prices', 'EXECUTE', true
FROM public.role_features rf JOIN public.features f ON f.id = rf.feature_id
WHERE f.key = 'see-costs-prices' AND rf.value = 'true'
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = rf.role_id AND x.object_type = 'function' AND x.object_name = 'get_kernel_stock_prices' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
