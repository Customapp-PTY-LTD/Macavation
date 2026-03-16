-- Add Style Butter Low Oil from BLO sheet (3/16/2026). Rows with non-zero kg only.
-- Cartons: use GREATEST(1, ROUND(kg/11.34)) so kg and cartons stay consistent (kg = cartons * 11.34).
-- See 20260316000018_fix_butter_low_oil_cartons_consistent.sql for carton correction.
-- Batches not in DB or inactive are skipped.

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('44.2.25.28',  2, 27),
        ('56.1.25.39',  1, 10),
        ('51.1.25.31',  0, 3),
        ('7.7.25.32',   0, 3),
        ('54.6.25.37',  1, 13),
        ('55.1.25.38',  5, 53),
        ('44.2.25.40',  1, 15),
        ('56.1.25.45',  0, 3),
        ('23.6.25.46',  3, 35)
    ) AS t(batch_num, cartons, kg))
    LOOP
        SELECT k.id, k.packing_data INTO v_kid, v_packing
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE b.batch_type = 'kernel'
          AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-'))
          AND k.is_active = true
        LIMIT 1;

        IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
            v_elem := (v_packing->0) || jsonb_build_object('bt_low_qty', rec.kg, 'bt_low_cartons', rec.cartons);
            v_packing := jsonb_set(v_packing, '{0}', v_elem);
            UPDATE public.kernel
            SET packing_data = v_packing, updated_at = now()
            WHERE id = v_kid;
        END IF;
    END LOOP;
END;
$$;
