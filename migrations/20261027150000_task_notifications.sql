-- ============================================================================
-- A notification (sidebar bell) for every new task.
--
-- WHY. Henry (27 Oct 2026): "add a notification for each task". The bell already shows
-- role-targeted notifications (notifications.target_role_id, get_my_notifications), so each new
-- task sends one notification to every role that gets it: for a task with a kind, the roles whose
-- Role Features switch task-<kind> is on (_task_kind_roles, 20261027140000); for a kind-less task,
-- its own role. Clicking it opens My Day.
--
-- Done by a trigger on workflow_tasks, so every future kind of task notifies with no extra work.
-- Tasks already open when this runs (the 8 transport-rate tasks on prod) are notified once here.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._notify_task(p_task_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    t      public.workflow_tasks%ROWTYPE;
    v_body text;
    v_n    integer;
BEGIN
    SELECT * INTO t FROM public.workflow_tasks WHERE id = p_task_id;
    IF NOT FOUND OR t.status IN ('completed', 'dismissed') THEN RETURN 0; END IF;

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
    SELECT CASE WHEN t.kind = 'transport_rate'
                THEN replace(t.title, 'Enter transport rate', 'Transport rate needed')
                ELSE 'New task: ' || t.title END,
           v_body, 'task', 'info', 'my-day', jsonb_build_object('task_id', t.id), r.id
    FROM public.roles r
    WHERE CASE WHEN t.kind IS NULL THEN r.role_name = t.role
               ELSE r.role_name = ANY (public._task_kind_roles(t.kind)) END;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public._workflow_task_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public._notify_task(NEW.id);
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_task(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._workflow_task_notify() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER workflow_task_notify
    AFTER INSERT ON public.workflow_tasks
    FOR EACH ROW EXECUTE FUNCTION public._workflow_task_notify();

-- Once, for tasks already open.
SELECT public._notify_task(t.id)
FROM public.workflow_tasks t
WHERE t.status NOT IN ('completed', 'dismissed')
  AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.link_params ->> 'task_id' = t.id::text);
