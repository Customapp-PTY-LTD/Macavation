-- =============================================================================
-- Reports v2: frozen snapshot, comparison (previous period / year to date / targets),
-- coming-up lists, and one-call report view.
--
-- Depends on 20261106180000_reports_auto_drafts.sql (report_due_date, list_report_history),
-- 20261106180200_reports_all_figures.sql (get_reports_all_figures) and
-- 20260817100000_report_instances_and_targets.sql (publish/supersede, report_period_targets).
--
-- A published report now stores the exact figures it was issued with (report_snapshot) so the
-- Reports tabs and the PDF never drift from what was sent. Reports published before this
-- migration have no snapshot and are served as legacy:true. supersede_report_instance inserts an
-- explicit column list, so a re-issued draft starts with report_snapshot NULL (verified).
--
-- Down: DROP FUNCTION get_report_view(uuid), report_build_snapshot(text, date),
--   get_report_coming_up(text, date), get_report_comparison(text, date), _report_headlines(jsonb);
--   re-create publish_report_instance from 20260817100000; ALTER TABLE report_instances DROP COLUMN
--   report_snapshot, DROP COLUMN snapshot_sha256.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Snapshot columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.report_instances
    ADD COLUMN IF NOT EXISTS report_snapshot jsonb NULL,
    ADD COLUMN IF NOT EXISTS snapshot_sha256 text NULL;

COMMENT ON COLUMN public.report_instances.report_snapshot IS
    'Frozen Reports v2 payload (figures, comparison, coming up) captured at publish. NULL on drafts and on reports published before Reports v2.';
COMMENT ON COLUMN public.report_instances.snapshot_sha256 IS
    'SHA-256 (hex) of report_snapshot::text, recorded at publish.';

-- ---------------------------------------------------------------------------
-- 2. _report_headlines - the headline numbers out of one get_reports_all_figures payload
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._report_headlines(p_fig jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_k_stock  jsonb;
    v_closings numeric[];
    v_raw      numeric;
BEGIN
    IF p_fig IS NULL OR COALESCE(p_fig->>'success', 'false') <> 'true' THEN
        RETURN jsonb_build_object(
            'nis_received_kg', NULL, 'cracked_kg', NULL, 'sk_packed_kg', NULL, 'recovery_pct', NULL,
            'kernel_stock_kg', NULL, 'kernel_sales_zar', NULL, 'kernel_sales_kg', NULL, 'kernel_avg_price', NULL,
            'raws_received_kg', NULL, 'food_grade_kg', NULL, 'crude_kg', NULL, 'protein_kg', NULL,
            'oil_sales_zar', NULL, 'raw_stock_kg', NULL);
    END IF;

    v_k_stock := p_fig #> '{kernel,finished_stock}';

    -- Raw stock on hand: sum of the three materials' closing; unknown if any one is unknown.
    SELECT array_agg(NULLIF(m->>'closing_kg', '')::numeric)
      INTO v_closings
      FROM jsonb_array_elements(COALESCE(p_fig #> '{oil,raw_stock,materials}', '[]'::jsonb)) m;
    IF v_closings IS NULL OR cardinality(v_closings) = 0 OR array_position(v_closings, NULL) IS NOT NULL THEN
        v_raw := NULL;
    ELSE
        SELECT sum(x) INTO v_raw FROM unnest(v_closings) x;
    END IF;

    RETURN jsonb_build_object(
        'nis_received_kg',  NULLIF(p_fig #>> '{kernel,procurement,nis_kg}', '')::numeric,
        'cracked_kg',       NULLIF(p_fig #>> '{kernel,production,cracked_kg}', '')::numeric,
        'sk_packed_kg',     NULLIF(p_fig #>> '{kernel,production,sk_packed_kg}', '')::numeric,
        'recovery_pct',     NULLIF(p_fig #>> '{kernel,production,recovery_pct}', '')::numeric,
        'kernel_stock_kg',  CASE WHEN COALESCE(v_k_stock->>'available', 'false') = 'true'
                                 THEN NULLIF(v_k_stock->>'closing_kg', '')::numeric END,
        'kernel_sales_zar', NULLIF(p_fig #>> '{kernel,sales,value_zar}', '')::numeric,
        'kernel_sales_kg',  NULLIF(p_fig #>> '{kernel,sales,kg}', '')::numeric,
        'kernel_avg_price', NULLIF(p_fig #>> '{kernel,sales,avg_price_per_kg}', '')::numeric,
        'raws_received_kg', NULLIF(p_fig #>> '{oil,procurement,total_kg}', '')::numeric,
        'food_grade_kg',    NULLIF(p_fig #>> '{oil,production,food_grade_kg}', '')::numeric,
        'crude_kg',         NULLIF(p_fig #>> '{oil,production,crude_kg}', '')::numeric,
        'protein_kg',       NULLIF(p_fig #>> '{oil,production,protein_kg}', '')::numeric,
        'oil_sales_zar',    NULLIF(p_fig #>> '{oil,sales,value_zar}', '')::numeric,
        'raw_stock_kg',     v_raw);
END;
$$;

COMMENT ON FUNCTION public._report_headlines(jsonb) IS
    'Headline numbers (kg, rand, percent) extracted from one get_reports_all_figures payload. Nulls when the payload failed or a figure is not known.';

-- ---------------------------------------------------------------------------
-- 3. get_report_comparison
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_comparison(p_period_type text, p_period_start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from      date;
    v_to        date;
    v_pfrom     date;
    v_pto       date;
    v_fy_start  date;
    v_ytd_from  date;
    v_ytd_to    date;
    v_fig_cur   jsonb;
    v_fig_prev  jsonb;
    v_fig_ytd   jsonb;
    v_h_cur     jsonb;
    v_h_prev    jsonb;
    v_h_ytd     jsonb;
    v_metrics   jsonb := '{}'::jsonb;
    v_months    jsonb := '[]'::jsonb;
    r           record;
    v_mk        text;
    v_target    numeric;
    v_ytd_t     numeric;
    v_ytd_tn    integer;
    v_ytd_n     integer;
    v_ytd_on numeric;
    v_ytd_val   numeric;
    v_m         date;
    v_m_end     date;
    v_t1        numeric;
    v_t2        numeric;
    v_t3        numeric;
BEGIN
    IF p_period_type IS NULL OR p_period_type NOT IN ('weekly', 'monthly') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Period type must be weekly or monthly.');
    END IF;
    IF p_period_start IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'A period start date is required.');
    END IF;

    IF p_period_type = 'weekly' THEN
        v_from  := date_trunc('week', p_period_start)::date;
        v_to    := v_from + 6;
        v_pfrom := v_from - 7;
        v_pto   := v_from - 1;
    ELSE
        v_from  := date_trunc('month', p_period_start)::date;
        v_to    := (v_from + interval '1 month' - interval '1 day')::date;
        v_pfrom := (v_from - interval '1 month')::date;
        v_pto   := v_from - 1;
    END IF;

    -- Financial year runs 1 April to 31 March; year to date is FY start through the period end.
    v_fy_start := make_date(EXTRACT(YEAR FROM v_to)::integer - CASE WHEN EXTRACT(MONTH FROM v_to) < 4 THEN 1 ELSE 0 END, 4, 1);
    v_ytd_from := v_fy_start;
    v_ytd_to   := v_to;

    v_fig_cur := public.get_reports_all_figures(v_from, v_to);
    IF COALESCE(v_fig_cur->>'success', 'false') <> 'true' THEN
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_fig_cur->>'error', 'Figures could not be read.'));
    END IF;
    v_fig_prev := public.get_reports_all_figures(v_pfrom, v_pto);
    v_fig_ytd  := public.get_reports_all_figures(v_ytd_from, v_ytd_to);
    v_h_cur  := public._report_headlines(v_fig_cur);
    v_h_prev := public._report_headlines(v_fig_prev);
    v_h_ytd  := public._report_headlines(v_fig_ytd);

    -- Number of periods of this type in the year to date (weekly: Mondays from FY start; monthly: months).
    IF p_period_type = 'weekly' THEN
        SELECT count(*)::integer INTO v_ytd_n
          FROM generate_series(v_ytd_from::timestamp, v_from::timestamp, interval '1 day') g
         WHERE EXTRACT(ISODOW FROM g) = 1;
    ELSE
        v_ytd_n := (EXTRACT(YEAR FROM v_from)::integer - EXTRACT(YEAR FROM v_fy_start)::integer) * 12
                   + EXTRACT(MONTH FROM v_from)::integer - EXTRACT(MONTH FROM v_fy_start)::integer + 1;
    END IF;

    FOR r IN
        SELECT * FROM (VALUES
            ('nis_received_kg',  'NIS received',          'kg',         'kernel', 'flow',  'nis_procured_kg',            p_period_type = 'monthly'),
            ('cracked_kg',       'NIS cracked',           'kg',         'kernel', 'flow',  'kernel_nis_cracking_kg',     true),
            ('sk_packed_kg',     'Sound kernel packed',   'kg',         'kernel', 'flow',  'kernel_sk_packing_kg',       true),
            ('recovery_pct',     'Kernel recovery',       'pct',        'kernel', 'ratio', NULL,                         false),
            ('kernel_stock_kg',  'Kernel stock on hand',  'kg',         'kernel', 'stock', NULL,                         false),
            ('kernel_sales_zar', 'Kernel sales',          'zar',        'kernel', 'flow',  'kernel_sales_excl_vat_zar',  true),
            ('kernel_sales_kg',  'Kernel sold',           'kg',         'kernel', 'flow',  NULL,                         false),
            ('kernel_avg_price', 'Average kernel price',  'zar_per_kg', 'kernel', 'ratio', NULL,                         false),
            ('raws_received_kg', 'Oil raws received',     'kg',         'oil',    'flow',  NULL,                         false),
            ('food_grade_kg',    'Food grade oil',        'kg',         'oil',    'flow',  'oil_food_grade_produced_kg', true),
            ('crude_kg',         'Crude oil',             'kg',         'oil',    'flow',  'oil_cosmetic_produced_kg',   true),
            ('protein_kg',       'Protein powder',        'kg',         'oil',    'flow',  'oil_protein_produced_kg',    true),
            ('oil_sales_zar',    'Oil & protein sales',   'zar',        'oil',    'flow',  'oil_sales_excl_vat_zar',     true),
            ('raw_stock_kg',     'Oil raw stock on hand', 'kg',         'oil',    'stock', NULL,                         false)
        ) AS t(k, label, unit, stream, kind, metric_key, targeted)
    LOOP
        v_mk := r.metric_key;
        v_target := NULL; v_ytd_t := NULL; v_ytd_tn := NULL; v_ytd_on := NULL; v_ytd_val := NULL;

        IF r.kind <> 'stock' THEN
            v_ytd_val := NULLIF(v_h_ytd->>r.k, '')::numeric;
        END IF;

        IF r.kind = 'flow' AND r.targeted AND v_mk IS NOT NULL THEN
            SELECT t.target_value INTO v_target
              FROM public.report_period_targets t
             WHERE t.metric_key = v_mk AND t.period_type = p_period_type
               AND t.period_start = v_from AND t.target_value > 0;
            SELECT sum(t.target_value), count(*)::integer INTO v_ytd_t, v_ytd_tn
              FROM public.report_period_targets t
             WHERE t.metric_key = v_mk AND t.period_type = p_period_type
               AND t.period_start BETWEEN v_ytd_from AND v_from AND t.target_value > 0;
            IF COALESCE(v_ytd_tn, 0) = 0 THEN
                v_ytd_t := NULL; v_ytd_tn := 0;
            ELSE
                -- Actual over ONLY the periods that carry a target, so a partial-year target is
                -- compared like for like (2 targeted months vs 2 months of actuals, not 7).
                SELECT sum(public.resolve_report_metric_value(t.metric_key, t.period_start,
                           CASE WHEN p_period_type = 'weekly' THEN t.period_start + 6
                                ELSE (t.period_start + interval '1 month' - interval '1 day')::date END))
                  INTO v_ytd_on
                  FROM public.report_period_targets t
                 WHERE t.metric_key = v_mk AND t.period_type = p_period_type
                   AND t.period_start BETWEEN v_ytd_from AND v_from AND t.target_value > 0;
            END IF;
        END IF;

        v_metrics := v_metrics || jsonb_build_object(r.k, jsonb_build_object(
            'label', r.label, 'unit', r.unit, 'stream', r.stream, 'kind', r.kind, 'metric_key', v_mk,
            'value', NULLIF(v_h_cur->>r.k, '')::numeric,
            'target', v_target,
            'previous', NULLIF(v_h_prev->>r.k, '')::numeric,
            'ytd', v_ytd_val,
            'ytd_target', v_ytd_t,
            'ytd_target_periods', CASE WHEN r.kind = 'flow' AND r.targeted THEN COALESCE(v_ytd_tn, 0) END,
            'ytd_periods', CASE WHEN r.kind = 'stock' THEN NULL ELSE v_ytd_n END,
            'ytd_actual_on_target', v_ytd_on));
    END LOOP;

    -- Financial-year month by month (monthly reports only): actuals via the fast resolver.
    IF p_period_type = 'monthly' THEN
        v_m := v_fy_start;
        WHILE v_m <= v_from LOOP
            v_m_end := (v_m + interval '1 month' - interval '1 day')::date;
            SELECT max(t.target_value) FILTER (WHERE t.metric_key = 'kernel_nis_cracking_kg' AND t.target_value > 0),
                   max(t.target_value) FILTER (WHERE t.metric_key = 'kernel_sales_excl_vat_zar' AND t.target_value > 0),
                   max(t.target_value) FILTER (WHERE t.metric_key = 'oil_sales_excl_vat_zar' AND t.target_value > 0)
              INTO v_t1, v_t2, v_t3
              FROM public.report_period_targets t
             WHERE t.period_type = 'monthly' AND t.period_start = v_m
               AND t.metric_key IN ('kernel_nis_cracking_kg', 'kernel_sales_excl_vat_zar', 'oil_sales_excl_vat_zar');
            v_months := v_months || jsonb_build_array(jsonb_build_object(
                'month', v_m,
                'cracked_kg',          public.resolve_report_metric_value('kernel_nis_cracking_kg', v_m, v_m_end),
                'cracked_target',      v_t1,
                'kernel_sales_zar',    public.resolve_report_metric_value('kernel_sales_excl_vat_zar', v_m, v_m_end),
                'kernel_sales_target', v_t2,
                'oil_sales_zar',       public.resolve_report_metric_value('oil_sales_excl_vat_zar', v_m, v_m_end),
                'oil_sales_target',    v_t3));
            v_m := (v_m + interval '1 month')::date;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'period_type', p_period_type,
        'from', v_from, 'to', v_to,
        'period_complete', v_to < public.report_sast_today(),
        'prev', jsonb_build_object('from', v_pfrom, 'to', v_pto),
        'ytd',  jsonb_build_object('from', v_ytd_from, 'to', v_ytd_to),
        'fy', public.report_fy_of_date(v_to),
        'metrics', v_metrics,
        'fy_months', v_months);
END;
$$;

COMMENT ON FUNCTION public.get_report_comparison(text, date) IS
    'Headline numbers for a week or month with the previous period, financial-year-to-date (1 April), targets and last year''s year to date. Stocks carry no year to date or target. Targets are null (never 0) when none are set.';

-- ---------------------------------------------------------------------------
-- 4. get_report_coming_up
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_coming_up(p_period_type text, p_period_start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_pfrom date;
    v_pto   date;
    v_from  date;
    v_to    date;
    v_proc  jsonb;
    v_ord   jsonb;
    v_over  integer;
BEGIN
    IF p_period_type IS NULL OR p_period_type NOT IN ('weekly', 'monthly') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Period type must be weekly or monthly.');
    END IF;
    IF p_period_start IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'A period start date is required.');
    END IF;

    IF p_period_type = 'weekly' THEN
        v_pfrom := date_trunc('week', p_period_start)::date;
        v_pto   := v_pfrom + 6;
        v_from  := v_pto + 1;
        v_to    := v_pto + 7;
    ELSE
        v_pfrom := date_trunc('month', p_period_start)::date;
        v_pto   := (v_pfrom + interval '1 month' - interval '1 day')::date;
        v_from  := v_pto + 1;
        v_to    := (v_from + interval '1 month' - interval '1 day')::date;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'date', x.scheduled_date, 'grower', x.grower, 'kg', x.kg, 'truck', x.truck, 'confirmed', x.confirmed)
               ORDER BY x.scheduled_date, x.grower), '[]'::jsonb)
      INTO v_proc
      FROM (
          SELECT p.scheduled_date,
                 COALESCE(NULLIF(trim(p.grower_name), ''), c.company_name, c.trading_name, c.primary_contact_name, 'Grower') AS grower,
                 p.predicted_weight_kg AS kg,
                 p.truck_label AS truck,
                 p.is_confirmed AS confirmed
            FROM public.kernel_intake_procurement p
            LEFT JOIN public.contacts c ON c.id = p.supplier_id
           WHERE p.status <> 'cancelled'
             AND p.scheduled_date BETWEEN v_from AND v_to
      ) x;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'date', x.d, 'customer', x.customer, 'kg', x.kg, 'cartons', x.cartons,
               'value_zar', x.value_zar, 'stage', x.stage) ORDER BY x.d, x.customer), '[]'::jsonb)
      INTO v_ord
      FROM (
          SELECT COALESCE(o.planned_collection_date, o.delivery_date) AS d,
                 COALESCE(NULLIF(trim(o.buyer_name), ''), 'Customer') AS customer,
                 (SELECT sum(COALESCE(NULLIF(l->>'quantity_kg', '')::numeric,
                                      NULLIF(l->>'cartons', '')::numeric * 11.34))
                    FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) l) AS kg,
                 (SELECT sum(NULLIF(l->>'cartons', '')::numeric)
                    FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) l) AS cartons,
                 o.sale_value_zar AS value_zar,
                 o.workflow_stage AS stage
            FROM public.kernel_dispatch_orders o
           WHERE o.dispatched_at IS NULL
             AND o.status <> 'cancelled'
             AND COALESCE(o.planned_collection_date, o.delivery_date) BETWEEN v_from AND v_to
      ) x;

    SELECT count(*)::integer INTO v_over
      FROM public.kernel_dispatch_orders o
     WHERE o.dispatched_at IS NULL
       AND o.status <> 'cancelled'
       AND COALESCE(o.planned_collection_date, o.delivery_date) < v_from;

    RETURN jsonb_build_object(
        'success', true,
        'from', v_from, 'to', v_to,
        'procurement', v_proc,
        'procurement_kg', COALESCE((SELECT sum((e->>'kg')::numeric) FROM jsonb_array_elements(v_proc) e), 0),
        'orders', v_ord,
        'orders_kg', COALESCE((SELECT sum((e->>'kg')::numeric) FROM jsonb_array_elements(v_ord) e), 0),
        'orders_zar', COALESCE((SELECT sum((e->>'value_zar')::numeric) FROM jsonb_array_elements(v_ord) e), 0),
        'overdue_orders', COALESCE(v_over, 0));
END;
$$;

COMMENT ON FUNCTION public.get_report_coming_up(text, date) IS
    'Scheduled grower deliveries and undispatched customer orders in the week after a weekly report, or the month after a monthly one, plus the count of undispatched orders already overdue.';

-- ---------------------------------------------------------------------------
-- 5. report_build_snapshot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_build_snapshot(p_period_type text, p_period_start date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from date;
    v_to   date;
BEGIN
    IF p_period_type IS NULL OR p_period_type NOT IN ('weekly', 'monthly') OR p_period_start IS NULL THEN
        RETURN jsonb_build_object('version', 1, 'figures',
            jsonb_build_object('success', false, 'error', 'A weekly or monthly period start is required.'));
    END IF;
    IF p_period_type = 'weekly' THEN
        v_from := date_trunc('week', p_period_start)::date;
        v_to   := v_from + 6;
    ELSE
        v_from := date_trunc('month', p_period_start)::date;
        v_to   := (v_from + interval '1 month' - interval '1 day')::date;
    END IF;

    RETURN jsonb_build_object(
        'version', 1,
        'built_at', now(),
        'figures', public.get_reports_all_figures(v_from, v_to),
        'comparison', public.get_report_comparison(p_period_type, v_from),
        'coming_up', public.get_report_coming_up(p_period_type, v_from));
END;
$$;

COMMENT ON FUNCTION public.report_build_snapshot(text, date) IS
    'Builds the full Reports v2 payload for a period from live data. publish_report_instance stores it; drafts get it live through get_report_view.';

-- ---------------------------------------------------------------------------
-- 6. get_report_view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_view(p_report_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    ri       public.report_instances%ROWTYPE;
    v_label  text;
    v_frozen boolean;
    v_legacy boolean;
    v_snap   jsonb;
BEGIN
    SELECT * INTO ri FROM public.report_instances WHERE id = p_report_instance_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Report not found.');
    END IF;

    v_label := CASE WHEN ri.period_type = 'weekly'
                    THEN 'Wk ' || TO_CHAR(ri.period_start, 'IW') || ' · '
                         || TO_CHAR(ri.period_start, 'FMDD Mon') || ' to ' || TO_CHAR(ri.period_end, 'FMDD Mon')
                    ELSE TO_CHAR(ri.period_start, 'FMMon YYYY') END;
    v_frozen := ri.report_snapshot IS NOT NULL;
    v_legacy := ri.status <> 'draft' AND ri.report_snapshot IS NULL;

    IF v_frozen THEN
        v_snap := ri.report_snapshot;
    ELSIF v_legacy THEN
        v_snap := NULL;
    ELSE
        v_snap := public.report_build_snapshot(ri.period_type, ri.period_start);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'instance', jsonb_build_object(
            'id', ri.id,
            'period_type', ri.period_type,
            'period_start', ri.period_start,
            'period_end', ri.period_end,
            'period_label', v_label,
            'status', ri.status,
            'version', ri.version,
            'executive_summary', ri.executive_summary,
            'published_at', ri.published_at,
            'due_date', public.report_due_date(ri.period_type, ri.period_start)),
        'frozen', v_frozen,
        'legacy', v_legacy,
        'snapshot', v_snap);
END;
$$;

COMMENT ON FUNCTION public.get_report_view(uuid) IS
    'One-call view of a report: the stored snapshot when published (frozen), a live build for a draft, or legacy:true with no snapshot for reports published before Reports v2.';

-- ---------------------------------------------------------------------------
-- 7. publish_report_instance - same signature and return as 20260817100000, now freezing the snapshot
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_report_instance(
    p_report_instance_id uuid,
    p_actor_user_id      uuid DEFAULT NULL,
    p_pdf_storage_bucket text DEFAULT NULL,
    p_pdf_storage_path   text DEFAULT NULL,
    p_pdf_sha256         text DEFAULT NULL
)
RETURNS TABLE (success integer, error text, content_sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status  text;
    v_ptype   text;
    v_pstart  date;
    v_payload jsonb;
    v_hash    text;
    v_snap    jsonb;
BEGIN
    SELECT ri.status, ri.period_type, ri.period_start INTO v_status, v_ptype, v_pstart
      FROM public.report_instances ri WHERE ri.id = p_report_instance_id;
    IF v_status IS NULL THEN
        RETURN QUERY SELECT 0, 'Report not found.', NULL::text;
        RETURN;
    END IF;
    IF v_status <> 'draft' THEN
        RETURN QUERY SELECT 0, format('Report is already %s.', v_status), NULL::text;
        RETURN;
    END IF;

    -- Freeze exactly what is being issued; refuse rather than publish a report with unreadable figures.
    v_snap := public.report_build_snapshot(v_ptype, v_pstart);
    IF COALESCE(v_snap->'figures'->>'success', 'false') <> 'true' THEN
        RETURN QUERY SELECT 0, 'Figures could not be read: ' || COALESCE(v_snap->'figures'->>'error', ''), NULL::text;
        RETURN;
    END IF;

    v_payload := public.get_report_instance(p_report_instance_id);
    v_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

    UPDATE public.report_instances
    SET status             = 'published',
        published_by       = p_actor_user_id,
        published_at       = now(),
        content_sha256     = v_hash,
        report_snapshot    = v_snap,
        snapshot_sha256    = encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex'),
        pdf_storage_bucket = COALESCE(p_pdf_storage_bucket, pdf_storage_bucket),
        pdf_storage_path   = COALESCE(p_pdf_storage_path, pdf_storage_path),
        pdf_sha256         = COALESCE(p_pdf_sha256, pdf_sha256)
    WHERE id = p_report_instance_id;

    RETURN QUERY SELECT 1, NULL::text, v_hash;
END;
$$;

COMMENT ON FUNCTION public.publish_report_instance(uuid, uuid, text, text, text) IS
    'Freezes a draft report. After this the child rows are immutable by trigger, content_sha256 records exactly what was issued, and report_snapshot stores the Reports v2 figures as issued.';

-- ---------------------------------------------------------------------------
-- 8. Grants and bookkeeping
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public._report_headlines(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_comparison(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_coming_up(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_build_snapshot(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_view(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_report_instance(uuid, uuid, text, text, text) TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key = 'sales-forecasting-grid'
CROSS JOIN unnest(ARRAY['_report_headlines', 'get_report_comparison', 'get_report_coming_up',
                        'report_build_snapshot', 'get_report_view', 'publish_report_instance']) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
