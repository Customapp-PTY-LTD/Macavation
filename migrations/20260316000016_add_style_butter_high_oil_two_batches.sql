-- Add Style Butter High Oil to two batches.
-- 55.1.25.50.3 (Big 5): 3 cartons, 34.02 kg. BB 7/19/2027, PV 2.15, FFA 0.25%
-- 32.4.25.52 (AP Vos & Seuns): 6 cartons, 68.04 kg. BB 8/4/2027, PV 0.10, FFA 0.20%

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('55.1.25.50.3', 3, 34.02),
        ('32.4.25.52', 6, 68.04)
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
            v_elem := (v_packing->0) || jsonb_build_object('bt_high_qty', rec.kg, 'bt_high_cartons', rec.cartons);
            v_packing := jsonb_set(v_packing, '{0}', v_elem);
            UPDATE public.kernel
            SET packing_data = v_packing, updated_at = now()
            WHERE id = v_kid;
        END IF;
    END LOOP;
END;
$$;
