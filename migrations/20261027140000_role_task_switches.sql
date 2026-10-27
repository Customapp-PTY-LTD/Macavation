-- ============================================================================
-- Role tasks: which roles get a kind of task is a per-role switch in Role Features.
--
-- WHY. Henry (27 Oct 2026): tasks must be able to be turned on and off for other roles too.
-- 20261027130000 stamped each transport-rate task with ONE role from a setting. Now each task kind
-- has a feature, `task-<kind>` (transport_rate -> task-transport-rate), and a task of that kind is
-- shown to EVERY role whose switch is on, decided when tasks are read, so flipping a switch
-- applies to tasks already open as well as new ones. super_user still sees everything.
--
--   features        task-transport-rate "Tasks: enter transport rates" (shows on Role Features)
--   role_features   on for Palladium Manager (same people as before)
--   workflow_tasks  kind tasks carry role = 'task-<kind>' (the column is NOT NULL); kind-less
--                   tasks still match on role as before
--   get_role_tasks  visibility by switch; 'role' in its result = the roles currently switched on
--   trigger         switching a task kind ON for a role also switches My Day on, so the tasks
--                   have somewhere to show
--
-- kernel_pipeline_settings.transport_rate_task_role (from 20261027130000) is no longer read.
-- ============================================================================

INSERT INTO public.features (key, name, description, is_active)
VALUES ('task-transport-rate', 'Tasks: enter transport rates',
        'Gets an "Enter transport rate" task in My Day for each delivery saved without a transport rate.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE r.role_name = 'Palladium Manager' AND f.key = 'task-transport-rate'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

UPDATE public.workflow_tasks SET role = 'task-transport-rate' WHERE kind = 'transport_rate';

CREATE OR REPLACE FUNCTION public._ensure_transport_rate_task(p_kernel_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_batch text;
BEGIN
    SELECT b.batch_id INTO v_batch
    FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id;

    -- role names the switch, not a person or a single role: see get_role_tasks.
    INSERT INTO public.workflow_tasks (role, kind, kernel_id, title, description, status)
    SELECT 'task-transport-rate', 'transport_rate', p_kernel_id,
           'Enter transport rate · ' || COALESCE(v_batch, 'delivery'),
           'The supervisor saved this delivery without a transport rate.',
           'pending'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.workflow_tasks
        WHERE kind = 'transport_rate' AND kernel_id = p_kernel_id AND status NOT IN ('completed', 'dismissed'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public._ensure_transport_rate_task(uuid) FROM PUBLIC, anon, authenticated;

-- Roles whose switch for a task kind is on, e.g. 'transport_rate' -> {"Palladium Manager"}.
CREATE OR REPLACE FUNCTION public._task_kind_roles(p_kind text)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(array_agg(r.role_name ORDER BY r.role_name), '{}')
    FROM public.role_features rf
    JOIN public.roles r ON r.id = rf.role_id
    JOIN public.features f ON f.id = rf.feature_id
    WHERE f.key = 'task-' || replace(p_kind, '_', '-') AND f.is_active AND rf.value = 'true';
$$;

REVOKE EXECUTE ON FUNCTION public._task_kind_roles(text) FROM PUBLIC, anon, authenticated;

-- Open tasks for a role. A task with a kind shows to every role whose task-<kind> switch is on;
-- one without a kind shows to its own role. super_user sees every task, snoozed ones included
-- (marked); others don't see snoozed ones. 'role' = who it is for, for the super-user label.
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
          AND (t.scheduled_date IS NULL OR t.scheduled_date <= CURRENT_DATE)
          AND (
                p_role = 'super_user'
             OR ((t.snoozed_until IS NULL OR t.snoozed_until <= now())
                 AND CASE WHEN t.kind IS NULL THEN t.role = p_role ELSE p_role = ANY (v.roles) END)
          )
    ) s;
$$;

-- Switching a task kind on for a role switches My Day on for it too.
CREATE OR REPLACE FUNCTION public._role_task_switch_needs_my_day()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.value = 'true' AND EXISTS (SELECT 1 FROM public.features WHERE id = NEW.feature_id AND key LIKE 'task-%') THEN
        INSERT INTO public.role_features (role_id, feature_id, value)
        SELECT NEW.role_id, f.id, 'true' FROM public.features f WHERE f.key = 'my-day'
        ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._role_task_switch_needs_my_day() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER role_task_switch_needs_my_day
    AFTER INSERT OR UPDATE OF value ON public.role_features
    FOR EACH ROW EXECUTE FUNCTION public._role_task_switch_needs_my_day();
