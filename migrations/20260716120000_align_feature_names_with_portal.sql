-- Align features.name with portal sidebar wording (non-numbered labels).
-- Pipeline step prefixes (1., 2., …) remain a sidebar presentation concern in the client.

UPDATE public.features
SET name = 'Find a batch', updated_at = NOW()
WHERE key = 'batch-journey';

UPDATE public.features
SET name = 'Documents', updated_at = NOW()
WHERE key = 'document-management-grid';

UPDATE public.features
SET name = 'Kernel forecast', updated_at = NOW()
WHERE key = 'kernel-production-forecast-grid';

UPDATE public.features
SET name = 'Oil forecast', updated_at = NOW()
WHERE key = 'oil-production-forecast-grid';

UPDATE public.features
SET name = 'Pallandium Integrator Dashboard', updated_at = NOW()
WHERE key = 'amanda-dashboard';

UPDATE public.features
SET name = 'User & access', updated_at = NOW()
WHERE key = 'admin-grid';

NOTIFY pgrst, 'reload schema';
