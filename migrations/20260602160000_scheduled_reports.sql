-- Sprint 4B: Scheduled reporting (daily digest).
-- Schema + content RPC. Delivery is performed by a Supabase Edge Function on a
-- cron schedule that calls get_daily_digest() and emails subscribers. WhatsApp
-- delivery is deferred until Business API credentials are available.

CREATE TABLE IF NOT EXISTS public.scheduled_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NULL,
    email text NULL,
    report_type varchar(40) NOT NULL DEFAULT 'daily_digest',
    channel varchar(20) NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp')),
    is_active boolean NOT NULL DEFAULT true,
    last_sent_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_active ON public.scheduled_reports (is_active);

REVOKE ALL ON TABLE public.scheduled_reports FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_reports TO service_role;

CREATE OR REPLACE FUNCTION public.get_scheduled_reports()
RETURNS SETOF public.scheduled_reports
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT * FROM public.scheduled_reports ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.upsert_scheduled_report(
    p_id uuid,
    p_user_id uuid,
    p_email text,
    p_report_type text,
    p_channel text,
    p_is_active boolean
)
RETURNS SETOF public.scheduled_reports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_channel text := lower(trim(coalesce(p_channel, 'email')));
    v_id uuid;
BEGIN
    IF v_channel NOT IN ('email', 'whatsapp') THEN v_channel := 'email'; END IF;
    IF p_id IS NULL THEN
        INSERT INTO public.scheduled_reports (user_id, email, report_type, channel, is_active)
        VALUES (p_user_id, NULLIF(trim(coalesce(p_email, '')), ''), coalesce(NULLIF(trim(p_report_type), ''), 'daily_digest'),
                v_channel, coalesce(p_is_active, true))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.scheduled_reports
        SET user_id = p_user_id, email = NULLIF(trim(coalesce(p_email, '')), ''),
            report_type = coalesce(NULLIF(trim(p_report_type), ''), 'daily_digest'),
            channel = v_channel, is_active = coalesce(p_is_active, true), updated_at = now()
        WHERE id = p_id;
        v_id := p_id;
    END IF;
    RETURN QUERY SELECT * FROM public.scheduled_reports WHERE id = v_id;
END;
$$;

-- ============================================================
-- Daily digest content: production summary, open alerts, procurement today.
-- Returned as JSON so the edge function can render email/WhatsApp.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_kernel jsonb;
    v_alerts jsonb;
    v_procurement jsonb;
BEGIN
    SELECT to_jsonb(s) INTO v_kernel FROM public.get_dashboard_kernel_stats() s;

    SELECT jsonb_agg(x) INTO v_alerts FROM (
        SELECT jsonb_build_object(
            'title', a.alert_title, 'severity', a.severity, 'type', a.alert_type, 'created_at', a.created_at
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

    RETURN jsonb_build_object(
        'generated_at', now(),
        'date', current_date,
        'kernel_stats', COALESCE(v_kernel, '{}'::jsonb),
        'open_alerts', COALESCE(v_alerts, '[]'::jsonb),
        'procurement_today', COALESCE(v_procurement, '{}'::jsonb)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_scheduled_reports() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_scheduled_report(uuid, uuid, text, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_digest() TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY['get_scheduled_reports', 'upsert_scheduled_report', 'get_daily_digest'];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

COMMENT ON TABLE public.scheduled_reports IS 'Subscriptions for scheduled report delivery (email now, WhatsApp deferred).';
COMMENT ON FUNCTION public.get_daily_digest() IS 'Daily digest payload for the scheduled report edge function.';

NOTIFY pgrst, 'reload schema';
