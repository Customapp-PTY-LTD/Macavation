-- Insert an active dashboard alert (e.g. oil supplier intake weight discrepancy before production).
-- Run via Supabase SQL Editor or MCP execute_sql on the project your Lambda uses.

CREATE OR REPLACE FUNCTION public.create_dashboard_alert_simple(
    p_alert_title   varchar,
    p_alert_message text DEFAULT NULL,
    p_batch_number  varchar DEFAULT NULL,
    p_alert_type    varchar DEFAULT 'stock_low',
    p_severity      varchar DEFAULT 'warning'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
    v_num varchar(50);
BEGIN
    IF p_alert_title IS NULL OR trim(p_alert_title) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'alert_title is required');
    END IF;

    v_num := 'ALT-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

    INSERT INTO public.dashboard_alerts (
        alert_number,
        alert_type,
        severity,
        batch_number,
        alert_title,
        alert_message,
        status
    )
    VALUES (
        v_num,
        COALESCE(NULLIF(trim(p_alert_type), ''), 'stock_low'),
        COALESCE(NULLIF(trim(p_severity), ''), 'warning'),
        NULLIF(trim(COALESCE(p_batch_number, '')), ''),
        trim(p_alert_title),
        p_alert_message,
        'active'
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id, 'alert_number', v_num);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.create_dashboard_alert_simple IS 'Insert active dashboard_alerts row; used when oil intake weight before production is >50 kg below intake weight.';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id, 'function', 'create_dashboard_alert_simple', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;
