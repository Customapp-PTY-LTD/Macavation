-- Add missing batch 55.1.25.50.1 (Big 5) with Style 5 only: 38 cartons, 430.92 kg.
-- BB Date 7/8/2027, PV 3.39, FFA 0.33%.

INSERT INTO public.batches (batch_id, batch_type, is_active)
VALUES ('55.1.25.50.1', 'kernel', true)
ON CONFLICT (batch_id) DO NOTHING;

INSERT INTO public.kernel (
    batch_id,
    grower_name,
    status,
    packing_data,
    job_card_data,
    qa_data,
    received_date,
    production_finished_at,
    jobcard_approved,
    is_active
)
SELECT
    b.id,
    'Big 5',
    'complete',
    jsonb_build_array(
        jsonb_build_object(
            'date', '2026-03-16',
            'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 430.92, 'sk_6_qty', 0,
            'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0,
            'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 38, 'sk_6_cartons', 0,
            'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0
        )
    ),
    jsonb_build_object('best_before_date', '2027-07-08'::date, 'packing_completion_date', '2026-03-16'),
    jsonb_build_object('ffa_result', 0.33, 'ffa', 0.33, 'peroxide', 3.39),
    '2026-03-01'::date,
    now() - interval '30 days',
    true,
    true
FROM public.batches b
WHERE b.batch_id = '55.1.25.50.1' AND b.batch_type = 'kernel'
  AND NOT EXISTS (SELECT 1 FROM public.kernel k WHERE k.batch_id = b.id AND k.is_active = true);
