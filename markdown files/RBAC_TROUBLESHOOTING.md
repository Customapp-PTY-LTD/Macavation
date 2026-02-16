# RBAC 403 Forbidden Errors - Troubleshooting Guide

## Why do I get "operation execute is not allowed"?

This message means **your role is not allowed to run the requested function** (e.g. `create_production_batch_simple`, `get_production_batches`, `update_production_batch`).

1. **How it works**  
   When you call an API (e.g. "Create kernel batch"), the backend:
   - Reads your **role** from your JWT (e.g. `user`, `viewer`, `admin`).
   - Looks up `role_permissions` for that role and the function name with operation `EXECUTE`.
   - If there is **no row** or **allowed = false**, it returns 403 with a message like "operation execute is not allowed".

2. **What was fixed**  
   EXECUTE permission has been granted for **all roles** (including admin, super_user, KP Data Admin, and every PWA role) on all data functions used to date (see **Data functions – public to all roles** below). Creating/updating kernel batches, supplier intake, dashboard, and kernel production flows should work for any role once the migration has been applied (see BluePrint/RBAC_GUIDE.md).

3. **If you still see the error**  
   - **Log out and log back in** so a new JWT is issued with your current role.
   - If your app uses a **different backend** (e.g. another Lambda or DB), the same permissions must exist there.
   - Ask an admin to confirm your user’s **role** in the `users` table and that `role_permissions` has EXECUTE for that role and the function name.

---

## Status: All Functions and Permissions Verified ✅

All required database functions have been created and RBAC permissions have been set correctly:

### Functions Created ✅
- ✅ `get_workflow_tasks`
- ✅ `get_watching_items`
- ✅ `get_due_items`
- ✅ `get_executive_kpis`
- ✅ `get_recent_activity_by_role`
- ✅ `get_active_anomalies`
- ✅ `get_production_batches`
- ✅ `get_dashboard_alerts`
- ✅ `get_dashboard_stats`
- ✅ `get_recent_activity`
- ✅ `get_stock_items`

### Permissions Set ✅
All **data functions** (listed below) have `EXECUTE` permissions for **every user role** in the system:
- ✅ `super_user`, `admin`
- ✅ `KP Data Admin`
- ✅ All PWA roles (PWA Production, PWA Quality Assurance, PWA Grower Intake, PWA Document Management, PWA Field Operations, PWA Finance, PWA Sales, PWA Stock Management)

### Data functions – completely public (all roles)

**Macavation Supabase:** Migration `grant_all_functions_execute_to_all_roles_public` makes **every** function in `role_permissions` executable by **every** active role. No role is excluded: admin, super_user, KP Data Admin, and all PWA roles can EXECUTE all 128+ database functions. This is the “completely public” RBAC setup.

Earlier migrations (still valid on other projects or for reference):
- **Auth / user (all roles):** `get_user_by_id`, `get_user_with_permissions`, `get_roles`, `get_users`
- Dashboard / My Day: `get_workflow_tasks`, `get_watching_items`, `get_due_items`, `get_executive_kpis`, `get_recent_activity_by_role`, `get_active_anomalies`, `get_dashboard_alerts`, `get_dashboard_stats`, `get_recent_activity`, `get_stock_items`
- Production batches: `get_production_batches`, `create_production_batch_simple`, `update_production_batch`
- Supplier intake: `get_supplier_intake_batches`, `create_supplier_intake_batch`, `get_supplier_intake_batches_by_production_day`, `update_supplier_intake_batch_production_day`
- Kernel production: `get_kernel_job_card`, `get_kernel_job_cards`, `create_kernel_job_card`, `get_kernel_packing_sample`, `get_kernel_packing_samples`, `create_kernel_packing_sample`, `get_kernel_production_days`, `get_kernel_production_days_list`, `create_kernel_production_day`, `get_kernel_production_stages`, `get_kernel_production_stages_by_day`, `get_kernel_production_stages_list`, `save_kernel_production_stages`, `finish_kernel_batch_production`
- Supporting: `get_receiving_checklist`, `get_receiving_checklists`, `get_sample_submissions`, `get_contacts`

## If You're Still Getting 403 Errors

### Solution 1: Refresh JWT Token (Most Common Fix)

The Lambda proxy checks permissions based on the user's role from the JWT token. If you're still getting 403 errors after permissions were added, try:

1. **Log out completely**
   - Click your profile in the top right
   - Click "Logout"
   - Clear browser cache (optional but recommended)

2. **Log back in**
   - This will generate a fresh JWT token with updated role information
   - The new token will include your current role_id

3. **Try accessing the modules again**
   - Dashboard should now load without 403 errors
   - My Day should now load without 403 errors

### Solution 2: Verify Your Role

1. Check your current role:
   - Look at your profile dropdown (top right)
   - It should show your role name

2. If you're `super_user` or `admin`, you should have access to all functions
   - If not, the JWT token might be outdated
   - Log out and log back in

### Solution 3: Check Browser Console

If errors persist after logging out/in:

1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Look for the exact error message
4. Check if it's still a 403 error or a different error

### Role display / "Could not fetch role name" (index.html)

If you see **"Could not fetch role name: Error: Access denied: operation EXECUTE is not allowed"** when loading the app, the Lambda is denying `get_user_by_id` or `get_roles` for your role. Ensure RBAC allows these for **all** roles:

- **`get_user_by_id`** – used by `dataFunctions.getUserById()` so index.html can show role name.
- **`get_roles`** – used when resolving role name from `role_id`.
- **`get_user_with_permissions`** – used by auth-service for full user/role info.

On the **Macavation** Supabase project, migration `grant_get_user_by_id_and_get_roles_to_all_roles` grants EXECUTE on these three functions to every active role (admin, super_user, KP Data Admin, and all PWA roles). After applying it, **log out and log back in** so the new permissions are used.

### Solution 4: Verify Database Permissions (Admin Only)

If you have database access, you can verify permissions:

```sql
-- Check your user's role
SELECT u.email, r.role_name, u.role_id
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
WHERE u.email = 'your-email@example.com';

-- Check permissions for your role
SELECT 
    r.role_name,
    rp.object_name,
    rp.allowed
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
WHERE r.role_name = 'super_user'  -- or your role
AND rp.object_name IN (
    'get_workflow_tasks',
    'get_watching_items',
    'get_due_items',
    'get_executive_kpis',
    'get_recent_activity_by_role'
)
AND rp.operation = 'EXECUTE';
```

## What Was Fixed

1. ✅ Created all missing database functions
2. ✅ Added RBAC permissions for all functions to all roles
3. ✅ Verified no duplicate or conflicting permissions
4. ✅ Ensured all permissions are set to `allowed = true`

## Expected Behavior After Fix

After logging out and back in, you should be able to:

- ✅ Access Dashboard without 403 errors
- ✅ See dashboard metrics (KPIs, alerts, stats)
- ✅ Access My Day without 403 errors
- ✅ See workflow tasks, due items, watching items, and recent activity
- ✅ Manage My Day entries (complete, snooze, dismiss)

## Still Having Issues?

If you've tried all solutions above and still get 403 errors:

1. **Check Lambda Logs** (if you have access)
   - Look for RBAC permission check logs
   - Verify the user's role_id is being correctly retrieved from JWT

2. **Verify JWT Token Contains Role**
   - The JWT token should include the user's `role_id`
   - If the token doesn't have `role_id`, the Lambda can't check permissions

3. **Contact System Administrator**
   - They can verify Lambda configuration
   - They can check if there are any Lambda-side permission checks that need updating

## Technical Details

### How Lambda Checks Permissions

1. Lambda receives function call request with JWT token
2. Lambda extracts user info from JWT (including `role_id`)
3. Lambda queries `role_permissions` table:
   ```sql
   SELECT allowed 
   FROM role_permissions 
   WHERE role_id = <user_role_id>
   AND object_type = 'function'
   AND object_name = <function_name>
   AND operation = 'EXECUTE'
   ```
4. If `allowed = true`, function executes
5. If `allowed = false` or no permission found, returns 403

### Why Logout/Login Fixes It

- Old JWT tokens might have been issued before permissions were added
- New JWT tokens include current role information
- Lambda uses the role_id from the JWT to check permissions
- Fresh token = fresh permission check

