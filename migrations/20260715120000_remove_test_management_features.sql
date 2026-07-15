-- Remove portal Test Management feature keys (test-scenarios-grid, test-data-grid).
-- The Web Portal module and submodules have been removed; clear role assignments first.

DELETE FROM public.role_features
WHERE feature_id IN (
    SELECT id FROM public.features
    WHERE key IN ('test-scenarios-grid', 'test-data-grid')
);

DELETE FROM public.features
WHERE key IN ('test-scenarios-grid', 'test-data-grid');
