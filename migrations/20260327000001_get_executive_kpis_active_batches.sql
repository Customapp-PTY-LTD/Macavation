-- Executive KPIs: active_batches = count of active kernel batches (matches Kernel Production grid / dashboard).
-- Fixes "Active Batches" card showing 0 when kernel batches exist.

DROP FUNCTION IF EXISTS public.get_executive_kpis();

CREATE OR REPLACE FUNCTION public.get_executive_kpis()
RETURNS TABLE (
    total_production_kg numeric,
    active_batches bigint,
    total_sales numeric,
    quality_pass_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_active_batches bigint;
    v_total_production numeric := 0;
    v_total_sales numeric := 0;
    v_quality_pass_rate numeric := 0;
BEGIN
    -- Active batches = all active kernel batches (same as Kernel Production grid and dashboard "Kernel batches in production").
    SELECT count(*)::bigint INTO v_active_batches
    FROM public.kernel k
    WHERE k.is_active = true;

    -- Placeholders for other KPIs (can be wired to real data later).
    -- total_production_kg, total_sales, quality_pass_rate left at 0 if no other source.

    RETURN QUERY SELECT v_total_production, v_active_batches, v_total_sales, v_quality_pass_rate;
END;
$$;

COMMENT ON FUNCTION public.get_executive_kpis() IS 'Executive dashboard KPIs. active_batches = active kernel count (matches Kernel Production).';

-- RBAC
DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'get_executive_kpis', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
