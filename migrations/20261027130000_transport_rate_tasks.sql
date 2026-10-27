-- ============================================================================
-- Transport rate moves from New Delivery (supervisor) to a My Day task for a ROLE.
--
-- WHY. Mike (27 Oct 2026): the supervisor capturing a New Delivery doesn't know the transport
-- rate, so every prod delivery so far was saved with R0 to get past the required field. The rate
-- is entered later by the Palladium Manager role (Joslyn today). Tasks belong to a role, never to
-- a person, so whoever holds the role sees them; super_user sees every role's tasks.
--
-- What this adds:
--   workflow_tasks   kind, kernel_id, snoozed_until, completed_at (table existed, never used)
--   setting          kernel_pipeline_settings.transport_rate_task_role = "Palladium Manager"
--   trigger          kernel: a delivery saved with no rate gets ONE open 'transport_rate' task;
--                    a rate arriving by any route closes it
--   get_role_tasks(p_role)               open tasks for a role (super_user: all roles)
--   set_transport_rate(p_kernel_id, p_rate_zar)
--   snooze_workflow_task(p_task_id, p_until)
--   role_features    my-day for Palladium Manager (it had none)
--   backfill         a task for each active delivery whose rate is R0 or blank
--
-- Existing get_workflow_tasks / update_workflow_task are left as they are (update_workflow_task
-- still serves Dismiss). The page falls back to get_workflow_tasks until this is applied.
-- ============================================================================

ALTER TABLE public.workflow_tasks
    ADD COLUMN IF NOT EXISTS kind          text,
    ADD COLUMN IF NOT EXISTS kernel_id     uuid REFERENCES public.kernel(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
    ADD COLUMN IF NOT EXISTS completed_at  timestamptz;

-- One open transport-rate task per delivery.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_tasks_open_kind_kernel
    ON public.workflow_tasks (kind, kernel_id)
    WHERE kernel_id IS NOT NULL AND status NOT IN ('completed', 'dismissed');

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_role_status ON public.workflow_tasks (role, status);

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('transport_rate_task_role', '"Palladium Manager"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Open the task for a delivery that has transport details but no rate (idempotent).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ensure_transport_rate_task(p_kernel_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role  text;
    v_batch text;
BEGIN
    SELECT COALESCE((SELECT value #>> '{}' FROM public.kernel_pipeline_settings WHERE key = 'transport_rate_task_role'),
                    'Palladium Manager')
    INTO v_role;

    SELECT b.batch_id INTO v_batch
    FROM public.kernel k JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id;

    INSERT INTO public.workflow_tasks (role, kind, kernel_id, title, description, status)
    SELECT v_role, 'transport_rate', p_kernel_id,
           'Enter transport rate · ' || COALESCE(v_batch, 'delivery'),
           'The supervisor saved this delivery without a transport rate.',
           'pending'
    WHERE NOT EXISTS (
        SELECT 1 FROM public.workflow_tasks
        WHERE kind = 'transport_rate' AND kernel_id = p_kernel_id AND status NOT IN ('completed', 'dismissed'));
END;
$$;

CREATE OR REPLACE FUNCTION public._complete_transport_rate_task(p_kernel_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
    UPDATE public.workflow_tasks
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE kind = 'transport_rate' AND kernel_id = p_kernel_id AND status NOT IN ('completed', 'dismissed');
$$;

-- ----------------------------------------------------------------------------
-- Trigger: works however the delivery is saved (New Delivery today, anything later).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._kernel_transport_rate_task()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.is_active AND (NEW.intake_data #> '{delivery,transport}') IS NOT NULL THEN
        IF (NEW.intake_data #>> '{delivery,transport,rate_zar}') IS NULL THEN
            PERFORM public._ensure_transport_rate_task(NEW.id);
        ELSE
            PERFORM public._complete_transport_rate_task(NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER kernel_transport_rate_task
    AFTER INSERT OR UPDATE OF intake_data ON public.kernel
    FOR EACH ROW EXECUTE FUNCTION public._kernel_transport_rate_task();

-- ----------------------------------------------------------------------------
-- Reads / writes for My Day.
-- ----------------------------------------------------------------------------

-- Open tasks for a role. super_user sees every role's tasks, snoozed ones included (marked).
-- Others see their role's tasks that aren't snoozed. Tasks of a removed delivery drop out.
CREATE OR REPLACE FUNCTION public.get_role_tasks(p_role text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'tasks', COALESCE(jsonb_agg(x ORDER BY x ->> 'created_at'), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'id', t.id, 'role', t.role, 'kind', t.kind, 'title', t.title, 'description', t.description,
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
        LEFT JOIN public.kernel k ON k.id = t.kernel_id
        LEFT JOIN public.batches b ON b.id = k.batch_id
        WHERE t.status NOT IN ('completed', 'dismissed')
          AND (t.kernel_id IS NULL OR k.is_active)
          AND (t.scheduled_date IS NULL OR t.scheduled_date <= CURRENT_DATE)
          AND (
                p_role = 'super_user'
             OR (t.role = p_role AND (t.snoozed_until IS NULL OR t.snoozed_until <= now()))
          )
    ) s;
$$;

CREATE OR REPLACE FUNCTION public.set_transport_rate(p_kernel_id uuid, p_rate_zar numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_rate_zar IS NULL OR p_rate_zar < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the rate for the whole trip (0 or more).');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.kernel
                   WHERE id = p_kernel_id AND is_active AND (intake_data #> '{delivery,transport}') IS NOT NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery not found.');
    END IF;

    UPDATE public.kernel
    SET intake_data = jsonb_set(
            jsonb_set(intake_data, '{delivery,transport,rate_zar}', to_jsonb(round(p_rate_zar, 2)), true),
            '{delivery,transport,rate_entered_at}', to_jsonb(now()), true),
        updated_at = now()
    WHERE id = p_kernel_id;

    -- The trigger closes the task when the rate goes from blank to a value; an R0 backfill task
    -- has a value already, so close it explicitly too.
    PERFORM public._complete_transport_rate_task(p_kernel_id);
    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'rate_zar', round(p_rate_zar, 2));
END;
$$;

CREATE OR REPLACE FUNCTION public.snooze_workflow_task(p_task_id uuid, p_until timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_until IS NULL OR p_until <= now() OR p_until > now() + interval '14 days' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Snooze must end in the next 14 days.');
    END IF;
    UPDATE public.workflow_tasks SET snoozed_until = p_until, updated_at = now()
    WHERE id = p_task_id AND status NOT IN ('completed', 'dismissed');
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Task not found.');
    END IF;
    RETURN jsonb_build_object('success', true, 'snoozed_until', p_until);
END;
$$;

-- Helpers are internal only.
REVOKE EXECUTE ON FUNCTION public._ensure_transport_rate_task(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._complete_transport_rate_task(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kernel_transport_rate_task() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- My Day for the Palladium Manager role.
-- ----------------------------------------------------------------------------
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE r.role_name = 'Palladium Manager' AND f.key = 'my-day'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

-- ----------------------------------------------------------------------------
-- Backfill: deliveries already saved with R0 or no rate get a task.
-- ----------------------------------------------------------------------------
SELECT public._ensure_transport_rate_task(k.id)
FROM public.kernel k
WHERE k.is_active
  AND (k.intake_data #> '{delivery,transport}') IS NOT NULL
  AND COALESCE((k.intake_data #>> '{delivery,transport,rate_zar}')::numeric, 0) = 0;
