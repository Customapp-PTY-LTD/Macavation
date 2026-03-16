-- Add/update Style 4L for three batches (cartons circled in image).
-- 55.1.25.50.1: 38 cartons, 430.92 kg (skipped if batch not found)
-- 55.1.25.51.1: 6 cartons, 68.04 kg
-- 60.1.25.56: 123 cartons, 1,394.82 kg (update from previous 122/1383.48)

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('55.1.25.50.1', 38, 430.92),
        ('55.1.25.51.1', 6, 68.04),
        ('60.1.25.56', 123, 1394.82)
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
            v_elem := (v_packing->0) || jsonb_build_object('sk_4l_qty', rec.kg, 'sk_4l_cartons', rec.cartons);
            v_packing := jsonb_set(v_packing, '{0}', v_elem);
            UPDATE public.kernel
            SET packing_data = v_packing, updated_at = now()
            WHERE id = v_kid;
        END IF;
    END LOOP;
END;
$$;
