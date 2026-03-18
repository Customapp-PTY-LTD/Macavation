-- Align messed-up log/sheet grower labels and NIS contact to official names (NIS list + Big Five Mac).

-- 1) CRM: NIS supplier #55
UPDATE public.contacts
SET company_name = 'Big Five Mac',
    updated_at = now()
WHERE contact_type = 'nis_supplier'
  AND company_name = 'Big G Mac';

-- 2) Kernel batch display names (exact-match replacements)
UPDATE public.kernel SET grower_name = 'Big Five Mac', updated_at = now()
WHERE grower_name IN ('Big 5', 'Big G Mac');

UPDATE public.kernel SET grower_name = 'Agristar Macadamias (Pty) Ltd NutsAll', updated_at = now()
WHERE grower_name IN ('Agri mac', 'Agristar');

UPDATE public.kernel SET grower_name = 'AP Vos & Seuns (Pty) Ltd', updated_at = now()
WHERE grower_name IN ('Ap Vos', 'AP Vos & Seuns');

UPDATE public.kernel SET grower_name = 'Fyvie Estates Trading', updated_at = now()
WHERE grower_name IN ('Fyve', 'Fyvie Estates');

UPDATE public.kernel SET grower_name = 'Brechoust CC', updated_at = now()
WHERE grower_name IN ('Brechoost', 'Breechoost CC');

UPDATE public.kernel SET grower_name = 'Tamboti Agric (Pty) Ltd', updated_at = now()
WHERE grower_name = 'Tambutton';

UPDATE public.kernel SET grower_name = 'Pylon Park Sugar Estate CC', updated_at = now()
WHERE grower_name = 'Pylel Parle';

UPDATE public.kernel SET grower_name = 'Mac-Eden Estate', updated_at = now()
WHERE grower_name IN ('Mac Edey', 'Meng eden', 'Mac Eden Estate');

UPDATE public.kernel SET grower_name = 'Eucalypt Forestry Services CC', updated_at = now()
WHERE grower_name IN ('Eucalypt Fo', 'Eucalypt Forestry');

UPDATE public.kernel SET grower_name = 'Foster Farming Pty Ltd', updated_at = now()
WHERE grower_name IN ('Foster Farm', 'Foster Farming');

UPDATE public.kernel SET grower_name = 'Rope Miller', updated_at = now()
WHERE grower_name = 'Ropa Miller';
