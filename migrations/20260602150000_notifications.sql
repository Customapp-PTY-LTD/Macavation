-- Sprint 4A: Internal notifications (in-system inbox).
-- A notification targets a specific user OR a role (everyone with that role).
-- Read state is per-user via notification_reads.

CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    body text NULL,
    notification_type varchar(40) NOT NULL DEFAULT 'info',
    severity varchar(20) NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    link_route text NULL,                    -- optional app route to deep-link to
    target_user_id uuid NULL,
    target_role_id uuid NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    created_by uuid NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_target_user ON public.notifications (target_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON public.notifications (target_role_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_reads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    read_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON public.notification_reads (user_id);

REVOKE ALL ON TABLE public.notifications FROM PUBLIC;
REVOKE ALL ON TABLE public.notification_reads FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notifications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_reads TO service_role;

-- ============================================================
-- Create a notification (targeted to a user, a role, or broadcast)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_notification(
    p_title text,
    p_body text DEFAULT NULL,
    p_type text DEFAULT 'info',
    p_severity text DEFAULT 'info',
    p_link_route text DEFAULT NULL,
    p_target_user_id uuid DEFAULT NULL,
    p_target_role_id uuid DEFAULT NULL,
    p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id uuid;
    v_sev text := lower(trim(coalesce(p_severity, 'info')));
BEGIN
    IF p_title IS NULL OR trim(p_title) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'title is required');
    END IF;
    IF v_sev NOT IN ('info', 'warning', 'critical') THEN v_sev := 'info'; END IF;

    INSERT INTO public.notifications (title, body, notification_type, severity, link_route, target_user_id, target_role_id, created_by)
    VALUES (trim(p_title), p_body, coalesce(NULLIF(trim(p_type), ''), 'info'), v_sev, NULLIF(trim(coalesce(p_link_route, '')), ''),
            p_target_user_id, p_target_role_id, p_created_by)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- Notify everyone with a given role name (workflow helper).
CREATE OR REPLACE FUNCTION public.notify_role(
    p_role_name text,
    p_title text,
    p_body text DEFAULT NULL,
    p_type text DEFAULT 'info',
    p_severity text DEFAULT 'info',
    p_link_route text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role_id uuid;
BEGIN
    SELECT id INTO v_role_id FROM public.roles WHERE role_name = p_role_name LIMIT 1;
    IF v_role_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'role not found');
    END IF;
    RETURN public.create_notification(p_title, p_body, p_type, p_severity, p_link_route, NULL, v_role_id, NULL);
END;
$$;

-- ============================================================
-- Inbox: notifications for a user (direct + role-targeted) with read flag
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_notifications(
    p_user_id uuid,
    p_role_id uuid DEFAULT NULL,
    p_limit integer DEFAULT 50
)
RETURNS TABLE (
    id uuid,
    title text,
    body text,
    notification_type varchar,
    severity varchar,
    link_route text,
    created_at timestamptz,
    is_read boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        n.id, n.title, n.body, n.notification_type, n.severity, n.link_route, n.created_at,
        (r.id IS NOT NULL) AS is_read
    FROM public.notifications n
    LEFT JOIN public.notification_reads r ON r.notification_id = n.id AND r.user_id = p_user_id
    WHERE n.target_user_id = p_user_id
       OR (p_role_id IS NOT NULL AND n.target_role_id = p_role_id)
       OR (n.target_user_id IS NULL AND n.target_role_id IS NULL)   -- broadcast
    ORDER BY n.created_at DESC
    LIMIT GREATEST(1, p_limit);
$$;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id uuid, p_role_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT count(*)::integer
    FROM public.notifications n
    LEFT JOIN public.notification_reads r ON r.notification_id = n.id AND r.user_id = p_user_id
    WHERE r.id IS NULL
      AND (
          n.target_user_id = p_user_id
          OR (p_role_id IS NOT NULL AND n.target_role_id = p_role_id)
          OR (n.target_user_id IS NULL AND n.target_role_id IS NULL)
      );
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.notification_reads (notification_id, user_id)
    VALUES (p_notification_id, p_user_id)
    ON CONFLICT (notification_id, user_id) DO NOTHING;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid, p_role_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
    INSERT INTO public.notification_reads (notification_id, user_id)
    SELECT n.id, p_user_id
    FROM public.notifications n
    LEFT JOIN public.notification_reads r ON r.notification_id = n.id AND r.user_id = p_user_id
    WHERE r.id IS NULL
      AND (
          n.target_user_id = p_user_id
          OR (p_role_id IS NOT NULL AND n.target_role_id = p_role_id)
          OR (n.target_user_id IS NULL AND n.target_role_id IS NULL)
      )
    ON CONFLICT (notification_id, user_id) DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ============================================================
-- Workflow hook: when a dashboard alert is created, notify ops.
-- Demonstrates stock red flag -> notification (Epic 4 -> Epic 8).
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_dashboard_alert_to_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role_id uuid;
BEGIN
    -- Prefer a stock-facing role; fall back to admin.
    SELECT id INTO v_role_id FROM public.roles
    WHERE role_name IN ('Office Administrator', 'General Manager', 'admin', 'super_user')
    ORDER BY array_position(ARRAY['Office Administrator','General Manager','admin','super_user'], role_name)
    LIMIT 1;

    PERFORM public.create_notification(
        COALESCE(NEW.alert_title, 'Dashboard alert'),
        NEW.alert_message,
        COALESCE(NEW.alert_type, 'alert'),
        COALESCE(NEW.severity, 'warning'),
        'dashboard',
        NULL,
        v_role_id,
        NULL
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dashboard_alert_to_notification ON public.dashboard_alerts;
CREATE TRIGGER trg_dashboard_alert_to_notification
    AFTER INSERT ON public.dashboard_alerts
    FOR EACH ROW
    WHEN (NEW.status = 'active')
    EXECUTE FUNCTION public.tg_dashboard_alert_to_notification();

-- ============================================================
-- Grants + RBAC
-- ============================================================
GRANT EXECUTE ON FUNCTION public.create_notification(text, text, text, text, text, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_role(text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_notifications(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid, uuid) TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'create_notification', 'notify_role', 'get_my_notifications',
        'get_unread_notification_count', 'mark_notification_read', 'mark_all_notifications_read'
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

COMMENT ON TABLE public.notifications IS 'Internal notifications inbox; targeted to a user, a role, or broadcast.';

NOTIFY pgrst, 'reload schema';
