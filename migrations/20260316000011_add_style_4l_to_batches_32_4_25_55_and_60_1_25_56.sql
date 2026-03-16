-- Add Style 4L to two batches that did not show: merge sk_4l_cartons and sk_4l_qty into existing packing_data.
-- 32.4.25.55: 31 cartons, 351.54 kg
-- 60.1.25.56: 122 cartons, 1,383.48 kg

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('32.4.25.55', 31, 351.54),
        ('60.1.25.56', 122, 1383.48)
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
