# RBAC Implementation Guide for UnderRight

This guide explains how to properly implement Role-Based Access Control (RBAC) when adding new functions or CRUD operations to the UnderRight project.

## Overview

The UnderRight project uses a comprehensive RBAC system with:
- **Roles**: Admin, User, Viewer
- **Objects**: Tables, Functions, Views
- **Operations**: SELECT, INSERT, UPDATE, DELETE, EXECUTE
- **Permissions**: Stored in `role_permissions` table

## Database Structure

### Core Tables
- `roles` - Defines available roles (Admin, User, Viewer)
- `role_permissions` - Maps roles to object permissions
- `users` - User accounts with role assignments

### Permission Format
```sql
object_type:object_name:operation
-- Examples:
-- table:users:INSERT
-- function:get_users:EXECUTE
-- view:user_summary:SELECT
```

## Adding New Database Functions

### 1. Create the Function
```sql
-- Example: Creating a new function
CREATE OR REPLACE FUNCTION your_function_name(
    param1 VARCHAR,
    param2 INTEGER DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- Variables
BEGIN
    -- Function logic
    RETURN json_build_object('success', true, 'data', result);
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

### 2. Add RBAC Permissions
```sql
-- Add EXECUTE permission for Admin role
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'your_function_name', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'Admin'
AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id 
    AND rp.object_type = 'function' 
    AND rp.object_name = 'your_function_name' 
    AND rp.operation = 'EXECUTE'
);

-- Add EXECUTE permission for User role (if needed)
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'your_function_name', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'User'
AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id 
    AND rp.object_type = 'function' 
    AND rp.object_name = 'your_function_name' 
    AND rp.operation = 'EXECUTE'
);
```

### 3. Update Frontend
```javascript
// In auth-service.js, add a new method
async yourFunctionName(params, token) {
    try {
        const response = await fetch(`${this.proxyUrl}/proxy/function`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                function: 'your_function_name',
                params: params
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        // Check if the function returned an error
        if (result.error) {
            throw new Error(result.error);
        }
        
        return result;
    } catch (error) {
        console.error('Error calling your_function_name:', error);
        throw error;
    }
}
```

## Adding New Tables

### 1. Create the Table
```sql
CREATE TABLE your_table_name (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 2. Add RBAC Permissions for All Operations
```sql
-- Add permissions for Admin role
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'table', 'your_table_name', op.operation, true
FROM roles r
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS op(operation)
WHERE r.role_name = 'Admin'
AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id 
    AND rp.object_type = 'table' 
    AND rp.object_name = 'your_table_name' 
    AND rp.operation = op.operation
);

-- Add SELECT permission for User role
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'table', 'your_table_name', 'SELECT', true
FROM roles r 
WHERE r.role_name = 'User'
AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id 
    AND rp.object_type = 'table' 
    AND rp.object_name = 'your_table_name' 
    AND rp.operation = 'SELECT'
);

-- Add SELECT permission for Viewer role
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'table', 'your_table_name', 'SELECT', true
FROM roles r 
WHERE r.role_name = 'Viewer'
AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id 
    AND rp.object_type = 'table' 
    AND rp.object_name = 'your_table_name' 
    AND rp.operation = 'SELECT'
);
```

### 3. Update SQL Protection
Add your table to the allowed tables list in `utils/sqlProtection.js`:
```javascript
const ALLOWED_TABLES = [
    'users',
    'roles', 
    'role_permissions',
    'user_sessions',
    'identity_providers',
    'Clients',
    'Company',
    'Documents',
    'DocumentInstances',
    'RecordOfAdvice',
    'Tags',
    'your_table_name'  // Add your new table here
];
```

## Adding CRUD Operations

### 1. Create CRUD Functions
```sql
-- Create function
CREATE OR REPLACE FUNCTION create_your_entity(
    p_name VARCHAR,
    p_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO your_table_name (name, description)
    VALUES (p_name, p_description)
    RETURNING id INTO v_id;
    
    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'message', 'Entity created successfully'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to create entity: ' || SQLERRM
        );
END;
$$;

-- Read function
CREATE OR REPLACE FUNCTION get_your_entities()
RETURNS TABLE(
    id UUID,
    name VARCHAR,
    description TEXT,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT yt.id, yt.name, yt.description, yt.is_active, yt.created_at
    FROM your_table_name yt
    WHERE yt.is_active = true
    ORDER BY yt.created_at DESC;
END;
$$;

-- Update function
CREATE OR REPLACE FUNCTION update_your_entity(
    p_id UUID,
    p_name VARCHAR DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE your_table_name 
    SET 
        name = COALESCE(p_name, name),
        description = COALESCE(p_description, description),
        updated_at = now()
    WHERE id = p_id;
    
    IF FOUND THEN
        RETURN json_build_object(
            'success', true,
            'message', 'Entity updated successfully'
        );
    ELSE
        RETURN json_build_object(
            'success', false,
            'error', 'Entity not found'
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to update entity: ' || SQLERRM
        );
END;
$$;

-- Delete function
CREATE OR REPLACE FUNCTION delete_your_entity(p_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE your_table_name 
    SET is_active = false, updated_at = now()
    WHERE id = p_id;
    
    IF FOUND THEN
        RETURN json_build_object(
            'success', true,
            'message', 'Entity deleted successfully'
        );
    ELSE
        RETURN json_build_object(
            'success', false,
            'error', 'Entity not found'
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to delete entity: ' || SQLERRM
        );
END;
$$;
```

### 2. Add Function Permissions
```sql
-- Add permissions for all CRUD functions
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', func.function_name, 'EXECUTE', true
FROM roles r
CROSS JOIN (VALUES 
    ('create_your_entity'),
    ('get_your_entities'),
    ('update_your_entity'),
    ('delete_your_entity')
) AS func(function_name)
WHERE r.role_name = 'Admin'
AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = r.id 
    AND rp.object_type = 'function' 
    AND rp.object_name = func.function_name 
    AND rp.operation = 'EXECUTE'
);
```

## Frontend Integration

### 1. Add Service Methods
```javascript
// In auth-service.js
class AuthService {
    // ... existing methods ...

    async createYourEntity(data, token) {
        return await this.callFunction('create_your_entity', data, token);
    }

    async getYourEntities(token) {
        return await this.callFunction('get_your_entities', {}, token);
    }

    async updateYourEntity(id, data, token) {
        return await this.callFunction('update_your_entity', { p_id: id, ...data }, token);
    }

    async deleteYourEntity(id, token) {
        return await this.callFunction('delete_your_entity', { p_id: id }, token);
    }

    // Helper method for function calls
    async callFunction(functionName, params, token) {
        try {
            const response = await fetch(`${this.proxyUrl}/proxy/function`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    function: functionName,
                    params: params
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.error) {
                throw new Error(result.error);
            }
            
            return result;
        } catch (error) {
            console.error(`Error calling ${functionName}:`, error);
            throw error;
        }
    }
}
```

### 2. Add UI Components
```javascript
// In admin.js or your component file
async function loadYourEntities() {
    try {
        const lambdaToken = localStorage.getItem('lambda_token');
        if (!lambdaToken) {
            showAuthError();
            return;
        }

        const result = await window.authService.getYourEntities(lambdaToken);
        // Process and display results
        displayYourEntities(result);
    } catch (error) {
        console.error('Error loading entities:', error);
        showErrorAlert('Error Loading Entities', 'Failed to load entities. Please try again.');
    }
}

async function createYourEntity(formData) {
    try {
        const lambdaToken = localStorage.getItem('lambda_token');
        if (!lambdaToken) {
            showAuthError();
            return;
        }

        const result = await window.authService.createYourEntity(formData, lambdaToken);
        showNotification('Entity created successfully', 'success');
        closeModal('your-modal');
        loadYourEntities(); // Refresh the list
    } catch (error) {
        console.error('Error creating entity:', error);
        showErrorAlert('Error Creating Entity', error.message || 'Failed to create entity.');
    }
}
```

## Testing RBAC

### 1. Verify Permissions
```sql
-- Check if permissions are correctly set
SELECT r.role_name, rp.object_type, rp.object_name, rp.operation, rp.allowed 
FROM roles r 
LEFT JOIN role_permissions rp ON r.id = rp.role_id 
WHERE rp.object_name = 'your_function_name'
ORDER BY r.role_name;
```

### 2. Test with Different Roles
- Test with Admin user (should have full access)
- Test with User role (should have limited access)
- Test with Viewer role (should have read-only access)

## Best Practices

### 1. Security
- Always use `SECURITY DEFINER` for functions
- Set `search_path = public` to prevent injection
- Validate all input parameters
- Use parameterized queries

### 2. Error Handling
- Return structured JSON responses
- Include meaningful error messages
- Log errors for debugging
- Use SweetAlert for user-facing errors

### 3. Performance
- Use indexes on frequently queried columns
- Implement proper pagination
- Cache frequently accessed data
- Use connection pooling

### 4. Consistency
- Follow naming conventions
- Use consistent parameter prefixes (p_ for parameters)
- Return consistent response formats
- Document all functions

## Common Patterns

### 1. Validation Pattern
```sql
-- Always validate required fields
IF p_required_field IS NULL OR p_required_field = '' THEN
    RETURN json_build_object(
        'success', false,
        'error', 'Required field is missing'
    );
END IF;
```

### 2. Existence Check Pattern
```sql
-- Check if record exists before operations
IF NOT EXISTS (SELECT 1 FROM your_table WHERE id = p_id) THEN
    RETURN json_build_object(
        'success', false,
        'error', 'Record not found'
    );
END IF;
```

### 3. Soft Delete Pattern
```sql
-- Use soft deletes instead of hard deletes
UPDATE your_table 
SET is_active = false, updated_at = now()
WHERE id = p_id;
```

## Troubleshooting

### Common Issues
1. **Permission Denied**: Check if RBAC permissions are set correctly
2. **Function Not Found**: Verify function name and parameters
3. **Authentication Error**: Check if user has valid token
4. **Validation Error**: Ensure all required fields are provided

### Debug Steps
1. Check function exists: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'your_function';`
2. Check permissions: Query `role_permissions` table
3. Check user role: Query `users` table with role join
4. Test function directly: Call function with SQL
5. Check logs: Look at Lambda and Supabase logs

This guide should help you implement RBAC correctly for any new functionality in the UnderRight project.
