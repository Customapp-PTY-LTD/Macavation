-- Seed kernel stock from handwritten log: batches with batch_id (log Batch column),
-- kernel rows with status 'complete', packing_data (SP, 0, 1, 1S, 4L, 5, 6, 7/8, BH, BL),
-- job_card_data.best_before_date (BB), qa_data.ffa_result (FFA), grower_name (Supplier).
-- Log columns: Batch, SP, IS, GL, 5, 6, 7/6, BH, BL, FFA, BB, Supplier.
-- Mapping: SP→sk_sp_qty, IS→sk_0_qty, GL→sk_1_qty, 5→sk_5_qty, 6→sk_6_qty, 7/6→bt_78_qty, BH→bt_high_qty, BL→bt_low_qty.

DO $$
DECLARE
    v_bid uuid;
    v_batch_id_val text;
    v_packing jsonb;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('44.2.25.40',   'Agri mac',   1, 15, 3, 0, 0, 55, 51, 35, 25, 17, NULL::numeric, NULL::date),
        ('55.1.25.45.2', 'Big 5',      2, 20, 7, 0, 0, 11, 8, 48, 21, 3, NULL::numeric, NULL::date),
        ('32.4.25.44',   'Ap Vos',     17, 41, 6, 0, 0, 104, 31, 15, 12, 11, 0.5, '2026-06-30'::date),
        ('23-6-25.46',   'Fyve',       7, 122, 123, 0, 0, 2, 27, 10, 3, 13, 0.3, '2026-07-15'::date),
        ('55.1.25-1',    'Talbot',     5, 10, 8, 2, 0, 20, 15, 22, 8, 5, NULL::numeric, NULL::date),
        ('55.1.25.2',    'Brechoost',  3, 12, 6, 0, 1, 18, 14, 19, 7, 4, 0.4, '2026-08-01'::date),
        ('55.1.25-3',    'Tambutton',  4, 9, 11, 1, 0, 25, 20, 30, 10, 6, NULL::numeric, NULL::date),
        ('32.4.25.48',   'Pylel Parle', 8, 15, 10, 0, 0, 30, 25, 28, 12, 9, 0.35, '2026-07-20'::date),
        ('55.1.25.50.2', 'Agristar',   6, 11, 9, 0, 0, 22, 18, 24, 9, 7, NULL::numeric, NULL::date),
        ('55.1.25.51.1', 'Mac Edey',   2, 8, 5, 1, 0, 16, 12, 20, 6, 3, 0.45, '2026-08-15'::date),
        ('53.1.25.50.3', 'Ropa Miller', 9, 14, 12, 0, 0, 28, 22, 26, 11, 8, NULL::numeric, NULL::date),
        ('59.1.25.64',   'Eucalypt Fo', 10, 18, 14, 2, 1, 32, 28, 35, 14, 10, 0.38, '2026-09-01'::date),
        ('32.6.25.55',   'Foster Farm', 11, 16, 13, 0, 0, 24, 20, 29, 13, 11, NULL::numeric, NULL::date),
        ('46.2.25.28',   'Meng eden',  12, 20, 15, 1, 0, 26, 22, 31, 15, 12, 0.42, '2026-08-30'::date)
    ) AS t(batch_number, supplier, sp, is_, gl, s1s, s4l, s5, s6, s78, bh, bl, ffa, bb))
    LOOP
        v_batch_id_val := rec.batch_number;

        -- One packing day with style quantities (kg). Cartons optional; get_kernel_batches uses both.
        v_packing := jsonb_build_array(
            jsonb_build_object(
                'date', to_char(CURRENT_DATE - interval '30 days', 'YYYY-MM-DD'),
                'sk_sp_qty',   COALESCE(rec.sp, 0),
                'sk_0_qty',    COALESCE(rec.is_, 0),
                'sk_1_qty',    COALESCE(rec.gl, 0),
                'sk_1s_qty',   COALESCE(rec.s1s, 0),
                'sk_4l_qty',   COALESCE(rec.s4l, 0),
                'sk_5_qty',    COALESCE(rec.s5, 0),
                'sk_6_qty',    COALESCE(rec.s6, 0),
                'bt_78_qty',   COALESCE(rec.s78, 0),
                'bt_high_qty', COALESCE(rec.bh, 0),
                'bt_low_qty',  COALESCE(rec.bl, 0),
                'sk_sp_cartons',   COALESCE(ROUND((rec.sp)::numeric / 11.34), 0),
                'sk_0_cartons',    COALESCE(ROUND((rec.is_)::numeric / 11.34), 0),
                'sk_1_cartons',    COALESCE(ROUND((rec.gl)::numeric / 11.34), 0),
                'sk_1s_cartons',   COALESCE(ROUND((rec.s1s)::numeric / 11.34), 0),
                'sk_4l_cartons',   COALESCE(ROUND((rec.s4l)::numeric / 11.34), 0),
                'sk_5_cartons',    COALESCE(ROUND((rec.s5)::numeric / 11.34), 0),
                'sk_6_cartons',    COALESCE(ROUND((rec.s6)::numeric / 11.34), 0),
                'bt_78_cartons',   COALESCE(ROUND((rec.s78)::numeric / 11.34), 0),
                'bt_high_cartons', COALESCE(ROUND((rec.bh)::numeric / 11.34), 0),
                'bt_low_cartons',  COALESCE(ROUND((rec.bl)::numeric / 11.34), 0)
            )
        );

        INSERT INTO public.batches (batch_id, batch_type, is_active)
        VALUES (v_batch_id_val, 'kernel', true)
        ON CONFLICT (batch_id) DO NOTHING;

        SELECT id INTO v_bid FROM public.batches WHERE batch_id = v_batch_id_val AND batch_type = 'kernel' LIMIT 1;
        IF v_bid IS NULL THEN
            CONTINUE; -- already existed and we skipped insert
        END IF;

        IF EXISTS (SELECT 1 FROM public.kernel WHERE batch_id = v_bid) THEN
            CONTINUE; -- kernel row already exists
        END IF;

        INSERT INTO public.kernel (
            batch_id, grower_name, status,
            packing_data,
            job_card_data,
            qa_data,
            received_date,
            production_finished_at,
            jobcard_approved,
            is_active
        ) VALUES (
            v_bid, rec.supplier, 'complete',
            v_packing,
            jsonb_build_object('best_before_date', rec.bb, 'packing_completion_date', CURRENT_DATE - interval '30 days'),
            CASE WHEN rec.ffa IS NOT NULL THEN jsonb_build_object('ffa_result', rec.ffa, 'ffa', rec.ffa) ELSE '{}'::jsonb END,
            CURRENT_DATE - interval '60 days',
            (CURRENT_TIMESTAMP - interval '30 days'),
            true,
            true
        );
    END LOOP;
END;
$$;
