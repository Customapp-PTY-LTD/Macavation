-- Seed oil_stock_lots from Macadamia Oil SOH and Production Figures YE'25 (12) (1).xlsx
-- Sheets: RM SOH - 801 (supplier-level raws), FG SOH - 850 (finished on hand), PROTEIN POWDER SOH, Sold (historical dispatch).
-- Skipped: YE'25/YE'26 Production, Forecast, pivot-only blocks (no batch-level rows).
-- Idempotent: delete prior rows tagged in notes, then insert.

DELETE FROM public.oil_stock_lots
WHERE notes = 'SOH YE25 xlsx seed v1';

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
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.04.02', NULL, NULL, 'Extra Virgin', 0.24, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.04.03', NULL, NULL, 'Extra Virgin', 0.29, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.01', NULL, NULL, 'Extra Virgin', 0.27, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.02', NULL, NULL, 'Extra Virgin', 0.24, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.03', NULL, NULL, 'Extra Virgin', 0.25, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.04', NULL, NULL, 'Extra Virgin', 0.32, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.05', NULL, NULL, 'Extra Virgin', 0.24, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.06', NULL, NULL, 'Extra Virgin', 0.34, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.07', NULL, NULL, 'Extra Virgin', 0.31, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.08', NULL, NULL, 'Extra Virgin', 0.29, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.11', NULL, NULL, 'Extra Virgin', 0.37, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.12', NULL, NULL, 'Extra Virgin', 0.28, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.13', NULL, NULL, 'Extra Virgin', 0.23, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.05.14', NULL, NULL, 'Extra Virgin', 0.24, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.06.01', NULL, NULL, 'Extra Virgin', 0.39, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.06.02', NULL, NULL, 'Extra Virgin', 0.39, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.06.03', NULL, NULL, 'Extra Virgin', 0.32, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Decanting sample', 'BFGO 25.06.04', NULL, NULL, 'Extra Virgin', 0.34, 'Not Sent', NULL, 520,
  478.4, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.06.05', NULL, NULL, 'Extra Virgin', 0.35, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25', 'BFGO 25.06.06', NULL, NULL, 'Extra Virgin', 0.31, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.06.07', NULL, NULL, 'Extra Virgin', 0.37, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.06.08', NULL, NULL, 'Extra Virgin', 0.42, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.06.09', NULL, NULL, 'Extra Virgin', 0.41, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.06.10', NULL, NULL, 'Extra Virgin', 0.36, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.06.11', NULL, NULL, 'Extra Virgin', 0.32, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.06.12', NULL, NULL, 'Extra Virgin', 0.38, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.06.13', NULL, NULL, 'Extra Virgin', 0.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.07.01', NULL, NULL, 'Extra Virgin', 0.58, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.07.02', NULL, NULL, 'Extra Virgin', 0.62, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.07.03', NULL, NULL, 'Extra Virgin', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.07.04', NULL, NULL, 'Extra Virgin', 0.31, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.07.05', NULL, NULL, 'Extra Virgin', 0.62, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.07.06', NULL, NULL, 'Extra Virgin', 0.57, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO 25.07.07', NULL, NULL, 'Extra Virgin', 0.48, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.07.08', NULL, NULL, 'Extra Virgin', 0.51, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.08.01', NULL, NULL, 'Extra Virgin', 0.59, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.08.02', NULL, NULL, 'Extra Virgin', 0.49, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.08.03', NULL, NULL, 'Extra Virgin', 0.59, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.09.03', NULL, NULL, 'Extra Virgin', 0.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.09.04', NULL, NULL, 'Extra Virgin', 0.66, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO 25.10.02', NULL, NULL, 'Extra Virgin', 0.69, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.10.03', NULL, NULL, 'Extra Virgin', 0.78, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.10.04', NULL, NULL, 'Extra Virgin', 0.79, 'Not Sent', NULL, 730,
  671.6, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.08.25', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.08.26', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.08.31', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.08.33', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.09.05', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.09.14', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.09.16', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.09.25', NULL, NULL, 'Crude Cosmetic', 3.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.09.29', NULL, NULL, 'Crude Cosmetic', 3.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.09.30', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.09.42', NULL, NULL, 'Crude Cosmetic', 2.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.09.46', NULL, NULL, 'Crude Cosmetic', 2.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.10.21', NULL, NULL, 'Crude Cosmetic', 2.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.10.29', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.10.31', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.10.37', NULL, NULL, 'Crude Cosmetic', 2.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.10.45', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.10.52', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.10.55', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, NULL, '2025-11-03', '2026-11-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO 25.10.05', NULL, NULL, 'Extra Virgin', 0.75, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.11.04', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.11.06', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 E', 'BO 25.11.19', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.05.30', NULL, NULL, 'Crude Cosmetic', 1.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.05.31', NULL, NULL, 'Crude Cosmetic', 0.99, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.05.32', NULL, NULL, 'Crude Cosmetic', 1.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.05.39', NULL, NULL, 'Crude Cosmetic', 1.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.05.49', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.06.08', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.07.28', NULL, NULL, 'Crude Cosmetic', 1.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.08.09', NULL, NULL, 'Crude Cosmetic', 1.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.08.11', NULL, NULL, 'Crude Cosmetic', 1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.08.16', NULL, NULL, 'Crude Cosmetic', 1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.08.18', NULL, NULL, 'Crude Cosmetic', 1.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.08.19', NULL, NULL, 'Crude Cosmetic', 1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.09.13', NULL, NULL, 'Crude Cosmetic', 1.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.10.22', NULL, NULL, 'Crude Cosmetic', 1.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.11.16', NULL, NULL, 'Crude Cosmetic', 1.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.11.29', NULL, NULL, 'Crude Cosmetic', 3.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.11.39', NULL, NULL, 'Crude Cosmetic', 3.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 25.12.35', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 26.01.03', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 26.01.16', NULL, NULL, 'Crude Cosmetic', 4.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 F', 'BO 26.01.26', NULL, NULL, 'Crude Cosmetic', 4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.05.33', NULL, NULL, 'Crude Cosmetic', 1.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.05.34', NULL, NULL, 'Crude Cosmetic', 0.82, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.05.44', NULL, NULL, 'Crude Cosmetic', 1.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.05.50', NULL, NULL, 'Crude Cosmetic', 1.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.05.52', NULL, NULL, 'Crude Cosmetic', 1.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.06.14', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.06.15', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.07.07', NULL, NULL, 'Crude Cosmetic', 1.4, 'Not Sent', NULL, 1000,
  920, NULL, '2025-07-07', '2026-07-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.07.22', NULL, NULL, 'Crude Cosmetic', 1.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.08.05', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.08.12', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.09.12', NULL, NULL, 'Crude Cosmetic', 1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.10.18', NULL, NULL, 'Crude Cosmetic', 1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.11.34', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.11.38', NULL, NULL, 'Crude Cosmetic', 2.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.12.02', NULL, NULL, 'Crude Cosmetic', 3.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.12.07', NULL, NULL, 'Crude Cosmetic', 4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.12.13', NULL, NULL, 'Crude Cosmetic', 3.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO 25.11.01', NULL, NULL, 'Extra Virgin', 0.86, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.12.17', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.12.21', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.12.23', NULL, NULL, 'Crude Cosmetic', 3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 G', 'BO 25.12.24', NULL, NULL, 'Crude Cosmetic', 4.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO 26.01.01', NULL, NULL, 'Extra Virgin', 0.71, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO 26.01.02', NULL, NULL, 'Extra Virgin', 0.64, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO 26.02.01', NULL, NULL, 'Extra Virgin', 0.64, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO 26.02.02', NULL, NULL, 'Extra Virgin', 0.64, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.05.37', NULL, NULL, 'Crude Cosmetic', 1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.05.40', NULL, NULL, 'Crude Cosmetic', 1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.06.23', NULL, NULL, 'Crude Cosmetic', 1.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.07.06', NULL, NULL, 'Crude Cosmetic', 1.3, 'Not Sent', NULL, 1000,
  920, NULL, '2025-07-06', '2026-07-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.07.19', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.08.22', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.10.27', NULL, NULL, 'Crude Cosmetic', 1.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.10.32', NULL, NULL, 'Crude Cosmetic', 1.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.10.34', NULL, NULL, 'Crude Cosmetic', 1.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.11.20', NULL, NULL, 'Crude Cosmetic', 1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.11.23', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.11.31', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.11.35', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.11.37', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.12.01', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.12.18', NULL, NULL, 'Crude Cosmetic', 3.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.12.26', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.12.28', NULL, NULL, 'Crude Cosmetic', 4.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.12.32', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.12.36', NULL, NULL, 'Crude Cosmetic', 2.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 26.01.01', NULL, NULL, 'Crude Cosmetic', 3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  '25 I', 'BO 25.11.12', NULL, NULL, 'Crude Cosmetic', 1.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 25.06.09', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 25.12.06', NULL, NULL, 'Crude Cosmetic', 5.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 25.12.08', NULL, NULL, 'Crude Cosmetic', 4.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 25.12.15', NULL, NULL, 'Crude Cosmetic', 4.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 25.12.27', NULL, NULL, 'Crude Cosmetic', 5.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 25.12.29', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 25.12.33', NULL, NULL, 'Crude Cosmetic', 4.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.04', NULL, NULL, 'Crude Cosmetic', 5.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.11', NULL, NULL, 'Crude Cosmetic', 6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.13', NULL, NULL, 'Crude Cosmetic', 5.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.14', NULL, NULL, 'Crude Cosmetic', 5.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.18', NULL, NULL, 'Crude Cosmetic', 5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.19', NULL, NULL, 'Crude Cosmetic', 7.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.20', NULL, NULL, 'Crude Cosmetic', 4.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.21', NULL, NULL, 'Crude Cosmetic', 4.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.23', NULL, NULL, 'Crude Cosmetic', 4.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.25', NULL, NULL, 'Crude Cosmetic', 7.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.27', NULL, NULL, 'Crude Cosmetic', 4.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.30', NULL, NULL, 'Crude Cosmetic', 5.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.31', NULL, NULL, 'Crude Cosmetic', 3.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.32', NULL, NULL, 'Crude Cosmetic', 7.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.33', NULL, NULL, 'Crude Cosmetic', 8.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.34', NULL, NULL, 'Crude Cosmetic', 6.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.35', NULL, NULL, 'Crude Cosmetic', 4.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.36', NULL, NULL, 'Crude Cosmetic', 9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.37', NULL, NULL, 'Crude Cosmetic', 3.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.38', NULL, NULL, 'Crude Cosmetic', 8.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.39', NULL, NULL, 'Crude Cosmetic', 6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.40', NULL, NULL, 'Crude Cosmetic', 5.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.41', NULL, NULL, 'Crude Cosmetic', 4.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.42', NULL, NULL, 'Crude Cosmetic', 7.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.01', NULL, NULL, 'Crude Cosmetic', 5.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.02', NULL, NULL, 'Crude Cosmetic', 5.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.03', NULL, NULL, 'Crude Cosmetic', 6.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.04', NULL, NULL, 'Crude Cosmetic', 4.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.05', NULL, NULL, 'Crude Cosmetic', 3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.06', NULL, NULL, 'Crude Cosmetic', 5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.07', NULL, NULL, 'Crude Cosmetic', 4.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.08', NULL, NULL, 'Crude Cosmetic', 4.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.09', NULL, NULL, 'Crude Cosmetic', 3.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.10', NULL, NULL, 'Crude Cosmetic', 4.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.11', NULL, NULL, 'Crude Cosmetic', 5.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.12', NULL, NULL, 'Crude Cosmetic', 5.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.13', NULL, NULL, 'Crude Cosmetic', 4.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.14', NULL, NULL, 'Crude Cosmetic', 3.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.15', NULL, NULL, 'Crude Cosmetic', 3.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.16', NULL, NULL, 'Crude Cosmetic', 4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.17', NULL, NULL, 'Crude Cosmetic', 4.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.18', NULL, NULL, 'Crude Cosmetic', 4.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.19', NULL, NULL, 'Crude Cosmetic', 3.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.20', NULL, NULL, 'Crude Cosmetic', 3.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.21', NULL, NULL, 'Crude Cosmetic', 5.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.22', NULL, NULL, 'Crude Cosmetic', 6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.23', NULL, NULL, 'Crude Cosmetic', 10.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.24', NULL, NULL, 'Crude Cosmetic', 7.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.25', NULL, NULL, 'Crude Cosmetic', 7.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.26', NULL, NULL, 'Crude Cosmetic', 10.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.27', NULL, NULL, 'Crude Cosmetic', 7.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO25.08.04', NULL, NULL, 'Extra Virgin', 0.56, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO25.08.05', NULL, NULL, 'Extra Virgin', 0.57, 'Not Sent', NULL, 1000,
  920, NULL, '2025-02-25', '2026-02-25', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.28', NULL, NULL, 'Crude Cosmetic', 7.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.29', NULL, NULL, 'Crude Cosmetic', 8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.30', NULL, NULL, 'Crude Cosmetic', 8.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.31', NULL, NULL, 'Crude Cosmetic', 6.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.32', NULL, NULL, 'Crude Cosmetic', 6.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.33', NULL, NULL, 'Crude Cosmetic', 6.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.34', NULL, NULL, 'Crude Cosmetic', 4.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.35', NULL, NULL, 'Crude Cosmetic', 4.5, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.36', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.02.37', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.02', NULL, NULL, 'Crude Cosmetic', 3.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.03', NULL, NULL, 'Crude Cosmetic', 4.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.04', NULL, NULL, 'Crude Cosmetic', 4.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.05', NULL, NULL, 'Crude Cosmetic', 4.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.06', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.07', NULL, NULL, 'Crude Cosmetic', 4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.08', NULL, NULL, 'Crude Cosmetic', 3.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.09', NULL, NULL, 'Crude Cosmetic', 3.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.11', NULL, NULL, 'Crude Cosmetic', 3.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.14', NULL, NULL, 'Crude Cosmetic', 3.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO25.08.06', NULL, NULL, 'Extra Virgin', 0.96, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'BFGO25A', 'BFGO25.08.07', NULL, NULL, 'Extra Virgin', 0.95, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.15', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.16', NULL, NULL, 'Crude Cosmetic', 3.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.17', NULL, NULL, 'Crude Cosmetic', 4.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.18', NULL, NULL, 'Crude Cosmetic', 4.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.19', NULL, NULL, 'Crude Cosmetic', 4.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.20', NULL, NULL, 'Crude Cosmetic', 3.4, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.21', NULL, NULL, 'Crude Cosmetic', 3.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.22', NULL, NULL, 'Crude Cosmetic', 3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.23', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.24', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.25', NULL, NULL, 'Crude Cosmetic', 1.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.26', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.27', NULL, NULL, 'Crude Cosmetic', 1.3, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.28', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.29', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.30', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.31', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.32', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.33', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.34', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.35', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.36', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.37', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.38', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.39', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.40', NULL, NULL, 'Crude Cosmetic', 2.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.41', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO25.09.01', NULL, NULL, 'Extra Virgin', 0.75, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BFGO25.09.02', NULL, NULL, 'Extra Virgin', 0.62, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.42', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.43', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.44', NULL, NULL, 'Crude Cosmetic', NULL, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.01.22', NULL, NULL, 'Crude Cosmetic', 3.2, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.45', NULL, NULL, 'Crude Cosmetic', NULL, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  'Unassigned', 'BO 26.03.46', NULL, NULL, 'Crude Cosmetic', NULL, 'Not Sent', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.04.33', NULL, NULL, 'Crude Cosmetic', 0.76, 'Received', NULL, 1000,
  920, NULL, '2024-04-29', '2026-04-29', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.05.01', NULL, NULL, 'Crude Cosmetic', 0.7, 'Received', NULL, 1000,
  920, NULL, '2024-05-02', '2026-05-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.05.09', NULL, NULL, 'Crude Cosmetic', 0.8, 'Received', NULL, 1000,
  920, NULL, '2024-05-06', '2026-05-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.05.11', NULL, NULL, 'Crude Cosmetic', 0.7, 'Received', NULL, 1000,
  920, NULL, '2024-05-07', '2026-05-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.05.13', NULL, NULL, 'Crude Cosmetic', 0.9, 'Received', NULL, 1000,
  920, NULL, '2024-05-09', '2026-05-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.05.14', NULL, NULL, 'Crude Cosmetic', 0.83, 'Received', NULL, 1000,
  920, NULL, '2024-05-09', '2026-05-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.05.15', NULL, NULL, 'Crude Cosmetic', 0.79, 'Received', NULL, 1000,
  920, NULL, '2024-05-10', '2026-05-10', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.05.16', NULL, NULL, 'Crude Cosmetic', 0.83, 'Received', NULL, 1000,
  920, NULL, '2024-05-10', '2026-05-10', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.05.17', NULL, NULL, 'Crude Cosmetic', 0.85, 'Received', NULL, 1000,
  920, NULL, '2024-05-10', '2026-05-10', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.01', NULL, NULL, 'Crude Cosmetic', 0.78, 'Received', NULL, 1000,
  920, NULL, '2024-07-01', '2026-07-01', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.04', NULL, NULL, 'Crude Cosmetic', 0.75, 'Received', NULL, 1000,
  920, NULL, '2024-07-03', '2026-07-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.05', NULL, NULL, 'Crude Cosmetic', 0.8, 'Received', NULL, 1000,
  920, NULL, '2024-07-03', '2026-07-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.06', NULL, NULL, 'Crude Cosmetic', 0.87, 'Received', NULL, 1000,
  920, NULL, '2024-07-08', '2026-07-08', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.08', NULL, NULL, 'Crude Cosmetic', 0.86, 'Received', NULL, 1000,
  920, NULL, '2024-07-09', '2026-07-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.13', NULL, NULL, 'Crude Cosmetic', 0.89, 'Received', NULL, 1000,
  920, NULL, '2024-07-11', '2026-07-11', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.29', NULL, NULL, 'Crude Cosmetic', 0.78, 'Received', NULL, 1000,
  920, NULL, '2024-07-24', '2026-07-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.30', NULL, NULL, 'Crude Cosmetic', 0.8, 'Received', NULL, 1000,
  920, NULL, '2024-07-24', '2026-07-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.32', NULL, NULL, 'Crude Cosmetic', 0.89, 'Received', NULL, 1000,
  920, NULL, '2024-07-29', '2026-07-29', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.07.33', NULL, NULL, 'Crude Cosmetic', 0.76, 'Received', NULL, 1000,
  920, NULL, '2024-07-30', '2026-07-30', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.08.05', NULL, NULL, 'Crude Cosmetic', 0.75, 'Received', NULL, 1000,
  920, NULL, '2024-08-08', '2026-08-08', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.08.06', NULL, NULL, 'Crude Cosmetic', 0.8, 'Received', NULL, 1000,
  920, NULL, '2024-05-08', '2026-05-08', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24E', 'BO 24.08.11', NULL, NULL, 'Crude Cosmetic', 0.91, 'Received', NULL, 1000,
  920, NULL, '2024-08-11', '2026-08-11', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.04.12', NULL, NULL, 'Crude Cosmetic', 2.9, 'Received', NULL, 1000,
  920, NULL, '2024-04-09', '2026-04-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.04.31', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-04-24', '2026-04-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.21', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, NULL, '2024-05-14', '2026-05-14', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.22', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-05-14', '2026-05-14', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.23', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, NULL, '2024-05-14', '2026-05-14', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.24', NULL, NULL, 'Crude Cosmetic', 2.7, 'Received', NULL, 1000,
  920, NULL, '2024-05-15', '2026-05-15', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.30', NULL, NULL, 'Crude Cosmetic', 3, 'Received', NULL, 1000,
  920, NULL, '2024-05-20', '2026-05-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.31', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, NULL, '2024-05-20', '2026-05-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.33', NULL, NULL, 'Crude Cosmetic', 3.2, 'Received', NULL, 1000,
  920, NULL, '2024-05-21', '2026-05-21', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.36', NULL, NULL, 'Crude Cosmetic', 2.7, 'Received', NULL, 1000,
  920, NULL, '2024-05-22', '2026-05-22', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.38', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-05-22', '2026-05-22', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.40', NULL, NULL, 'Crude Cosmetic', 2.7, 'Received', NULL, 1000,
  920, NULL, '2024-05-23', '2026-05-23', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.42', NULL, NULL, 'Crude Cosmetic', 2.8, 'Received', NULL, 1000,
  920, NULL, '2024-05-27', '2026-05-27', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.43', NULL, NULL, 'Crude Cosmetic', 2.8, 'Received', NULL, 1000,
  920, NULL, '2024-05-27', '2026-05-27', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.44', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, NULL, '2024-05-27', '2026-05-27', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.45', NULL, NULL, 'Crude Cosmetic', 2.8, 'Received', NULL, 1000,
  920, NULL, '2024-05-28', '2026-05-28', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.46', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, NULL, '2024-05-28', '2026-05-28', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.05.47', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-05-30', '2026-05-30', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.07.14', NULL, NULL, 'Crude Cosmetic', 2.9, 'Received', NULL, 1000,
  920, NULL, '2024-07-15', '2026-07-15', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.07.20', NULL, NULL, 'Crude Cosmetic', 2.6, 'Received', NULL, 1000,
  920, NULL, '2024-07-17', '2026-07-17', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.08.09', NULL, NULL, 'Crude Cosmetic', 2.6, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24F', 'BO 24.08.10', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.06.02', NULL, NULL, 'Crude Cosmetic', 0.73, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.06.03', NULL, NULL, 'Crude Cosmetic', 0.91, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.06.04', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.06.05', NULL, NULL, 'Crude Cosmetic', 0.71, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.06.06', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.14', NULL, NULL, 'Crude Cosmetic', 3.9, 'Received', NULL, 1000,
  920, NULL, '2024-08-14', '2026-08-14', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.19', NULL, NULL, 'Crude Cosmetic', 0.78, 'Received', NULL, 1000,
  920, NULL, '2024-08-19', '2026-08-19', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.21', NULL, NULL, 'Crude Cosmetic', 0.74, 'Received', NULL, 1000,
  920, NULL, '2024-08-21', '2026-08-21', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.22', NULL, NULL, 'Crude Cosmetic', 0.81, 'Received', NULL, 1000,
  920, NULL, '2024-08-22', '2026-08-22', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.23', NULL, NULL, 'Crude Cosmetic', 0.87, 'Received', NULL, 1000,
  920, NULL, '2024-08-23', '2026-08-23', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.24', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-08-24', '2026-08-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.25', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, NULL, '2024-08-25', '2026-08-25', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.26', NULL, NULL, 'Crude Cosmetic', 3.2, 'Received', NULL, 1000,
  920, NULL, '2024-08-22', '2026-08-22', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.27', NULL, NULL, 'Crude Cosmetic', 1.05, 'Received', NULL, 1000,
  920, NULL, '2024-08-22', '2026-08-22', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.29', NULL, NULL, 'Crude Cosmetic', 0.88, 'Received', NULL, 1000,
  920, NULL, '2024-08-26', '2026-08-26', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.30', NULL, NULL, 'Crude Cosmetic', 3.3, 'Received', NULL, 1000,
  920, NULL, '2024-08-27', '2026-08-27', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.08.31', NULL, NULL, 'Crude Cosmetic', 3.2, 'Received', NULL, 1000,
  920, NULL, '2024-08-31', '2026-08-31', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.09.01', NULL, NULL, 'Crude Cosmetic', 0.96, 'Received', NULL, 1000,
  920, NULL, '2024-09-02', '2026-09-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.09.02', NULL, NULL, 'Crude Cosmetic', 0.77, 'Received', NULL, 1000,
  920, NULL, '2024-09-02', '2026-09-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.09.04', NULL, NULL, 'Crude Cosmetic', 0.87, 'Received', NULL, 1000,
  920, NULL, '2024-09-03', '2026-09-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.09.05', NULL, NULL, 'Crude Cosmetic', 4.2, 'Received', NULL, 1000,
  920, NULL, '2024-09-03', '2026-09-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24G', 'BO 24.09.06', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-09-03', '2026-09-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.05.02', NULL, NULL, 'Crude Cosmetic', 0.54, 'Received', NULL, 1000,
  920, NULL, '2024-05-02', '2026-05-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.05.04', NULL, NULL, 'Crude Cosmetic', 0.54, 'Received', NULL, 1000,
  920, NULL, '2024-05-02', '2026-05-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.05.05', NULL, NULL, 'Crude Cosmetic', 0.39, 'Received', NULL, 1000,
  920, NULL, '2024-05-03', '2026-05-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.05.06', NULL, NULL, 'Crude Cosmetic', 0.39, 'Received', NULL, 1000,
  920, NULL, '2024-05-03', '2026-05-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.05.07', NULL, NULL, 'Crude Cosmetic', 0.65, 'Received', NULL, 1000,
  920, NULL, '2024-05-03', '2026-05-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.05.10', NULL, NULL, 'Crude Cosmetic', 0.43, 'Received', NULL, 1000,
  920, NULL, '2024-05-06', '2026-05-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.06.07', NULL, NULL, 'Crude Cosmetic', 0.59, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.06.08', NULL, NULL, 'Crude Cosmetic', 0.44, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.06.09', NULL, NULL, 'Crude Cosmetic', 0.46, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.07.34', NULL, NULL, 'Crude Cosmetic', 0.62, 'Received', NULL, 1000,
  920, NULL, '2024-07-31', '2026-07-31', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.01', NULL, NULL, 'Crude Cosmetic', 0.55, 'Received', NULL, 1000,
  920, NULL, '2024-08-01', '2026-08-01', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.02', NULL, NULL, 'Crude Cosmetic', 0.59, 'Received', NULL, 1000,
  920, NULL, '2024-08-02', '2026-08-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.07', NULL, NULL, 'Crude Cosmetic', 0.53, 'Received', NULL, 1000,
  920, NULL, '2024-08-07', '2026-08-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.12', NULL, NULL, 'Crude Cosmetic', 0.63, 'Received', NULL, 1000,
  920, NULL, '2024-08-12', '2026-08-12', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.13', NULL, NULL, 'Crude Cosmetic', 0.58, 'Received', NULL, 1000,
  920, NULL, '2024-08-13', '2026-08-13', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.15', NULL, NULL, 'Crude Cosmetic', 0.57, 'Received', NULL, 1000,
  920, NULL, '2024-08-15', '2026-08-15', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.16', NULL, NULL, 'Crude Cosmetic', 0.55, 'Received', NULL, 1000,
  920, NULL, '2024-08-16', '2026-08-16', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.17', NULL, NULL, 'Crude Cosmetic', 0.53, 'Received', NULL, 1000,
  920, NULL, '2024-08-17', '2026-08-17', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.18', NULL, NULL, 'Crude Cosmetic', 0.53, 'Received', NULL, 1000,
  920, NULL, '2024-08-18', '2026-08-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.20', NULL, NULL, 'Crude Cosmetic', 0.57, 'Received', NULL, 1000,
  920, NULL, '2024-08-20', '2026-08-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.08.28', NULL, NULL, 'Crude Cosmetic', 0.53, 'Received', NULL, 1000,
  920, NULL, '2024-08-26', '2026-08-26', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', NULL, NULL, NULL,
  '24H', 'BO 24.09.03', NULL, NULL, 'Crude Cosmetic', 0.68, 'Received', NULL, 1000,
  920, NULL, '2024-09-02', '2026-09-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.07', NULL, NULL, 'Crude Cosmetic', 0.96, 'Received', NULL, 1000,
  920, NULL, '2024-09-05', '2026-09-05', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.08', NULL, NULL, 'Crude Cosmetic', 0.74, 'Received', NULL, 1000,
  920, NULL, '2024-09-05', '2026-09-05', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.09', NULL, NULL, 'Crude Cosmetic', 1.04, 'Received', NULL, 1000,
  920, NULL, '2024-09-05', '2026-09-05', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.10', NULL, NULL, 'Crude Cosmetic', 3.5, 'Received', NULL, 1000,
  920, NULL, '2024-09-06', '2026-09-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.11', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, NULL, '2024-09-06', '2026-09-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.12', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, NULL, '2024-09-06', '2026-09-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.13', NULL, NULL, 'Crude Cosmetic', 4.1, 'Received', NULL, 1000,
  920, NULL, '2024-09-09', '2026-09-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.14', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, NULL, '2024-09-09', '2026-09-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.15', NULL, NULL, 'Crude Cosmetic', 0.93, 'Received', NULL, 1000,
  920, NULL, '2024-09-09', '2026-09-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.16', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-09-10', '2026-09-10', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.17', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, NULL, '2024-09-10', '2026-09-10', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.18', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, NULL, '2024-09-11', '2026-09-11', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.19', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, NULL, '2024-09-11', '2026-09-11', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.20', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, NULL, '2024-09-12', '2026-09-12', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.21', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, NULL, '2024-09-12', '2026-09-12', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.22', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, NULL, '2024-09-12', '2026-09-12', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.23', NULL, NULL, 'Crude Cosmetic', 3, 'Received', NULL, 1000,
  920, NULL, '2024-09-13', '2026-09-13', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.24', NULL, NULL, 'Crude Cosmetic', 2.7, 'Received', NULL, 1000,
  920, NULL, '2024-09-13', '2026-09-13', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.25', NULL, NULL, 'Crude Cosmetic', 3.6, 'Received', NULL, 1000,
  920, NULL, '2024-09-16', '2026-09-16', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.26', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, NULL, '2024-09-16', '2026-09-16', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.27', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, NULL, '2024-09-16', '2026-09-16', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24I', 'BO 24.09.28', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-09-17', '2026-09-17', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.29', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, '2024-09-18', '2026-09-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.30', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, NULL, '2024-09-18', '2026-09-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.31', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, NULL, '2024-09-18', '2026-09-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.32', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, NULL, '2024-09-18', '2026-09-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.33', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, NULL, '2024-09-19', '2026-09-19', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.34', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, '2024-09-19', '2026-09-19', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.35', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, '2024-09-19', '2026-09-19', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.36', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, NULL, '2024-09-20', '2026-09-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.37', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, NULL, '2024-09-20', '2026-09-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.38', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, '2024-09-24', '2026-09-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.39', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, NULL, '2024-09-24', '2026-09-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.40', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, NULL, '2024-09-24', '2026-09-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.41', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, NULL, '2024-09-25', '2026-09-25', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.42', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, NULL, '2024-09-25', '2026-09-25', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.43', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, NULL, '2024-09-25', '2026-09-25', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.44', NULL, NULL, 'Crude Cosmetic', 1.2, 'Received', NULL, 1000,
  920, NULL, '2024-09-25', '2026-09-25', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.45', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-09-26', '2026-09-26', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.46', NULL, NULL, 'Crude Cosmetic', 0.95, 'Received', NULL, 1000,
  920, NULL, '2024-09-27', '2026-09-27', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.47', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, NULL, '2024-09-27', '2026-09-27', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.48', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, NULL, '2024-09-27', '2026-09-27', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.49', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-09-30', '2026-09-30', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24J', 'BO 24.09.50', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, NULL, '2024-09-30', '2026-09-30', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.09.51', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, '2024-09-30', '2026-09-30', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.01', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-01', '2026-10-01', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.02', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2024-10-01', '2026-10-01', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.03', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, NULL, '2024-10-01', '2026-10-01', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.04', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, NULL, '2024-10-01', '2026-10-01', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.05', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, NULL, '2024-10-02', '2026-10-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.06', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, '2024-10-02', '2026-10-02', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.07', NULL, NULL, 'Crude Cosmetic', 1.2, 'Received', NULL, 1000,
  920, NULL, '2024-10-03', '2026-10-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.08', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, NULL, '2024-10-03', '2026-10-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.09', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-03', '2026-10-03', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.10', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, NULL, '2024-10-07', '2026-10-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.11', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, NULL, '2024-10-07', '2026-10-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.12', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, NULL, '2024-10-08', '2026-10-08', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.13', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, NULL, '2024-10-08', '2026-10-08', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.14', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, NULL, '2024-10-09', '2026-10-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.15', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, NULL, '2024-10-09', '2026-10-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.16', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, NULL, '2024-10-10', '2026-10-10', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.22', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, NULL, '2024-10-14', '2026-10-14', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.23', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, NULL, '2024-10-15', '2026-10-15', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.24', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, '2024-10-16', '2026-10-16', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.25', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-17', '2026-10-17', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24K', 'BO 24.10.26', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, '2024-10-18', '2026-10-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.17', NULL, NULL, 'Crude Cosmetic', 3, 'Received', NULL, 1000,
  920, NULL, '2024-10-10', '2026-10-10', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.18', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, NULL, '2024-10-10', '2026-10-10', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.19', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, NULL, '2024-10-11', '2026-10-11', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.20', NULL, NULL, 'Crude Cosmetic', 4.1, 'Received', NULL, 1000,
  920, NULL, '2024-10-12', '2026-10-12', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.21', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, NULL, '2024-10-13', '2026-10-13', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.27', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, '2024-10-16', '2026-10-16', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.28', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, NULL, '2024-10-16', '2026-10-16', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.29', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2024-10-16', '2026-10-16', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.30', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, NULL, '2024-10-17', '2026-10-17', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.31', NULL, NULL, 'Crude Cosmetic', 0.77, 'Received', NULL, 1000,
  920, NULL, '2024-10-17', '2026-10-17', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.32', NULL, NULL, 'Crude Cosmetic', 0.86, 'Received', NULL, 1000,
  920, NULL, '2024-10-17', '2026-10-17', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.33', NULL, NULL, 'Crude Cosmetic', 0.84, 'Received', NULL, 1000,
  920, NULL, '2024-10-17', '2026-10-17', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.34', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, '2024-10-21', '2026-10-21', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.35', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-21', '2026-10-21', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.36', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-22', '2026-10-22', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.37', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-22', '2026-10-22', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.38', NULL, NULL, 'Crude Cosmetic', 0.9, 'Received', NULL, 1000,
  920, NULL, '2024-10-22', '2026-10-22', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.39', NULL, NULL, 'Crude Cosmetic', 0.92, 'Received', NULL, 1000,
  920, NULL, '2024-10-23', '2026-10-23', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.40', NULL, NULL, 'Crude Cosmetic', 0.92, 'Received', NULL, 1000,
  920, NULL, '2024-10-23', '2026-10-23', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.41', NULL, NULL, 'Crude Cosmetic', 1.07, 'Received', NULL, 1000,
  920, NULL, '2024-10-23', '2026-10-23', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.42', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-23', '2026-10-23', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24L', 'BO 24.10.43', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-23', '2026-10-23', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.44', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, NULL, '2024-10-23', '2026-10-23', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.45', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2024-10-24', '2026-10-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.46', NULL, NULL, 'Crude Cosmetic', 0.82, 'Received', NULL, 1000,
  920, NULL, '2024-10-24', '2026-10-24', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.47', NULL, NULL, 'Crude Cosmetic', 0.75, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.48', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.49', NULL, NULL, 'Crude Cosmetic', 0.68, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.50', NULL, NULL, 'Crude Cosmetic', 0.69, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.51', NULL, NULL, 'Crude Cosmetic', 0.76, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.52', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.53', NULL, NULL, 'Crude Cosmetic', 0.9, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.54', NULL, NULL, 'Crude Cosmetic', 0.78, 'Received', NULL, 1000,
  920, NULL, '2024-10-30', '2026-10-30', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.55', NULL, NULL, 'Crude Cosmetic', 0.67, 'Received', NULL, 1000,
  920, NULL, '2024-10-30', '2026-10-30', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.56', NULL, NULL, 'Crude Cosmetic', 0.65, 'Received', NULL, 1000,
  920, NULL, '2024-10-31', '2026-10-31', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.57', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-10-31', '2026-10-31', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.10.58', NULL, NULL, 'Crude Cosmetic', 0.95, 'Received', NULL, 1000,
  920, NULL, '2024-10-31', '2026-10-31', 'SOH YE25 xlsx seed v1', true, now(), now()
);
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
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.11.03', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-11-04', '2026-11-04', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.11.04', NULL, NULL, 'Crude Cosmetic', 1.04, 'Received', NULL, 1000,
  920, NULL, '2024-11-05', '2026-11-05', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.11.05', NULL, NULL, 'Crude Cosmetic', 0.69, 'Received', NULL, 1000,
  920, NULL, '2024-11-05', '2026-11-05', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.11.06', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-11-05', '2026-11-05', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24M', 'BO 24.11.07', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2024-11-06', '2026-11-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.08', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-11-06', '2026-11-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.09', NULL, NULL, 'Crude Cosmetic', 0.94, 'Received', NULL, 1000,
  920, NULL, '2024-11-06', '2026-11-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.10', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, '2024-11-07', '2026-11-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.11', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, NULL, '2024-11-07', '2026-11-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.12', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2024-11-07', '2026-11-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.13', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, NULL, '2024-11-07', '2026-11-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.14', NULL, NULL, 'Crude Cosmetic', 0.94, 'Received', NULL, 1000,
  920, NULL, '2024-11-07', '2026-11-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.15', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, '2024-11-11', '2026-11-11', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.16', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, NULL, '2024-11-11', '2026-11-11', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.17', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2024-11-11', '2026-11-11', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.18', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, NULL, '2024-11-12', '2026-11-12', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.19', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.20', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.21', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.22', NULL, NULL, 'Crude Cosmetic', 1.2, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.23', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.24', NULL, NULL, 'Crude Cosmetic', 1.2, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.25', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.26', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.27', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.28', NULL, NULL, 'Crude Cosmetic', 0.72, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24N', 'BO 24.11.29', NULL, NULL, 'Crude Cosmetic', 0.99, 'Received', NULL, 1000,
  920, NULL, '2024-11-18', '2026-11-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.30', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2024-11-18', '2026-11-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.31', NULL, NULL, 'Crude Cosmetic', 0.74, 'Received', NULL, 1000,
  920, NULL, '2024-11-18', '2026-11-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.32', NULL, NULL, 'Crude Cosmetic', 0.8, 'Received', NULL, 1000,
  920, NULL, '2024-11-18', '2026-11-18', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.33', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, '2024-11-19', '2026-11-19', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.34', NULL, NULL, 'Crude Cosmetic', 0.77, 'Received', NULL, 1000,
  920, NULL, '2024-11-19', '2026-11-19', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.35', NULL, NULL, 'Crude Cosmetic', 0.73, 'Received', NULL, 1000,
  920, NULL, '2024-11-19', '2026-11-19', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.36', NULL, NULL, 'Crude Cosmetic', 0.8, 'Received', NULL, 1000,
  920, NULL, '2024-11-19', '2026-11-19', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.37', NULL, NULL, 'Crude Cosmetic', 0.87, 'Received', NULL, 1000,
  920, NULL, '2024-11-20', '2026-11-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.38', NULL, NULL, 'Crude Cosmetic', 0.97, 'Received', NULL, 1000,
  920, NULL, '2024-11-20', '2026-11-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.39', NULL, NULL, 'Crude Cosmetic', 0.81, 'Received', NULL, 1000,
  920, NULL, '2024-11-20', '2026-11-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.40', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2024-11-20', '2026-11-20', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.41', NULL, NULL, 'Crude Cosmetic', 0.99, 'Received', NULL, 1000,
  920, NULL, '2024-11-21', '2026-11-21', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.42', NULL, NULL, 'Crude Cosmetic', 1.09, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.43', NULL, NULL, 'Crude Cosmetic', 0.92, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.44', NULL, NULL, 'Crude Cosmetic', 0.87, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.45', NULL, NULL, 'Crude Cosmetic', 0.76, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.46', NULL, NULL, 'Crude Cosmetic', 0.92, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.47', NULL, NULL, 'Crude Cosmetic', 0.75, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.48', NULL, NULL, 'Crude Cosmetic', 0.8, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.49', NULL, NULL, 'Crude Cosmetic', 0.69, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.50', NULL, NULL, 'Crude Cosmetic', 0.58, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24O', 'BO 24.11.51', NULL, NULL, 'Crude Cosmetic', 0.65, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.08.01', NULL, NULL, 'Extra Virgin', 0.45, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.08.02', NULL, NULL, 'Extra Virgin', 0.18, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.08.04', NULL, NULL, 'Extra Virgin', 0.1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.08.05', NULL, NULL, 'Extra Virgin', 0.16, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.01', NULL, NULL, 'Extra Virgin', 0.21, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.02', NULL, NULL, 'Extra Virgin', 0.21, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.03', NULL, NULL, 'Extra Virgin', 0.21, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.04', NULL, NULL, 'Extra Virgin', 0.24, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.05', NULL, NULL, 'Extra Virgin', 0.21, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.06', NULL, NULL, 'Extra Virgin', 0.33, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.07', NULL, NULL, 'Extra Virgin', 0.27, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.09', NULL, NULL, 'Extra Virgin', 0.31, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.10', NULL, NULL, 'Extra Virgin', 0.15, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.11', NULL, NULL, 'Extra Virgin', 0.21, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.12', NULL, NULL, 'Extra Virgin', 0.24, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.09.13', NULL, NULL, 'Extra Virgin', 0.32, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.10.01', NULL, NULL, 'Extra Virgin', 0.12, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.10.02', NULL, NULL, 'Extra Virgin', 0.48, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.10.03', NULL, NULL, 'Extra Virgin', 0.33, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.10.04', NULL, NULL, 'Extra Virgin', 0.59, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amana Oils', NULL,
  'Unassigned', 'BRO 04.09.01', NULL, NULL, 'Triple Refined', 2.75, 'Received', NULL, 61700,
  56764, NULL, '2024-04-08', '2026-04-08', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.01', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, NULL, '2025-01-06', '2027-01-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.02', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, NULL, '2025-01-06', '2027-01-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.03', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, NULL, '2025-01-06', '2027-01-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.04', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, NULL, '2025-01-06', '2027-01-06', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.05', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, NULL, '2025-01-07', '2027-01-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.06', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, NULL, '2025-01-07', '2027-01-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.07', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, '2025-01-07', '2027-01-07', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.41', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.42', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.43', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.44', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.45', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.46', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.47', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.48', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.49', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.50', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.51', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.52', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.53', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.01.54', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24S', 'BO 25.05.01', NULL, NULL, 'Crude Cosmetic', 2.6, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.10.05', NULL, NULL, 'Extra Virgin', 0.51, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24P', 'BFGO 24.10.06', NULL, NULL, 'Extra Virgin', 0.5, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  24.11.01', NULL, NULL, 'Extra Virgin', 0.58, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.01.01', NULL, NULL, 'Extra Virgin', 0.29, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.01.02', NULL, NULL, 'Extra Virgin', 0.18, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.01.03', NULL, NULL, 'Extra Virgin', 0.22, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.01.04', NULL, NULL, 'Extra Virgin', 0.44, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.01.05', NULL, NULL, 'Extra Virgin', 0.38, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.01.06', NULL, NULL, 'Extra Virgin', 0.75, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.01.07', NULL, NULL, 'Extra Virgin', 0.83, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.01.08', NULL, NULL, 'Extra Virgin', 0.82, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.01', NULL, NULL, 'Extra Virgin', 0.68, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.02', NULL, NULL, 'Extra Virgin', 0.36, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.03', NULL, NULL, 'Extra Virgin', 0.65, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.04', NULL, NULL, 'Extra Virgin', 0.55, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.05', NULL, NULL, 'Extra Virgin', 0.63, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.06', NULL, NULL, 'Extra Virgin', 0.53, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.07', NULL, NULL, 'Extra Virgin', 0.89, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.08', NULL, NULL, 'Extra Virgin', 0.5, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.09', NULL, NULL, 'Extra Virgin', 0.82, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.02.10', NULL, NULL, 'Extra Virgin', 0.95, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.03.01', NULL, NULL, 'Extra Virgin', 0.69, 'Received', NULL, 1000,
  920, '2025-05-28', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.02', NULL, NULL, 'Crude Cosmetic', 2.9, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.03', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.04', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.05', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.06', NULL, NULL, 'Crude Cosmetic', 3.1, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.07', NULL, NULL, 'Crude Cosmetic', 4, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.08', NULL, NULL, 'Crude Cosmetic', 1.6, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.09', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.10', NULL, NULL, 'Crude Cosmetic', 3.4, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.11', NULL, NULL, 'Crude Cosmetic', 3.3, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.12', NULL, NULL, 'Crude Cosmetic', 3.7, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.14', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.15', NULL, NULL, 'Crude Cosmetic', 2.9, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.16', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.17', NULL, NULL, 'Crude Cosmetic', 4, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.18', NULL, NULL, 'Crude Cosmetic', 3.7, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.19', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.20', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.21', NULL, NULL, 'Crude Cosmetic', 3, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.22', NULL, NULL, 'Crude Cosmetic', 2.7, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.23', NULL, NULL, 'Crude Cosmetic', 3.7, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.24', NULL, NULL, 'Crude Cosmetic', 5.1, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.25', NULL, NULL, 'Crude Cosmetic', 6.6, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.26', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.27', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.28', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.38', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.46', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.47', NULL, NULL, 'Crude Cosmetic', 3.7, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.05.48', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.06.02', NULL, NULL, 'Crude Cosmetic', 3.1, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.06.07', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.06.11', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.06.20', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.06.21', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.06.25', NULL, NULL, 'Crude Cosmetic', 2.2, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Amanah', NULL,
  'Amanah', 'BO 25.06.28', NULL, NULL, 'Crude Cosmetic', 2.9, 'Not Sent', NULL, 1000,
  920, '2025-07-05', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.11.52', NULL, NULL, 'Crude Cosmetic', 0.74, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.11.53', NULL, NULL, 'Crude Cosmetic', 0.8, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.11.54', NULL, NULL, 'Crude Cosmetic', 0.88, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.11.55', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.12.01', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.12.02', NULL, NULL, 'Crude Cosmetic', 1.03, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.12.03', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.12.04', NULL, NULL, 'Crude Cosmetic', 0.85, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.12.05', NULL, NULL, 'Crude Cosmetic', 0.83, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.12.06', NULL, NULL, 'Crude Cosmetic', 0.99, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 24.12.07', NULL, NULL, 'Crude Cosmetic', 1.01, 'Received', NULL, 1000,
  920, '2025-11-07', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.11', NULL, NULL, 'Crude Cosmetic', 3.2, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-08', '2027-01-08', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.12', NULL, NULL, 'Crude Cosmetic', 3.5, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-08', '2027-01-08', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.13', NULL, NULL, 'Crude Cosmetic', 3.2, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-09', '2027-01-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.14', NULL, NULL, 'Crude Cosmetic', 2.8, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-09', '2027-01-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.15', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-09', '2027-01-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.16', NULL, NULL, 'Crude Cosmetic', 3.2, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-09', '2027-01-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.17', NULL, NULL, 'Crude Cosmetic', 3, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-09', '2027-01-09', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.18', NULL, NULL, 'Crude Cosmetic', 3.8, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-13', '2027-01-13', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.19', NULL, NULL, 'Crude Cosmetic', 2.6, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-13', '2027-01-13', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.20', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-13', '2027-01-13', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Gustav Heess', NULL,
  '24P', 'BO 25.01.21', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, '2025-11-07', '2025-01-14', '2027-01-14', 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.03.02', NULL, NULL, 'Extra Virgin', 0.64, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'IMCD', NULL,
  '24BOFG', 'BOFG  25.03.03', NULL, NULL, 'Extra Virgin', 0.44, 'Received', NULL, 1000,
  920, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.45', NULL, NULL, 'Crude Cosmetic', 0.9, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.46', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.47', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.48', NULL, NULL, 'Crude Cosmetic', 2.6, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.49', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.50', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.51', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.52', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.53', NULL, NULL, 'Crude Cosmetic', 1.2, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.54', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.55', NULL, NULL, 'Crude Cosmetic', 1.2, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.56', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.57', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.58', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.59', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.60', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.03.61', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.04.01', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.04.02', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.04.03', NULL, NULL, 'Crude Cosmetic', 3, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.04.04', NULL, NULL, 'Crude Cosmetic', 3, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24X', 'BO 25.04.05', NULL, NULL, 'Crude Cosmetic', 4.1, 'Received', NULL, 1000,
  920, '2025-12-08', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.19', NULL, NULL, 'Crude Cosmetic', 0.82, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.20', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.21', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.22', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.23', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.24', NULL, NULL, 'Crude Cosmetic', 0.97, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.25', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.26', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.27', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.28', NULL, NULL, 'Crude Cosmetic', 0.94, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 24.12.29', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.08', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.09', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.10', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.33', NULL, NULL, 'Crude Cosmetic', 3.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.34', NULL, NULL, 'Crude Cosmetic', 2.7, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.35', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.36', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.37', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.38', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24R', 'BO 25.01.39', NULL, NULL, 'Crude Cosmetic', 2.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
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
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.01', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.02', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.03', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.04', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.05', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.06', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.07', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.08', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.09', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.10', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.11', NULL, NULL, 'Crude Cosmetic', 1.1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.12', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.13', NULL, NULL, 'Crude Cosmetic', 1.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.14', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.15', NULL, NULL, 'Crude Cosmetic', 3.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.16', NULL, NULL, 'Crude Cosmetic', 3.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.17', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.18', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.19', NULL, NULL, 'Crude Cosmetic', 3.6, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.20', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24T', 'BO 25.02.21', NULL, NULL, 'Crude Cosmetic', 1.6, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.22', NULL, NULL, 'Crude Cosmetic', 2.8, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.23', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.24', NULL, NULL, 'Crude Cosmetic', 3.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.25', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.26', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.27', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.28', NULL, NULL, 'Crude Cosmetic', 1.3, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.29', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.30', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.31', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.32', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.33', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.34', NULL, NULL, 'Crude Cosmetic', 1.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.35', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.36', NULL, NULL, 'Crude Cosmetic', 1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.37', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.38', NULL, NULL, 'Crude Cosmetic', 3.3, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.39', NULL, NULL, 'Crude Cosmetic', 3.9, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.40', NULL, NULL, 'Crude Cosmetic', 4.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.41', NULL, NULL, 'Crude Cosmetic', 2.4, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.42', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Vantage', NULL,
  '24U', 'BO 25.02.43', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, '2025-08-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.04.07', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.05.29', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.06.18', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.06.27', NULL, NULL, 'Crude Cosmetic', 2.2, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.06.32', NULL, NULL, 'Crude Cosmetic', 3.1, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.07.12', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.07.14', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.07.16', NULL, NULL, 'Crude Cosmetic', 2.5, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.07.17', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.07.18', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.07.25', NULL, NULL, 'Crude Cosmetic', 2.1, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.07.29', NULL, NULL, 'Crude Cosmetic', 1.7, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.02', NULL, NULL, 'Crude Cosmetic', 3, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.03', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.04', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.07', NULL, NULL, 'Crude Cosmetic', 1.9, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.14', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.15', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.20', NULL, NULL, 'Crude Cosmetic', 2, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.21', NULL, NULL, 'Crude Cosmetic', 2.7, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.23', NULL, NULL, 'Crude Cosmetic', 1.8, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Henry Lamotte', NULL,
  '24Z', 'BO 25.08.24', NULL, NULL, 'Crude Cosmetic', 2.3, 'Received', NULL, 1000,
  920, '2025-12-12', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.08.29', NULL, NULL, 'Crude Cosmetic', 4.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.08.32', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.02', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.06', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.07', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.11', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.15', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.17', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.24', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.33', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.37', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.38', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.09.40', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.10.10', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.10.13', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.10.24', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.10.38', NULL, NULL, 'Crude Cosmetic', 2.9, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.10.46', NULL, NULL, 'Crude Cosmetic', 3.7, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.10.51', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.10.53', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.11.05', NULL, NULL, 'Crude Cosmetic', 2.2, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 A', 'BO 25.11.13', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.08.30', NULL, NULL, 'Crude Cosmetic', 3.5, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.01', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.08', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.18', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.26', NULL, NULL, 'Crude Cosmetic', 2.7, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.28', NULL, NULL, 'Crude Cosmetic', 4.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.32', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.34', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.39', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.41', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.43', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.09.44', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.10.01', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.10.06', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.10.12', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.10.20', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.10.33', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.10.36', NULL, NULL, 'Crude Cosmetic', 2.9, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.10.41', NULL, NULL, 'Crude Cosmetic', 3, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.10.42', NULL, NULL, 'Crude Cosmetic', 2.2, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.11.09', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 B', 'BO 25.11.11', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.08.28', NULL, NULL, 'Crude Cosmetic', 3.5, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.09.09', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.09.20', NULL, NULL, 'Crude Cosmetic', 1.9, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.09.31', NULL, NULL, 'Crude Cosmetic', 2, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.09.47', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.02', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.03', NULL, NULL, 'Crude Cosmetic', 2.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.04', NULL, NULL, 'Crude Cosmetic', 2.5, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.05', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.08', NULL, NULL, 'Crude Cosmetic', 2.6, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.09', NULL, NULL, 'Crude Cosmetic', 2.7, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.11', NULL, NULL, 'Crude Cosmetic', 2.4, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.14', NULL, NULL, 'Crude Cosmetic', 3, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.16', NULL, NULL, 'Crude Cosmetic', 2.9, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.19', NULL, NULL, 'Crude Cosmetic', 2.3, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.35', NULL, NULL, 'Crude Cosmetic', 2.2, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.44', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.47', NULL, NULL, 'Crude Cosmetic', 4.6, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.10.50', NULL, NULL, 'Crude Cosmetic', 2.7, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.11.03', NULL, NULL, 'Crude Cosmetic', 2.1, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.11.08', NULL, NULL, 'Crude Cosmetic', 1.8, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'sold', 'sold', 'customer', 'Essen Supplier Group, SA. DE C.V
Periferico Manuel Gomez Morin', NULL,
  '25 C', 'BO 25.11.10', NULL, NULL, 'Crude Cosmetic', 1.7, 'Not Sent', NULL, 1000,
  920, '2026-01-22', NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Global Macadamias (Pty) Ltd', NULL,
  NULL, NULL, 'ZRNMKC', 'ZRNMKC - Crude Grade Oil Kernel', NULL, 0.32, NULL, NULL, NULL,
  2041.2, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Lowveld Nut Processing (Pty) Ltd', NULL,
  NULL, NULL, 'ZRNMKC', 'ZRNMKC - Crude Grade Oil Kernel', NULL, 0.72, NULL, NULL, NULL,
  5443.2, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Green Farm Nut co', NULL,
  NULL, NULL, 'ZRNMKC', 'ZRNMKC - Crude Grade Oil Kernel', NULL, 0.61, NULL, NULL, NULL,
  9308, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Mac- Eden', NULL,
  NULL, NULL, 'ZRNMKC', 'ZRNMKC - Crude Grade Oil Kernel', NULL, NULL, NULL, NULL, NULL,
  3315, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Global Macadamias (Pty) Ltd', NULL,
  NULL, NULL, 'ZRNMKD', 'ZRNMKD - Kernel Dust', NULL, NULL, NULL, NULL, NULL,
  16600, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Lowveld Nut Processing (Pty) Ltd', NULL,
  NULL, NULL, 'ZRNMKD', 'ZRNMKD - Kernel Dust', NULL, NULL, NULL, NULL, NULL,
  4490.64, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Green Farm Nut co', NULL,
  NULL, NULL, 'ZRNMKD', 'ZRNMKD - Kernel Dust', NULL, 1, NULL, NULL, NULL,
  646, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Mac- Eden', NULL,
  NULL, NULL, 'ZRNMKD', 'ZRNMKD - Kernel Dust', NULL, NULL, NULL, NULL, NULL,
  1175, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Macavation', NULL,
  NULL, NULL, 'ZRNMKD', 'ZRNMKD - Kernel Dust', NULL, NULL, NULL, NULL, NULL,
  4536, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Global  Macadamias', NULL,
  NULL, NULL, 'ZRNMKD', 'ZRNMKD - Kernel Dust', NULL, NULL, NULL, NULL, NULL,
  6800, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Global Macadamias (Pty) Ltd', NULL,
  NULL, NULL, 'ZRNMOSP', 'ZRNMOSP - Cracker Dust', NULL, 0.95, NULL, NULL, NULL,
  61050, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Lowveld Nut Processing (Pty) Ltd', NULL,
  NULL, NULL, 'ZRNMOSP', 'ZRNMOSP - Cracker Dust', NULL, 1.01, NULL, NULL, NULL,
  48675, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Green Farm Nut co', NULL,
  NULL, NULL, 'ZRNMOSP', 'ZRNMOSP - Cracker Dust', NULL, 1.05, NULL, NULL, NULL,
  82712, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Mac- Eden', NULL,
  NULL, NULL, 'ZRNMOSP', 'ZRNMOSP - Cracker Dust', NULL, NULL, NULL, NULL, NULL,
  8055, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Greenfarm', NULL,
  NULL, NULL, 'ZRNMOSP', 'ZRNMOSP - Cracker Dust', NULL, NULL, NULL, NULL, NULL,
  1291, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '801', 'raw_material', 'on_hand', 'supplier', 'Global  Macadamias', NULL,
  NULL, NULL, 'ZRNMOSP', 'ZRNMOSP - Cracker Dust', NULL, NULL, NULL, NULL, NULL,
  26200, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  NULL, NULL, NULL, 'Protein powder', 'Protein powder (A grade)', NULL, NULL, NULL, NULL,
  4994, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1', true, now(), now()
);
INSERT INTO public.oil_stock_lots (
  location_code, stock_category, status, counterparty_type, counterparty_name, counterparty_contact_id,
  po_reference, batch_number, product_code, product_description, grade, ffa, coa_status, units, volume,
  kilograms, delivery_date, manufacture_date, bb_date, notes, is_active, created_at, updated_at
) VALUES (
  '850', 'finished_good', 'on_hand', NULL, NULL, NULL,
  NULL, NULL, NULL, 'Protein powder', 'Protein powder (A grade)', NULL, NULL, NULL, NULL,
  4983, NULL, NULL, NULL, 'SOH YE25 xlsx seed v1 - Pete took 2 boxes for samples, trade shows', true, now(), now()
);
