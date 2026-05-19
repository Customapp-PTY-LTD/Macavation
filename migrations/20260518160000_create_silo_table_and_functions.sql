-- Silo grid (1–12) for kernel / oil batch assignment. Missing on Macavation until this migration.

CREATE TABLE IF NOT EXISTS public.silo (
    silo_number integer PRIMARY KEY CHECK (silo_number >= 1 AND silo_number <= 12),
    kernel_id uuid NULL REFERENCES public.kernel(id) ON DELETE SET NULL,
    oil_batch_id uuid NULL,
    status text NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'occupied')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.silo (silo_number, status)
SELECT gs, 'empty'
FROM generate_series(1, 12) AS gs
ON CONFLICT (silo_number) DO NOTHING;

ALTER TABLE public.kernel
ADD COLUMN IF NOT EXISTS silos integer[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.set_silo_empty(p_silo_number integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_silo_number IS NULL OR p_silo_number < 1 OR p_silo_number > 12 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Silo number must be between 1 and 12');
    END IF;
    UPDATE public.silo
    SET kernel_id = NULL, oil_batch_id = NULL, status = 'empty', updated_at = NOW()
    WHERE silo_number = p_silo_number;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- get_silos (from 20260314000002_get_silos_with_grower_name.sql)
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
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'get_silos', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'set_silo_empty', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
