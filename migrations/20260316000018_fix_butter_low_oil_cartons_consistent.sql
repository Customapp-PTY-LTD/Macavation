-- Fix Butter Low Oil cartons: cartons = source of truth, kg = cartons * 11.34.
-- From sheet kg: cartons = GREATEST(1, ROUND(kg/11.34)), then kg = ROUND(cartons * 11.34, 2).
-- Result: 44.2.25.28→2 cartons/22.68kg, 56.1.25.39→1/11.34, 51.1.25.31→1/11.34, 7.7.25.32→1/11.34,
-- 54.6.25.37→1/11.34, 55.1.25.38→5/56.70, 44.2.25.40→1/11.34, 56.1.25.45→1/11.34, 23.6.25.46→3/34.02.

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
    v_cartons int;
    v_kg numeric;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('44.2.25.28', 27),
        ('56.1.25.39', 10),
        ('51.1.25.31', 3),
        ('7.7.25.32', 3),
        ('54.6.25.37', 13),
        ('55.1.25.38', 53),
        ('44.2.25.40', 15),
        ('56.1.25.45', 3),
        ('23.6.25.46', 35)
    ) AS t(batch_num, kg_in))
    LOOP
        v_cartons := GREATEST(1, ROUND(rec.kg_in / 11.34)::int);
        v_kg := ROUND(v_cartons * 11.34, 2);

        SELECT k.id, k.packing_data INTO v_kid, v_packing
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE b.batch_type = 'kernel'
          AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-'))
          AND k.is_active = true
        LIMIT 1;

        IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
            v_elem := (v_packing->0) || jsonb_build_object('bt_low_qty', v_kg, 'bt_low_cartons', v_cartons);
            v_packing := jsonb_set(v_packing, '{0}', v_elem);
            UPDATE public.kernel
            SET packing_data = v_packing, updated_at = now()
            WHERE id = v_kid;
        END IF;
    END LOOP;
END;
$$;
