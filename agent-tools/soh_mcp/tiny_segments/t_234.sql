INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.40', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 24.10.15 b', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
