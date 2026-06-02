-- Sprint 2A: Aggregation RPCs that feed the dashboard forecast charts.
--   get_kernel_production_forecast_by_week — open kernel demand (cartons) by ISO week.
--   get_procurement_forecast_by_week       — scheduled grower intake (kg) by ISO week.
-- WebPortal: dataFunctions.getKernelForecastByWeek() / getProcurementForecastByWeek().

-- Open kernel FG demand grouped by the week the order is due.
CREATE OR REPLACE FUNCTION public.get_kernel_production_forecast_by_week(p_weeks integer DEFAULT 12)
RETURNS TABLE (
    week_start date,
    style_code text,
    quantity_cartons numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        date_trunc('week', COALESCE(f.due_date, current_date))::date AS week_start,
        f.style_code,
        SUM(f.quantity_cartons)::numeric AS quantity_cartons
    FROM public.kernel_production_forecast f
    WHERE f.status IN ('open', 'in_progress')
      AND COALESCE(f.due_date, current_date)
            BETWEEN date_trunc('week', current_date)::date
                AND (date_trunc('week', current_date) + (GREATEST(1, p_weeks) || ' weeks')::interval)::date
    GROUP BY 1, 2
    ORDER BY 1, 2;
$$;

-- Scheduled grower deliveries grouped by week.
CREATE OR REPLACE FUNCTION public.get_procurement_forecast_by_week(p_weeks integer DEFAULT 12)
RETURNS TABLE (
    week_start date,
    predicted_weight_kg numeric,
    delivery_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        date_trunc('week', p.scheduled_date)::date AS week_start,
        SUM(p.predicted_weight_kg)::numeric AS predicted_weight_kg,
        count(*)::bigint AS delivery_count
    FROM public.kernel_intake_procurement p
    WHERE p.status = 'scheduled'
      AND p.scheduled_date
            BETWEEN date_trunc('week', current_date)::date
                AND (date_trunc('week', current_date) + (GREATEST(1, p_weeks) || ' weeks')::interval)::date
    GROUP BY 1
    ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_kernel_production_forecast_by_week(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_procurement_forecast_by_week(integer) TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY['get_kernel_production_forecast_by_week', 'get_procurement_forecast_by_week'];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
