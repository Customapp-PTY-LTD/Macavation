-- ClickUp sync via Lambda /proxy/function (JWT + role_permissions).
-- Reads token from public.app_secrets (service/DEFINER only).
-- Requires Postgres http extension (or install: create extension if not exists http).

-- Prefer extensions schema (Supabase); fall back to public if already installed elsewhere
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  CREATE EXTENSION IF NOT EXISTS http;
END $$;

CREATE TABLE IF NOT EXISTS public.app_secrets (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon ΓÇö only SECURITY DEFINER readers

CREATE OR REPLACE FUNCTION public.sync_issue_to_clickup(
    p_issue_id uuid,
    p_force boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
        v_err := 'CLICKUP_API_TOKEN missing in app_secrets ΓÇö insert via SQL Editor';
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
$$;

GRANT EXECUTE ON FUNCTION public.sync_issue_to_clickup(uuid, boolean) TO authenticated, anon, service_role;

-- RBAC for sync_issue_to_clickup
DO $$
DECLARE
  v_admin uuid := '9c69485d-0116-4cf6-b7e6-2ff6c025478e';
  v_super uuid := 'f8c7989a-cdf4-4804-952a-47565acd9c4c';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_admin AND object_type = 'function' AND object_name = 'sync_issue_to_clickup' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_admin, 'function', 'sync_issue_to_clickup', 'EXECUTE', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = v_super AND object_type = 'function' AND object_name = 'sync_issue_to_clickup' AND operation = 'EXECUTE'
  ) THEN
    INSERT INTO public.role_permissions(role_id, object_type, object_name, operation, allowed)
    VALUES (v_super, 'function', 'sync_issue_to_clickup', 'EXECUTE', true);
  END IF;
END $$;

-- Seed list id (token must be inserted manually ΓÇö do not commit real tokens)
INSERT INTO public.app_secrets (key, value)
VALUES ('CLICKUP_ISSUE_REGISTER_LIST_ID', '901219597012')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
