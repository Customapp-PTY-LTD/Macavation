INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.11.01', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-11-04', '2026-11-04', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.11.02', NULL, NULL, 'Crude Cosmetic', 1.05, 'Received', NULL, 1000,
  920, NULL, '2024-11-04', '2026-11-04', 'SOH YE25 xlsx seed v1', true, now(), now()
);
