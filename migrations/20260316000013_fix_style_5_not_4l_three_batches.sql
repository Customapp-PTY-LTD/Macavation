-- Correct mistaken Style 4L: those three batches were for Style 5.
-- 55.1.25.51.1: remove wrong 4L (set 0), set Style 5 = 6 cartons, 68.04 kg
-- 60.1.25.56: restore Style 4L to 122 cartons, 1383.48 kg; set Style 5 = 123 cartons, 1394.82 kg
-- 55.1.25.50.1: if batch exists, set Style 5 = 38 cartons, 430.92 kg

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
BEGIN
    -- 55.1.25.51.1: was given 6/68.04 as 4L by mistake → set 4L=0, 5=6 cartons, 68.04 kg
    SELECT k.id, k.packing_data INTO v_kid, v_packing
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE b.batch_type = 'kernel' AND k.is_active = true
      AND (b.batch_id = '55.1.25.51.1' OR b.batch_id = '55-1-25-51-1')
    LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
        v_elem := (v_packing->0) || jsonb_build_object('sk_4l_qty', 0, 'sk_4l_cartons', 0, 'sk_5_qty', 68.04, 'sk_5_cartons', 6);
        UPDATE public.kernel SET packing_data = jsonb_set(packing_data, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;

    -- 60.1.25.56: restore 4L to 122 cartons / 1383.48 kg; set Style 5 = 123 cartons, 1394.82 kg
    SELECT k.id, k.packing_data INTO v_kid, v_packing
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE b.batch_type = 'kernel' AND k.is_active = true
      AND (b.batch_id = '60.1.25.56' OR b.batch_id = '60-1-25-56')
    LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
        v_elem := (v_packing->0) || jsonb_build_object('sk_4l_qty', 1383.48, 'sk_4l_cartons', 122, 'sk_5_qty', 1394.82, 'sk_5_cartons', 123);
        UPDATE public.kernel SET packing_data = jsonb_set(packing_data, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;

    -- 55.1.25.50.1: if batch exists, set Style 5 = 38 cartons, 430.92 kg
    SELECT k.id, k.packing_data INTO v_kid, v_packing
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE b.batch_type = 'kernel' AND k.is_active = true
      AND (b.batch_id = '55.1.25.50.1' OR b.batch_id = '55-1-25-50-1')
    LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
        v_elem := (v_packing->0) || jsonb_build_object('sk_5_qty', 430.92, 'sk_5_cartons', 38);
        UPDATE public.kernel SET packing_data = jsonb_set(packing_data, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;
END;
$$;
