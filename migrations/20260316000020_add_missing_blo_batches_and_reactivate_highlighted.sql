-- BLO highlighted rows: add missing batches and re-activate removed ones so all highlighted show with BLO.
-- Create: 44.2.25.28 (Agristar, 27 cartons), 56.1.25.39 (Mac-Eden, 10), 51.1.25.31 (Ropa Miller, 3), 7.7.25.32 (Eucalypt, 3).
-- Re-activate and set BLO: 54.6.25.37 (13 cartons), 55.1.25.38 (53), 56.1.25.45 (3).
-- 44.2.25.40 and 23.6.25.46 already had BLO from previous migration.

DO $$
DECLARE
    v_bid uuid;
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('44.2.25.28', 'Agristar Macadamias (Pty) Ltd NutsAll', 27, 306.18),
        ('56.1.25.39', 'Mac-Eden Estate', 10, 113.40),
        ('51.1.25.31', 'Ropa Miller', 3, 34.02),
        ('7.7.25.32', 'Eucalypt Forestry', 3, 34.02)
    ) AS t(batch_num, supplier, cartons, kg))
    LOOP
        INSERT INTO public.batches (batch_id, batch_type, is_active)
        VALUES (rec.batch_num, 'kernel', true)
        ON CONFLICT (batch_id) DO NOTHING;

        SELECT id INTO v_bid FROM public.batches WHERE batch_id = rec.batch_num AND batch_type = 'kernel' LIMIT 1;
        IF v_bid IS NULL THEN CONTINUE; END IF;

        IF NOT EXISTS (SELECT 1 FROM public.kernel WHERE batch_id = v_bid AND is_active = true) THEN
            v_packing := jsonb_build_array(
                jsonb_build_object(
                    'date', '2026-03-16',
                    'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 0,
                    'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', rec.kg,
                    'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 0,
                    'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', rec.cartons
                )
            );
            INSERT INTO public.kernel (batch_id, grower_name, status, packing_data, job_card_data, qa_data, received_date, production_finished_at, jobcard_approved, is_active)
            VALUES (v_bid, rec.supplier, 'complete', v_packing, '{}'::jsonb, '{}'::jsonb, '2026-03-01'::date, now() - interval '30 days', true, true);
        END IF;
    END LOOP;

    FOR rec IN (SELECT * FROM (VALUES
        ('54.6.25.37', 13, 147.42),
        ('55.1.25.38', 53, 601.02),
        ('56.1.25.45', 3, 34.02)
    ) AS t(batch_num, cartons, kg))
    LOOP
        SELECT k.id, k.packing_data INTO v_kid, v_packing
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-'))
        LIMIT 1;

        IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
            v_elem := (v_packing->0) || jsonb_build_object('bt_low_qty', rec.kg, 'bt_low_cartons', rec.cartons);
            v_packing := jsonb_set(v_packing, '{0}', v_elem);
            UPDATE public.kernel
            SET packing_data = v_packing, is_active = true, updated_at = now()
            WHERE id = v_kid;
        END IF;
    END LOOP;
END;
$$;
