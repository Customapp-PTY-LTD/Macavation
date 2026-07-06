-- Phase 2 portal: feature registration, default alert rules, oil trends, runway, digest sender helper.

-- ============================================================
-- 1. Oil production trends (daily litres from oil bin batches)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_oil_production_trends_daily(p_days integer DEFAULT 365)
RETURNS TABLE (
    trend_date date,
    oil_litres numeric,
    protein_kg numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
    v_start date := v_today - GREATEST(1, coalesce(p_days, 365)) + 1;
BEGIN
    RETURN QUERY
    WITH dates AS (
        SELECT d::date AS d FROM generate_series(v_start, v_today, interval '1 day') AS d
    ),
    oil_bins AS (
        SELECT
            coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) AS d,
            SUM(coalesce(o.total_oil_litre, 0)) AS litres
        FROM public.oil o
        WHERE o.is_active = true
          AND coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) >= v_start
        GROUP BY 1
    ),
    protein AS (
        SELECT
            coalesce(p.start_date, (p.created_at AT TIME ZONE 'Africa/Johannesburg')::date) AS d,
            SUM(coalesce(p.batch_weight_kg, 0)) AS kg
        FROM public.protein_bin_batch p
        WHERE coalesce(p.start_date, (p.created_at AT TIME ZONE 'Africa/Johannesburg')::date) >= v_start
        GROUP BY 1
    )
    SELECT
        dates.d,
        coalesce(oil_bins.litres, 0)::numeric,
        coalesce(protein.kg, 0)::numeric
    FROM dates
    LEFT JOIN oil_bins ON oil_bins.d = dates.d
    LEFT JOIN protein ON protein.d = dates.d
    ORDER BY dates.d;
END;
$$;

-- Kernel raw material runway: SOH kg vs 4-week average forecast demand (cartons * 11.34).
CREATE OR REPLACE FUNCTION public.get_kernel_runway_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_soh_kg numeric := 0;
    v_weekly_demand_kg numeric := 0;
    v_weeks_cover numeric;
    v_style text;
    v_rem jsonb;
BEGIN
    SELECT coalesce(SUM(
        (SELECT coalesce(SUM((value)::numeric), 0)
         FROM jsonb_each_text(coalesce(k.remaining_by_style, '{}'::jsonb)))
    ), 0) INTO v_soh_kg
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.status IN ('complete', 'in_finished_stock');

    SELECT coalesce(SUM(coalesce(f.quantity_cartons, 0) * 11.34), 0) / 4.0 INTO v_weekly_demand_kg
    FROM public.kernel_production_forecast f
    WHERE f.status IN ('open', 'in_progress')
      AND coalesce(f.due_date, current_date)
            BETWEEN date_trunc('week', current_date)::date
                AND (date_trunc('week', current_date) + interval '4 weeks')::date;

    IF coalesce(v_weekly_demand_kg, 0) > 0 THEN
        v_weeks_cover := round(v_soh_kg / v_weekly_demand_kg, 1);
    ELSE
        v_weeks_cover := NULL;
    END IF;

    RETURN jsonb_build_object(
        'soh_kg', coalesce(v_soh_kg, 0),
        'weekly_demand_kg', coalesce(v_weekly_demand_kg, 0),
        'weeks_cover', v_weeks_cover,
        'months_cover', CASE WHEN v_weeks_cover IS NOT NULL THEN round(v_weeks_cover / 4.33, 1) ELSE NULL END
    );
END;
$$;

-- Mark scheduled report as sent (edge function helper).
CREATE OR REPLACE FUNCTION public.mark_scheduled_report_sent(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.scheduled_reports SET last_sent_at = now(), updated_at = now() WHERE id = p_id;
    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_oil_production_trends_daily(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_runway_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_scheduled_report_sent(uuid) TO service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY['get_oil_production_trends_daily', 'get_kernel_runway_summary'];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- ============================================================
-- 2. Default stock alert rules (Macavation can adjust in admin UI)
-- ============================================================
INSERT INTO public.stock_alert_rules (product_type, style, min_qty, unit, alert_type, severity, is_active)
VALUES
    ('kernel', '0', 500, 'kg', 'stock_low', 'warning', true),
    ('kernel', '1', 500, 'kg', 'stock_low', 'warning', true),
    ('oil', '*', 200, 'kg', 'stock_low', 'warning', true),
    ('protein', '*', 100, 'kg', 'stock_low', 'warning', true),
    ('shell', '*', 0, 'kg', 'stock_low', 'info', true)
ON CONFLICT (product_type, style) DO NOTHING;

-- ============================================================
-- 3. Register Phase 2 admin features
-- ============================================================
INSERT INTO public.features (key, name, description) VALUES
    ('stock-alert-rules-grid', 'Stock Alert Rules', 'Configure red-flag thresholds when stock on hand falls below minimum.'),
    ('scheduled-reports-grid', 'Scheduled Reports', 'Manage daily digest email subscriptions.'),
    ('messaging-compose-grid', 'Send Message', 'Compose in-app notifications to users or roles.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN public.features f
WHERE f.key IN ('stock-alert-rules-grid', 'scheduled-reports-grid', 'messaging-compose-grid')
  AND r.role_name IN ('super_user', 'admin', 'General Manager', 'Production Manager', 'Oil Plant Manager', 'Office Administrator')
ON CONFLICT (role_id, feature_id) DO NOTHING;

-- Additional action keys for Phase 2 permission rollout
INSERT INTO public.actions (key, module, label, description) VALUES
    ('kernel.dispatch.create', 'Kernel Dispatch', 'Create dispatch order', 'Create kernel dispatch orders'),
    ('grower.batch.create', 'Grower Intake', 'Create grower batch', 'Create kernel batches from grower intake'),
    ('oil.batch.create', 'Oil Production', 'Create oil batch', 'Start oil bin batches and production sheets'),
    ('stock.alert_rules.manage', 'Stock', 'Manage alert rules', 'Configure stock red-flag thresholds'),
    ('reports.schedule.manage', 'Reports', 'Manage scheduled reports', 'Configure daily digest subscriptions')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
    v_role_id uuid;
    v_action_id bigint;
    v_role_name text;
BEGIN
    FOREACH v_role_name IN ARRAY ARRAY['super_user', 'admin'] LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_role_name;
        IF v_role_id IS NOT NULL THEN
            FOR v_action_id IN SELECT id FROM public.actions WHERE is_active = true LOOP
                INSERT INTO public.role_actions (role_id, action_id, value)
                VALUES (v_role_id, v_action_id, 'true')
                ON CONFLICT (role_id, action_id) DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
