-- Add Style 1s to batch 60.1.25.56 (Breechoost CC): 7 cartons, 79.38 kg.
-- Merge into existing packing_data first element; leave other styles unchanged.

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
BEGIN
    SELECT k.id, k.packing_data INTO v_kid, v_packing
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE b.batch_type = 'kernel'
      AND (b.batch_id = '60.1.25.56' OR b.batch_id = '60-1-25-56')
      AND k.is_active = true
    LIMIT 1;

    IF v_kid IS NOT NULL AND v_packing IS NOT NULL AND jsonb_array_length(v_packing) > 0 THEN
        v_elem := (v_packing->0) || jsonb_build_object('sk_1s_qty', 79.38, 'sk_1s_cartons', 7);
        v_packing := jsonb_set(v_packing, '{0}', v_elem);
        UPDATE public.kernel
        SET packing_data = v_packing, updated_at = now()
        WHERE id = v_kid;
    END IF;
END;
$$;
