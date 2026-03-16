-- Replace kernel stock with Style 6 spreadsheet data only.
-- Source: Style 6 spreadsheet (Supplier, Batch #, BB Date, FFA %, PV, Cartons, Kilograms).
-- Each batch gets packing_data with only Style 6 (sk_6_qty, sk_6_cartons); other styles 0.
-- job_card_data.best_before_date and qa_data.ffa_result/peroxide set from spreadsheet.
-- Batches not in this list are deactivated (is_active = false) so they no longer show in Stock (Kernel).

DO $$
DECLARE
    v_bid uuid;
    v_kid uuid;
    v_packing jsonb;
    v_bb date;
    v_ffa numeric;
    v_pv numeric;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('54.6.25.37',  'Foster Farming',               '2027-02-27'::date, NULL::numeric, NULL::numeric, 0, 0),
        ('55.1.25.38',  'Big 5',                         '2027-03-18'::date, NULL::numeric, NULL::numeric, 0, 0),
        ('44.2.25.40',  'Agristar Macadamias (Pty) Ltd NutsAll', '2027-04-01'::date, NULL::numeric, NULL::numeric, 1, 11.34),
        ('57.1.25.42',  'Two Rivers Trust',              '2027-04-10'::date, NULL::numeric, NULL::numeric, 0, 0),
        ('55.1.25.43.1','Big 5',                         '2027-04-11'::date, NULL::numeric, NULL::numeric, 0, 0),
        ('55.1.25.43.2','Big 5',                         '2027-04-16'::date, NULL::numeric, NULL::numeric, 3, 34.02),
        ('56.1.25.45',  'Mac Eden Estate',               '2027-04-17'::date, NULL::numeric, NULL::numeric, 0, 0),
        ('32.4.25.44',  'AP Vos & Seuns',                '2027-04-24'::date, 0.15, 0.25, 55, 623.70),
        ('23.6.25.46',  'Fyvie Estates',                 '2027-05-06'::date, 0.13, 0.10, 51, 578.34),
        ('55.1.25.47.1','Big 5',                         '2027-05-13'::date, 0.38, 2.04, 25, 283.50),
        ('55.1.25.47.2','Big 5',                         '2027-05-17'::date, 0.22, 0.1, 17, 192.78),
        ('55.1.25.47.3','Big 5',                         '2027-05-19'::date, 0.36, 0.73, 2, 22.68),
        ('32.4.25.48',  'AP Vos & Seuns',                '2027-05-24'::date, 0.35, 0.65, 20, 226.80),
        ('55.1.25.50.2','Big 5',                         '2027-07-13'::date, 0.19, 0.30, 7, 79.38),
        ('55.1.25.51.1','Big 5',                         '2027-07-08'::date, 0.26, 2.95, 11, 124.74),
        ('55.1.2.25.51.2','Big 5',                       '2027-07-23'::date, 0.32, 0.38, 11, 124.74),
        ('55.1.25.50.3','Big 5',                         '2027-07-19'::date, 0.25, 2.15, 8, 90.72),
        ('55.1.25.51.3','Big 5',                         '2027-07-28'::date, 0.38, 2.37, 21, 238.14),
        ('59.1.25.54',  'Talbot',                        '2027-08-03'::date, 0.58, 1.07, 1, 11.34),
        ('32.4.25.52',  'AP Vos & Seuns',                '2027-08-04'::date, 0.20, 0.10, 41, 464.94),
        ('32.4.25.55',  'AP Vos & Seuns',                '2027-08-02'::date, 0.62, 0.68, 15, 170.10),
        ('60.1.25.56',  'Breechoost CC',                 '2027-09-02'::date, 0.64, 0.32, 2, 22.68)
    ) AS t(batch_num, supplier, bb_date, ffa_pct, pv_val, cartons, kg))
    LOOP
        v_bb := rec.bb_date;
        v_ffa := rec.ffa_pct;
        v_pv := rec.pv_val;

        v_packing := jsonb_build_array(
            jsonb_build_object(
                'date', '2026-03-16',
                'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0,
                'sk_6_qty', COALESCE(rec.kg, 0), 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0,
                'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0,
                'sk_6_cartons', COALESCE(rec.cartons, 0), 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0
            )
        );

        -- Match batch: try exact then with dots replaced by dashes (23.6.25.46 -> 23-6-25.46)
        SELECT b.id INTO v_bid FROM public.batches b WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-')) LIMIT 1;
        IF v_bid IS NULL THEN
            INSERT INTO public.batches (batch_id, batch_type, is_active) VALUES (rec.batch_num, 'kernel', true) ON CONFLICT (batch_id) DO NOTHING;
            SELECT id INTO v_bid FROM public.batches WHERE batch_id = rec.batch_num AND batch_type = 'kernel' LIMIT 1;
        END IF;
        IF v_bid IS NULL THEN
            CONTINUE;
        END IF;

        SELECT k.id INTO v_kid FROM public.kernel k WHERE k.batch_id = v_bid LIMIT 1;
        IF v_kid IS NOT NULL THEN
            UPDATE public.kernel SET
                packing_data = v_packing,
                grower_name = rec.supplier,
                job_card_data = COALESCE(job_card_data, '{}'::jsonb) || jsonb_build_object('best_before_date', v_bb, 'packing_completion_date', '2026-03-16'),
                qa_data = CASE WHEN v_ffa IS NOT NULL OR v_pv IS NOT NULL THEN jsonb_build_object('ffa_result', v_ffa, 'ffa', v_ffa, 'peroxide', v_pv) ELSE COALESCE(qa_data, '{}'::jsonb) END,
                status = 'complete',
                updated_at = now()
            WHERE id = v_kid;
        ELSE
            INSERT INTO public.kernel (batch_id, grower_name, status, packing_data, job_card_data, qa_data, received_date, production_finished_at, jobcard_approved, is_active)
            VALUES (
                v_bid, rec.supplier, 'complete', v_packing,
                jsonb_build_object('best_before_date', v_bb, 'packing_completion_date', '2026-03-16'),
                CASE WHEN v_ffa IS NOT NULL OR v_pv IS NOT NULL THEN jsonb_build_object('ffa_result', v_ffa, 'ffa', v_ffa, 'peroxide', v_pv) ELSE '{}'::jsonb END,
                '2026-03-01'::date, now() - interval '30 days', true, true
            );
        END IF;
    END LOOP;

    -- Deactivate kernel rows for batches not in the Style 6 spreadsheet (old seeded data no longer shown)
    UPDATE public.kernel k
    SET is_active = false, updated_at = now()
    FROM public.batches b
    WHERE k.batch_id = b.id AND k.status = 'complete' AND b.batch_type = 'kernel'
    AND b.batch_id NOT IN (
        '54.6.25.37','55.1.25.38','44.2.25.40','57.1.25.42','55.1.25.43.1','55.1.25.43.2','56.1.25.45',
        '32.4.25.44','23.6.25.46','23-6-25.46','55.1.25.47.1','55.1.25.47.2','55.1.25.47.3','32.4.25.48',
        '55.1.25.50.2','55.1.25.51.1','55.1.2.25.51.2','55.1.25.50.3','55.1.25.51.3','59.1.25.54',
        '32.4.25.52','32.4.25.55','60.1.25.56'
    );
END;
$$;
