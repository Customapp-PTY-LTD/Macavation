-- ============================================================================
-- Switching a task kind ON for a role also notifies that role of the tasks already waiting.
--
-- WHY. 20261027150000 notifies the roles that get a task when it is CREATED. A role switched on
-- later saw the waiting tasks in My Day but got no bell notification for them. Henry left the
-- call to me (27 Oct 2026): notify them, once per task per role, so the red bubble and the bell
-- agree. The notification text now lives in one place, _notify_task_role, used by both paths.
-- Replaces _notify_task (20261027150000) and the switch trigger function (20261027140000); the
-- switch still turns My Day on too.
-- ============================================================================

-- One notification for one task to one role, unless that role already has one for it.
CREATE OR REPLACE FUNCTION public._notify_task_role(p_task_id uuid, p_role_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    t      public.workflow_tasks%ROWTYPE;
    v_body text;
BEGIN
    SELECT * INTO t FROM public.workflow_tasks WHERE id = p_task_id;
    IF NOT FOUND OR t.status IN ('completed', 'dismissed') OR p_role_id IS NULL THEN RETURN 0; END IF;
    IF EXISTS (SELECT 1 FROM public.notifications
               WHERE link_params ->> 'task_id' = t.id::text AND target_role_id = p_role_id) THEN
        RETURN 0;
    END IF;

    IF t.kind = 'transport_rate' THEN
        SELECT concat_ws(' · ',
                   NULLIF(k.grower_name, ''),
                   NULLIF(k.intake_data #>> '{delivery,transport,transporter_name}', ''),
                   'delivery note ' || NULLIF(k.intake_data #>> '{delivery,transport,delivery_note_ref}', ''))
               || '. Enter the rate in My Day.'
        INTO v_body
        FROM public.kernel k WHERE k.id = t.kernel_id;
    ELSE
        v_body := COALESCE(t.description, 'Open My Day to see it.');
    END IF;

    INSERT INTO public.notifications (title, body, notification_type, severity, link_route, link_params, target_role_id)
    VALUES (CASE WHEN t.kind = 'transport_rate'
                 THEN replace(t.title, 'Enter transport rate', 'Transport rate needed')
                 ELSE 'New task: ' || t.title END,
            v_body, 'task', 'info', 'my-day', jsonb_build_object('task_id', t.id), p_role_id);
    RETURN 1;
END;
$$;

-- Every role that gets this task (task-<kind> switch on; kind-less: its own role).
CREATE OR REPLACE FUNCTION public._notify_task(p_task_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    t   public.workflow_tasks%ROWTYPE;
    v_n integer := 0;
    r   record;
BEGIN
    SELECT * INTO t FROM public.workflow_tasks WHERE id = p_task_id;
    IF NOT FOUND THEN RETURN 0; END IF;
    FOR r IN SELECT id FROM public.roles
             WHERE CASE WHEN t.kind IS NULL THEN role_name = t.role
                        ELSE role_name = ANY (public._task_kind_roles(t.kind)) END
    LOOP
        v_n := v_n + public._notify_task_role(t.id, r.id);
    END LOOP;
    RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public._role_task_switch_needs_my_day()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_key text;
BEGIN
    SELECT key INTO v_key FROM public.features WHERE id = NEW.feature_id;
    IF NEW.value = 'true' AND v_key LIKE 'task-%' THEN
        INSERT INTO public.role_features (role_id, feature_id, value)
        SELECT NEW.role_id, f.id, 'true' FROM public.features f WHERE f.key = 'my-day'
        ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

        -- task-transport-rate -> transport_rate: tell this role about the tasks already waiting.
        PERFORM public._notify_task_role(t.id, NEW.role_id)
        FROM public.workflow_tasks t
        WHERE t.kind = replace(substr(v_key, 6), '-', '_')
          AND t.status NOT IN ('completed', 'dismissed');
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_task_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._notify_task(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._role_task_switch_needs_my_day() FROM PUBLIC, anon, authenticated;
