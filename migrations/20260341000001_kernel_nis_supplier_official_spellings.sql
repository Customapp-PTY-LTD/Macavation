-- Official spellings for NIS kernel suppliers #1–#53 (contacts + kernel grower_name).
-- Corrects seed typos: Famile→Familie, Empirenstata→Empirestate, Dougrale→Dougvale, Ulunhata→Uluhlata,
-- Shanwan→Sharwan, Nombhabe→Nombhaba, Neeze→Nseze, Rope Miller→Ropa Miller.

-- --- public.contacts (nis_supplier): match Supplier # in notes ---
UPDATE public.contacts SET company_name = 'JD Richter Familie Trust', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #15%';

UPDATE public.contacts SET company_name = 'Empirestate Trading (Pty) Ltd', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #27%';

UPDATE public.contacts SET company_name = 'Dougvale (Pty) Ltd', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #33%';

UPDATE public.contacts SET company_name = 'Uluhlata Agri (Pty) Ltd', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #34%';

UPDATE public.contacts SET company_name = 'Sharwan Singh', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #38%';

UPDATE public.contacts SET company_name = 'Nombhaba Sugar (Pty) Ltd', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #45%';

UPDATE public.contacts SET company_name = 'Nseze Farm (Pty) Ltd', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #48%';

UPDATE public.contacts SET company_name = 'Ropa Miller', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #51%';

UPDATE public.contacts SET company_name = 'Big Five Mac', updated_at = now()
WHERE contact_type = 'nis_supplier' AND notes LIKE 'Supplier #55%' AND company_name = 'Big G Mac';

-- --- public.kernel: historical grower_name strings ---
UPDATE public.kernel SET grower_name = 'JD Richter Familie Trust', updated_at = now()
WHERE grower_name = 'JD Richter Famile Trust';

UPDATE public.kernel SET grower_name = 'Empirestate Trading (Pty) Ltd', updated_at = now()
WHERE grower_name = 'Empirenstata Trading (Pty) Ltd';

UPDATE public.kernel SET grower_name = 'Dougvale (Pty) Ltd', updated_at = now()
WHERE grower_name = 'Dougrale (Pty) Ltd';

UPDATE public.kernel SET grower_name = 'Uluhlata Agri (Pty) Ltd', updated_at = now()
WHERE grower_name = 'Ulunhata Agri (Pty) Ltd';

UPDATE public.kernel SET grower_name = 'Sharwan Singh', updated_at = now()
WHERE grower_name = 'Shanwan Singh';

UPDATE public.kernel SET grower_name = 'Nombhaba Sugar (Pty) Ltd', updated_at = now()
WHERE grower_name = 'Nombhabe Sugar (Pty) Ltd';

UPDATE public.kernel SET grower_name = 'Nseze Farm (Pty) Ltd', updated_at = now()
WHERE grower_name = 'Neeze Farm (Pty) Ltd';

UPDATE public.kernel SET grower_name = 'Ropa Miller', updated_at = now()
WHERE grower_name = 'Rope Miller';

NOTIFY pgrst, 'reload schema';
