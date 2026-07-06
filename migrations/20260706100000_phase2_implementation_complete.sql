-- Phase 2 implementation: alerts resolve/clear, extended KPIs, digest enrichment,
-- mass balance NIS, procurement variance, shell automation, oil import, permissions,
-- messaging link_params, WhatsApp phone on scheduled_reports.

-- ============================================================
-- 1. dashboard_alerts — resolve workflow
-- ============================================================
ALTER TABLE public.dashboard_alerts
    ADD COLUMN IF NOT EXISTS resolved_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS resolved_note text NULL;

CREATE OR REPLACE FUNCTION public.resolve_dashboard_alert(
    p_alert_id uuid,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_rows integer;
BEGIN
    UPDATE public.dashboard_alerts
    SET status = 'resolved',
        resolved_at = now(),
        resolved_note = NULLIF(trim(coalesce(p_note, '')), '')
    WHERE id = p_alert_id AND status = 'active';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Alert not found or already resolved');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Auto-clear stock rule alerts when stock recovers above threshold.
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
    v_cleared int := 0;
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

        SELECT * INTO v_rule FROM public.stock_alert_rules r
        WHERE r.is_active = true AND r.product_type = v_pt
          AND (r.style = v_style OR r.style = '*')
        ORDER BY (r.style = '*') ASC
        LIMIT 1;

        IF NOT FOUND THEN CONTINUE; END IF;

        v_key := 'STKRULE-' || v_pt || '-' || coalesce(v_style, 'all') || '-' || to_char(current_date, 'YYYYMMDD');

        IF v_qty <= v_rule.min_qty THEN
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
        ELSE
            UPDATE public.dashboard_alerts
            SET status = 'resolved', resolved_at = now(), resolved_note = 'Auto-cleared: stock recovered above threshold'
            WHERE batch_number = v_key AND status = 'active';
            IF FOUND THEN v_cleared := v_cleared + 1; END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'checked', v_checked, 'raised', v_raised, 'cleared', v_cleared);
END;
$$;

-- ============================================================
-- 2. Extended executive KPIs (recovery, yield, SOH, deltas)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_phase2_extended_kpis()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_nis_in numeric := 0;
    v_sound_out numeric := 0;
    v_recovery_pct numeric := 0;
    v_oil_litres numeric := 0;
    v_rm_kg numeric := 0;
    v_oil_yield_pct numeric := 0;
    v_kernel_soh numeric := 0;
    v_oil_soh numeric := 0;
    v_rm_soh numeric := 0;
    v_prod_this_month numeric := 0;
    v_prod_last_month numeric := 0;
    v_month_start date := date_trunc('month', current_date)::date;
    v_last_month_start date := (date_trunc('month', current_date) - interval '1 month')::date;
BEGIN
    SELECT coalesce(SUM(coalesce(k.wet_nis_received_kg, 0)), 0) INTO v_nis_in
    FROM public.kernel k
    WHERE k.is_active = true
      AND k.received_date >= v_last_month_start
      AND k.received_date < v_month_start + interval '1 month';

    SELECT coalesce(SUM(
        coalesce(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric, 0)
    ), 0) INTO v_sound_out
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true AND elem ? 'date';

    IF v_nis_in > 0 THEN v_recovery_pct := round((v_sound_out / v_nis_in) * 100, 2); END IF;

    SELECT coalesce(SUM(coalesce(o.total_oil_litre, 0)), 0) INTO v_oil_litres
    FROM public.oil o
    WHERE o.is_active = true
      AND coalesce(o.production_date, (o.created_at AT TIME ZONE 'Africa/Johannesburg')::date) >= v_last_month_start;

    SELECT coalesce(SUM(coalesce(l.kilograms, 0)), 0) INTO v_rm_kg
    FROM public.oil_stock_lots l
    WHERE lower(coalesce(l.stock_category, '')) = 'raw_material';

    IF v_rm_kg > 0 THEN v_oil_yield_pct := round((v_oil_litres / v_rm_kg) * 100, 2); END IF;

    SELECT coalesce(SUM(
        (SELECT coalesce(SUM((value)::numeric), 0) FROM jsonb_each_text(coalesce(k.remaining_by_style, '{}'::jsonb)))
    ), 0) INTO v_kernel_soh
    FROM public.kernel k WHERE k.is_active = true AND k.status IN ('complete', 'in_finished_stock');

    SELECT coalesce(SUM(coalesce(l.kilograms, 0)), 0) INTO v_oil_soh
    FROM public.oil_stock_lots l
    WHERE lower(coalesce(l.stock_category, '')) = 'finished_good'
      AND lower(coalesce(l.status, '')) IN ('on_hand', 'hold', 'in_stock');

    SELECT coalesce(SUM(coalesce(l.kilograms, 0)), 0) INTO v_rm_soh
    FROM public.oil_stock_lots l
    WHERE lower(coalesce(l.stock_category, '')) = 'raw_material';

    SELECT coalesce(SUM(
        coalesce(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric, 0)
    ), 0) INTO v_prod_this_month
    FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true AND (elem->>'date')::date >= v_month_start;

    SELECT coalesce(SUM(
        coalesce(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, NULLIF(TRIM(elem->>'sk_total_qty'), '')::numeric, 0)
    ), 0) INTO v_prod_last_month
    FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND (elem->>'date')::date >= v_last_month_start
      AND (elem->>'date')::date < v_month_start;

    RETURN jsonb_build_object(
        'sound_kernel_recovery_pct', v_recovery_pct,
        'oil_yield_pct', v_oil_yield_pct,
        'kernel_soh_kg', v_kernel_soh,
        'oil_finished_soh_kg', v_oil_soh,
        'oil_rm_soh_kg', v_rm_soh,
        'production_kg_this_month', v_prod_this_month,
        'production_kg_last_month', v_prod_last_month,
        'production_delta_pct', CASE WHEN v_prod_last_month > 0
            THEN round(((v_prod_this_month - v_prod_last_month) / v_prod_last_month) * 100, 1) ELSE NULL END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_oil_forecast_by_week(p_weeks integer DEFAULT 12)
RETURNS TABLE (week_start date, stream_code text, quantity_kg numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        date_trunc('week', COALESCE(f.due_date, current_date))::date,
        f.stream_code,
        SUM(f.quantity_kg)::numeric
    FROM public.oil_production_forecast f
    WHERE f.status IN ('open', 'in_progress')
      AND COALESCE(f.due_date, current_date)
            BETWEEN date_trunc('week', current_date)::date
                AND (date_trunc('week', current_date) + (GREATEST(1, p_weeks) || ' weeks')::interval)::date
    GROUP BY 1, 2
    ORDER BY 1, 2;
$$;

CREATE OR REPLACE FUNCTION public.get_consolidated_batch_dashboard_summary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'open_count', count(*) FILTER (WHERE status = 'open'),
        'total_litres_open', coalesce(SUM(total_oil_litre) FILTER (WHERE status = 'open'), 0),
        'with_lab_ref', count(*) FILTER (WHERE lab_test_doc_ref IS NOT NULL AND trim(lab_test_doc_ref) <> ''),
        'recent', coalesce(jsonb_agg(
            jsonb_build_object(
                'consolidated_number', consolidated_number,
                'status', status,
                'total_oil_litre', total_oil_litre,
                'lab_test_doc_ref', lab_test_doc_ref
            ) ORDER BY created_at DESC
        ) FILTER (WHERE status IN ('open', 'closed')), '[]'::jsonb)
    )
    FROM (
        SELECT * FROM public.oil_consolidated_batch
        ORDER BY created_at DESC
        LIMIT 10
    ) sub;
$$;

-- ============================================================
-- 3. Enriched daily digest
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_kernel jsonb;
    v_alerts jsonb;
    v_procurement jsonb;
    v_oil jsonb;
    v_runway jsonb;
    v_extended jsonb;
    v_target jsonb;
    v_actual numeric;
    v_target_val numeric;
BEGIN
    SELECT to_jsonb(s) INTO v_kernel FROM public.get_dashboard_kernel_stats() s;
    SELECT public.get_kernel_runway_summary() INTO v_runway;
    SELECT public.get_phase2_extended_kpis() INTO v_extended;

    SELECT jsonb_agg(x) INTO v_alerts FROM (
        SELECT jsonb_build_object(
            'id', a.id, 'title', a.alert_title, 'severity', a.severity,
            'type', a.alert_type, 'created_at', a.created_at
        ) AS x
        FROM public.dashboard_alerts a
        WHERE a.status = 'active'
        ORDER BY a.created_at DESC
        LIMIT 25
    ) sub;

    SELECT jsonb_build_object(
        'deliveries_today', count(*),
        'predicted_kg_today', COALESCE(SUM(predicted_weight_kg), 0)
    ) INTO v_procurement
    FROM public.kernel_intake_procurement
    WHERE status = 'scheduled' AND scheduled_date = current_date;

    SELECT jsonb_build_object(
        'litres_today', coalesce(SUM(total_oil_litre) FILTER (
            WHERE coalesce(production_date, (created_at AT TIME ZONE 'Africa/Johannesburg')::date) = current_date
        ), 0),
        'litres_week', coalesce(SUM(total_oil_litre) FILTER (
            WHERE coalesce(production_date, (created_at AT TIME ZONE 'Africa/Johannesburg')::date)
                >= date_trunc('week', current_date)::date
        ), 0)
    ) INTO v_oil
    FROM public.oil WHERE is_active = true;

    SELECT target_value INTO v_target_val FROM public.dashboard_targets
    WHERE metric_key = 'total_production_kg' AND is_active = true
    ORDER BY updated_at DESC LIMIT 1;

    v_actual := coalesce((v_extended->>'production_kg_this_month')::numeric, 0);

    RETURN jsonb_build_object(
        'generated_at', now(),
        'date', current_date,
        'kernel_stats', COALESCE(v_kernel, '{}'::jsonb),
        'oil_stats', COALESCE(v_oil, '{}'::jsonb),
        'open_alerts', COALESCE(v_alerts, '[]'::jsonb),
        'procurement_today', COALESCE(v_procurement, '{}'::jsonb),
        'runway', COALESCE(v_runway, '{}'::jsonb),
        'extended_kpis', COALESCE(v_extended, '{}'::jsonb),
        'produced_vs_target', jsonb_build_object(
            'actual_kg', v_actual,
            'target_kg', v_target_val,
            'variance_kg', CASE WHEN v_target_val IS NOT NULL THEN v_actual - v_target_val ELSE NULL END
        )
    );
END;
$$;

-- ============================================================
-- 4. Mass balance with NIS + procurement variance
-- ============================================================
DROP FUNCTION IF EXISTS public.get_kernel_mass_balance(date, date);

CREATE OR REPLACE FUNCTION public.get_kernel_mass_balance(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
    nis_in_kg numeric,
    cracked_kg numeric,
    packed_kg numeric,
    balance_kg numeric,
    balance_pct numeric,
    procurement_scheduled_kg numeric,
    procurement_received_kg numeric,
    procurement_variance_kg numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from date := COALESCE(p_from, current_date - interval '30 days');
    v_to date := COALESCE(p_to, current_date);
    v_cracked numeric;
    v_packed numeric;
    v_nis numeric;
    v_proc_sched numeric;
    v_proc_recv numeric;
BEGIN
    SELECT coalesce(SUM(coalesce(k.wet_nis_received_kg, 0)), 0) INTO v_nis
    FROM public.kernel k
    WHERE k.is_active = true AND k.received_date BETWEEN v_from AND v_to;

    SELECT coalesce(SUM(
        COALESCE(NULLIF(TRIM(elem->>'totalqty'), '')::numeric, NULLIF(TRIM(elem->>'total_qty'), '')::numeric, 0)
    ), 0) INTO v_cracked
    FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true AND k.received_date BETWEEN v_from AND v_to;

    SELECT coalesce(SUM(
        COALESCE(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, 0)
    ), 0) INTO v_packed
    FROM public.kernel k, jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true AND k.received_date BETWEEN v_from AND v_to;

    SELECT coalesce(SUM(predicted_weight_kg), 0) INTO v_proc_sched
    FROM public.kernel_intake_procurement
    WHERE status IN ('scheduled', 'converted') AND scheduled_date BETWEEN v_from AND v_to;

    SELECT coalesce(SUM(coalesce(k.wet_nis_received_kg, 0)), 0) INTO v_proc_recv
    FROM public.kernel k
    JOIN public.kernel_intake_procurement p ON p.batch_id = k.batch_id AND p.status = 'converted'
    WHERE k.is_active = true AND p.scheduled_date BETWEEN v_from AND v_to;

    RETURN QUERY SELECT
        v_nis, v_cracked, v_packed, (v_cracked - v_packed),
        CASE WHEN v_cracked > 0 THEN round((v_packed / v_cracked) * 100, 2) ELSE 0 END,
        v_proc_sched, v_proc_recv, (v_proc_recv - v_proc_sched);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_procurement_week_summary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH bounds AS (
        SELECT date_trunc('week', current_date)::date AS w_start,
               (date_trunc('week', current_date) + interval '6 days')::date AS w_end
    )
    SELECT jsonb_build_object(
        'week_start', (SELECT w_start FROM bounds),
        'planned_kg', coalesce((
            SELECT SUM(predicted_weight_kg) FROM public.kernel_intake_procurement p, bounds b
            WHERE p.scheduled_date BETWEEN b.w_start AND b.w_end AND p.status <> 'cancelled'
        ), 0),
        'received_kg', coalesce((
            SELECT SUM(coalesce(k.wet_nis_received_kg, 0))
            FROM public.kernel k, bounds b
            WHERE k.is_active = true AND k.received_date BETWEEN b.w_start AND b.w_end
        ), 0),
        'deliveries_scheduled', coalesce((
            SELECT count(*) FROM public.kernel_intake_procurement p, bounds b
            WHERE p.scheduled_date BETWEEN b.w_start AND b.w_end AND p.status = 'scheduled'
        ), 0)
    );
$$;

-- Bulk import procurement rows
CREATE OR REPLACE FUNCTION public.import_kernel_intake_procurement_row(
    p_scheduled_date date,
    p_grower_name text,
    p_predicted_weight_kg numeric,
    p_supplier_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
    IF p_scheduled_date IS NULL OR trim(coalesce(p_grower_name, '')) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'scheduled_date and grower_name required');
    END IF;
    INSERT INTO public.kernel_intake_procurement (scheduled_date, grower_name, predicted_weight_kg, supplier_id, status)
    VALUES (p_scheduled_date, trim(p_grower_name), coalesce(p_predicted_weight_kg, 0), p_supplier_id, 'scheduled')
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- ============================================================
-- 5. Shell waste automation + movements
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shell_stock_movement (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id uuid NOT NULL REFERENCES public.shell_stock_lot(id) ON DELETE CASCADE,
    movement_type text NOT NULL CHECK (movement_type IN ('created', 'adjusted', 'dispatched', 'written_off')),
    quantity_kg numeric NOT NULL DEFAULT 0,
    reference text NULL,
    notes text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shell_stock_movement_lot ON public.shell_stock_movement (lot_id);

REVOKE ALL ON TABLE public.shell_stock_movement FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.shell_stock_movement TO service_role;

CREATE OR REPLACE FUNCTION public.auto_create_shell_lot_from_production(
    p_batch_number text,
    p_shell_kg numeric,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_lot_id uuid;
    v_lot_num text;
    v_existing uuid;
BEGIN
    IF coalesce(p_shell_kg, 0) <= 0 THEN
        RETURN jsonb_build_object('success', false, 'skipped', true, 'reason', 'zero shell kg');
    END IF;

    SELECT id INTO v_existing FROM public.shell_stock_lot
    WHERE source_batch_number = trim(p_batch_number) AND status = 'in_stock'
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        UPDATE public.shell_stock_lot
        SET quantity_kg = quantity_kg + p_shell_kg, updated_at = now()
        WHERE id = v_existing;
        INSERT INTO public.shell_stock_movement (lot_id, movement_type, quantity_kg, reference, notes)
        VALUES (v_existing, 'adjusted', p_shell_kg, p_batch_number, coalesce(p_notes, 'Production stage shell total'));
        RETURN jsonb_build_object('success', true, 'id', v_existing, 'updated', true);
    END IF;

    v_lot_num := 'SHELL-' || regexp_replace(trim(coalesce(p_batch_number, 'UNK')), '[^A-Za-z0-9-]', '', 'g');
    INSERT INTO public.shell_stock_lot (lot_number, source_batch_number, quantity_kg, status, notes)
    VALUES (v_lot_num, trim(p_batch_number), p_shell_kg, 'in_stock', p_notes)
    RETURNING id INTO v_lot_id;

    INSERT INTO public.shell_stock_movement (lot_id, movement_type, quantity_kg, reference, notes)
    VALUES (v_lot_id, 'created', p_shell_kg, p_batch_number, 'Auto-created from production');

    RETURN jsonb_build_object('success', true, 'id', v_lot_id, 'lot_number', v_lot_num);
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_shell_stock_lot(
    p_lot_id uuid,
    p_customer_ref text DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_qty numeric;
BEGIN
    SELECT quantity_kg INTO v_qty FROM public.shell_stock_lot WHERE id = p_lot_id AND status = 'in_stock';
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Lot not found or not in stock'); END IF;

    UPDATE public.shell_stock_lot
    SET status = 'dispatched', notes = coalesce(NULLIF(trim(p_notes), ''), notes), updated_at = now()
    WHERE id = p_lot_id;

    INSERT INTO public.shell_stock_movement (lot_id, movement_type, quantity_kg, reference, notes)
    VALUES (p_lot_id, 'dispatched', v_qty, NULLIF(trim(coalesce(p_customer_ref, '')), ''), p_notes);

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shell_stock_movements(p_lot_id uuid)
RETURNS SETOF public.shell_stock_movement
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT * FROM public.shell_stock_movement WHERE lot_id = p_lot_id ORDER BY created_at;
$$;

-- ============================================================
-- 6. Oil historical import
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_historical_oil_stock_lot(
    p_lot_number text,
    p_product_type text DEFAULT 'oil',
    p_quantity numeric DEFAULT 0,
    p_as_at_date date DEFAULT NULL,
    p_location text DEFAULT NULL,
    p_batch_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
    v_cat text;
    v_loc text;
    v_batch text;
BEGIN
    v_batch := coalesce(NULLIF(trim(coalesce(p_batch_number, p_lot_number, '')), ''), 'HIST-' || to_char(now(), 'YYYYMMDDHH24MISS'));
    IF v_batch = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'lot_number or batch_number required');
    END IF;

    IF EXISTS (SELECT 1 FROM public.oil_stock_lots WHERE batch_number = v_batch AND notes LIKE 'Historical import%') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Duplicate batch_number');
    END IF;

    v_cat := CASE lower(trim(coalesce(p_product_type, 'oil')))
        WHEN 'protein' THEN 'finished_good'
        WHEN 'raw_material' THEN 'raw_material'
        WHEN 'rm' THEN 'raw_material'
        ELSE 'finished_good'
    END;
    v_loc := coalesce(NULLIF(trim(coalesce(p_location, '')), ''), '801');

    INSERT INTO public.oil_stock_lots (
        location_code, batch_number, kilograms, status, stock_category, notes, delivery_date
    )
    VALUES (
        v_loc, v_batch, coalesce(p_quantity, 0), 'on_hand', v_cat,
        'Historical import ' || coalesce(p_as_at_date::text, current_date::text),
        coalesce(p_as_at_date, current_date)
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id, 'batch_number', v_batch);
END;
$$;

-- ============================================================
-- 7. Messaging link_params + scheduled_reports phone
-- ============================================================
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS link_params jsonb NULL;

ALTER TABLE public.scheduled_reports
    ADD COLUMN IF NOT EXISTS phone text NULL;

CREATE OR REPLACE FUNCTION public.create_notification(
    p_title text,
    p_body text DEFAULT NULL,
    p_type text DEFAULT 'info',
    p_severity text DEFAULT 'info',
    p_link_route text DEFAULT NULL,
    p_target_user_id uuid DEFAULT NULL,
    p_target_role_id uuid DEFAULT NULL,
    p_created_by uuid DEFAULT NULL,
    p_link_params jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
    v_sev text := lower(trim(coalesce(p_severity, 'info')));
BEGIN
    IF p_title IS NULL OR trim(p_title) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'title is required');
    END IF;
    IF v_sev NOT IN ('info', 'warning', 'critical') THEN v_sev := 'info'; END IF;

    INSERT INTO public.notifications (title, body, notification_type, severity, link_route, link_params, target_user_id, target_role_id, created_by)
    VALUES (trim(p_title), p_body, coalesce(NULLIF(trim(p_type), ''), 'info'), v_sev,
            NULLIF(trim(coalesce(p_link_route, '')), ''), p_link_params,
            p_target_user_id, p_target_role_id, p_created_by)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

DROP FUNCTION IF EXISTS public.get_my_notifications(uuid, uuid, integer);
CREATE OR REPLACE FUNCTION public.get_my_notifications(
    p_user_id uuid,
    p_role_id uuid DEFAULT NULL,
    p_limit integer DEFAULT 50
)
RETURNS TABLE (
    id uuid, title text, body text, notification_type varchar, severity varchar,
    link_route text, link_params jsonb, created_at timestamptz, is_read boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT n.id, n.title, n.body, n.notification_type, n.severity, n.link_route, n.link_params, n.created_at,
           (r.id IS NOT NULL) AS is_read
    FROM public.notifications n
    LEFT JOIN public.notification_reads r ON r.notification_id = n.id AND r.user_id = p_user_id
    WHERE n.target_user_id = p_user_id
       OR (p_role_id IS NOT NULL AND n.target_role_id = p_role_id)
       OR (n.target_user_id IS NULL AND n.target_role_id IS NULL)
    ORDER BY n.created_at DESC
    LIMIT GREATEST(1, p_limit);
$$;

DROP FUNCTION IF EXISTS public.upsert_scheduled_report(uuid, uuid, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.create_notification(text, text, text, text, text, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.upsert_scheduled_report(
    p_id uuid,
    p_user_id uuid,
    p_email text,
    p_report_type text,
    p_channel text,
    p_is_active boolean,
    p_phone text DEFAULT NULL
)
RETURNS SETOF public.scheduled_reports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_channel text := lower(trim(coalesce(p_channel, 'email')));
    v_id uuid;
BEGIN
    IF v_channel NOT IN ('email', 'whatsapp') THEN v_channel := 'email'; END IF;
    IF p_id IS NULL THEN
        INSERT INTO public.scheduled_reports (user_id, email, phone, report_type, channel, is_active)
        VALUES (p_user_id, NULLIF(trim(coalesce(p_email, '')), ''), NULLIF(trim(coalesce(p_phone, '')), ''),
                coalesce(NULLIF(trim(p_report_type), ''), 'daily_digest'), v_channel, coalesce(p_is_active, true))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.scheduled_reports
        SET user_id = p_user_id,
            email = NULLIF(trim(coalesce(p_email, '')), ''),
            phone = NULLIF(trim(coalesce(p_phone, '')), ''),
            report_type = coalesce(NULLIF(trim(p_report_type), ''), 'daily_digest'),
            channel = v_channel,
            is_active = coalesce(p_is_active, true),
            updated_at = now()
        WHERE id = p_id;
        v_id := p_id;
    END IF;
    RETURN QUERY SELECT * FROM public.scheduled_reports WHERE id = v_id;
END;
$$;

-- Oil search index
CREATE INDEX IF NOT EXISTS idx_oil_batch_id_search ON public.oil (batch_id);
CREATE INDEX IF NOT EXISTS idx_oil_production_date ON public.oil (production_date DESC NULLS LAST);

-- ============================================================
-- 8. Additional action keys (Phase 2 permissions rollout)
-- ============================================================
INSERT INTO public.actions (key, module, label, description) VALUES
    ('kernel.dispatch.create', 'Kernel Dispatch', 'Create dispatch order', 'Create kernel dispatch orders'),
    ('kernel.dispatch.edit', 'Kernel Dispatch', 'Edit dispatch order', 'Edit kernel dispatch orders'),
    ('oil.production.edit', 'Oil Production', 'Edit oil production sheet', 'Save oil production sheet data'),
    ('oil.production.release', 'Oil Production', 'Release oil batch', 'Release oil batch to stock'),
    ('grower.intake.create', 'Grower Intake', 'Create intake batch', 'Create kernel batch from grower intake'),
    ('grower.procurement.manage', 'Grower Intake', 'Manage procurement calendar', 'Add/edit scheduled grower deliveries'),
    ('stock.dispatch', 'Stock', 'Dispatch stock', 'Send stock to dispatch'),
    ('qa.test.create', 'Quality Assurance', 'Create quality test', 'Record QA test results'),
    ('qa.test.approve', 'Quality Assurance', 'Approve quality test', 'Approve QA test for release'),
    ('dashboard.targets.manage', 'Dashboard', 'Manage dashboard targets', 'Edit KPI targets'),
    ('alerts.resolve', 'Dashboard', 'Resolve alerts', 'Acknowledge and resolve dashboard alerts'),
    ('reports.subscribe', 'Reporting', 'Manage report subscriptions', 'Add/edit daily digest subscriptions')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE v_role_id uuid; v_action_id bigint; v_role_name text;
    v_full_access_roles text[] := ARRAY['super_user', 'admin', 'General Manager'];
BEGIN
    FOREACH v_role_name IN ARRAY v_full_access_roles LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_role_name;
        IF v_role_id IS NOT NULL THEN
            FOR v_action_id IN SELECT id FROM public.actions WHERE is_active = true LOOP
                INSERT INTO public.role_actions (role_id, action_id, value)
                VALUES (v_role_id, v_action_id, 'true') ON CONFLICT (role_id, action_id) DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- 9. Grants + RBAC
-- ============================================================
GRANT EXECUTE ON FUNCTION public.resolve_dashboard_alert(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_phase2_extended_kpis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_oil_forecast_by_week(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_consolidated_batch_dashboard_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_procurement_week_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_kernel_intake_procurement_row(date, text, numeric, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_create_shell_lot_from_production(text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_shell_stock_lot(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shell_stock_movements(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_historical_oil_stock_lot(text, text, numeric, date, text, text) TO authenticated, service_role;

DO $$
DECLARE v_role_id uuid; v_fn text;
    v_fns text[] := ARRAY[
        'resolve_dashboard_alert', 'get_phase2_extended_kpis', 'get_oil_forecast_by_week',
        'get_consolidated_batch_dashboard_summary', 'get_procurement_week_summary',
        'import_kernel_intake_procurement_row', 'auto_create_shell_lot_from_production',
        'dispatch_shell_stock_lot', 'get_shell_stock_movements', 'import_historical_oil_stock_lot'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true) ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
