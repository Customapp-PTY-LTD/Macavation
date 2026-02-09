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
-- Add EXECUTE permission for specific roles
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_items', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;
```

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

## Checklist

When adding RBAC for new module:

- [ ] Database function created with SECURITY DEFINER
- [ ] Permissions added to role_permissions table
- [ ] Permissions tested for each role
- [ ] Frontend checks added (if needed)
- [ ] Documentation updated
- [ ] Tested with different user roles

## Troubleshooting: "Access denied: operation EXECUTE is not allowed" (Kernel / Create batch)

When creating a new kernel batch in **Grower Intake**, the backend (Lambda) checks the `role_permissions` table in Supabase. If you see this error:

1. **Log out and log back in** so your JWT has your current role.
2. **Admin fix (required if step 1 doesn’t help):** The Lambda must use the **same Supabase project** where `role_permissions` has EXECUTE for your role.

**Option A – Point Lambda at the correct Supabase (recommended)**  
In **AWS Lambda** → your function → **Configuration** → **Environment variables**, set:
- **Name:** `SUPABASE_URL`
- **Value:** `https://tfwrktyynvnjjhcqnlul.supabase.co`  
(See project root file `LAMBDA_ENV_REQUIRED.md`.)

**Option B – Grant EXECUTE on the database the Lambda already uses**  
If the Lambda cannot be changed, run this SQL on the Supabase project that the Lambda’s `SUPABASE_URL` points to (so `role_permissions` and `users`/roles are in that project):

```sql
-- Grant EXECUTE on production batch functions to all roles (so Create kernel batch works)
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_production_batches', 'EXECUTE', true
FROM public.roles r
ON CONFLICT (role_id, object_type, object_name, operation) DO UPDATE SET allowed = true;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_production_batch_simple', 'EXECUTE', true
FROM public.roles r
ON CONFLICT (role_id, object_type, object_name, operation) DO UPDATE SET allowed = true;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_production_batch', 'EXECUTE', true
FROM public.roles r
ON CONFLICT (role_id, object_type, object_name, operation) DO UPDATE SET allowed = true;
```

Then have users log out and log back in and try again.

## Next Steps

- See `MODULE_GUIDE.md` for module creation
- Review `PATTERNS.md` for architecture patterns
- Check `DATABASE_GUIDE.md` for database setup

