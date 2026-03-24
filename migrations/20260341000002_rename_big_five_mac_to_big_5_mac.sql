-- Supplier #55: canonical name Big Five Mac -> Big 5 Mac (contacts + kernel).
UPDATE public.contacts SET company_name = 'Big 5 Mac', updated_at = now()
WHERE contact_type = 'nis_supplier' AND company_name = 'Big Five Mac';

UPDATE public.kernel SET grower_name = 'Big 5 Mac', updated_at = now()
WHERE grower_name = 'Big Five Mac';

NOTIFY pgrst, 'reload schema';
