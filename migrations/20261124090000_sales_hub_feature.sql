-- Sales (24 Nov 2026): one page for orders, prices, customers and sales figures (route sales-hub).
-- The page only reads through existing RPCs and writes through the existing dialogs, so the only
-- database change is the feature row that puts it in the menu.
--
-- Given to every role that already has the sales screens it gathers (Sales & Production Data):
-- on prod 24 Nov 2026 that is admin, super_user, Sales Exec, Procurement Lead and Palladium Manager.
-- The Prices tab still needs kernel_prices.view, and every action keeps its own permission check.
-- Idempotent: safe to run more than once.

INSERT INTO public.features (key, name, description, is_active)
VALUES ('sales-hub', 'Sales',
        'One page for selling: orders waiting for pricing, kernel prices, customers and sales figures by period.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT rf.role_id, f_new.id, 'true'
FROM public.role_features rf
JOIN public.features f_old ON f_old.id = rf.feature_id AND f_old.key = 'sales-data-grid'
CROSS JOIN public.features f_new
WHERE f_new.key = 'sales-hub'
  AND rf.value::text IN ('true', '"true"')
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';
