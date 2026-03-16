-- Style SP: fill sk_sp_cartons and sk_sp_qty into existing kernel batches only where cartons > 0.
-- Only batches with non-zero Style SP cartons are updated; rows with 0 cartons are left unchanged.
-- All targeted batches already exist; no new batches or kernel rows are created.

DO $$
DECLARE
    v_kid uuid;
    v_packing jsonb;
    v_elem jsonb;
    rec record;
BEGIN
    FOR rec IN (SELECT * FROM (VALUES
        ('55.1.25.51.3', 48, 544.32),
        ('59.1.25.54',    3, 34.02),
        ('32.4.25.52',   17, 192.78),
        ('32.4.25.55',  104, 1179.36),
        ('60.1.25.56',   11, 124.74)
    ) AS t(batch_num, cartons, kg))
    LOOP
        SELECT k.id, k.packing_data INTO v_kid, v_packing
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE b.batch_type = 'kernel'
          AND (b.batch_id = rec.batch_num OR b.batch_id = REPLACE(rec.batch_num, '.', '-'))
          AND k.is_active = true
        LIMIT 1;

        IF v_kid IS NULL OR v_packing IS NULL OR jsonb_array_length(v_packing) = 0 THEN
            CONTINUE;
        END IF;

        v_elem := (v_packing->0) || jsonb_build_object('sk_sp_qty', rec.kg, 'sk_sp_cartons', rec.cartons);
        v_packing := jsonb_set(v_packing, '{0}', v_elem);

        UPDATE public.kernel
        SET packing_data = v_packing, updated_at = now()
        WHERE id = v_kid;
    END LOOP;
END;
$$;
