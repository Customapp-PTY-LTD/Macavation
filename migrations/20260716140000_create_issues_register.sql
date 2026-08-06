-- Feedback & Issues register (Macavation / FruitLive)
-- Apply via Supabase SQL Editor on the Macavation project (not via Libra MCP).
-- Attachments: schema supports jsonb; v1 UI is text-only until storage upload exists.

CREATE TABLE IF NOT EXISTS public.issues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text,
    type text NOT NULL CHECK (type IN ('defect', 'enhancement', 'new_feature', 'other')),
    area text,
    severity text NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    steps_to_reproduce text,
    business_benefit text,
    route text,
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    reported_by uuid,
    reported_by_name text,
    assigned_to uuid,
    milestone text,
    resolution_notes text,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    clickup_task_id text,
    clickup_synced_at timestamptz,
    clickup_sync_error text
);

CREATE INDEX IF NOT EXISTS idx_issues_type ON public.issues(type);
CREATE INDEX IF NOT EXISTS idx_issues_severity ON public.issues(severity);
CREATE INDEX IF NOT EXISTS idx_issues_status ON public.issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_created_at ON public.issues(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_signoff ON public.issues(type, severity, status);

-- List issues (optional filters)
CREATE OR REPLACE FUNCTION public.get_issues(
    p_type text DEFAULT NULL,
    p_severity text DEFAULT NULL,
    p_status_group text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    title text,
    description text,
    type text,
    area text,
    severity text,
    status text,
    steps_to_reproduce text,
    business_benefit text,
    route text,
    attachments jsonb,
    reported_by uuid,
    reported_by_name text,
    resolution_notes text,
    resolved_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    clickup_task_id text,
    clickup_synced_at timestamptz,
    clickup_sync_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        i.id,
        i.title,
        i.description,
        i.type,
        i.area,
        i.severity,
        i.status,
        i.steps_to_reproduce,
        i.business_benefit,
        i.route,
        i.attachments,
        i.reported_by,
        i.reported_by_name,
        i.resolution_notes,
        i.resolved_at,
        i.created_at,
        i.updated_at,
        i.clickup_task_id,
        i.clickup_synced_at,
        i.clickup_sync_error
    FROM public.issues i
    WHERE (p_type IS NULL OR i.type = p_type)
      AND (p_severity IS NULL OR i.severity = p_severity)
      AND (
        p_status_group IS NULL
        OR (p_status_group = 'open' AND i.status IN ('open', 'in_progress'))
        OR (p_status_group = 'resolved' AND i.status IN ('resolved', 'closed'))
        OR (i.status = p_status_group)
      )
    ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_issue_by_id(p_id uuid)
RETURNS TABLE (
    id uuid,
    title text,
    description text,
    type text,
    area text,
    severity text,
    status text,
    steps_to_reproduce text,
    business_benefit text,
    route text,
    attachments jsonb,
    reported_by uuid,
    reported_by_name text,
    resolution_notes text,
    resolved_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    clickup_task_id text,
    clickup_synced_at timestamptz,
    clickup_sync_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        i.id,
        i.title,
        i.description,
        i.type,
        i.area,
        i.severity,
        i.status,
        i.steps_to_reproduce,
        i.business_benefit,
        i.route,
        i.attachments,
        i.reported_by,
        i.reported_by_name,
        i.resolution_notes,
        i.resolved_at,
        i.created_at,
        i.updated_at,
        i.clickup_task_id,
        i.clickup_synced_at,
        i.clickup_sync_error
    FROM public.issues i
    WHERE i.id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_issue_signoff_status()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count integer;
BEGIN
    SELECT COUNT(*)::integer INTO v_count
    FROM public.issues i
    WHERE i.type = 'defect'
      AND i.severity IN ('CRITICAL', 'HIGH')
      AND i.status IN ('open', 'in_progress');

    RETURN json_build_object(
        'blocked', v_count > 0,
        'blocking_count', v_count,
        'status', CASE WHEN v_count > 0 THEN 'BLOCKED' ELSE 'PASSED' END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_issue_simple(
    p_title text,
    p_type text,
    p_severity text,
    p_description text DEFAULT NULL,
    p_area text DEFAULT NULL,
    p_steps_to_reproduce text DEFAULT NULL,
    p_business_benefit text DEFAULT NULL,
    p_route text DEFAULT NULL,
    p_reported_by uuid DEFAULT NULL,
    p_reported_by_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_title IS NULL OR trim(p_title) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Title is required');
    END IF;
    IF p_type IS NULL OR p_type NOT IN ('defect', 'enhancement', 'new_feature', 'other') THEN
        RETURN json_build_object('success', false, 'message', 'Invalid type');
    END IF;
    IF p_severity IS NULL OR p_severity NOT IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW') THEN
        RETURN json_build_object('success', false, 'message', 'Invalid severity');
    END IF;

    INSERT INTO public.issues (
        title, description, type, area, severity, status,
        steps_to_reproduce, business_benefit, route,
        reported_by, reported_by_name, attachments
    ) VALUES (
        trim(p_title),
        p_description,
        p_type,
        p_area,
        p_severity,
        'open',
        p_steps_to_reproduce,
        p_business_benefit,
        p_route,
        p_reported_by,
        p_reported_by_name,
        '[]'::jsonb
    )
    RETURNING id INTO v_id;

    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'message', 'Issue created successfully'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_issue_simple(
    p_issue_id uuid,
    p_title text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_type text DEFAULT NULL,
    p_area text DEFAULT NULL,
    p_severity text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_steps_to_reproduce text DEFAULT NULL,
    p_business_benefit text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.issues WHERE id = p_issue_id) THEN
        RETURN json_build_object('success', false, 'message', 'Issue not found');
    END IF;

    UPDATE public.issues SET
        title = COALESCE(NULLIF(trim(p_title), ''), title),
        description = COALESCE(p_description, description),
        type = COALESCE(p_type, type),
        area = COALESCE(p_area, area),
        severity = COALESCE(p_severity, severity),
        status = COALESCE(p_status, status),
        steps_to_reproduce = COALESCE(p_steps_to_reproduce, steps_to_reproduce),
        business_benefit = COALESCE(p_business_benefit, business_benefit),
        updated_at = now()
    WHERE id = p_issue_id;

    RETURN json_build_object('success', true, 'id', p_issue_id, 'message', 'Issue updated successfully');
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_issue_simple(
    p_issue_id uuid,
    p_resolution_notes text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_resolution_notes IS NULL OR trim(p_resolution_notes) = '' THEN
        RETURN json_build_object('success', false, 'message', 'Resolution notes are required');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.issues WHERE id = p_issue_id) THEN
        RETURN json_build_object('success', false, 'message', 'Issue not found');
    END IF;

    UPDATE public.issues SET
        status = 'resolved',
        resolution_notes = trim(p_resolution_notes),
        resolved_at = now(),
        updated_at = now()
    WHERE id = p_issue_id;

    RETURN json_build_object('success', true, 'id', p_issue_id, 'message', 'Issue resolved successfully');
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_issue_hard(p_issue_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.issues WHERE id = p_issue_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Issue not found');
    END IF;
    RETURN json_build_object('success', true, 'message', 'Issue deleted successfully');
END;
$$;

-- Used by Edge Function (service role) after ClickUp sync
CREATE OR REPLACE FUNCTION public.update_issue_clickup_sync(
    p_issue_id uuid,
    p_clickup_task_id text DEFAULT NULL,
    p_clickup_sync_error text DEFAULT NULL,
    p_clear_error boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.issues SET
        clickup_task_id = COALESCE(p_clickup_task_id, clickup_task_id),
        clickup_synced_at = CASE WHEN p_clickup_task_id IS NOT NULL THEN now() ELSE clickup_synced_at END,
        clickup_sync_error = CASE
            WHEN p_clear_error THEN NULL
            WHEN p_clickup_sync_error IS NOT NULL THEN p_clickup_sync_error
            ELSE clickup_sync_error
        END,
        updated_at = now()
    WHERE id = p_issue_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Issue not found');
    END IF;

    RETURN json_build_object('success', true, 'id', p_issue_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_issues(text, text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_issue_by_id(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_issue_signoff_status() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_issue_simple(text, text, text, text, text, text, text, text, uuid, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_issue_simple(uuid, text, text, text, text, text, text, text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_issue_simple(uuid, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_issue_hard(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_issue_clickup_sync(uuid, text, text, boolean) TO authenticated, anon, service_role;
