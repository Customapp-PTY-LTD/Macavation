-- Optional single-arg overloads (e.g. if a proxy omits null keys).
-- Two-arg signature uses p_start_date then p_stream (alphabetical = PostgREST order).

DROP FUNCTION IF EXISTS public.start_oil_bin_batch(date);
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(varchar);

CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(p_start_date date)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.start_oil_bin_batch(p_start_date, NULL::varchar);
$$;

CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(p_stream varchar)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.start_oil_bin_batch(NULL::date, p_stream);
$$;

NOTIFY pgrst, 'reload schema';
