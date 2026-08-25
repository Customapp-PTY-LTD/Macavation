-- The daily production report — figures, the WhatsApp menu's read RPCs, and a delivery log that
-- can hold a send with no report instance behind it.
--
-- Context. The report engine only knows 'weekly' and 'monthly' report instances
-- (migrations/20260817100000_report_instances_and_targets.sql:148). The daily production report is
-- not an instance at all: nobody edits it, nobody publishes it, there is no PDF. It is a fixed set
-- of figures sent at 17:00 SAST. So it needs its own read function, and the existing per-recipient
-- delivery log needs to accept a row that has no report_instance_id.
--
-- The single most important decision in this file: EVERY production figure is derived through
-- resolve_report_metric_value (migrations/20260821090000_report_engine_gaps.sql:386), the same
-- function the weekly report already uses — not by reading data_production_daily directly. That is
-- what makes the Thursday daily and Friday's weekly arithmetically unable to disagree about the same
-- day's tonnage. Given how much of this project has gone into reconciling contradictory figures
-- (docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md), one shared resolver is worth more than the
-- small cost of a function call per figure.
--
-- wholes_pct is the one exception: no metric key exists for it, so it is read straight off
-- data_production_daily. Noted at the point of use.
--
-- Metric keys. resolve_report_metric_value takes a report_metrics.metric_key and dispatches on that
-- row's source_kind. The 'data_page_*' strings are the SOURCE KIND, not the key — passing one as a
-- key raises 'Unknown report metric_key' (confirmed against dev, 2026-08-25). The real keys are
-- kernel_nis_cracking_kg, kernel_sk_packing_kg, nis_procured_kg, kernel_sales_excl_vat_zar and
-- oil_sales_excl_vat_zar.
--
-- Targets are keyed on the same metric_key. Weekly cracking targets currently stop at 2026-07-27, so
-- wtd_target_kg is NULL for any later week until someone loads them on the Report Targets screen.
-- NULL is rendered as "not captured", never as a zero target.
--
-- NULL is not zero anywhere in this file. A null figure means nobody captured it; rendering that as
-- 0 kg on a shareholder's phone would be a lie. has_production is the one flag the sender should
-- branch on.
--
-- Idempotency. Every statement is re-runnable: this repo's MCP apply path stamps its own migration
-- version, so a file can legitimately be executed more than once.

-- ============================================================================
-- 1. report_deliveries — carry a daily send
--
-- report_instance_id becomes nullable and four columns are added. The CHECK keeps the old guarantee
-- intact for weekly/monthly: those still cannot exist without an instance.
-- ============================================================================

ALTER TABLE public.report_deliveries ALTER COLUMN report_instance_id DROP NOT NULL;

ALTER TABLE public.report_deliveries ADD COLUMN IF NOT EXISTS report_kind   text NULL;
ALTER TABLE public.report_deliveries ADD COLUMN IF NOT EXISTS report_date   date NULL;
ALTER TABLE public.report_deliveries ADD COLUMN IF NOT EXISTS message_kind  text NULL;
ALTER TABLE public.report_deliveries ADD COLUMN IF NOT EXISTS template_name text NULL;

-- Backfill from the instance rather than defaulting everything to 'weekly': some existing rows are
-- monthly, and stamping them all weekly would put a wrong answer in the audit log.
UPDATE public.report_deliveries d
SET report_kind = ri.period_type
FROM public.report_instances ri
WHERE d.report_instance_id = ri.id AND d.report_kind IS NULL;

UPDATE public.report_deliveries SET report_kind = 'weekly' WHERE report_kind IS NULL;
UPDATE public.report_deliveries SET message_kind = 'text' WHERE message_kind IS NULL;

ALTER TABLE public.report_deliveries ALTER COLUMN report_kind  SET NOT NULL;
ALTER TABLE public.report_deliveries ALTER COLUMN report_kind  SET DEFAULT 'weekly';
ALTER TABLE public.report_deliveries ALTER COLUMN message_kind SET NOT NULL;
ALTER TABLE public.report_deliveries ALTER COLUMN message_kind SET DEFAULT 'text';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'report_deliveries_report_kind_check'
                     AND conrelid = 'public.report_deliveries'::regclass) THEN
        ALTER TABLE public.report_deliveries ADD CONSTRAINT report_deliveries_report_kind_check
            CHECK (report_kind IN ('daily', 'weekly', 'monthly'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'report_deliveries_message_kind_check'
                     AND conrelid = 'public.report_deliveries'::regclass) THEN
        ALTER TABLE public.report_deliveries ADD CONSTRAINT report_deliveries_message_kind_check
            CHECK (message_kind IN ('text', 'template'));
    END IF;

    -- A weekly or monthly delivery still REQUIRES its instance. Only 'daily' may stand alone.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'report_deliveries_instance_required_check'
                     AND conrelid = 'public.report_deliveries'::regclass) THEN
        ALTER TABLE public.report_deliveries ADD CONSTRAINT report_deliveries_instance_required_check
            CHECK (report_kind = 'daily' OR report_instance_id IS NOT NULL);
    END IF;
END;
$$;

-- Supports the idempotency guard, which asks "has today's daily already gone out".
CREATE INDEX IF NOT EXISTS idx_report_deliveries_kind_date
    ON public.report_deliveries (report_kind, report_date, status);

COMMENT ON COLUMN public.report_deliveries.report_kind IS
    'daily | weekly | monthly. A daily row has no report_instance_id — there is no such instance.';
COMMENT ON COLUMN public.report_deliveries.message_kind IS
    'text = free-form (only permitted inside Meta''s 24-hour window); template = an approved template.';

-- ============================================================================
-- 2. begin_report_delivery / complete_report_delivery — widened
--
-- CREATE OR REPLACE cannot add parameters, and adding them as a second overload would make every
-- existing 9-argument call ambiguous, so the old signatures are dropped and recreated. The first
-- nine parameters keep their exact names, order and meaning, so the existing caller in
-- supabase/functions/send-report-whatsapp/index.ts keeps working untouched.
-- ============================================================================

DROP FUNCTION IF EXISTS public.begin_report_delivery(uuid, text, text, uuid, text, text, text, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.complete_report_delivery(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.begin_report_delivery(
    p_report_instance_id uuid,
    p_phone              text,
    p_display_name       text DEFAULT NULL,
    p_recipient_id       uuid DEFAULT NULL,
    p_message_body       text DEFAULT NULL,
    p_pdf_storage_bucket text DEFAULT NULL,
    p_pdf_storage_path   text DEFAULT NULL,
    p_link_expires_at    timestamptz DEFAULT NULL,
    p_actor_user_id      uuid DEFAULT NULL,
    p_report_kind        text DEFAULT 'weekly',
    p_report_date        date DEFAULT NULL,
    p_message_kind       text DEFAULT 'text',
    p_template_name      text DEFAULT NULL
)
RETURNS TABLE (success int, error text, id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_phone text := public.report_normalize_wa_phone(p_phone);
    v_kind  text := lower(TRIM(COALESCE(p_report_kind, 'weekly')));
    v_msg   text := lower(TRIM(COALESCE(p_message_kind, 'text')));
    v_id    uuid;
BEGIN
    IF v_kind NOT IN ('daily', 'weekly', 'monthly') THEN
        RETURN QUERY SELECT 0, 'p_report_kind must be daily, weekly or monthly.', NULL::uuid;
        RETURN;
    END IF;

    IF v_msg NOT IN ('text', 'template') THEN
        RETURN QUERY SELECT 0, 'p_message_kind must be text or template.', NULL::uuid;
        RETURN;
    END IF;

    -- A daily send has no instance by design; weekly and monthly still must have one.
    IF v_kind <> 'daily' THEN
        IF p_report_instance_id IS NULL THEN
            RETURN QUERY SELECT 0, 'p_report_instance_id is required.', NULL::uuid;
            RETURN;
        END IF;

        -- ri.id must be alias-qualified: this function's RETURNS TABLE declares an OUT column named
        -- `id`, which otherwise shadows the table column and raises 42702 at call time.
        IF NOT EXISTS (SELECT 1 FROM public.report_instances ri WHERE ri.id = p_report_instance_id) THEN
            RETURN QUERY SELECT 0, 'Report not found.', NULL::uuid;
            RETURN;
        END IF;
    END IF;

    IF v_phone IS NULL THEN
        RETURN QUERY SELECT 0, 'A valid phone number is required.', NULL::uuid;
        RETURN;
    END IF;

    INSERT INTO public.report_deliveries
        (report_instance_id, recipient_id, phone, display_name, status, message_body,
         pdf_storage_bucket, pdf_storage_path, link_expires_at, sent_by,
         report_kind, report_date, message_kind, template_name)
    VALUES
        (p_report_instance_id, p_recipient_id, v_phone,
         NULLIF(TRIM(COALESCE(p_display_name, '')), ''), 'pending', p_message_body,
         p_pdf_storage_bucket, p_pdf_storage_path, p_link_expires_at, p_actor_user_id,
         v_kind, p_report_date, v_msg, NULLIF(TRIM(COALESCE(p_template_name, '')), ''))
    RETURNING report_deliveries.id INTO v_id;

    RETURN QUERY SELECT 1, NULL::text, v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.complete_report_delivery(
    p_delivery_id         uuid,
    p_status              text,
    p_external_message_id text DEFAULT NULL,
    p_error               text DEFAULT NULL,
    p_message_body        text DEFAULT NULL
)
RETURNS TABLE (success int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_status text := lower(TRIM(COALESCE(p_status, '')));
BEGIN
    IF p_delivery_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_delivery_id is required.';
        RETURN;
    END IF;

    IF v_status NOT IN ('sent', 'failed') THEN
        RETURN QUERY SELECT 0, 'p_status must be sent or failed.';
        RETURN;
    END IF;

    UPDATE public.report_deliveries
    SET status              = v_status,
        external_message_id = COALESCE(p_external_message_id, external_message_id),
        -- The gateway's own message is kept verbatim: a WhatsApp send can fail for reasons the
        -- portal cannot anticipate (falling outside Meta's 24-hour window being the likeliest), and
        -- a generic "failed" would hide the only actionable detail.
        error               = CASE WHEN v_status = 'failed'
                                   THEN COALESCE(NULLIF(TRIM(COALESCE(p_error, '')), ''), 'Send failed.')
                                   ELSE NULL END,
        message_body        = COALESCE(p_message_body, message_body),
        completed_at        = now()
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Delivery not found.';
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text;
END;
$fn$;

-- list_report_deliveries gains message_kind as a final column. Note the delivery's own error stays
-- exposed as `delivery_error` — `error` belongs to the envelope, and
-- scripts/verify-report-whatsapp-history.mjs asserts the two are never conflated.
-- Adding message_kind changes the OUT row type, which CREATE OR REPLACE cannot do
-- (42P13 "cannot change return type of existing function"), so the old one is dropped first.
DROP FUNCTION IF EXISTS public.list_report_deliveries(uuid);

CREATE OR REPLACE FUNCTION public.list_report_deliveries(
    p_report_instance_id uuid
)
RETURNS TABLE (
    success             int,
    error               text,
    id                  uuid,
    recipient_id        uuid,
    phone               text,
    display_name        text,
    channel             text,
    status              text,
    external_message_id text,
    delivery_error      text,
    sent_by             uuid,
    sent_by_name        text,
    created_at          timestamptz,
    completed_at        timestamptz,
    link_expires_at     timestamptz,
    message_kind        text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
    IF p_report_instance_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_report_instance_id is required.', NULL::uuid, NULL::uuid,
                            NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
                            NULL::uuid, NULL::text, NULL::timestamptz, NULL::timestamptz,
                            NULL::timestamptz, NULL::text;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 1, NULL::text, d.id, d.recipient_id, d.phone, d.display_name, d.channel, d.status,
           d.external_message_id, d.error, d.sent_by,
           NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
           d.created_at, d.completed_at, d.link_expires_at, d.message_kind
    FROM public.report_deliveries d
    LEFT JOIN public.users u ON u.id = d.sent_by
    WHERE d.report_instance_id = p_report_instance_id
    ORDER BY d.created_at DESC;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.daily_report_already_sent(p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM public.report_deliveries d
        WHERE d.report_kind = 'daily' AND d.report_date = p_date AND d.status = 'sent'
    );
$fn$;

-- ============================================================================
-- 3. get_daily_production_report — the 17:00 message's figures
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_daily_production_report(p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_d        date := COALESCE(p_date, public.report_sast_today());
    v_week     date := public.report_week_start(v_d);
    v_cracked  numeric;
    v_packed   numeric;
    v_nis      numeric;
    v_wtd      numeric;
    v_target   numeric;
    v_wholes   numeric;
    v_seeded   timestamptz;
BEGIN
    -- Same resolver the weekly report uses, so the two cannot disagree about this day.
    v_cracked := public.resolve_report_metric_value('kernel_nis_cracking_kg', v_d, v_d);
    v_packed  := public.resolve_report_metric_value('kernel_sk_packing_kg',  v_d, v_d);
    v_nis     := public.resolve_report_metric_value('nis_procured_kg',        v_d, v_d);
    v_wtd     := public.resolve_report_metric_value('kernel_nis_cracking_kg', v_week, v_d);

    SELECT t.target_value INTO v_target
    FROM public.report_period_targets t
    WHERE t.metric_key = 'kernel_nis_cracking_kg'
      AND t.period_type = 'weekly'
      AND t.period_start = v_week;

    -- wholes_pct has no metric key, so it is the one figure read straight off the data page.
    SELECT dpd.wholes_pct, dpd.seeded_at INTO v_wholes, v_seeded
    FROM public.data_production_daily dpd
    WHERE dpd.production_date = v_d;

    RETURN jsonb_build_object(
        'report_date',    v_d,
        'date_label',     to_char(v_d, 'Dy FMDD Mon YYYY'),
        -- The sender branches on this alone. A day with neither cracking nor packing captured is a
        -- day the factory did not run: no message goes out at all, rather than a row of "0 kg".
        'has_production', (COALESCE(v_cracked, 0) > 0 OR COALESCE(v_packed, 0) > 0),
        'refreshed_at',   v_seeded,
        'cracked_kg',     v_cracked,
        'sk_packed_kg',   v_packed,
        'wholes_pct',     v_wholes,
        'nis_kg',         v_nis,
        'week_start',     v_week,
        'week_label',     to_char(v_week, 'Dy FMDD Mon') || ' to ' || to_char(v_d, 'Dy FMDD Mon'),
        'wtd_cracked_kg', v_wtd,
        'wtd_target_kg',  v_target
    );
END;
$fn$;

-- ============================================================================
-- 4. get_period_production_summary — the WEEK and MONTH menu answers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_period_production_summary(p_kind text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_kind    text := lower(TRIM(COALESCE(p_kind, '')));
    v_today   date := public.report_sast_today();
    v_ptype   text;
    v_start   date;
    v_end     date;
    v_cracked numeric;
    v_target  numeric;
BEGIN
    IF v_kind IN ('week', 'weekly') THEN
        v_ptype := 'weekly';
    ELSIF v_kind IN ('month', 'monthly') THEN
        v_ptype := 'monthly';
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'p_kind must be week or month.');
    END IF;

    v_start := public.report_normalise_period_start(v_ptype, v_today);
    v_end   := public.report_period_end(v_ptype, v_start);

    v_cracked := public.resolve_report_metric_value('kernel_nis_cracking_kg', v_start, v_today);

    SELECT t.target_value INTO v_target
    FROM public.report_period_targets t
    WHERE t.metric_key = 'kernel_nis_cracking_kg'
      AND t.period_type = v_ptype
      AND t.period_start = v_start;

    RETURN jsonb_build_object(
        'ok',               true,
        'label',            public.report_period_label(v_ptype, v_start),
        'range_label',      to_char(v_start, 'Dy FMDD Mon') || ' to ' || to_char(v_today, 'Dy FMDD Mon'),
        'cracked_kg',       v_cracked,
        'target_kg',        v_target,
        -- NULL rather than a divide-by-zero or a fake 0%: no target set is not the same as missing it.
        'pct_of_target',    CASE WHEN COALESCE(v_target, 0) > 0
                                 THEN round((COALESCE(v_cracked, 0) / v_target) * 100, 1)
                                 ELSE NULL END,
        'days_left',        GREATEST(v_end - v_today, 0),
        'kernel_sales_zar', public.resolve_report_metric_value('kernel_sales_excl_vat_zar', v_start, v_today),
        'oil_sales_zar',    public.resolve_report_metric_value('oil_sales_excl_vat_zar',    v_start, v_today)
    );
END;
$fn$;

-- ============================================================================
-- 5. get_kernel_stock_summary — the STOCK menu answer
--
-- Reads get_stock_soh_history('kernel', 7) and takes its most recent day. Styles sitting at zero
-- are dropped: a WhatsApp message listing six zeroes buries the four numbers that matter.
--
-- Written as one CTE query, not a temp table: a STABLE function may not execute CREATE/INSERT, and
-- Postgres rejects it outright with "INSERT is not allowed in a non-volatile function".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kernel_stock_summary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    WITH h AS (
        SELECT s.d, s.series, s.qty_kg FROM public.get_stock_soh_history('kernel', 7) s
    ),
    latest AS (SELECT max(h.d) AS d FROM h),
    live AS (
        SELECT h.series, h.qty_kg
        FROM h JOIN latest l ON h.d = l.d
        WHERE COALESCE(h.qty_kg, 0) > 0
    )
    SELECT jsonb_build_object(
        'ok',       true,
        'label',    CASE WHEN (SELECT d FROM latest) IS NULL
                         THEN 'No kernel stock history available'
                         ELSE 'Kernel stock on hand' END,
        'as_of',    (SELECT d FROM latest),
        'lines',    COALESCE((SELECT jsonb_agg(jsonb_build_object('style', series, 'kg', qty_kg)
                                               ORDER BY qty_kg DESC) FROM live), '[]'::jsonb),
        'total_kg', (SELECT sum(qty_kg) FROM live)
    );
$fn$;

-- ============================================================================
-- 6. get_open_alerts_summary — the ALERTS menu answer
--
-- Same source and filter get_daily_digest already uses (dashboard_alerts, status = 'active'), so
-- the WhatsApp answer and the email digest cannot disagree about what is outstanding.
--
-- Grouped by alert_title, because the live table really does hold the same alert many times over
-- (dev, 2026-08-25: 16 active alerts, 8 of them the identical 'Low stock: Protein *'). Listing them
-- one per line would fill a phone screen with one repeated sentence and bury everything else, so a
-- duplicated alert becomes a single line carrying its own occurrence count. `count` stays the true
-- total so nobody thinks alerts went missing.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_open_alerts_summary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    WITH active AS (
        SELECT a.alert_title, a.severity, a.created_at
        FROM public.dashboard_alerts a
        WHERE a.status = 'active'
    ),
    grouped AS (
        SELECT alert_title,
               count(*)::int AS occurrences,
               max(created_at) AS latest,
               -- 'critical' outranks 'warning' outranks anything else; min() over the rank picks the
               -- most severe of a duplicated group rather than an arbitrary one.
               (ARRAY['critical','warning','info'])[
                   min(CASE lower(severity) WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END)
               ] AS severity
        FROM active
        GROUP BY alert_title
    )
    SELECT jsonb_build_object(
        'ok',            true,
        'count',         (SELECT count(*)::int FROM active),
        'distinct_count',(SELECT count(*)::int FROM grouped),
        'lines',         COALESCE((
            SELECT jsonb_agg(jsonb_build_object('severity', g.severity,
                                                'text', g.alert_title,
                                                'occurrences', g.occurrences)
                             ORDER BY g.latest DESC)
            FROM (SELECT * FROM grouped ORDER BY latest DESC LIMIT 8) g
        ), '[]'::jsonb)
    );
$fn$;

-- ============================================================================
-- 7. recipient_last_inbound_at — is this number inside Meta's 24-hour window?
--
-- The weekly/monthly sender asks this per recipient to decide between free text and an approved
-- template. Matching is on chat_normalize_phone of BOTH sides: chat_conversations.external_phone
-- holds bare digits while the roster holds '+27…', and comparing the two forms directly matches
-- nobody, silently.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recipient_last_inbound_at(p_phone text)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT max(m.created_at)
    FROM public.chat_messages m
    JOIN public.chat_conversations c ON c.conversation_id = m.conversation_id
    WHERE m.direction = 'inbound_whatsapp'
      AND public.chat_normalize_phone(c.external_phone) = public.chat_normalize_phone(p_phone);
$fn$;

-- ============================================================================
-- 8. get_report_current_period — corrected to SAST
--
-- Was bare CURRENT_DATE, which is UTC on this server. Between midnight and 02:00 SAST that filed a
-- report against the previous day, and therefore potentially the previous week or month. Body is
-- otherwise unchanged from migrations/20260817090000_report_builder_foundations.sql:144.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_report_current_period(p_period_type text)
RETURNS TABLE (
    period_type    text,
    period_start   date,
    period_end     date,
    fy             integer,
    fy_month_index integer,
    period_label   text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT p_period_type,
           s.period_start,
           public.report_period_end(p_period_type, s.period_start),
           public.report_fy_of_date(s.period_start),
           public.report_fy_month_index(s.period_start),
           public.report_period_label(p_period_type, s.period_start)
    FROM (SELECT public.report_normalise_period_start(p_period_type, public.report_sast_today()) AS period_start) s
    WHERE s.period_start IS NOT NULL;
$fn$;

-- ============================================================================
-- 9. Grants
--
-- The figure functions go to service_role ONLY. They are read by the WhatsApp edge functions with
-- the service-role key. The portal has its own screens for all of this and does not need them, and
-- an anon-reachable production-figures RPC is reachable by anyone on the internet holding the
-- publicly committed anon key.
--
-- get_report_current_period keeps its existing broad grant — the report editor calls it.
-- ============================================================================

REVOKE ALL ON FUNCTION public.get_daily_production_report(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_period_production_summary(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_kernel_stock_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_open_alerts_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recipient_last_inbound_at(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.daily_report_already_sent(date) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_daily_production_report(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_period_production_summary(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_stock_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_open_alerts_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.recipient_last_inbound_at(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.daily_report_already_sent(date) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_report_current_period(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_report_deliveries(uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.begin_report_delivery(uuid, text, text, uuid, text, text, text, timestamptz, uuid, text, date, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_report_delivery(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_report_delivery(uuid, text, text, uuid, text, text, text, timestamptz, uuid, text, date, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_report_delivery(uuid, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
