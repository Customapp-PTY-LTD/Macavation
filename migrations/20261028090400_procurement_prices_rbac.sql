-- =============================================================================
-- Screens + permissions for the procurement plan, NIS storage areas, style prices and
-- the dispatch approval workflow (26 Oct 2026 meeting).
--
-- Who (Henry, 26 Oct): Mike and John edit the procurement plan (Mike is Sales Exec,
-- jon@ is Shareholder); Pete (Sales Exec), Joslyn (Palladium Manager) and super users
-- view it. Because Mike and Pete share the Sales Exec role, Sales Exec can edit.
-- Prices are seen by Pete, Mike and super users only (Sales Exec). Thando (Production
-- Manager) and Mark (Factory Manager) pick dispatches and move stock between areas.
-- super_user and admin pass every action check in code; they are listed for clarity.
-- =============================================================================

INSERT INTO public.features (key, name, description)
VALUES
    ('procurement-plan', 'Procurement plan', 'Planned grower trucks against cracking: weekly, daily and monthly stock forecast'),
    ('nis-storage', 'NIS storage areas', 'Nut in shell by storage area (silo, drying, shelter, fuels depot) and moves between them'),
    ('kernel-style-prices', 'Style prices', 'Price per kg for each kernel style, with history')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now();

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key IN ('procurement-plan', 'nis-storage')) f
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Shareholder', 'Palladium Manager', 'Production Manager', 'Factory Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'kernel-style-prices') f
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec')
ON CONFLICT (role_id, feature_id) DO NOTHING;

INSERT INTO public.actions (key, module, label, description) VALUES
    ('procurement.plan.edit', 'Procurement plan', 'Edit the procurement plan', 'Plan, change and cancel grower trucks; set day types and plan settings'),
    ('nis_storage.move', 'NIS storage', 'Move NIS stock between storage areas', 'Record stock placed in, moved between or taken out of a storage area'),
    ('kernel_prices.view', 'Kernel prices', 'See kernel prices and sale values', 'Shows rand prices and values on style prices, dispatch approval and the Kernel Dashboard'),
    ('kernel_prices.edit', 'Kernel prices', 'Change kernel style prices', 'Save new style prices and change the pricing mode'),
    ('kernel_dispatch.pick', 'Kernel Dispatch', 'Confirm picked stock', 'Confirm what was picked for a dispatch and flag changes'),
    ('kernel_dispatch.approve', 'Kernel Dispatch', 'Approve dispatch and record the sale', 'Price a picked dispatch, add transport and record it as a sale')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM (VALUES
    ('procurement.plan.edit',   ARRAY['super_user', 'admin', 'Sales Exec', 'Shareholder']),
    ('nis_storage.move',        ARRAY['super_user', 'admin', 'Sales Exec', 'Shareholder', 'Production Manager', 'Factory Manager']),
    ('kernel_prices.view',      ARRAY['super_user', 'admin', 'Sales Exec']),
    ('kernel_prices.edit',      ARRAY['super_user', 'admin', 'Sales Exec']),
    ('kernel_dispatch.pick',    ARRAY['super_user', 'admin', 'Production Manager', 'Factory Manager']),
    ('kernel_dispatch.approve', ARRAY['super_user', 'admin', 'Sales Exec'])
) AS g(action_key, roles)
JOIN public.actions a ON a.key = g.action_key
JOIN public.roles r ON r.role_name = ANY (g.roles)
ON CONFLICT (role_id, action_id) DO NOTHING;

-- Function permissions (bookkeeping; RPCs are SECURITY DEFINER + anon). NOT EXISTS: no unique key.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY[
    'get_procurement_plan', 'save_procurement_delivery', 'cancel_procurement_delivery',
    'set_procurement_days', 'set_procurement_plan_settings',
    'get_nis_storage_overview', 'record_nis_storage_movement', 'set_nis_storage_area_capacity',
    'get_kernel_style_prices', 'save_kernel_style_prices', 'set_kernel_pricing_mode',
    'get_kernel_dispatch_workflow', 'get_kernel_dispatch_stages', 'confirm_kernel_dispatch_pick',
    'send_back_kernel_dispatch', 'approve_kernel_dispatch_sale', 'get_kernel_dashboard_dispatch_sales'
]) AS fn
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Shareholder', 'Palladium Manager', 'Production Manager', 'Factory Manager')
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
