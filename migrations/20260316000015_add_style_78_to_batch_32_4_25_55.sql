-- Add Style 7/8 to batch 32.4.25.55 (AP Vos & Seuns): 12 cartons, 136.08 kg.
-- BB Date 8/2/2027, PV 0.68, FFA 0.62%.

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
BEGIN
    SELECT k.id, k.packing_data INTO v_kid, v_packing
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE b.batch_type = 'kernel' AND k.is_active = true
      AND (b.batch_id = '32.4.25.55' OR b.batch_id = '32-4-25-55')
    LIMIT 1;

    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
        v_elem := (v_packing->0) || jsonb_build_object('bt_78_qty', 136.08, 'bt_78_cartons', 12);
        v_packing := jsonb_set(v_packing, '{0}', v_elem);
        UPDATE public.kernel
        SET packing_data = v_packing, updated_at = now()
        WHERE id = v_kid;
    END IF;
END;
$$;
