-- Extend contacts.contact_type for CRM: Oil Ingredient Suppliers, Oil & Protein Customers
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_contact_type_check
  CHECK (contact_type IN (
    'customer',
    'supplier',
    'both',
    'nis_supplier',
    'oil_processor',
    'kernel_customer',
    'oil_ingredient_supplier',
    'oil_protein_customer'
  ));

NOTIFY pgrst, 'reload schema';
