-- Fix kernel stock on hand to match handwritten log (image).
-- Only values explicitly shown in the log are set; all other style columns set to 0.
-- Log columns: Batch, SP, IS, GL, 5, 6, 7/6, BH, BL. Map: SP→sk_sp_qty, IS→sk_0_qty, GL→sk_1_qty, 5→sk_5_qty, 6→sk_6_qty, 7/6→bt_78_qty, BH→bt_high_qty, BL→bt_low_qty.

DO $$
DECLARE
    v_packing jsonb;
    v_kid uuid;
BEGIN
    -- 44.2.25.40: 6=1, 7/6=15, BL=15
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '44.2.25.40' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 1, 'bt_78_qty', 15, 'bt_high_qty', 0, 'bt_low_qty', 15, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 0, 'bt_78_cartons', 1, 'bt_high_cartons', 0, 'bt_low_cartons', 1));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 55.1.25.45.2: 6=3
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '55.1.25.45.2' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 3, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 0, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 32.4.25.44: 6=55
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '32.4.25.44' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 55, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 5, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 23-6-25.46: 6=51, BL=35
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '23-6-25.46' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 51, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 35, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 4, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 3));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 55.1.25-1: 6=25
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '55.1.25-1' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 25, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 2, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 55.1.25.2: 6=17
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '55.1.25.2' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 17, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 1, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 55.1.25-3: 6=2
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '55.1.25-3' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 2, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 0, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 32.4.25.48: 6=20
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '32.4.25.48' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 20, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 2, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 55.1.25.50.2: 6=7 (arrow in image)
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '55.1.25.50.2' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 7, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 1, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 55.1.25.51.1: 6=11
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '55.1.25.51.1' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 11, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 1, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 53.1.25.50.3: 6=8
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '53.1.25.50.3' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 8, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 1, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 59.1.25.64: SP=3
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '59.1.25.64' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 3, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 0, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 0, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 32.6.25.55: SP=104, 7/6=12, 6=31
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '32.6.25.55' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 104, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 31, 'bt_78_qty', 12, 'bt_high_qty', 0, 'bt_low_qty', 0, 'sk_sp_cartons', 9, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 3, 'bt_78_cartons', 1, 'bt_high_cartons', 0, 'bt_low_cartons', 0));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;

    -- 46.2.25.28: BL=27
    SELECT k.id INTO v_kid FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_id = '46.2.25.28' AND k.status = 'complete' LIMIT 1;
    IF v_kid IS NOT NULL THEN
        v_packing := jsonb_build_array(jsonb_build_object('date', '2026-02-14', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 0, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 27, 'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 0, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 2));
        UPDATE public.kernel SET packing_data = v_packing, updated_at = now() WHERE id = v_kid;
    END IF;
END;
$$;
