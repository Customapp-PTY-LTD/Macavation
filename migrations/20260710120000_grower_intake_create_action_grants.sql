-- Align Grower Intake create-batch button with role action catalogue.
-- The portal gates the Create kernel batch button with grower.intake.create.
-- Remove obsolete duplicate grower.batch.create and grant intake actions to roles
-- that already have the grower-intake-grid module.

DELETE FROM public.role_actions ra
USING public.actions a
WHERE ra.action_id = a.id
  AND a.key = 'grower.batch.create';

DELETE FROM public.actions
WHERE key = 'grower.batch.create';

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT rf.role_id, a.id, 'true'
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key = 'grower-intake-grid'
JOIN public.actions a ON a.key IN ('grower.intake.create', 'grower.procurement.manage')
WHERE COALESCE(rf.value, 'true') IN ('true', '1', 'yes')
ON CONFLICT (role_id, action_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
