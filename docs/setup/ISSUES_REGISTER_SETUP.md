# Feedback & Issues register — setup (Macavation / Direct Supabase)

## What it is
Admin-only register under **User & access → Feedback & Issues**. Create/update/resolve/delete issues in Postgres; optionally sync new issues one-way to ClickUp list `901219597012` (Issue Register). Sync failures do not roll back the portal save. ClickUp is not shown in the portal UI.

## Migrations
Already applied on Macavation-dev when first built; keep these versioned in-repo:

1. `migrations/20260716140000_create_issues_register.sql` — table + CRUD RPCs
2. `migrations/20260716140001_rbac_issues_register.sql` — `role_permissions` for admin / super_user
3. `migrations/20260716140002_sync_issue_to_clickup.sql` — `app_secrets`, `sync_issue_to_clickup`, list id seed
4. `migrations/20260716150000_issues_in_function_admin_checks.sql` — in-function admin checks via `audit.current_actor()` (required now that Lambda RBAC is retired)

## Secrets
Insert the ClickUp personal token in SQL Editor (do not commit):

```sql
INSERT INTO public.app_secrets (key, value)
VALUES ('CLICKUP_API_TOKEN', '<token>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
```

List id is seeded as `CLICKUP_ISSUE_REGISTER_LIST_ID = 901219597012`.

`app_secrets` has RLS enabled with no policies for anon/authenticated — only SECURITY DEFINER functions read it.

## Frontend
- Methods on `WebPortal/js/data-functions.js` (`getIssues`, `createIssue`, …, `syncIssueToClickUp`)
- UI: third tab on `WebPortal/modules/admin/`

## Audience (v1)
Admin and `super_user` only (module already gated + in-function checks).
