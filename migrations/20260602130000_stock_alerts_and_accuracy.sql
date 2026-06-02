-- Sprint 2B/2C: Stock red-flag rules engine + stock accuracy snapshots.
--
-- Design: the stock grids already compute SOH per product/style for display.
-- evaluate_stock_alerts() takes those observed quantities as JSON and compares
-- them to configurable rules, raising dashboard alerts on breaches. This avoids
-- duplicating fragile SOH recomputation in SQL and keeps a single source of truth.

-- ============================================================
-- 1. stock_alert_rules — configurable red-flag thresholds
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_alert_rules (
    id BIGSERIAL PRIMARY KEY,
    product_type VARCHAR(40) NOT NULL,          -- e.g. kernel, oil, protein, shell, nis_raw
    style VARCHAR(80) NOT NULL DEFAULT '*',      -- style/grade or '*' for any
    min_qty NUMERIC(18, 3) NOT NULL DEFAULT 0,
    unit VARCHAR(20) NOT NULL DEFAULT 'kg',
    alert_type VARCHAR(40) NOT NULL DEFAULT 'stock_low',
    severity VARCHAR(20) NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_type, style)
);

CREATE INDEX IF NOT EXISTS idx_stock_alert_rules_active ON public.stock_alert_rules (is_active);

REVOKE ALL ON TABLE public.stock_alert_rules FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_alert_rules TO service_role;

CREATE OR REPLACE FUNCTION public.get_stock_alert_rules()
RETURNS SETOF public.stock_alert_rules
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT * FROM public.stock_alert_rules ORDER BY product_type, style;
$$;

CREATE OR REPLACE FUNCTION public.upsert_stock_alert_rule(
    p_id bigint,
    p_product_type text,
    p_style text,
    p_min_qty numeric,
    p_unit text,
    p_alert_type text,
    p_severity text,
    p_is_active boolean
)
RETURNS SETOF public.stock_alert_rules
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_pt text := lower(trim(coalesce(p_product_type, '')));
    v_style text := NULLIF(trim(coalesce(p_style, '')), '');
    v_sev text := lower(trim(coalesce(p_severity, 'warning')));
    v_id bigint;
BEGIN
    IF v_pt = '' THEN RAISE EXCEPTION 'product_type is required'; END IF;
    IF v_sev NOT IN ('info', 'warning', 'critical') THEN v_sev := 'warning'; END IF;
    IF v_style IS NULL THEN v_style := '*'; END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.stock_alert_rules (product_type, style, min_qty, unit, alert_type, severity, is_active)
        VALUES (v_pt, v_style, coalesce(p_min_qty, 0), coalesce(NULLIF(trim(p_unit), ''), 'kg'),
                coalesce(NULLIF(trim(p_alert_type), ''), 'stock_low'), v_sev, coalesce(p_is_active, true))
        ON CONFLICT (product_type, style) DO UPDATE
            SET min_qty = EXCLUDED.min_qty, unit = EXCLUDED.unit, alert_type = EXCLUDED.alert_type,
                severity = EXCLUDED.severity, is_active = EXCLUDED.is_active, updated_at = NOW()
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.stock_alert_rules
        SET product_type = v_pt, style = v_style, min_qty = coalesce(p_min_qty, 0),
            unit = coalesce(NULLIF(trim(p_unit), ''), 'kg'),
            alert_type = coalesce(NULLIF(trim(p_alert_type), ''), 'stock_low'),
            severity = v_sev, is_active = coalesce(p_is_active, true), updated_at = NOW()
        WHERE id = p_id;
        v_id := p_id;
    END IF;
    RETURN QUERY SELECT * FROM public.stock_alert_rules WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_stock_alert_rule(p_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
    DELETE FROM public.stock_alert_rules WHERE id = p_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

-- ============================================================
-- 2. evaluate_stock_alerts(observations) — raise alerts on breaches
--    p_observations: [{ "product_type": "kernel", "style": "0", "qty": 120 }, ...]
--    Dedups: skips a breach if an active alert with the same batch_number key
--    already exists today.
-- ============================================================
CREATE OR REPLACE FUNCTION public.evaluate_stock_alerts(p_observations jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_obs jsonb;
    v_pt text;
    v_style text;
    v_qty numeric;
    v_rule public.stock_alert_rules%ROWTYPE;
    v_key text;
    v_raised int := 0;
    v_checked int := 0;
BEGIN
    IF p_observations IS NULL OR jsonb_typeof(p_observations) <> 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'observations must be a JSON array');
    END IF;

    FOR v_obs IN SELECT * FROM jsonb_array_elements(p_observations)
    LOOP
        v_pt := lower(trim(coalesce(v_obs->>'product_type', '')));
        v_style := NULLIF(trim(coalesce(v_obs->>'style', '')), '');
        v_qty := NULLIF(trim(coalesce(v_obs->>'qty', '')), '')::numeric;
        IF v_pt = '' OR v_qty IS NULL THEN CONTINUE; END IF;
        v_checked := v_checked + 1;

        -- Most specific rule (exact style) wins over wildcard.
        SELECT * INTO v_rule FROM public.stock_alert_rules r
        WHERE r.is_active = true AND r.product_type = v_pt
          AND (r.style = v_style OR r.style = '*')
        ORDER BY (r.style = '*') ASC
        LIMIT 1;

        IF NOT FOUND THEN CONTINUE; END IF;

        IF v_qty <= v_rule.min_qty THEN
            v_key := 'STKRULE-' || v_pt || '-' || coalesce(v_style, 'all') || '-' || to_char(current_date, 'YYYYMMDD');
            IF NOT EXISTS (
                SELECT 1 FROM public.dashboard_alerts
                WHERE batch_number = v_key AND status = 'active'
            ) THEN
                PERFORM public.create_dashboard_alert_simple(
                    'Low stock: ' || initcap(v_pt) || coalesce(' ' || v_style, ''),
                    'On hand ' || v_qty || ' ' || v_rule.unit || ' is at or below the minimum of ' || v_rule.min_qty || ' ' || v_rule.unit || '.',
                    v_key,
                    v_rule.alert_type,
                    v_rule.severity
                );
                v_raised := v_raised + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'checked', v_checked, 'raised', v_raised);
END;
$$;

-- ============================================================
-- 3. stock_accuracy_snapshot — monthly SOH vs adjustments (live metric)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_accuracy_snapshot (
    id BIGSERIAL PRIMARY KEY,
    snapshot_month DATE NOT NULL,            -- first day of month
    product_type VARCHAR(40) NOT NULL DEFAULT 'all',
    total_soh NUMERIC(18, 3) NOT NULL DEFAULT 0,
    adjusted_qty NUMERIC(18, 3) NOT NULL DEFAULT 0,
    adjustment_events INTEGER NOT NULL DEFAULT 0,
    pct_adjusted NUMERIC(7, 3) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (snapshot_month, product_type)
);

REVOKE ALL ON TABLE public.stock_accuracy_snapshot FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_accuracy_snapshot TO service_role;

CREATE OR REPLACE FUNCTION public.capture_stock_accuracy_snapshot(
    p_month date,
    p_product_type text,
    p_total_soh numeric,
    p_adjusted_qty numeric,
    p_adjustment_events integer
)
RETURNS SETOF public.stock_accuracy_snapshot
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
    v_pt text := lower(trim(coalesce(p_product_type, 'all')));
    v_total numeric := coalesce(p_total_soh, 0);
    v_adj numeric := abs(coalesce(p_adjusted_qty, 0));
    v_pct numeric := CASE WHEN coalesce(p_total_soh, 0) > 0 THEN round((abs(coalesce(p_adjusted_qty, 0)) / p_total_soh) * 100, 3) ELSE 0 END;
    v_id bigint;
BEGIN
    INSERT INTO public.stock_accuracy_snapshot (snapshot_month, product_type, total_soh, adjusted_qty, adjustment_events, pct_adjusted)
    VALUES (v_month, v_pt, v_total, v_adj, coalesce(p_adjustment_events, 0), v_pct)
    ON CONFLICT (snapshot_month, product_type) DO UPDATE
        SET total_soh = EXCLUDED.total_soh, adjusted_qty = EXCLUDED.adjusted_qty,
            adjustment_events = EXCLUDED.adjustment_events, pct_adjusted = EXCLUDED.pct_adjusted, updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN QUERY SELECT * FROM public.stock_accuracy_snapshot WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_stock_accuracy(p_months integer DEFAULT 6)
RETURNS SETOF public.stock_accuracy_snapshot
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT *
    FROM public.stock_accuracy_snapshot
    WHERE snapshot_month >= date_trunc('month', current_date) - (GREATEST(1, p_months) || ' months')::interval
    ORDER BY snapshot_month DESC, product_type;
$$;

-- ============================================================
-- 4. Grants + RBAC
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_stock_alert_rules() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_stock_alert_rule(bigint, text, text, numeric, text, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_stock_alert_rule(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_stock_alerts(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_stock_accuracy_snapshot(date, text, numeric, numeric, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_stock_accuracy(integer) TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'get_stock_alert_rules', 'upsert_stock_alert_rule', 'delete_stock_alert_rule',
        'evaluate_stock_alerts', 'capture_stock_accuracy_snapshot', 'get_stock_accuracy'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

COMMENT ON TABLE public.stock_alert_rules IS 'Configurable stock red-flag thresholds per product/style.';
COMMENT ON TABLE public.stock_accuracy_snapshot IS 'Monthly SOH vs adjustment snapshots for the live stock accuracy metric.';

NOTIFY pgrst, 'reload schema';
