-- Per-person "sees every task" switch for My Day.
--
-- Until now only super_user saw every role's tasks. Mike (Procurement Lead) needs the same
-- view without becoming a super user, so the switch lives on the user, not the role.
--
--   users.sees_all_tasks                 true = My Day shows every role's open tasks
--   get_role_tasks(p_role, p_user_id)    when that user has the switch
--                                        on, the result is exactly what super_user gets
--
-- Completing and snoozing a task (update_workflow_task, snooze_workflow_task) have no role
-- check, so seeing a task is all the access needed to act on it.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS sees_all_tasks boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.sees_all_tasks IS
    'My Day shows this person every role''s open tasks, the same as super_user.';

-- New two-argument version. The one-argument version stays (below) as a wrapper, so old
-- callers still work; p_user_id has no default, or a one-argument call would be ambiguous.
CREATE OR REPLACE FUNCTION public.get_role_tasks(p_role text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    WITH viewer AS (
        SELECT p_role = 'super_user'
            OR COALESCE((SELECT u.sees_all_tasks FROM public.users u
                         WHERE u.id = p_user_id AND u.is_active), false) AS sees_all
    )
    SELECT jsonb_build_object('success', true,
                              'sees_all', (SELECT sees_all FROM viewer),
                              'tasks', COALESCE(jsonb_agg(x ORDER BY x ->> 'created_at'), '[]'::jsonb))
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
                (SELECT sees_all FROM viewer)
             OR ((t.snoozed_until IS NULL OR t.snoozed_until <= now())
                 AND CASE WHEN t.kind IS NULL THEN t.role = p_role ELSE p_role = ANY (v.roles) END)
          )
    ) s;
$function$;

GRANT EXECUTE ON FUNCTION public.get_role_tasks(text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_role_tasks(p_role text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT public.get_role_tasks(p_role, NULL::uuid);
$function$;

-- Mike sees every task (5 Nov 2026). No-op where he has no account.
UPDATE public.users SET sees_all_tasks = true WHERE lower(email) = 'mike@macavation.co.za';
