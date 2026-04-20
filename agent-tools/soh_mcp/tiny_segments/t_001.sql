INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 24.09.08', NULL, NULL, 'Extra Virgin', 0.24, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', 'customer', 'Vantage', NULL,
  'BFGO25', 'BFGO 24.09.15', NULL, NULL, 'Extra Virgin', 0.31, 'Received', NULL, 400,
  368, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.04.01', NULL, NULL, 'Extra Virgin', 0.32, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
