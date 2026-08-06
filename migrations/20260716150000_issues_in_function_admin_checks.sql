-- Direct Supabase: Lambda no longer enforces role_permissions.
-- Gate Feedback & Issues RPCs on admin / super_user via audit.current_actor().
-- Uses $issuefn$ delimiters (safer for MCP apply_migration than $$).


CREATE OR REPLACE FUNCTION public.portal_actor_is_issues_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $issuefn$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.roles r ON r.id = u.role_id
        WHERE u.id = (SELECT a.actor FROM audit.current_actor() a LIMIT 1)
          AND r.role_name IN ('admin', 'super_user')
          AND COALESCE(u.is_active, true) = true
    );
$issuefn$;

CREATE OR REPLACE FUNCTION public.assert_portal_issues_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $issuefn$
BEGIN
    IF NOT public.portal_actor_is_issues_admin() THEN
        RAISE EXCEPTION 'Access denied: admin or super_user role required for Feedback & Issues'
            USING ERRCODE = '42501';
    END IF;
END;
$issuefn$;

GRANT EXECUTE ON FUNCTION public.portal_actor_is_issues_admin() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assert_portal_issues_admin() TO authenticated, anon, service_role;


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
SET search_path = public
AS $issuefn$
BEGIN
    PERFORM public.assert_portal_issues_admin();
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
$issuefn$;

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
SET search_path = public
AS $issuefn$
BEGIN
    PERFORM public.assert_portal_issues_admin();
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
$issuefn$;

CREATE OR REPLACE FUNCTION public.get_issue_signoff_status()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $issuefn$
DECLARE
    v_count integer;
BEGIN
    PERFORM public.assert_portal_issues_admin();
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
$issuefn$;

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
SET search_path = public
AS $issuefn$
DECLARE
    v_id uuid;
BEGIN
    PERFORM public.assert_portal_issues_admin();
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
$issuefn$;

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
SET search_path = public
AS $issuefn$
BEGIN
    PERFORM public.assert_portal_issues_admin();
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
$issuefn$;

CREATE OR REPLACE FUNCTION public.resolve_issue_simple(
    p_issue_id uuid,
    p_resolution_notes text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $issuefn$
BEGIN
    PERFORM public.assert_portal_issues_admin();
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
$issuefn$;

CREATE OR REPLACE FUNCTION public.delete_issue_hard(p_issue_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $issuefn$
BEGIN
    PERFORM public.assert_portal_issues_admin();
    DELETE FROM public.issues WHERE id = p_issue_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Issue not found');
    END IF;
    RETURN json_build_object('success', true, 'message', 'Issue deleted successfully');
END;
$issuefn$;

CREATE OR REPLACE FUNCTION public.update_issue_clickup_sync(
    p_issue_id uuid,
    p_clickup_task_id text DEFAULT NULL,
    p_clickup_sync_error text DEFAULT NULL,
    p_clear_error boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $issuefn$
BEGIN
    PERFORM public.assert_portal_issues_admin();
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
$issuefn$;

CREATE OR REPLACE FUNCTION public.sync_issue_to_clickup(
    p_issue_id uuid,
    p_force boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $issuefn$
DECLARE
    v_issue public.issues%ROWTYPE;
    v_token text;
    v_list_id text;
    v_status text;
    v_priority integer;
    v_markdown text;
    v_type_label text;
    v_body jsonb;
    v_request http_request;
    v_response http_response;
    v_content jsonb;
    v_task_id text;
    v_task_url text;
    v_err text;
BEGIN
    PERFORM public.assert_portal_issues_admin();
    SELECT * INTO v_issue FROM public.issues WHERE id = p_issue_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Issue not found');
    END IF;

    IF v_issue.clickup_task_id IS NOT NULL AND p_force IS NOT TRUE THEN
        RETURN json_build_object(
            'success', true,
            'skipped', true,
            'clickup_task_id', v_issue.clickup_task_id,
            'message', 'Already synced'
        );
    END IF;

    SELECT value INTO v_token FROM public.app_secrets WHERE key = 'CLICKUP_API_TOKEN';
    IF v_token IS NULL OR trim(v_token) = '' THEN
        v_err := 'CLICKUP_API_TOKEN missing in app_secrets - insert via SQL Editor';
        UPDATE public.issues SET clickup_sync_error = v_err, updated_at = now() WHERE id = p_issue_id;
        RETURN json_build_object('success', false, 'error', v_err);
    END IF;

    SELECT value INTO v_list_id FROM public.app_secrets WHERE key = 'CLICKUP_ISSUE_REGISTER_LIST_ID';
    IF v_list_id IS NULL OR trim(v_list_id) = '' THEN
        v_list_id := '901219597012';
    END IF;

    v_type_label := CASE v_issue.type
        WHEN 'new_feature' THEN 'New Feature'
        WHEN 'enhancement' THEN 'Enhancement'
        WHEN 'defect' THEN 'Defect'
        ELSE 'Other'
    END;
    v_status := v_type_label;
    v_priority := CASE v_issue.severity
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        WHEN 'LOW' THEN 4
        ELSE 3
    END;

    v_markdown := format(
        E'**Type:** %s\n**Severity:** %s\n**Area:** %s\n**Reported by:** %s\n**Time reported:** %s\n**Portal issue id:** `%s`%s\n\n## Description\n%s',
        v_type_label,
        COALESCE(v_issue.severity, '-'),
        COALESCE(v_issue.area, '-'),
        COALESCE(v_issue.reported_by_name, '-'),
        to_char(v_issue.created_at AT TIME ZONE 'Africa/Johannesburg', 'DD/MM/YYYY HH24:MI') || ' SAST',
        v_issue.id::text,
        CASE WHEN v_issue.route IS NOT NULL AND v_issue.route <> ''
            THEN E'\n**Portal route:** `' || v_issue.route || '`'
            ELSE '' END,
        COALESCE(NULLIF(v_issue.description, ''), '_No description provided._')
    );

    IF v_issue.type = 'defect' AND COALESCE(v_issue.steps_to_reproduce, '') <> '' THEN
        v_markdown := v_markdown || E'\n\n## Steps to reproduce\n' || v_issue.steps_to_reproduce;
    END IF;
    IF v_issue.type IN ('enhancement', 'new_feature') AND COALESCE(v_issue.business_benefit, '') <> '' THEN
        v_markdown := v_markdown || E'\n\n## Business benefit\n' || v_issue.business_benefit;
    END IF;

    v_body := jsonb_build_object(
        'name', v_issue.title,
        'status', v_status,
        'priority', v_priority,
        'markdown_description', v_markdown
    );

    BEGIN
        v_request := (
            'POST',
            'https://api.clickup.com/api/v2/list/' || v_list_id || '/task',
            ARRAY[
                http_header('Authorization', v_token),
                http_header('Content-Type', 'application/json')
            ],
            'application/json',
            v_body::text
        )::http_request;

        v_response := http(v_request);
    EXCEPTION WHEN OTHERS THEN
        v_err := 'HTTP extension call failed: ' || SQLERRM;
        UPDATE public.issues SET clickup_sync_error = v_err, updated_at = now() WHERE id = p_issue_id;
        RETURN json_build_object('success', false, 'error', v_err);
    END;

    BEGIN
        v_content := v_response.content::jsonb;
    EXCEPTION WHEN OTHERS THEN
        v_content := jsonb_build_object('raw', v_response.content);
    END;

    IF v_response.status < 200 OR v_response.status >= 300 THEN
        v_err := COALESCE(v_content->>'err', v_content->>'error', v_response.content, 'ClickUp HTTP ' || v_response.status::text);
        UPDATE public.issues SET clickup_sync_error = v_err, updated_at = now() WHERE id = p_issue_id;
        RETURN json_build_object('success', false, 'error', v_err, 'status', v_response.status);
    END IF;

    v_task_id := v_content->>'id';
    v_task_url := v_content->>'url';

    UPDATE public.issues SET
        clickup_task_id = v_task_id,
        clickup_synced_at = now(),
        clickup_sync_error = NULL,
        updated_at = now()
    WHERE id = p_issue_id;

    RETURN json_build_object(
        'success', true,
        'clickup_task_id', v_task_id,
        'clickup_url', v_task_url
    );
END;
$issuefn$;


GRANT EXECUTE ON FUNCTION public.get_issues(text, text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_issue_by_id(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_issue_signoff_status() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_issue_simple(text, text, text, text, text, text, text, text, uuid, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_issue_simple(uuid, text, text, text, text, text, text, text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_issue_simple(uuid, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_issue_hard(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_issue_clickup_sync(uuid, text, text, boolean) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sync_issue_to_clickup(uuid, boolean) TO authenticated, anon, service_role;
