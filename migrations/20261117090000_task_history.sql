-- ============================================================================
-- My Day task history: who closed which task, and how many each person has done.
--
-- WHY. Henry, 17 Nov 2026: "on My Day, I want a history log that shows who has done what tasks
-- and the amount of tasks each person has."
--
-- WHO DID IT. Tasks belong to a ROLE, and most close themselves when the underlying work is saved
-- (confirm_kernel_dispatch_pick, approve_kernel_dispatch_sale, set_transport_rate, ...). The person
-- doing that work is already known to the database: the portal sends x-user-id on every call and
-- audit.current_actor() reads it (the same source audit.stamp_actor uses for updated_by). So a
-- BEFORE UPDATE trigger stamps workflow_tasks.completed_by the moment a task moves into
-- 'completed' or 'dismissed'. No closing function has to change.
--   * A task closed by a scheduled job (pg_cron: run_procurement_task_checks, run_oil_raw_task_checks)
--     has no person behind it, so completed_by stays NULL and the history shows "Closed automatically".
--   * The actor id is only stamped if it is a real users row, so a stray header can never make a
--     task-closing save fail on the foreign key.
--
-- BACKFILL. Tasks already closed get completed_by from audit.audit_log (the UPDATE that moved the
-- row to completed/dismissed), and dismissed tasks that never had completed_at get that time.
--
-- READ. get_task_history(p_role, p_user_id, p_days) - same viewer rule as get_role_tasks:
-- super_user, or a user with users.sees_all_tasks (Mike), sees everyone; anyone else sees only the
-- tasks they closed themselves. Returns a per-person tally (done, dismissed, open now for their
-- role) and the most recent 200 closed tasks in the window.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE throughout; the backfill only fills NULLs.
-- Down: DROP FUNCTION public.get_task_history(text, uuid, integer);
--       DROP TRIGGER bbb_stamp_completed_by ON public.workflow_tasks;
--       DROP FUNCTION public._trg_workflow_task_completed_by();
--       ALTER TABLE public.workflow_tasks DROP COLUMN completed_by;
-- ============================================================================

-- 1. Column ---------------------------------------------------------------------------------------
ALTER TABLE public.workflow_tasks
    ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_completed_at
    ON public.workflow_tasks (completed_at DESC) WHERE status IN ('completed', 'dismissed');
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_completed_by
    ON public.workflow_tasks (completed_by) WHERE completed_by IS NOT NULL;

-- 2. Stamp who closed it --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._trg_workflow_task_completed_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_actor uuid;
BEGIN
    IF NEW.status IN ('completed', 'dismissed')
       AND OLD.status IS DISTINCT FROM NEW.status
       AND OLD.status NOT IN ('completed', 'dismissed') THEN
        IF NEW.completed_by IS NULL THEN
            v_actor := (audit.current_actor()).actor;
            IF v_actor IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_actor) THEN
                NEW.completed_by := v_actor;
            END IF;
        END IF;
        NEW.completed_at := COALESCE(NEW.completed_at, now());
    ELSIF NEW.status NOT IN ('completed', 'dismissed') THEN
        -- Reopened (legacy tick box unticked): it is no longer someone's finished task.
        NEW.completed_by := NULL;
    END IF;
    RETURN NEW;
END;
$function$;

-- Runs after aaa_stamp_actor (triggers fire in name order).
CREATE OR REPLACE TRIGGER bbb_stamp_completed_by
    BEFORE UPDATE ON public.workflow_tasks
    FOR EACH ROW EXECUTE FUNCTION public._trg_workflow_task_completed_by();

-- 3. Backfill from the audit log ------------------------------------------------------------------
WITH closing AS (
    SELECT DISTINCT ON (a.row_id) a.row_id, a.actor_id, a.occurred_at
    FROM audit.audit_log a
    WHERE a.table_name = 'workflow_tasks' AND a.operation = 'UPDATE'
      AND a.new_data ->> 'status' IN ('completed', 'dismissed')
    ORDER BY a.row_id, a.occurred_at DESC
)
UPDATE public.workflow_tasks t
   SET completed_by = CASE WHEN EXISTS (SELECT 1 FROM public.users u WHERE u.id = c.actor_id)
                           THEN c.actor_id END,
       completed_at = COALESCE(t.completed_at, c.occurred_at)
  FROM closing c
 WHERE t.id::text = c.row_id
   AND t.status IN ('completed', 'dismissed')
   AND t.completed_by IS NULL
   AND (c.actor_id IS NOT NULL OR t.completed_at IS NULL);

-- 4. Read -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_task_history(p_role text, p_user_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    WITH viewer AS (
        SELECT p_role = 'super_user'
            OR COALESCE((SELECT u.sees_all_tasks FROM public.users u
                         WHERE u.id = p_user_id AND u.is_active), false) AS sees_all
    ),
    win AS (
        SELECT now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 1), 366)) AS since
    ),
    closed AS (
        SELECT t.id, t.kind, t.title, t.description, t.status, t.role, t.completed_at, t.completed_by
        FROM public.workflow_tasks t, win
        WHERE t.status IN ('completed', 'dismissed')
          AND t.completed_at >= win.since
          AND ((SELECT sees_all FROM viewer) OR t.completed_by = p_user_id)
    ),
    -- Open tasks per role, counted the way My Day shows them (get_role_tasks, non-viewer branch).
    open_by_role AS (
        SELECT r.role_name, count(*) AS open_now
        FROM public.workflow_tasks t
        LEFT JOIN public.kernel k ON k.id = t.kernel_id
        JOIN public.roles r
          ON CASE WHEN t.kind IS NULL THEN r.role_name = t.role
                  ELSE r.role_name = ANY (public._task_kind_roles(t.kind)) END
        WHERE t.status NOT IN ('completed', 'dismissed')
          AND (t.kernel_id IS NULL OR k.is_active)
          AND (t.scheduled_date IS NULL OR t.scheduled_date <= public._sast_today())
          AND (t.snoozed_until IS NULL OR t.snoozed_until <= now())
        GROUP BY r.role_name
    ),
    people AS (
        SELECT u.id AS user_id,
               COALESCE(NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS name,
               COALESCE(r.role_name, u.role) AS role_name,
               (SELECT count(*) FROM closed c WHERE c.completed_by = u.id AND c.status = 'completed') AS done,
               (SELECT count(*) FROM closed c WHERE c.completed_by = u.id AND c.status = 'dismissed') AS dismissed,
               (SELECT max(c.completed_at) FROM closed c WHERE c.completed_by = u.id) AS last_at,
               COALESCE((SELECT o.open_now FROM open_by_role o WHERE o.role_name = COALESCE(r.role_name, u.role)), 0) AS open_now
        FROM public.users u
        LEFT JOIN public.roles r ON r.id = u.role_id
        WHERE ((SELECT sees_all FROM viewer) AND u.is_active) OR u.id = p_user_id
           OR u.id IN (SELECT c.completed_by FROM closed c)
    )
    SELECT jsonb_build_object(
        'success', true,
        'sees_all', (SELECT sees_all FROM viewer),
        'days', LEAST(GREATEST(COALESCE(p_days, 30), 1), 366),
        'people', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'user_id', p.user_id, 'name', p.name, 'role', p.role_name,
                       'done', p.done, 'dismissed', p.dismissed, 'open_now', p.open_now, 'last_at', p.last_at)
                   ORDER BY p.done + p.dismissed DESC, p.open_now DESC, p.name)
            FROM people p
            WHERE p.done + p.dismissed > 0 OR p.open_now > 0 OR p.user_id = p_user_id
        ), '[]'::jsonb),
        'automatic', (SELECT count(*) FROM closed c WHERE c.completed_by IS NULL),
        'items', COALESCE((
            SELECT jsonb_agg(x ORDER BY x ->> 'completed_at' DESC)
            FROM (
                SELECT jsonb_build_object(
                           'id', c.id, 'kind', c.kind, 'title', c.title, 'description', c.description,
                           'status', c.status, 'completed_at', c.completed_at,
                           'by_user_id', c.completed_by,
                           'by_name', COALESCE(NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email)
                       ) AS x
                FROM closed c
                LEFT JOIN public.users u ON u.id = c.completed_by
                ORDER BY c.completed_at DESC
                LIMIT 200
            ) s
        ), '[]'::jsonb)
    );
$function$;

-- Same exposure as get_role_tasks (called from the portal with the anon key).
GRANT EXECUTE ON FUNCTION public.get_task_history(text, uuid, integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._trg_workflow_task_completed_by() FROM PUBLIC, anon, authenticated;
