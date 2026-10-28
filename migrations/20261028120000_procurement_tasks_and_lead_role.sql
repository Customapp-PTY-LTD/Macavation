-- ============================================================================
-- Procurement, dispatch and price tasks; Mike's own role; Pete's price reminder setting.
--
-- WHY. Henry (28 Oct 2026), from the v2 mockup (claude.ai/artifact/FUf6z3CE7JYk1npLrm1FJg):
-- the procurement plan, NIS storage areas, style prices and dispatch approval (20261028090000-
-- 090500) should hand work to people through My Day, like the transport-rate task does.
-- Mike and Pete shared "Sales Exec", so every task would reach both; Mike now gets his own role,
-- "Procurement Lead" (a copy of Sales Exec's screens and actions), and the task switches send
-- truck/run-out tasks to him and dispatch-approval/price tasks to Pete. Pete's price reminder
-- is a setting he changes on the Prices tab of Kernel Pipeline Settings.
--
--   workflow_tasks   subject_type, subject_id, dedupe_key (one open task per kind + key)
--   task kinds       dispatch_pick, dispatch_approve          (trigger on kernel_dispatch_orders)
--                    truck_due, truck_late, truck_unconfirmed  (trigger + daily check)
--                    style_prices_stale                        (daily check; saving prices closes)
--                    nis_runway_low, nis_unplaced              (daily check; a move closes)
--   settings         kernel_pipeline_settings 'price_reminder', 'procurement_tasks'
--   RPCs             get/set_price_reminder_settings, set_procurement_storage_area,
--                    set_procurement_confirmed, get_procurement_cleanup, run_procurement_task_checks
--   cron             procurement-task-checks, 05:30 SAST daily
--   roles            Procurement Lead (Mike); Sales Exec + Procurement Lead get Kernel Pipeline
--                    Settings (Prices tab); the separate Style prices screen is switched off;
--                    every role with Silo Allocation gets NIS storage (now one screen, two tabs)
--
-- get_role_tasks is replaced: same visibility rules (20261027140000), plus the subject fields,
-- and "today" is the SAST date rather than the server's UTC date.
-- Tasks go to roles through Role Features switches task-<kind>, so all routing below can be
-- changed on the Role Features screen without code.
-- ============================================================================

ALTER TABLE public.workflow_tasks
    ADD COLUMN IF NOT EXISTS subject_type text,
    ADD COLUMN IF NOT EXISTS subject_id   uuid,
    ADD COLUMN IF NOT EXISTS dedupe_key   text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_tasks_open_kind_dedupe
    ON public.workflow_tasks (kind, dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status NOT IN ('completed', 'dismissed');

INSERT INTO public.kernel_pipeline_settings (key, value) VALUES
    ('price_reminder', '{"enabled": true, "max_age_days": 30, "frequency": "weekly", "scope": "in_stock", "remind_missing": true}'::jsonb),
    -- unplaced_since: storage areas started 28 Oct 2026; older batches were never placed and
    -- would make the "not placed" task meaningless.
    ('procurement_tasks', '{"runway_warn_days": 30, "unconfirmed_within_days": 7, "late_within_days": 14, "unplaced_after_days": 1, "unplaced_since": "2026-10-28"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._sast_today()
RETURNS date
LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date; $$;

-- 30000 -> '30', 12350 -> '12.4'
CREATE OR REPLACE FUNCTION public._fmt_tonnes(p_kg numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT trim(trailing '.' FROM trim(trailing '0' FROM to_char(round(p_kg / 1000.0, 1), 'FM999G990D0'))); $$;

CREATE OR REPLACE FUNCTION public._procurement_task_setting(p_key text, p_default numeric)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE((SELECT (value ->> p_key)::numeric FROM public.kernel_pipeline_settings WHERE key = 'procurement_tasks'), p_default);
$$;

-- ----------------------------------------------------------------------------
-- Open (or refresh the wording of) one task; close tasks. role = the switch name, see
-- get_role_tasks / _task_kind_roles (20261027140000).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._open_task(
    p_kind text, p_dedupe text, p_title text, p_description text,
    p_subject_type text DEFAULT NULL, p_subject_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM public.workflow_tasks
    WHERE kind = p_kind AND dedupe_key = p_dedupe AND status NOT IN ('completed', 'dismissed');

    IF v_id IS NOT NULL THEN
        UPDATE public.workflow_tasks
           SET title = p_title, description = p_description, updated_at = now()
         WHERE id = v_id AND (title IS DISTINCT FROM p_title OR description IS DISTINCT FROM p_description);
        RETURN v_id;
    END IF;

    INSERT INTO public.workflow_tasks (role, kind, dedupe_key, subject_type, subject_id, title, description, status)
    VALUES ('task-' || replace(p_kind, '_', '-'), p_kind, p_dedupe, p_subject_type, p_subject_id, p_title, p_description, 'pending')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._close_tasks(p_kind text, p_dedupe text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_n integer;
BEGIN
    UPDATE public.workflow_tasks
       SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE kind = p_kind AND (p_dedupe IS NULL OR dedupe_key = p_dedupe)
       AND status NOT IN ('completed', 'dismissed');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- ----------------------------------------------------------------------------
-- Dispatch: picking -> Production Manager; approval -> Sales Exec (Pete).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dispatch_stage_tasks(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    o         public.kernel_dispatch_orders%ROWTYPE;
    v_key     text := p_order_id::text;
    v_buyer   text;
    v_cartons numeric;
    v_styles  integer;
    v_changed integer;
    v_desc    text;
BEGIN
    SELECT * INTO o FROM public.kernel_dispatch_orders WHERE id = p_order_id;
    IF NOT FOUND OR o.status = 'cancelled' OR o.workflow_stage IS NULL OR o.workflow_stage = 'approved' THEN
        PERFORM public._close_tasks('dispatch_pick', v_key);
        PERFORM public._close_tasks('dispatch_approve', v_key);
        RETURN;
    END IF;

    v_buyer := COALESCE(NULLIF(trim(o.buyer_name), ''), 'customer');
    SELECT COALESCE(SUM(COALESCE((l ->> 'cartons')::numeric, 0)), 0),
           COUNT(DISTINCT l ->> 'style'),
           COUNT(*) FILTER (WHERE (l ->> 'requested_cartons') IS NOT NULL
                              AND (l ->> 'cartons')::numeric < (l ->> 'requested_cartons')::numeric)
      INTO v_cartons, v_styles, v_changed
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) l;

    IF o.workflow_stage = 'picking' THEN
        PERFORM public._close_tasks('dispatch_approve', v_key);
        -- Already gone out: nothing left to pick.
        IF o.status = 'dispatched' THEN
            PERFORM public._close_tasks('dispatch_pick', v_key);
            RETURN;
        END IF;
        PERFORM public._open_task('dispatch_pick', v_key,
            'Pick the dispatch for ' || v_buyer || ': ' || trim(to_char(v_cartons, 'FM999G990')) || ' cartons, '
                || v_styles || CASE WHEN v_styles = 1 THEN ' style' ELSE ' styles' END,
            concat_ws(' ', 'Leaves ' || to_char(o.delivery_date, 'Dy FMDD Mon') || '.',
                'Confirm what is on the shelf, lower a line if short and leave a note.',
                CASE WHEN o.review_note IS NOT NULL AND trim(o.review_note) <> '' THEN 'Sent back: "' || trim(o.review_note) || '"' END),
            'kernel_dispatch_order', o.id);
    ELSE
        PERFORM public._close_tasks('dispatch_pick', v_key);
        v_desc := concat_ws(' ',
            'Picked' || COALESCE(' by ' || NULLIF(public.stock_history_user_label(o.picked_by), ''), '') || '.',
            CASE WHEN v_changed = 1 THEN '1 line was changed.' WHEN v_changed > 1 THEN v_changed || ' lines were changed.' END,
            CASE WHEN o.pick_note IS NOT NULL AND trim(o.pick_note) <> '' THEN 'Note: "' || trim(o.pick_note) || '"' END);
        PERFORM public._open_task('dispatch_approve', v_key,
            'The dispatch for ' || v_buyer || ' is picked and waiting for your price', v_desc,
            'kernel_dispatch_order', o.id);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_dispatch_stage_tasks()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public._dispatch_stage_tasks(NEW.id);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_dispatch_stage_tasks
    AFTER INSERT OR UPDATE OF workflow_stage, status, lines, pick_note, review_note ON public.kernel_dispatch_orders
    FOR EACH ROW EXECUTE FUNCTION public._trg_dispatch_stage_tasks();

-- ----------------------------------------------------------------------------
-- Planned trucks: due today -> Production Manager; late / not confirmed -> Procurement Lead.
-- One evaluator, used by the trigger and the daily check, so both always agree.
-- Late = still planned, date before today, at most late_within_days ago (older ones are listed
-- for clean-up by get_procurement_cleanup instead of nagging every day).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._procurement_truck_tasks(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r        record;
    v_key    text := p_id::text;
    v_today  date := public._sast_today();
    v_late   integer := public._procurement_task_setting('late_within_days', 14)::integer;
    v_unconf integer := public._procurement_task_setting('unconfirmed_within_days', 7)::integer;
    v_label  text;
BEGIN
    SELECT p.*, COALESCE(NULLIF(trim(p.grower_name), ''), c.company_name, c.trading_name, 'Grower') AS grower,
           a.label AS area_label
      INTO r
    FROM public.kernel_intake_procurement p
    LEFT JOIN public.contacts c ON c.id = p.supplier_id
    LEFT JOIN public.nis_storage_areas a ON a.code = p.storage_area_code
    WHERE p.id = p_id;

    IF NOT FOUND OR r.status <> 'scheduled' THEN
        PERFORM public._close_tasks('truck_due', v_key);
        PERFORM public._close_tasks('truck_late', v_key);
        PERFORM public._close_tasks('truck_unconfirmed', v_key);
        RETURN;
    END IF;

    -- "Agristar 1" already names the grower; "North Coast · truck 2" does not.
    v_label := CASE WHEN NULLIF(trim(r.truck_label), '') IS NULL THEN r.grower
                    WHEN trim(r.truck_label) ILIKE r.grower || '%' THEN trim(r.truck_label)
                    ELSE r.grower || ' · ' || trim(r.truck_label) END;

    IF r.scheduled_date = v_today THEN
        PERFORM public._open_task('truck_due', v_key,
            'Truck due today: ' || v_label
                || COALESCE(' · about ' || public._fmt_tonnes(r.predicted_weight_kg) || ' t', '')
                || COALESCE(' · going to ' || r.area_label, ''),
            'From the procurement plan. Book it in when it reaches the weighbridge.',
            'kernel_intake_procurement', r.id);
    ELSE
        PERFORM public._close_tasks('truck_due', v_key);
    END IF;

    IF r.scheduled_date < v_today AND r.scheduled_date >= v_today - v_late THEN
        PERFORM public._open_task('truck_late', v_key,
            'Truck is late: ' || v_label,
            'Was due ' || to_char(r.scheduled_date, 'Dy FMDD Mon') || '. Move it to its new date, cancel it, or book it in if it arrived.',
            'kernel_intake_procurement', r.id);
    ELSE
        PERFORM public._close_tasks('truck_late', v_key);
    END IF;

    IF NOT r.is_confirmed AND r.scheduled_date BETWEEN v_today AND v_today + v_unconf THEN
        PERFORM public._open_task('truck_unconfirmed', v_key,
            'Truck not confirmed: ' || v_label,
            'Due ' || to_char(r.scheduled_date, 'Dy FMDD Mon') || ' and the grower has not confirmed yet.',
            'kernel_intake_procurement', r.id);
    ELSE
        PERFORM public._close_tasks('truck_unconfirmed', v_key);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_procurement_truck_tasks()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public._procurement_truck_tasks(NEW.id);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER procurement_truck_tasks
    AFTER INSERT OR UPDATE OF status, scheduled_date, is_confirmed, grower_name, truck_label, storage_area_code, predicted_weight_kg
    ON public.kernel_intake_procurement
    FOR EACH ROW EXECUTE FUNCTION public._trg_procurement_truck_tasks();

-- ----------------------------------------------------------------------------
-- Style prices reminder (Pete). p_may_open: only the daily check, on its day, opens a new
-- task; saving prices or settings only updates or closes an open one.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._style_prices_task(p_may_open boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    s         jsonb := COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'price_reminder'), '{}'::jsonb);
    v_today   date := public._sast_today();
    v_days    integer := COALESCE((s ->> 'max_age_days')::integer, 30);
    v_scope   text := COALESCE(s ->> 'scope', 'in_stock');
    v_missing text[];
    v_old     text[];
    v_title   text;
    v_where   text;
BEGIN
    IF NOT COALESCE((s ->> 'enabled')::boolean, true) THEN
        PERFORM public._close_tasks('style_prices_stale', 'style_prices');
        RETURN;
    END IF;

    WITH styles AS (
        SELECT r.style_code, r.display_order
        FROM public.kernel_style_registry r
        WHERE r.is_active
          AND (v_scope = 'all' OR r.style_code IN (
                SELECT public.kernel_style_code_from_dispatch(h.series)
                FROM public.get_stock_soh_history('kernel', 7) h
                WHERE h.d = v_today AND h.qty_kg > 0))
    ),
    priced AS (
        SELECT st.style_code, st.display_order, lp.effective_from
        FROM styles st
        LEFT JOIN LATERAL (
            SELECT effective_from FROM public.kernel_style_prices p
            WHERE p.style_code = st.style_code AND p.customer_id IS NULL AND p.effective_from <= v_today
            ORDER BY p.effective_from DESC, p.created_at DESC LIMIT 1
        ) lp ON true
    )
    SELECT array_agg(style_code ORDER BY display_order, style_code) FILTER (WHERE effective_from IS NULL),
           array_agg(style_code ORDER BY display_order, style_code) FILTER (WHERE effective_from < v_today - v_days)
      INTO v_missing, v_old
    FROM priced;

    IF NOT COALESCE((s ->> 'remind_missing')::boolean, true) THEN
        v_missing := NULL;
    END IF;

    IF COALESCE(cardinality(v_missing), 0) = 0 AND COALESCE(cardinality(v_old), 0) = 0 THEN
        PERFORM public._close_tasks('style_prices_stale', 'style_prices');
        RETURN;
    END IF;

    v_where := CASE WHEN v_scope = 'all' THEN '' ELSE ' in stock' END;
    v_title := concat_ws(' · ',
        CASE WHEN cardinality(v_missing) = 1 THEN '1 style' || v_where || ' has no price'
             WHEN cardinality(v_missing) > 1 THEN cardinality(v_missing) || ' styles' || v_where || ' have no price' END,
        CASE WHEN cardinality(v_old) = 1 THEN '1 price is older than ' || v_days || ' days'
             WHEN cardinality(v_old) > 1 THEN cardinality(v_old) || ' prices are older than ' || v_days || ' days' END);

    IF NOT p_may_open AND NOT EXISTS (
        SELECT 1 FROM public.workflow_tasks
        WHERE kind = 'style_prices_stale' AND dedupe_key = 'style_prices' AND status NOT IN ('completed', 'dismissed')) THEN
        RETURN;
    END IF;

    PERFORM public._open_task('style_prices_stale', 'style_prices', v_title,
        CASE WHEN v_scope = 'all' THEN 'Set these on the Prices tab: ' ELSE 'Stock on hand can''t be valued until these are set: ' END
            || concat_ws('; ',
                   array_to_string(v_missing, ', ') || ' (no price)',
                   array_to_string(v_old, ', ') || ' (old)') || '.',
        'kernel_style_prices', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_style_prices_task()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public._style_prices_task(false);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_style_prices_task
    AFTER INSERT OR UPDATE ON public.kernel_style_prices
    FOR EACH STATEMENT EXECUTE FUNCTION public._trg_style_prices_task();

-- ----------------------------------------------------------------------------
-- NIS: runway (Procurement Lead) and stock not placed in an area (Production Manager).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._nis_runway_task()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := public._sast_today();
    v_warn  integer := public._procurement_task_setting('runway_warn_days', 30)::integer;
    v_out   date;
BEGIN
    BEGIN
        v_out := (public.get_nis_runway_forecast(60, NULL, NULL, 1, false) -> 'meta' ->> 'run_out_date')::date;
    EXCEPTION WHEN OTHERS THEN
        RETURN;   -- forecast unavailable: leave any open task as it is
    END;

    IF v_out IS NOT NULL AND v_out - v_today <= v_warn THEN
        PERFORM public._open_task('nis_runway_low', 'nis_runway',
            'Nut in shell runs out around ' || to_char(v_out, 'FMDD Mon YYYY'),
            'At the current cracking rate stock runs out in ' || GREATEST(v_out - v_today, 0)
                || ' days. Plan more trucks on the procurement plan.',
            'procurement_plan', NULL);
    ELSE
        PERFORM public._close_tasks('nis_runway_low', 'nis_runway');
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._nis_unplaced_task(p_may_open boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today   date := public._sast_today();
    v_after   integer := public._procurement_task_setting('unplaced_after_days', 1)::integer;
    v_since   date := COALESCE((SELECT (value ->> 'unplaced_since')::date FROM public.kernel_pipeline_settings WHERE key = 'procurement_tasks'), '2026-10-28');
    v_kg      numeric;
    v_n       integer;
    v_batches text;
BEGIN
    -- Same rule as get_nis_storage_overview's "not placed yet" list (20261028090000).
    SELECT COALESCE(SUM(u.unplaced), 0), COUNT(*),
           string_agg(u.batch_number, ', ' ORDER BY u.received_date) FILTER (WHERE u.rn <= 5)
      INTO v_kg, v_n, v_batches
    FROM (
        SELECT b.batch_id AS batch_number, k.received_date,
               COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg, 0)
               - COALESCE((SELECT SUM(m.kg) FROM public.nis_storage_movements m
                           WHERE m.kernel_id = k.id AND m.movement_type = 'in'), 0) AS unplaced,
               row_number() OVER (ORDER BY k.received_date) AS rn
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE k.is_active IS NOT FALSE
          AND k.status IN ('intake', 'receiving', 'production')
          AND k.received_date >= v_since
          AND k.received_date <= v_today - v_after
    ) u
    WHERE u.unplaced > 0.009;

    IF v_n = 0 THEN
        PERFORM public._close_tasks('nis_unplaced', 'nis_unplaced');
        RETURN;
    END IF;
    IF NOT p_may_open AND NOT EXISTS (
        SELECT 1 FROM public.workflow_tasks
        WHERE kind = 'nis_unplaced' AND dedupe_key = 'nis_unplaced' AND status NOT IN ('completed', 'dismissed')) THEN
        RETURN;
    END IF;

    PERFORM public._open_task('nis_unplaced', 'nis_unplaced',
        public._fmt_tonnes(v_kg) || ' t of nut in shell has no storage area yet',
        v_n || CASE WHEN v_n = 1 THEN ' batch was' ELSE ' batches were' END || ' booked in without a storage area ('
            || v_batches || CASE WHEN v_n > 5 THEN ', …' ELSE '' END
            || '). Choose where it went so the storage totals stay right.',
        'nis_storage', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_nis_unplaced_task()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public._nis_unplaced_task(false);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER nis_storage_movements_unplaced_task
    AFTER INSERT ON public.nis_storage_movements
    FOR EACH STATEMENT EXECUTE FUNCTION public._trg_nis_unplaced_task();

-- ----------------------------------------------------------------------------
-- The daily check (cron below). p_force_prices: open the price reminder whatever the day.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_procurement_task_checks(p_force_prices boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := public._sast_today();
    v_freq  text := COALESCE((SELECT value ->> 'frequency' FROM public.kernel_pipeline_settings WHERE key = 'price_reminder'), 'weekly');
    v_price_day boolean;
BEGIN
    -- Trucks around today, plus any truck that still has an open task (to close it).
    PERFORM public._procurement_truck_tasks(p.id)
    FROM public.kernel_intake_procurement p
    WHERE p.status = 'scheduled' AND p.scheduled_date BETWEEN v_today - 60 AND v_today + 60;

    PERFORM public._procurement_truck_tasks(t.subject_id)
    FROM public.workflow_tasks t
    WHERE t.kind IN ('truck_due', 'truck_late', 'truck_unconfirmed')
      AND t.status NOT IN ('completed', 'dismissed') AND t.subject_id IS NOT NULL;

    v_price_day := p_force_prices
        OR v_freq = 'daily'
        OR (v_freq = 'weekly' AND extract(isodow FROM v_today) = 1)
        OR (v_freq = 'monthly' AND extract(day FROM v_today) = 1);
    PERFORM public._style_prices_task(v_price_day);

    PERFORM public._nis_runway_task();
    PERFORM public._nis_unplaced_task(true);

    RETURN jsonb_build_object('success', true, 'ran_on', v_today, 'price_check', v_price_day,
        'open', (SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (
                    SELECT kind, COUNT(*) n FROM public.workflow_tasks
                    WHERE status NOT IN ('completed', 'dismissed') AND kind IS NOT NULL GROUP BY kind) x));
END;
$$;

-- ----------------------------------------------------------------------------
-- Pete's price reminder setting (Prices tab).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_price_reminder_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'settings',
        '{"enabled": true, "max_age_days": 30, "frequency": "weekly", "scope": "in_stock", "remind_missing": true}'::jsonb
        || COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'price_reminder'), '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.set_price_reminder_settings(p_settings jsonb, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_new  jsonb;
    v_days integer;
BEGIN
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nothing to save.');
    END IF;
    v_new := (public.get_price_reminder_settings() -> 'settings')
             || (p_settings - ARRAY(SELECT k FROM jsonb_object_keys(p_settings) k
                                    WHERE k NOT IN ('enabled', 'max_age_days', 'frequency', 'scope', 'remind_missing')));

    IF jsonb_typeof(v_new -> 'enabled') <> 'boolean' OR jsonb_typeof(v_new -> 'remind_missing') <> 'boolean' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose whether the reminder is on.');
    END IF;
    v_days := (v_new ->> 'max_age_days')::integer;
    IF v_days IS NULL OR v_days < 1 OR v_days > 365 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Days must be between 1 and 365.');
    END IF;
    IF v_new ->> 'frequency' NOT IN ('daily', 'weekly', 'monthly') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose how often to check.');
    END IF;
    IF v_new ->> 'scope' NOT IN ('in_stock', 'all') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose which styles count.');
    END IF;
    v_new := jsonb_set(v_new, '{max_age_days}', to_jsonb(v_days));

    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at, updated_by)
    VALUES ('price_reminder', v_new, now(), p_actor_user_id)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;

    PERFORM public._style_prices_task(false);
    RETURN jsonb_build_object('success', true, 'settings', v_new);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error', 'Days must be a whole number.');
END;
$$;

-- ----------------------------------------------------------------------------
-- Small writes for Book in and the plan screen.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_procurement_storage_area(p_id uuid, p_storage_area_code text, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_area text := NULLIF(trim(COALESCE(p_storage_area_code, '')), '');
BEGIN
    IF v_area IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.nis_storage_areas WHERE code = v_area AND is_active) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown storage area.');
    END IF;
    UPDATE public.kernel_intake_procurement
       SET storage_area_code = v_area, updated_by = p_actor_user_id, updated_at = now()
     WHERE id = p_id AND status = 'scheduled';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'This truck has already been received or cancelled.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_procurement_confirmed(p_id uuid, p_is_confirmed boolean, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.kernel_intake_procurement
       SET is_confirmed = COALESCE(p_is_confirmed, false), updated_by = p_actor_user_id, updated_at = now()
     WHERE id = p_id AND status = 'scheduled';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'This truck has already been received or cancelled.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Trucks to tidy up once before the old calendar goes: same grower twice on one day, and
-- planned trucks more than late_within_days old that were never booked in.
CREATE OR REPLACE FUNCTION public.get_procurement_cleanup()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := public._sast_today();
    v_late  integer := public._procurement_task_setting('late_within_days', 14)::integer;
    v_dupes jsonb;
    v_old   jsonb;
BEGIN
    WITH p AS (
        SELECT p.id, p.scheduled_date, p.truck_label, p.predicted_weight_kg, p.created_at,
               COALESCE(NULLIF(trim(p.grower_name), ''), c.company_name, c.trading_name, 'Grower') AS grower,
               COALESCE(p.supplier_id::text, lower(trim(p.grower_name))) AS gkey
        FROM public.kernel_intake_procurement p
        LEFT JOIN public.contacts c ON c.id = p.supplier_id
        WHERE p.status = 'scheduled'
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('scheduled_date', g.scheduled_date, 'grower', g.grower, 'trucks', g.trucks)
                              ORDER BY g.scheduled_date), '[]'::jsonb)
      INTO v_dupes
    FROM (
        SELECT scheduled_date, MIN(grower) AS grower,
               jsonb_agg(jsonb_build_object('id', id, 'truck_label', truck_label, 'predicted_weight_kg', predicted_weight_kg,
                                            'created_at', created_at) ORDER BY created_at) AS trucks
        FROM p WHERE gkey IS NOT NULL
        GROUP BY scheduled_date, gkey
        HAVING COUNT(*) > 1
    ) g;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'scheduled_date', p.scheduled_date, 'truck_label', p.truck_label,
               'predicted_weight_kg', p.predicted_weight_kg,
               'grower', COALESCE(NULLIF(trim(p.grower_name), ''), c.company_name, c.trading_name, 'Grower'))
               ORDER BY p.scheduled_date), '[]'::jsonb)
      INTO v_old
    FROM public.kernel_intake_procurement p
    LEFT JOIN public.contacts c ON c.id = p.supplier_id
    WHERE p.status = 'scheduled' AND p.scheduled_date < v_today - v_late;

    RETURN jsonb_build_object('success', true, 'today', v_today, 'late_within_days', v_late,
                              'possible_doubles', v_dupes, 'never_booked_in', v_old);
END;
$$;

-- ----------------------------------------------------------------------------
-- My Day read: as 20261027140000 plus subject fields; "today" in SAST.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_role_tasks(p_role text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'tasks', COALESCE(jsonb_agg(x ORDER BY x ->> 'created_at'), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'id', t.id,
            'role', CASE WHEN t.kind IS NULL THEN t.role
                         ELSE COALESCE(NULLIF(array_to_string(v.roles, ', '), ''), 'no role switched on') END,
            'kind', t.kind, 'title', t.title, 'description', t.description,
            'status', t.status, 'created_at', t.created_at, 'snoozed_until', t.snoozed_until,
            'is_snoozed', t.snoozed_until IS NOT NULL AND t.snoozed_until > now(),
            'action_url', t.action_url, 'action_label', t.action_label, 'context', t.context,
            'scheduled_time', t.scheduled_time,
            'subject_type', t.subject_type, 'subject_id', t.subject_id, 'dedupe_key', t.dedupe_key,
            'kernel_id', t.kernel_id,
            'batch_number', b.batch_id,
            'supplier', k.grower_name,
            'transporter', k.intake_data #>> '{delivery,transport,transporter_name}',
            'transport_type', k.intake_data #>> '{delivery,transport,transport_type_name}',
            'delivery_note', k.intake_data #>> '{delivery,transport,delivery_note_ref}',
            'rate_zar', k.intake_data #>> '{delivery,transport,rate_zar}',
            'pallets', CASE WHEN jsonb_typeof(k.intake_data #> '{delivery,bags}') = 'array'
                            THEN jsonb_array_length(k.intake_data #> '{delivery,bags}') END,
            'weighed_kg', k.actual_wet_nis_kg,
            'captured_at', COALESCE((k.intake_data #>> '{delivery,saved_at}')::timestamptz, k.created_at)
        ) AS x
        FROM public.workflow_tasks t
        CROSS JOIN LATERAL (SELECT CASE WHEN t.kind IS NULL THEN '{}'::text[]
                                        ELSE public._task_kind_roles(t.kind) END AS roles) v
        LEFT JOIN public.kernel k ON k.id = t.kernel_id
        LEFT JOIN public.batches b ON b.id = k.batch_id
        WHERE t.status NOT IN ('completed', 'dismissed')
          AND (t.kernel_id IS NULL OR k.is_active)
          AND (t.scheduled_date IS NULL OR t.scheduled_date <= public._sast_today())
          AND (
                p_role = 'super_user'
             OR ((t.snoozed_until IS NULL OR t.snoozed_until <= now())
                 AND CASE WHEN t.kind IS NULL THEN t.role = p_role ELSE p_role = ANY (v.roles) END)
          )
    ) s;
$$;

REVOKE EXECUTE ON FUNCTION public._procurement_task_setting(text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._open_task(text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._close_tasks(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dispatch_stage_tasks(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_dispatch_stage_tasks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._procurement_truck_tasks(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_procurement_truck_tasks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._style_prices_task(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_style_prices_task() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._nis_runway_task() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._nis_unplaced_task(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_nis_unplaced_task() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_procurement_task_checks(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_price_reminder_settings() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_price_reminder_settings(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_procurement_storage_area(uuid, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_procurement_confirmed(uuid, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_procurement_cleanup() TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Mike's role: Procurement Lead = everything Sales Exec has today.
-- ----------------------------------------------------------------------------
INSERT INTO public.roles (role_name, description, is_active)
VALUES ('Procurement Lead', 'Plans grower trucks and watches nut-in-shell stock. Same screens and actions as Sales Exec; gets the truck and run-out tasks.', true)
ON CONFLICT (role_name) DO NOTHING;

-- Screens only: task switches are set per role below (copying them would hand Mike Pete's tasks).
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT pl.id, rf.feature_id, rf.value
FROM public.role_features rf
JOIN public.roles se ON se.id = rf.role_id AND se.role_name = 'Sales Exec'
JOIN public.features f ON f.id = rf.feature_id AND f.key NOT LIKE 'task-%'
CROSS JOIN (SELECT id FROM public.roles WHERE role_name = 'Procurement Lead') pl
ON CONFLICT (role_id, feature_id) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT pl.id, ra.action_id, ra.value
FROM public.role_actions ra
JOIN public.roles se ON se.id = ra.role_id AND se.role_name = 'Sales Exec'
CROSS JOIN (SELECT id FROM public.roles WHERE role_name = 'Procurement Lead') pl
ON CONFLICT (role_id, action_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT pl.id, rp.object_type, rp.object_name, rp.operation, rp.allowed
FROM public.role_permissions rp
JOIN public.roles se ON se.id = rp.role_id AND se.role_name = 'Sales Exec'
CROSS JOIN (SELECT id FROM public.roles WHERE role_name = 'Procurement Lead') pl
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
    WHERE x.role_id = pl.id AND x.object_type = rp.object_type AND x.object_name = rp.object_name AND x.operation = rp.operation);

UPDATE public.users u
   SET role_id = pl.id, role = 'Procurement Lead'
  FROM public.roles pl
 WHERE pl.role_name = 'Procurement Lead' AND lower(u.email) = 'mike@macavation.co.za';

-- ----------------------------------------------------------------------------
-- Screens: Prices move into Kernel Pipeline Settings; NIS storage holds the Silos tab too.
-- ----------------------------------------------------------------------------
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE r.role_name IN ('Sales Exec', 'Procurement Lead') AND f.key = 'kernel-pipeline-settings'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

UPDATE public.features SET is_active = false, updated_at = now() WHERE key = 'kernel-style-prices';

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT rf.role_id, nf.id, 'true'
FROM public.role_features rf
JOIN public.features sf ON sf.id = rf.feature_id AND sf.key = 'silo-allocation-grid'
CROSS JOIN (SELECT id FROM public.features WHERE key = 'nis-storage') nf
WHERE rf.value = 'true'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

UPDATE public.features SET name = 'NIS storage & silos',
       description = 'Nut in shell by storage area, moves between areas, and silo allocation', updated_at = now()
 WHERE key = 'nis-storage';

-- ----------------------------------------------------------------------------
-- Task switches (Role Features), and who gets each by default.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active) VALUES
    ('task-dispatch-pick',        'Tasks: pick dispatches',            'Gets a "Pick a dispatch" task when a kernel dispatch is waiting to be picked.', true),
    ('task-dispatch-approve',     'Tasks: approve dispatches',         'Gets an "Approve a dispatch" task when a picked dispatch is waiting for its price.', true),
    ('task-truck-due',            'Tasks: trucks due today',           'Gets a "Truck due today" task for each planned truck on its day, to book it in.', true),
    ('task-truck-late',           'Tasks: late trucks',                'Gets a "Truck is late" task when a planned truck has not been booked in on its day.', true),
    ('task-truck-unconfirmed',    'Tasks: unconfirmed trucks',         'Gets a "Truck not confirmed" task when a truck is due within a week and the grower has not confirmed.', true),
    ('task-style-prices-stale',   'Tasks: style price reminder',       'Gets a reminder when styles have no price or an old price (set on the Prices tab).', true),
    ('task-nis-runway-low',       'Tasks: nut in shell running out',   'Gets a warning when nut in shell will run out soon at the current cracking rate.', true),
    ('task-nis-unplaced',         'Tasks: nut in shell not placed',    'Gets a task when booked-in nut in shell has no storage area.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM (VALUES
    ('task-dispatch-pick',      'Production Manager'),
    ('task-dispatch-approve',   'Sales Exec'),
    ('task-truck-due',          'Production Manager'),
    ('task-truck-late',         'Procurement Lead'),
    ('task-truck-unconfirmed',  'Procurement Lead'),
    ('task-style-prices-stale', 'Sales Exec'),
    ('task-nis-runway-low',     'Procurement Lead'),
    ('task-nis-unplaced',       'Production Manager')
) AS g(feature_key, role_name)
JOIN public.features f ON f.key = g.feature_key
JOIN public.roles r ON r.role_name = g.role_name
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

-- Pete's tasks stay off for Mike's role (an UPDATE, so a re-run can't turn them back on).
UPDATE public.role_features rf SET value = 'false'
FROM public.roles r, public.features f
WHERE rf.role_id = r.id AND rf.feature_id = f.id AND r.role_name = 'Procurement Lead'
  AND f.key IN ('task-dispatch-approve', 'task-style-prices-stale');

-- ----------------------------------------------------------------------------
-- Daily at 05:30 SAST (03:30 UTC), and once now.
-- ----------------------------------------------------------------------------
SELECT cron.schedule('procurement-task-checks', '30 3 * * *', 'SELECT public.run_procurement_task_checks()');

SELECT public._dispatch_stage_tasks(o.id)
FROM public.kernel_dispatch_orders o
WHERE o.workflow_stage IN ('picking', 'approval') AND o.status NOT IN ('dispatched', 'cancelled');

SELECT public.run_procurement_task_checks(true);

NOTIFY pgrst, 'reload schema';
