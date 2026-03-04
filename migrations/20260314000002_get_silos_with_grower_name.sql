-- get_silos: return silo status for all 12 silos, including batch_id and grower_name when a kernel is assigned.
-- Used by Kernel Production silo grid and Grower Intake silo picker. When a silo is occupied by kernel, show grower name.
CREATE OR REPLACE FUNCTION public.get_silos()
RETURNS TABLE (
    silo_number integer,
    kernel_id uuid,
    oil_batch_id uuid,
    status text,
    batch_id text,
    grower_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.silo_number::integer,
        s.kernel_id,
        s.oil_batch_id,
        s.status::text,
        b.batch_id::text,
        NULLIF(TRIM(k.grower_name), '')::text AS grower_name
    FROM public.silo s
    LEFT JOIN public.kernel k ON k.id = s.kernel_id AND k.is_active = true
    LEFT JOIN public.batches b ON b.id = k.batch_id
    WHERE s.silo_number >= 1 AND s.silo_number <= 12
    ORDER BY s.silo_number;
$$;

DO $$
DECLARE v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_silos', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
