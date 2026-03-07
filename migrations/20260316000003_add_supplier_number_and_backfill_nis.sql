-- Add supplier_number to contacts (for NIS supplier numbering 1-60 like Excel)
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS supplier_number integer;

-- Backfill NIS suppliers from notes "Supplier #N"
UPDATE public.contacts
SET supplier_number = (regexp_match(notes, 'Supplier #([0-9]+)'))[1]::integer
WHERE contact_type = 'nis_supplier'
  AND notes IS NOT NULL
  AND notes ~ 'Supplier #[0-9]+'
  AND supplier_number IS NULL;

COMMENT ON COLUMN public.contacts.supplier_number IS 'NIS supplier number (1-60) from Macadamia Kernel Statistics; used for display order and labelling.';
