# RBAC (Role-Based Access Control) Guide

This guide explains how to implement Role-Based Access Control when building new features.

## Overview

RBAC controls access to database functions and tables based on user roles. The system uses:

- **Roles**: User roles (super_user, admin, user, etc.)
- **Permissions**: Stored in `role_permissions` table
- **Objects**: Database functions or tables
- **Operations**: EXECUTE, SELECT, INSERT, UPDATE, DELETE

## Database Structure

### Roles Table

```sql
CREATE TABLE public.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name varchar NOT NULL UNIQUE,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

### Role Permissions Table

```sql
CREATE TABLE public.role_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    object_type varchar NOT NULL,      -- 'function', 'table'
    object_name varchar NOT NULL,      -- function name or table name
    operation varchar NOT NULL,        -- 'EXECUTE', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'
    allowed boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(role_id, object_type, object_name, operation)
);
```

### Users Table

```sql
CREATE TABLE public.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    username text UNIQUE,
    role_id uuid REFERENCES public.roles(id),
    role text,  -- denormalized role name for quick access
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

### Identity Providers Table

Stores OAuth/SSO identity provider configurations for authentication (e.g., Google, Microsoft, SAML providers).

```sql
CREATE TABLE public.identity_providers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_name varchar NOT NULL UNIQUE,  -- e.g., 'google', 'microsoft', 'saml'
    config_data jsonb NOT NULL DEFAULT '{}', -- Provider-specific config (client_id, etc.)
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

**RBAC Requirements for Identity Providers:**

| Operation | super_user | admin | manager | user | viewer |
|-----------|------------|-------|---------|------|--------|
| View providers | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create provider | ✅ | ❌ | ❌ | ❌ | ❌ |
| Update provider | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete provider | ✅ | ❌ | ❌ | ❌ | ❌ |
| View config_data | ✅ | ❌ | ❌ | ❌ | ❌ |

> **Security Note**: The `config_data` field contains sensitive OAuth credentials (client IDs, secrets). Only `super_user` should have full access. For admin viewing, consider returning a sanitized version that masks sensitive values.

## Creating Roles

```sql
-- Create default roles
INSERT INTO public.roles (role_name, description) VALUES
('super_user', 'Super administrator with full system access'),
('admin', 'Administrator with elevated permissions'),
('manager', 'Manager with limited administrative access'),
('user', 'Standard user with basic access'),
('viewer', 'Read-only user');

-- Get role IDs for permissions
SELECT id, role_name FROM public.roles;
```

## Adding Super Users

To add users with `super_user` role (full system access), use the following SQL:

### Step 1: Get Super User Role ID

```sql
-- Get the super_user role ID
SELECT id, role_name 
FROM public.roles 
WHERE role_name = 'super_user';
```

### Step 2: Add Super User

**Replace the placeholder values with the actual user details:**

```sql
-- Insert or update user as super_user
INSERT INTO public.users (email, username, role_id, role, is_active)
VALUES (
    'USER_EMAIL_HERE',           -- e.g., 'cedric@customapp.co.za'
    'USERNAME_HERE',             -- e.g., 'cedric'
    (SELECT id FROM public.roles WHERE role_name = 'super_user' LIMIT 1),
    'super_user',
    true
)
ON CONFLICT (email) 
DO UPDATE SET 
    role_id = (SELECT id FROM public.roles WHERE role_name = 'super_user' LIMIT 1),
    role = 'super_user',
    is_active = true,
    updated_at = now()
RETURNING *;
```

**Required Values:**
- **Email**: User's email address (must be unique)
- **Username**: Username for the user (optional, can be NULL)

**Example with actual values:**

```sql
-- Example: Add cedric@customapp.co.za as super_user
INSERT INTO public.users (email, username, role_id, role, is_active)
VALUES (
    'cedric@customapp.co.za',
    'cedric',
    (SELECT id FROM public.roles WHERE role_name = 'super_user' LIMIT 1),
    'super_user',
    true
)
ON CONFLICT (email) 
DO UPDATE SET 
    role_id = (SELECT id FROM public.roles WHERE role_name = 'super_user' LIMIT 1),
    role = 'super_user',
    is_active = true,
    updated_at = now();
```

### Step 3: Verify Super User

After adding, verify the user was created/updated correctly:

```sql
-- Verify super_user was added
SELECT 
    u.id,
    u.email,
    u.username,
    u.role,
    r.role_name,
    u.is_active,
    u.created_at,
    u.updated_at
FROM public.users u
JOIN public.roles r ON r.id = u.role_id
WHERE u.email = 'USER_EMAIL_HERE'  -- Replace with actual email
AND r.role_name = 'super_user';
```

### Adding Multiple Super Users

To add multiple super users at once:

```sql
-- Add multiple super users
INSERT INTO public.users (email, username, role_id, role, is_active)
SELECT 
    email_value,
    username_value,
    (SELECT id FROM public.roles WHERE role_name = 'super_user' LIMIT 1),
    'super_user',
    true
FROM (VALUES
    ('user1@example.com', 'user1'),
    ('user2@example.com', 'user2'),
    ('user3@example.com', 'user3')
) AS users(email_value, username_value)
ON CONFLICT (email) 
DO UPDATE SET 
    role_id = (SELECT id FROM public.roles WHERE role_name = 'super_user' LIMIT 1),
    role = 'super_user',
    is_active = true,
    updated_at = now();
```

**Super User Permissions:**
- Full access to all 44 database functions
- Can view identity provider `config_data` (including OAuth secrets)
- Can create, read, update, and delete all entities
- Can manage roles and permissions
- Can delete any entity (hard delete)

**Security Notes:**
- Limit the number of super_users in your system
- Super users have unrestricted access - use with caution
- Consider using admin role for most administrative tasks
- Audit super user actions regularly

## Adding Permissions for New Functions

When creating a new database function, add permissions:

### Step 1: Create Function with SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION get_items()
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER  -- Important: Allows function to run with creator's privileges
AS $$
BEGIN
    -- Function logic
END;
$$;
```

### Step 2: Add Permissions

```sql
-- Add EXECUTE permission for specific roles (use public.role_permissions and public.roles in Supabase)
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_items', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;
```

### Grower Intake: Create kernel batch + Receiving checklist tick (one backend fix)

The Lambda checks `role_permissions` before running each function. For **Create kernel batch** and for the **Receiving checklist checkbox to tick**, every role that uses Grower Intake needs EXECUTE on the same set of functions. If you already fixed “create new batch” but the **tick still doesn’t show**, the backend is still missing EXECUTE on **create_receiving_checklist**, **update_receiving_checklist**, or **update_production_batch** for your role.

**Run this once in your Supabase project** (Dashboard → SQL Editor → New query). It uses `WHERE NOT EXISTS` so it works even if your `role_permissions` table has no unique constraint. It adds EXECUTE for all roles so both create batch and the checklist tick work:

```sql
-- Grower Intake: create batch + receiving checklist tick (all roles)
-- Run in Supabase SQL Editor on the same project the app uses (SUPABASE_URL in Lambda).

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_production_batches', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'get_production_batches' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_production_batch_simple', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'create_production_batch_simple' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_production_batch', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'update_production_batch' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_receiving_checklist', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'create_receiving_checklist' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_receiving_checklist', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'update_receiving_checklist' AND rp.operation = 'EXECUTE');

-- Ensure existing rows are allowed = true (in case they were inserted as false)
UPDATE public.role_permissions
SET allowed = true
WHERE object_type = 'function' AND operation = 'EXECUTE'
  AND object_name IN ('get_production_batches', 'create_production_batch_simple', 'update_production_batch', 'create_receiving_checklist', 'update_receiving_checklist');
```

Then **sign out and sign in again** so the Lambda sees the new permissions. After that, create batch and the receiving checklist tick should both work.

### Kernel Production: Save job card

If you get **"Failed to save job card: Access denied: operation EXECUTE is not allowed"** after completing the job card, your role needs EXECUTE on `create_kernel_job_card`. Run this in Supabase SQL Editor (same project as the app):

```sql
-- Kernel Production: allow save job card (all roles)
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_kernel_job_card', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'create_kernel_job_card' AND rp.operation = 'EXECUTE');

UPDATE public.role_permissions SET allowed = true WHERE object_type = 'function' AND object_name = 'create_kernel_job_card' AND operation = 'EXECUTE';
```

Then **sign out and sign in again** and try saving the job card.

**Important:** Use the **same Supabase project** the app uses. Set the Lambda env var `SUPABASE_URL` to that project’s URL (see `LAMBDA_ENV_REQUIRED.md`). If the app points at a different project, run the SQL above in that project’s SQL Editor.

### Supplier Intake (Oil & Protein): Save batch

If you get **"Access denied: operation EXECUTE is not allowed"** (or `RBAC_PERMISSION_DENIED`) when saving a batch in **Supplier Intake**, your role needs EXECUTE on `get_supplier_intake_batches` and `create_supplier_intake_batch`.

**Most common cause:** The SQL was run in a **different Supabase project** than the one the Lambda uses. The Lambda reads permissions only from the project in its **SUPABASE_URL** env var. Run the SQL in **that** project, then sign out and sign in. See **docs/FIX_SUPPLIER_INTAKE_ACCESS_DENIED.md** for step-by-step troubleshooting.

**1. Use the same Supabase project as the app.** The Lambda uses the project set in env var `SUPABASE_URL`. Run the SQL below in that project’s **Dashboard → SQL Editor**.

**2. Run this SQL** (inserts missing permissions and forces `allowed = true` for existing rows via `ON CONFLICT DO UPDATE`):

```sql
-- Supplier Intake: allow list + save batch (all roles)
-- Uses ON CONFLICT so existing rows get allowed = true.

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_supplier_intake_batches', 'EXECUTE', true
FROM public.roles r
ON CONFLICT (role_id, object_type, object_name, operation)
DO UPDATE SET allowed = true;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_supplier_intake_batch', 'EXECUTE', true
FROM public.roles r
ON CONFLICT (role_id, object_type, object_name, operation)
DO UPDATE SET allowed = true;
```

If your `role_permissions` table does **not** have a unique constraint on `(role_id, object_type, object_name, operation)`, use this version instead:

```sql
-- Alternative if ON CONFLICT fails (no unique constraint):
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_supplier_intake_batches', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'get_supplier_intake_batches' AND rp.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_supplier_intake_batch', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.object_type = 'function' AND rp.object_name = 'create_supplier_intake_batch' AND rp.operation = 'EXECUTE');

UPDATE public.role_permissions SET allowed = true
WHERE object_type = 'function' AND operation = 'EXECUTE'
  AND object_name IN ('get_supplier_intake_batches', 'create_supplier_intake_batch');
```

**3. Sign out and sign in again** so the Lambda sees the new permissions.

**4. If you still get 403**, the error response includes your `role` (a UUID). Check that this role has the permission:

```sql
-- Replace YOUR_ROLE_ID with the "role" value from the error (e.g. 9c69485d-0116-4cf6-b7e6-2ff6c025478e)
SELECT rp.role_id, r.role_name, rp.object_name, rp.operation, rp.allowed
FROM public.role_permissions rp
JOIN public.roles r ON r.id = rp.role_id
WHERE rp.role_id = 'YOUR_ROLE_ID'::uuid
  AND rp.object_name IN ('get_supplier_intake_batches', 'create_supplier_intake_batch');
```

You should see two rows with `allowed = true`. If not, run the INSERT/UPDATE SQL again in the **same** Supabase project the Lambda uses (see `LAMBDA_ENV_REQUIRED.md` for `SUPABASE_URL`).

### Step 3: Permission Levels Example

**super_user**: Full access to all functions
```sql
-- Grant all permissions
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_items', 'EXECUTE', true
FROM roles r WHERE r.role_name = 'super_user';
```

**admin**: Can view/create/update but not delete
```sql
-- Grant read/write but not delete
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_items', 'EXECUTE', true
FROM roles r WHERE r.role_name = 'admin';

INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_item_simple', 'EXECUTE', true
FROM roles r WHERE r.role_name = 'admin';

INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_item_simple', 'EXECUTE', true
FROM roles r WHERE r.role_name = 'admin';

-- Do NOT grant delete permissions for admin
```

**user**: Read-only access
```sql
-- Grant read-only
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_items', 'EXECUTE', true
FROM roles r WHERE r.role_name = 'user';
```

## Complete Permission Setup Example

For a complete CRUD module:

```sql
-- Get all items (read)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_items', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user', 'viewer')
ON CONFLICT DO NOTHING;

-- Get item by ID (read)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_item_by_id', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user', 'viewer')
ON CONFLICT DO NOTHING;

-- Create item (write)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_item_simple', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT DO NOTHING;

-- Update item (write)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_item_simple', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT DO NOTHING;

-- Delete item (delete)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'delete_item_hard', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user')  -- Only super_user can delete
ON CONFLICT DO NOTHING;
```

## Lambda Proxy RBAC Check

The Lambda proxy checks permissions before executing functions:

1. Extracts user info from JWT token
2. Looks up user's role_id
3. Checks role_permissions table for allowed operations
4. Returns 403 Forbidden if not authorized

**You don't need to implement this** - it's handled by the Lambda proxy.

## Frontend RBAC Checks

Check permissions in frontend for UI visibility:

```javascript
// Check if user has admin role
if (dataFunctions.hasAdminRole()) {
    // Show admin features
    $('#adminPanel').show();
}

// Check user management access
if (dataFunctions.canAccessUserManagement()) {
    // Show user management link
    $('#userManagementLink').show();
}
```

### Custom Permission Checks

Add custom checks to `data-functions.js`:

```javascript
// Check if user can access specific module
canAccessItems: function() {
    const userInfo = localStorage.getItem('user_info');
    if (!userInfo) return false;
    
    const user = JSON.parse(userInfo);
    const roleName = user.role_name || user.role || '';
    
    // Only super_user and admin can access items
    return roleName === 'super_user' || roleName === 'admin';
}
```

## Best Practices

### 1. Principle of Least Privilege

Grant minimum permissions needed:
- Default to no access
- Grant permissions explicitly
- Use role hierarchy

### 2. Consistent Naming

Use consistent function naming:
- `get_[entity]s` - List all
- `get_[entity]_by_id` - Get one
- `create_[entity]_simple` - Create
- `update_[entity]_simple` - Update
- `delete_[entity]_hard` - Delete

### 3. Audit Permissions

Regularly audit permissions:
```sql
-- List all permissions by role
SELECT r.role_name, rp.object_type, rp.object_name, rp.operation, rp.allowed
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
ORDER BY r.role_name, rp.object_name;
```

### 4. Test with Different Roles

Always test with different user roles:
- Create test users with different roles
- Verify permissions work correctly
- Test edge cases

### 5. Document Permission Requirements

Document which roles need which permissions:
```markdown
## Items Module Permissions

- get_items: super_user, admin, user, viewer
- create_item_simple: super_user, admin
- update_item_simple: super_user, admin
- delete_item_hard: super_user only
```

## Common Patterns

### Pattern 1: Read-Only Module

```sql
-- Grant read access to all authenticated users
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_reports', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user', 'viewer');
```

### Pattern 2: Admin-Only Module

```sql
-- Grant access only to admins
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'manage_system_settings', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin');
```

### Pattern 3: Soft Delete Pattern

```sql
-- Everyone can deactivate (soft delete)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'deactivate_item', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user');

-- Only super_user can hard delete
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'delete_item_hard', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'super_user';
```

### Pattern 4: Identity Providers (Security-Critical Module)

This pattern applies to security-critical tables like `identity_providers` that contain sensitive configuration data.

```sql
-- Create CRUD functions for identity providers
CREATE OR REPLACE FUNCTION get_identity_providers()
RETURNS TABLE (
    id uuid,
    provider_name varchar,
    is_active boolean,
    created_at timestamptz,
    updated_at timestamptz
    -- Note: config_data excluded for security
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT ip.id, ip.provider_name, ip.is_active, ip.created_at, ip.updated_at
    FROM public.identity_providers ip
    ORDER BY ip.provider_name;
END;
$$;

-- Full details with config_data (super_user only)
CREATE OR REPLACE FUNCTION get_identity_provider_full(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN (
        SELECT json_build_object(
            'id', ip.id,
            'provider_name', ip.provider_name,
            'config_data', ip.config_data,
            'is_active', ip.is_active,
            'created_at', ip.created_at,
            'updated_at', ip.updated_at
        )
        FROM public.identity_providers ip
        WHERE ip.id = p_id
    );
END;
$$;

-- Set permissions: Only super_user can manage identity providers
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_identity_providers', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT DO NOTHING;

-- Full config access (super_user only - contains sensitive data)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_identity_provider_full', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'super_user'
ON CONFLICT DO NOTHING;

-- Create/Update/Delete (super_user only)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_identity_provider', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'super_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_identity_provider', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'super_user'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'delete_identity_provider', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'super_user'
ON CONFLICT DO NOTHING;
```

**Key Security Considerations for Identity Providers:**
- Never expose `config_data` (OAuth secrets) to non-super_user roles
- Log all modifications to identity providers for audit trail
- Consider separate functions for viewing vs. modifying sensitive config
- Validate provider configurations before saving

### Adding Google OAuth Provider

To configure Google OAuth authentication, you need to add the Google identity provider with OAuth credentials:

**Step 1: Obtain Google OAuth Credentials**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** > **Credentials**
4. Click **Create Credentials** > **OAuth client ID**
5. Configure the OAuth consent screen if prompted
6. Select application type (Web application)
7. Add authorized redirect URIs (e.g., `https://your-domain.com/auth/callback`)
8. Copy the **Client ID** and **Client Secret**

**Step 2: Add Google Provider to Database**

Use the following SQL to insert or update the Google identity provider. **Replace the placeholder values with your actual credentials:**

```sql
-- Insert or update Google identity provider with OAuth credentials
INSERT INTO public.identity_providers (provider_name, config_data, is_active)
VALUES (
    'google',
    jsonb_build_object(
        'client_id', 'YOUR_GOOGLE_CLIENT_ID_HERE',
        'client_secret', 'YOUR_GOOGLE_CLIENT_SECRET_HERE'
    ),
    true
)
ON CONFLICT (provider_name) 
DO UPDATE SET 
    config_data = EXCLUDED.config_data,
    is_active = EXCLUDED.is_active,
    updated_at = now()
RETURNING *;
```

**Required Values:**
- **Client ID**: Your Google OAuth Client ID (e.g., `YOUR_CLIENT_ID.apps.googleusercontent.com`)
- **Client Secret**: Your Google OAuth Client Secret (e.g., `YOUR_CLIENT_SECRET`)

**Example with placeholder values:**

```sql
-- Example: Google OAuth provider configuration
INSERT INTO public.identity_providers (provider_name, config_data, is_active)
VALUES (
    'google',
    jsonb_build_object(
        'client_id', 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
        'client_secret', 'YOUR_GOOGLE_CLIENT_SECRET'
    ),
    true
)
ON CONFLICT (provider_name) 
DO UPDATE SET 
    config_data = EXCLUDED.config_data,
    is_active = EXCLUDED.is_active,
    updated_at = now();
```

**Step 3: Verify Configuration**

After inserting, verify the provider was added correctly:

```sql
-- View Google provider (sanitized - no secrets)
SELECT 
    id,
    provider_name,
    is_active,
    created_at,
    updated_at
FROM public.identity_providers
WHERE provider_name = 'google';

-- View full configuration including secrets (super_user only)
SELECT 
    id,
    provider_name,
    config_data,
    is_active
FROM public.identity_providers
WHERE provider_name = 'google';
```

**Security Notes:**
- Only users with `super_user` role can view the full `config_data` including the client secret
- Store credentials securely and never commit them to version control
- Rotate credentials periodically for security
- Use environment variables or secure vaults in production

## Troubleshooting

**403 Forbidden errors?**
- Check role_permissions table
- Verify role_id matches user's role
- Check function name matches exactly
- Verify operation is 'EXECUTE' for functions

**User can't access module?**
- Check user's role_id in users table
- Verify permissions exist for that role
- Check Lambda proxy logs
- Test with different user role

**Permission not working?**
- Check SECURITY DEFINER on function
- Verify permission was inserted (no conflicts)
- Check permission is allowed = true
- Verify role_id is correct

**Receiving checklist saves but checkbox never ticks (receiving_checklist_id stays null)?**
- **1) create_receiving_checklist must return the new id.** The Lambda response from `create_receiving_checklist` must expose the new checklist id so the app can link it to the batch. The app expects one of: `{ success: true, id: "<uuid>" }` or `{ data: { id: "<uuid>" } }` or `{ create_receiving_checklist: { id: "<uuid>" } }`. If the Lambda wraps the RPC result differently, the app cannot get the id and will show “Checklist saved, tick not updated” – open the browser console (F12) and look for `[Receiving checklist]` to see the actual response shape.
- **2) update_production_batch must be allowed and receive the id.** The Lambda must pass the request body through to Supabase’s `update_production_batch` RPC, including `p_receiving_checklist_id`. Ensure the user’s role has EXECUTE on **update_production_batch** (run the “Grower Intake: Create kernel batch + Receiving checklist tick” SQL in this guide). Sign out and sign in after changing permissions.
- **3) Check the browser console** for “Link checklist to batch failed” (permission/403) or “[Receiving checklist] Saved but id missing” (response shape).

## Checklist

When adding RBAC for new module:

- [ ] Database function created with SECURITY DEFINER
- [ ] Permissions added to role_permissions table
- [ ] Permissions tested for each role
- [ ] Frontend checks added (if needed)
- [ ] Documentation updated
- [ ] Tested with different user roles

## Next Steps

- See `MODULE_GUIDE.md` for module creation
- Review `PATTERNS.md` for architecture patterns
- Check `DATABASE_GUIDE.md` for database setup

