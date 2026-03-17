-- Populate kernel stock from sheet images (3/16/2026).
-- Matches batches and assigns cartons/kg to styles: SP, 1s, 4L, 5, 6, 7/8, BHO, BLO.
-- Run via Supabase SQL Editor or MCP apply_migration (user-supabase).

-- Step 1: Ensure all batches exist (kernel type)
INSERT INTO public.batches (batch_id, batch_type, is_active) VALUES
  ('44.2.25.28', 'kernel', true), ('44.2.25.40', 'kernel', true), ('51.1.25.31', 'kernel', true),
  ('54.6.25.37', 'kernel', true), ('55.1.25.38', 'kernel', true), ('55.1.25.43.2', 'kernel', true),
  ('55.1.25.47.1', 'kernel', true), ('55.1.25.47.2', 'kernel', true), ('55.1.25.47.3', 'kernel', true),
  ('55.1.25.50.1', 'kernel', true), ('55.1.25.50.2', 'kernel', true), ('55.1.25.50.3', 'kernel', true),
  ('55.1.25.51.1', 'kernel', true), ('55.1.25.51.2', 'kernel', true), ('55.1.25.51.3', 'kernel', true),
  ('56.1.25.39', 'kernel', true), ('56.1.25.45', 'kernel', true), ('59.1.25.54', 'kernel', true),
  ('7.7.25.32', 'kernel', true), ('23.6.25.46', 'kernel', true), ('32.4.25.44', 'kernel', true),
  ('32.4.25.48', 'kernel', true), ('32.4.25.52', 'kernel', true), ('32.4.25.55', 'kernel', true),
  ('60.1.25.56', 'kernel', true)
ON CONFLICT (batch_id) DO NOTHING;

-- Step 2: Ensure kernel row exists for each batch (idempotent: update or insert)
DO $$
DECLARE v_bid uuid; v_kid uuid; v_packing jsonb; rec record;
BEGIN
  FOR rec IN (
    SELECT batch_num, supplier, bb_date, ffa_pct, pv_val FROM (VALUES
      ('44.2.25.28', 'Agristar Macadamias (Pty) Ltd NutsAll', '2027-02-22'::date, NULL::numeric, NULL::numeric),
      ('44.2.25.40', 'Agristar Macadamias (Pty) Ltd NutsAll', '2027-04-01'::date, NULL::numeric, NULL::numeric),
      ('51.1.25.31', 'Ropa Miller', '2027-03-12'::date, NULL::numeric, NULL::numeric),
      ('54.6.25.37', 'Foster Farming', '2027-02-27'::date, NULL::numeric, NULL::numeric),
      ('55.1.25.38', 'Big 5', '2027-03-18'::date, NULL::numeric, NULL::numeric),
      ('55.1.25.43.2', 'Big 5', '2027-04-16'::date, NULL::numeric, NULL::numeric),
      ('55.1.25.47.1', 'Big 5', '2027-05-13'::date, 0.38, 2.04),
      ('55.1.25.47.2', 'Big 5', '2027-05-17'::date, 0.22, 0.1),
      ('55.1.25.47.3', 'Big 5', '2027-05-19'::date, 0.36, 0.73),
      ('55.1.25.50.1', 'Big 5', '2027-07-08'::date, 0.33, 3.39),
      ('55.1.25.50.2', 'Big 5', '2027-07-13'::date, 0.19, 0.30),
      ('55.1.25.50.3', 'Big 5', '2027-07-19'::date, 0.25, 2.15),
      ('55.1.25.51.1', 'Big 5', '2027-07-08'::date, 0.26, 2.95),
      ('55.1.25.51.2', 'Big 5', '2027-07-23'::date, 0.32, 0.38),
      ('55.1.25.51.3', 'Big 5', '2027-07-28'::date, 0.38, 2.37),
      ('56.1.25.39', 'Mac-Eden Estate', '2027-03-05'::date, NULL::numeric, NULL::numeric),
      ('56.1.25.45', 'Mac Eden Estate', '2027-04-17'::date, NULL::numeric, NULL::numeric),
      ('59.1.25.54', 'Talbot', '2027-08-03'::date, 0.58, 1.07),
      ('7.7.25.32', 'Eucalypt Forestry', '2027-03-15'::date, NULL::numeric, NULL::numeric),
      ('23.6.25.46', 'Fyvie Estates', '2027-05-06'::date, 0.13, 0.10),
      ('32.4.25.44', 'AP Vos & Seuns', '2027-04-24'::date, 0.15, 0.25),
      ('32.4.25.48', 'AP Vos & Seuns', '2027-05-24'::date, 0.35, 0.65),
      ('32.4.25.52', 'AP Vos & Seuns', '2027-08-04'::date, 0.20, 0.10),
      ('32.4.25.55', 'AP Vos & Seuns', '2027-08-02'::date, 0.62, 0.68),
      ('60.1.25.56', 'Breechoost CC', '2027-09-02'::date, 0.64, 0.32)
    ) AS t(batch_num, supplier, bb_date, ffa_pct, pv_val)
  ) LOOP
    SELECT b.id INTO v_bid FROM public.batches b WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-')) LIMIT 1;
    IF v_bid IS NULL THEN CONTINUE; END IF;
    SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k WHERE k.batch_id = v_bid LIMIT 1;
    v_packing := COALESCE(v_packing, '[]'::jsonb);
    IF jsonb_array_length(v_packing) = 0 THEN
      v_packing := jsonb_build_array(jsonb_build_object(
        'date', '2026-03-16', 'sk_sp_qty', 0, 'sk_0_qty', 0, 'sk_1_qty', 0, 'sk_1s_qty', 0, 'sk_4l_qty', 0, 'sk_5_qty', 0, 'sk_6_qty', 0, 'bt_78_qty', 0, 'bt_high_qty', 0, 'bt_low_qty', 0,
        'sk_sp_cartons', 0, 'sk_0_cartons', 0, 'sk_1_cartons', 0, 'sk_1s_cartons', 0, 'sk_4l_cartons', 0, 'sk_5_cartons', 0, 'sk_6_cartons', 0, 'bt_78_cartons', 0, 'bt_high_cartons', 0, 'bt_low_cartons', 0
      ));
    END IF;
    IF v_kid IS NOT NULL THEN
      UPDATE public.kernel SET grower_name = rec.supplier, packing_data = v_packing,
        job_card_data = COALESCE(job_card_data, '{}'::jsonb) || jsonb_build_object('best_before_date', rec.bb_date, 'packing_completion_date', '2026-03-16'),
        qa_data = CASE WHEN rec.ffa_pct IS NOT NULL OR rec.pv_val IS NOT NULL THEN jsonb_build_object('ffa_result', rec.ffa_pct, 'ffa', rec.ffa_pct, 'peroxide', rec.pv_val) ELSE COALESCE(qa_data, '{}'::jsonb) END,
        status = 'complete', is_active = true, updated_at = now() WHERE id = v_kid;
    ELSE
      INSERT INTO public.kernel (batch_id, grower_name, status, packing_data, job_card_data, qa_data, received_date, production_finished_at, jobcard_approved, is_active)
      VALUES (v_bid, rec.supplier, 'complete', v_packing, jsonb_build_object('best_before_date', rec.bb_date, 'packing_completion_date', '2026-03-16'),
        CASE WHEN rec.ffa_pct IS NOT NULL OR rec.pv_val IS NOT NULL THEN jsonb_build_object('ffa_result', rec.ffa_pct, 'ffa', rec.ffa_pct, 'peroxide', rec.pv_val) ELSE '{}'::jsonb END,
        '2026-03-01'::date, now() - interval '30 days', true, true);
    END IF;
  END LOOP;
END;
$$;

-- Step 3: Style 6 (from Style 6 sheet)
DO $$
DECLARE v_kid uuid; v_packing jsonb; v_elem jsonb; rec record;
BEGIN
  FOR rec IN (SELECT * FROM (VALUES
    ('44.2.25.40', 1, 11.34), ('55.1.25.43.2', 3, 34.02), ('32.4.25.44', 55, 623.70), ('23.6.25.46', 51, 578.34),
    ('55.1.25.47.1', 25, 283.50), ('55.1.25.47.2', 17, 192.78), ('55.1.25.47.3', 2, 22.68), ('32.4.25.48', 20, 226.80),
    ('55.1.25.50.2', 7, 79.38), ('55.1.25.51.1', 11, 124.74), ('55.1.25.51.2', 11, 124.74), ('55.1.25.50.3', 8, 90.72),
    ('55.1.25.51.3', 21, 238.14), ('59.1.25.54', 1, 11.34), ('32.4.25.52', 41, 464.94), ('32.4.25.55', 15, 170.10), ('60.1.25.56', 2, 22.68)
  ) AS t(batch_num, cartons, kg)) LOOP
    SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-')) LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
      v_elem := (v_packing->0) || jsonb_build_object('sk_6_qty', rec.kg, 'sk_6_cartons', rec.cartons);
      UPDATE public.kernel SET packing_data = jsonb_set(v_packing, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;
  END LOOP;
END;
$$;

-- Step 4: Style SP
DO $$
DECLARE v_kid uuid; v_packing jsonb; v_elem jsonb; rec record;
BEGIN
  FOR rec IN (SELECT * FROM (VALUES ('55.1.25.51.3', 48, 544.32), ('59.1.25.54', 3, 34.02), ('32.4.25.52', 17, 192.78), ('32.4.25.55', 104, 1179.36), ('60.1.25.56', 11, 124.74)) AS t(batch_num, cartons, kg)) LOOP
    SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-')) LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
      v_elem := (v_packing->0) || jsonb_build_object('sk_sp_qty', rec.kg, 'sk_sp_cartons', rec.cartons);
      UPDATE public.kernel SET packing_data = jsonb_set(v_packing, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;
  END LOOP;
END;
$$;

-- Step 5: Style 1s
DO $$
DECLARE v_kid uuid; v_packing jsonb; v_elem jsonb;
BEGIN
  SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_type = 'kernel' AND (b.batch_id = '60.1.25.56' OR b.batch_id = '60-1-25-56') LIMIT 1;
  IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
    v_elem := (v_packing->0) || jsonb_build_object('sk_1s_qty', 79.38, 'sk_1s_cartons', 7);
    UPDATE public.kernel SET packing_data = jsonb_set(v_packing, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
  END IF;
END;
$$;

-- Step 6: Style 4L
DO $$
DECLARE v_kid uuid; v_packing jsonb; v_elem jsonb; rec record;
BEGIN
  FOR rec IN (SELECT * FROM (VALUES ('32.4.25.55', 31, 351.54), ('60.1.25.56', 122, 1383.48)) AS t(batch_num, cartons, kg)) LOOP
    SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-')) LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
      v_elem := (v_packing->0) || jsonb_build_object('sk_4l_qty', rec.kg, 'sk_4l_cartons', rec.cartons);
      UPDATE public.kernel SET packing_data = jsonb_set(v_packing, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;
  END LOOP;
END;
$$;

-- Step 7: Style 5
DO $$
DECLARE v_kid uuid; v_packing jsonb; v_elem jsonb; rec record;
BEGIN
  FOR rec IN (SELECT * FROM (VALUES ('55.1.25.50.1', 38, 430.92), ('55.1.25.51.1', 6, 68.04), ('60.1.25.56', 123, 1394.82)) AS t(batch_num, cartons, kg)) LOOP
    SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-')) LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
      v_elem := (v_packing->0) || jsonb_build_object('sk_5_qty', rec.kg, 'sk_5_cartons', rec.cartons);
      UPDATE public.kernel SET packing_data = jsonb_set(v_packing, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;
  END LOOP;
END;
$$;

-- Step 8: Style 7/8
DO $$
DECLARE v_kid uuid; v_packing jsonb; v_elem jsonb;
BEGIN
  SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_type = 'kernel' AND (b.batch_id = '32.4.25.55' OR b.batch_id = '32-4-25-55') LIMIT 1;
  IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
    v_elem := (v_packing->0) || jsonb_build_object('bt_78_qty', 136.08, 'bt_78_cartons', 12);
    UPDATE public.kernel SET packing_data = jsonb_set(v_packing, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
  END IF;
END;
$$;

-- Step 9: Butter High Oil (BHO)
DO $$
DECLARE v_kid uuid; v_packing jsonb; v_elem jsonb; rec record;
BEGIN
  FOR rec IN (SELECT * FROM (VALUES ('55.1.25.50.3', 3, 34.02), ('32.4.25.52', 6, 68.04)) AS t(batch_num, cartons, kg)) LOOP
    SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-')) LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
      v_elem := (v_packing->0) || jsonb_build_object('bt_high_qty', rec.kg, 'bt_high_cartons', rec.cartons);
      UPDATE public.kernel SET packing_data = jsonb_set(v_packing, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;
  END LOOP;
END;
$$;

-- Step 10: Butter Low Oil (BLO)
DO $$
DECLARE v_kid uuid; v_packing jsonb; v_elem jsonb; rec record;
BEGIN
  FOR rec IN (SELECT * FROM (VALUES
    ('44.2.25.28', 27, 306.18), ('56.1.25.39', 10, 113.40), ('51.1.25.31', 3, 34.02), ('7.7.25.32', 3, 34.02),
    ('54.6.25.37', 13, 147.42), ('55.1.25.38', 53, 601.02), ('44.2.25.40', 15, 170.10), ('56.1.25.45', 3, 34.02), ('23.6.25.46', 35, 396.90)
  ) AS t(batch_num, cartons, kg)) LOOP
    SELECT k.id, k.packing_data INTO v_kid, v_packing FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id WHERE b.batch_type = 'kernel' AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-')) LIMIT 1;
    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
      v_elem := (v_packing->0) || jsonb_build_object('bt_low_qty', rec.kg, 'bt_low_cartons', rec.cartons);
      UPDATE public.kernel SET packing_data = jsonb_set(v_packing, '{0}', v_elem), updated_at = now() WHERE id = v_kid;
    END IF;
  END LOOP;
END;
$$;
