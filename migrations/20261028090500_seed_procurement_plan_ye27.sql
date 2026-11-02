-- =============================================================================
-- Load Mike's "Procurement Plan YE27.xlsx" (received 26 Oct 2026) into the new plan:
-- 11 planned 30 t trucks, the worked Saturdays / half days / no-cracking days /
-- shutdown he marked, SA public holidays in March 2027, and his opening stock
-- (214,522.5 kg on 26 Oct 2026) at 5,000 kg per cracking day.
-- Idempotent: trucks are matched on (truck_label, scheduled_date); day rows upsert;
-- settings are only written when no 'procurement_plan' setting exists yet.
-- Note: the sheet's own formula skipped North Coast's Saturday 21 Nov truck; it is
-- included here.
-- =============================================================================

WITH plan(truck_label, d, grower, supplier_like, confirmed) AS (VALUES
    ('Agristar 1',    DATE '2026-10-28', 'Agristar',      'Agristar%', true),
    ('AP Vos 1',      DATE '2026-10-31', 'AP Vos',        'AP Vos%',   false),
    ('Bester 1',      DATE '2026-11-06', 'Bester',        NULL,        false),
    ('Russell Stone 1', DATE '2026-11-14', 'Russell Stone', NULL,      false),
    ('North Coast 1', DATE '2026-11-21', 'North Coast',   NULL,        false),
    ('Agristar 2',    DATE '2026-11-24', 'Agristar',      'Agristar%', false),
    ('AP Vos 2',      DATE '2026-12-01', 'AP Vos',        'AP Vos%',   false),
    ('WR/MPU 1',      DATE '2026-12-08', 'WR/MPU',        NULL,        false),
    ('Agristar 3',    DATE '2027-01-07', 'Agristar',      'Agristar%', false),
    ('Agristar 4',    DATE '2027-01-15', 'Agristar',      'Agristar%', false),
    ('Agristar 5',    DATE '2027-01-26', 'Agristar',      'Agristar%', false)
)
INSERT INTO public.kernel_intake_procurement
    (scheduled_date, supplier_id, grower_name, predicted_weight_kg, status, truck_label, is_confirmed, note)
SELECT p.d,
       (SELECT c.id FROM public.contacts c
         WHERE p.supplier_like IS NOT NULL AND c.company_name ILIKE p.supplier_like
         ORDER BY c.created_at LIMIT 1),
       p.grower, 30000, 'scheduled', p.truck_label, p.confirmed,
       'From Procurement Plan YE27 (Mike, 26 Oct 2026)'
FROM plan p
WHERE NOT EXISTS (
    SELECT 1 FROM public.kernel_intake_procurement k
    WHERE k.truck_label = p.truck_label AND k.scheduled_date = p.d);

WITH days(d_from, d_to, day_type, note) AS (VALUES
    (DATE '2026-10-30', DATE '2026-10-30', 'half',     'Half day'),
    (DATE '2026-10-31', DATE '2026-10-31', 'work',     'Saturday worked'),
    (DATE '2026-11-14', DATE '2026-11-14', 'work',     'Saturday worked'),
    (DATE '2026-11-21', DATE '2026-11-21', 'work',     'Saturday worked'),
    (DATE '2026-11-27', DATE '2026-11-27', 'half',     'Half day'),
    (DATE '2026-12-05', DATE '2026-12-05', 'work',     'Saturday worked'),
    (DATE '2026-12-11', DATE '2026-12-11', 'nocrack',  'No cracking (from the YE27 sheet - to confirm with Mike)'),
    (DATE '2026-12-14', DATE '2026-12-17', 'nocrack',  'No cracking (from the YE27 sheet - to confirm with Mike)'),
    (DATE '2026-12-18', DATE '2026-12-18', 'holiday',  'Public holiday (moved)'),
    (DATE '2026-12-19', DATE '2027-01-03', 'shutdown', 'Year-end shutdown'),
    (DATE '2027-01-29', DATE '2027-01-29', 'half',     'Half day'),
    (DATE '2027-03-22', DATE '2027-03-22', 'holiday',  'Human Rights Day (observed)'),
    (DATE '2027-03-26', DATE '2027-03-26', 'holiday',  'Good Friday'),
    (DATE '2027-03-29', DATE '2027-03-29', 'holiday',  'Family Day')
)
INSERT INTO public.procurement_day_types (day, day_type, note)
SELECT g::date, d.day_type, d.note
FROM days d
CROSS JOIN LATERAL generate_series(d.d_from, d.d_to, interval '1 day') g
ON CONFLICT (day) DO NOTHING;

INSERT INTO public.kernel_pipeline_settings (key, value, updated_at)
VALUES ('procurement_plan',
        jsonb_build_object('planned_kg_per_day', 5000, 'opening_mode', 'manual',
                           'opening_kg', 214522.5, 'opening_as_of', '2026-10-26'),
        now())
ON CONFLICT (key) DO NOTHING;
