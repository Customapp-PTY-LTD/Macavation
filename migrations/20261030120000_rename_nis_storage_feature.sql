-- Rename the "NIS storage & silos" feature to "Silos & storage" (Silos is now the first tab the
-- menu opens). Only the Role Features label changes; the key 'nis-storage' and every grant stay.
UPDATE public.features
   SET name = 'Silos & storage',
       description = 'Silo allocation and cracking, plus nut in shell by storage area and moves between areas',
       updated_at = now()
 WHERE key = 'nis-storage';

DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.features WHERE key = 'nis-storage' AND name = 'Silos & storage') THEN
        RAISE EXCEPTION 'nis-storage feature missing or not renamed';
    END IF;
END $do$;
