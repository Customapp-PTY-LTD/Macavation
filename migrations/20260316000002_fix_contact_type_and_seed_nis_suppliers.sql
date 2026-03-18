-- Step 1: Ensure contact_type allows 'nis_supplier' (required for NIS Suppliers tab in Contact Database Management)
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_contact_type_check
  CHECK (contact_type IN ('customer', 'supplier', 'both', 'nis_supplier', 'oil_processor', 'kernel_customer'));

-- Step 2: Seed NIS Suppliers (idempotent – skips if same company_name + contact_type already exists)
INSERT INTO public.contacts (contact_type, company_name, status, notes)
SELECT v.contact_type, v.company_name, v.status, v.notes
FROM (VALUES
  ('nis_supplier', 'Amber Macs (Pty) Ltd', 'active', 'Supplier #1, Code: MACAMB'),
  ('nis_supplier', 'Tamboti Agric (Pty) Ltd', 'active', 'Supplier #2, Code: MACTAM'),
  ('nis_supplier', 'Lilje Farms (Pty) Ltd', 'active', 'Supplier #3, Code: MACLIL'),
  ('nis_supplier', 'Senekal Familie Boerdery', 'active', 'Supplier #4, Code: MACSEN'),
  ('nis_supplier', 'Avo Valley (Pty) Ltd', 'active', 'Supplier #5, Code: MACAVO'),
  ('nis_supplier', 'Sundale Farm', 'active', 'Supplier #6, Code: MACSUN'),
  ('nis_supplier', 'Eucalypt Forestry Services CC', 'active', 'Supplier #7, Code: MACEUC'),
  ('nis_supplier', 'Perry''s Bridge Citrus Estate (Pty) Ltd', 'active', 'Supplier #8, Code: MACPER'),
  ('nis_supplier', 'Miller Farming', 'active', 'Supplier #9, Code: MACMIL'),
  ('nis_supplier', 'Stellenrust Landgoed', 'active', 'Supplier #10, Code: MACSTE'),
  ('nis_supplier', 'Pylon Park Sugar Estate CC', 'active', 'Supplier #11, Code: MACPYL'),
  ('nis_supplier', 'Cavalla Farming CC', 'active', 'Supplier #12, Code: MACCAV'),
  ('nis_supplier', 'Hopeview Farm (Pty) Ltd', 'active', 'Supplier #13, Code: MACHOP'),
  ('nis_supplier', 'MWM Agro Forestry', 'active', 'Supplier #14, Code: MACMWM'),
  ('nis_supplier', 'JD Richter Famile Trust', 'active', 'Supplier #15, Code: MACID'),
  ('nis_supplier', 'AH Bennett SP', 'active', 'Supplier #16, Code: MACAHB'),
  ('nis_supplier', 'Estorf Farms (Pty) Ltd', 'active', 'Supplier #17, Code: MACEST'),
  ('nis_supplier', 'Sharma Sugar CC', 'active', 'Supplier #18, Code: MACSHA'),
  ('nis_supplier', 'Northern Sugar Estate', 'active', 'Supplier #19, Code: MACNOR'),
  ('nis_supplier', 'Mac Damm (Pty) Ltd', 'active', 'Supplier #20, Code: MACMAC'),
  ('nis_supplier', 'The Umhlatuzi Valley Sugar Company (Pty) Ltd', 'active', 'Supplier #21, Code: MACUVS'),
  ('nis_supplier', 'Horn Familie Trust', 'active', 'Supplier #22, Code: MACHOR'),
  ('nis_supplier', 'Fyvie Estates Trading', 'active', 'Supplier #23, Code: MACFYV'),
  ('nis_supplier', 'D.S. Vorster Landgoed CC', 'active', 'Supplier #24, Code: MACDSV'),
  ('nis_supplier', 'Duleen Estates CC', 'active', 'Supplier #25, Code: MACDUL'),
  ('nis_supplier', 'D.R. Mattison Farms', 'active', 'Supplier #26, Code: MACDRM'),
  ('nis_supplier', 'Empirenstata Trading (Pty) Ltd', 'active', 'Supplier #27, Code: MACEMP'),
  ('nis_supplier', 'Danroc (Pty) Ltd', 'active', 'Supplier #28, Code: MACDAN'),
  ('nis_supplier', 'Talana Macs', 'active', 'Supplier #29, Code: MACTAL02'),
  ('nis_supplier', 'Barbers Rest (Pty) Ltd', 'active', 'Supplier #30, Code: MACBAR'),
  ('nis_supplier', 'Nivage (Pty) Ltd', 'active', 'Supplier #31, Code: MACNIV'),
  ('nis_supplier', 'AP Vos & Seuns (Pty) Ltd', 'active', 'Supplier #32, Code: MACAPV'),
  ('nis_supplier', 'Dougrale (Pty) Ltd', 'active', 'Supplier #33, Code: MACDOU'),
  ('nis_supplier', 'Ulunhata Agri (Pty) Ltd', 'active', 'Supplier #34, Code: HACULL'),
  ('nis_supplier', 'Waldene Estate (Pty) Ltd', 'active', 'Supplier #35, Code: HACWAL'),
  ('nis_supplier', 'Tad Poles', 'active', 'Supplier #36, Code: MACTAD'),
  ('nis_supplier', 'Theo Bunge Family Trust', 'active', 'Supplier #37, Code: MACTHE'),
  ('nis_supplier', 'Shanwan Singh', 'active', 'Supplier #38, Code: MACSHA02'),
  ('nis_supplier', 'SDD Macs - Eastridge Farm', 'active', 'Supplier #39, Code: MACSDO'),
  ('nis_supplier', 'Bhubesi Agri (Pty) Ltd', 'active', 'Supplier #40, Code: MACBHU'),
  ('nis_supplier', 'Golden Grow', 'active', 'Supplier #41, Code: MACOOL'),
  ('nis_supplier', 'NDX', 'active', 'Supplier #42, Code: MACNDX01'),
  ('nis_supplier', 'Honey Coastline Investments 134 CC', 'active', 'Supplier #43, Code: MACHON'),
  ('nis_supplier', 'Agristar Macadamias (Pty) Ltd NutsAll', 'active', 'Supplier #44, Code: MACAGR02'),
  ('nis_supplier', 'Nombhabe Sugar (Pty) Ltd', 'active', 'Supplier #45, Code: MACNOM'),
  ('nis_supplier', 'RSM Farm and Factory (Pty) Ltd', 'active', 'Supplier #46, Code: MACRSM'),
  ('nis_supplier', 'R&K Estates - Fairview', 'active', 'Supplier #47, Code: MACRKE'),
  ('nis_supplier', 'Neeze Farm (Pty) Ltd', 'active', 'Supplier #48, Code: MACNSE'),
  ('nis_supplier', 'Zenith Estates CC', 'active', 'Supplier #49, Code: MACZEN'),
  ('nis_supplier', 'Highrain Macs (Pty) Ltd', 'active', 'Supplier #50, Code: MACHIG'),
  ('nis_supplier', 'Rope Miller', 'active', 'Supplier #51, Code: MACROP'),
  ('nis_supplier', 'The Hayden Percival Family Trust', 'active', 'Supplier #52, Code: MACTHP'),
  ('nis_supplier', 'Van Eeden Projects Trust', 'active', 'Supplier #53'),
  ('nis_supplier', 'Foster Farming Pty Ltd', 'active', 'Supplier #54, Code: MACFOS'),
  ('nis_supplier', 'Big Five Mac', 'active', 'Supplier #55, Code: MACHES'),
  ('nis_supplier', 'Mac-Eden Estate', 'active', 'Supplier #56, Code: MACMAC01'),
  ('nis_supplier', 'The Two Rivers Trust', 'active', 'Supplier #57, Code: MACTWO'),
  ('nis_supplier', 'Philip', 'active', 'Supplier #58'),
  ('nis_supplier', 'Talbot', 'active', 'Supplier #59, Code: MACTAL03'),
  ('nis_supplier', 'Brechoust CC', 'active', 'Supplier #60')
) AS v(contact_type, company_name, status, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.contacts c
  WHERE c.contact_type = v.contact_type AND c.company_name = v.company_name
);
