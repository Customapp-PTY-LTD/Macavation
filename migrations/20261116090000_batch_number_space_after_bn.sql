-- Kernel batch numbers in messages read "BN 32.26.03" (space after BN) instead of "BN.32.26.03".
-- Mike, 16 Nov 2026. Display only: the stored value stays 'Bn 32 26 03'.
-- Same rule as macBatchNo.format in WebPortal/js/batch-number-format.js.
CREATE OR REPLACE FUNCTION public._fmt_batch_number(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT regexp_replace(COALESCE(p, ''), '^(?:[Bb][Nn][ .]?)?(\d{2})[ .](\d{2})[ .](\d+)$', 'BN \1.\2.\3'); $$;
