-- NIS supplier #57: kernel rows used "Two Rivers Trust" while CRM / official list is "The Two Rivers Trust".
-- Fixes wrong grower display and CRM sort index (NIS_SUPPLIER_ORDER uses the full name).

UPDATE public.kernel SET grower_name = 'The Two Rivers Trust', updated_at = now()
WHERE grower_name = 'Two Rivers Trust';

NOTIFY pgrst, 'reload schema';
