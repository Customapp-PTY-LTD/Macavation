# CRUD Functions Implementation Guide

This guide explains how to create, implement, and integrate CRUD (Create, Read, Update, Delete) functions in the AutoFlows Admin Portal.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Functions](#database-functions)
4. [Frontend Integration](#frontend-integration)
5. [Lambda Proxy Integration](#lambda-proxy-integration)
6. [Creating New CRUD Functions](#creating-new-crud-functions)
7. [Examples](#examples)
8. [Error Handling](#error-handling)
9. [RBAC (Role-Based Access Control) Permissions](#rbac-role-based-access-control-permissions)
10. [Security Considerations](#security-considerations)
11. [Best Practices](#best-practices)

## Overview

The AutoFlows Admin Portal uses a three-tier architecture for CRUD operations:

1. **Frontend** (`data-functions.js`) - JavaScript functions that call the Lambda proxy
2. **Lambda Proxy** - AWS Lambda function that validates requests and calls Supabase
3. **Supabase Database Functions** - PostgreSQL functions that perform the actual CRUD operations

### Flow Diagram

```
Frontend (data-functions.js)
    ↓
Lambda Proxy (Authentication & Validation)
    ↓
Supabase Database Function (CRUD Operation)
    ↓
Database Table (Data Storage)
```

## Architecture

### Component Responsibilities

**Frontend (`data-functions.js`)**
- Provides JavaScript API for CRUD operations
- Handles authentication tokens
- Manages request/response formatting
- Provides error handling

**Lambda Proxy**
- Validates authentication tokens
- Routes requests to appropriate database functions
- Handles CORS and security
- Provides consistent error responses

**Database Functions**
- Perform actual database operations
- Enforce business logic
- Validate data integrity
- Return standardized JSON responses

## Database Functions

### Function Naming Conventions

Use consistent naming patterns:

- **Read (GET)**: `get_<entity>`, `get_<entity>_by_id`
- **Create**: `create_<entity>_simple`
- **Update**: `update_<entity>_simple`
- **Delete**: `delete_<entity>_hard`, `deactivate_<entity>`

Examples:
- `get_users`
- `get_user_by_id`
- `create_user_simple`
- `update_user_simple`
- `delete_user_hard`
- `deactivate_user`

### Function Structure

All database functions should follow this pattern:

```sql
CREATE OR REPLACE FUNCTION public.create_<entity>_simple(
    -- Required parameters first
    p_<required_field> <type>,
    -- Optional parameters with defaults
    p_<optional_field> <type> DEFAULT NULL,
    ...
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_<entity>_id UUID;
    v_result JSON;
BEGIN
    -- Validation
    IF p_<required_field> IS NULL OR p_<required_field> = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', '<Field> is required'
        );
    END IF;

    -- Business logic checks
    IF EXISTS (SELECT 1 FROM <table> WHERE <field> = p_<field>) THEN
        RETURN json_build_object(
            'success', false,
            'error', '<Field> already exists'
        );
    END IF;

    -- Perform operation
    INSERT INTO public.<table> (
        <field1>,
        <field2>,
        ...
    ) VALUES (
        p_<field1>,
        p_<field2>,
        ...
    )
    RETURNING id INTO v_<entity>_id;

    -- Return success response
    SELECT json_build_object(
        'success', true,
        '<entity>', json_build_object(
            'id', v_<entity>_id,
            <field1>, p_<field1>,
            ...
        )
    ) INTO v_result;

    RETURN v_result;

EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Duplicate entry'
        );
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Error creating <entity>: ' || SQLERRM
        );
END;
$function$;
```

### Response Format

All functions must return JSON in this format:

**Success Response:**
```json
{
    "success": true,
    "<entity>": {
        "id": "uuid",
        "field1": "value1",
        ...
    }
}
```

**Error Response:**
```json
{
    "success": false,
    "error": "Error message"
}
```

### SECURITY DEFINER

All CRUD functions should use `SECURITY DEFINER` to bypass RLS policies:

```sql
SECURITY DEFINER
```

This allows the function to run with the privileges of the function owner (typically postgres), bypassing Row Level Security policies.

## Frontend Integration

### data-functions.js Structure

The `data-functions.js` file provides a consistent API for all CRUD operations:

```javascript
var _dataFunctions = function () {
    return {
        proxyUrl: 'https://your-lambda-url/proxy/function',

        /**
         * Generic function call to Lambda proxy
         */
        callFunction: async function (functionName, params = {}, token = null) {
            const authToken = token || this.getToken();

            if (!authToken) {
                throw new Error('No authentication token available. Please sign in again.');
            }

            try {
                const response = await fetch(this.proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({
                        function: functionName,
                        params: params
                    })
                });

                if (!response.ok) {
                    let errorMessage = `HTTP error! status: ${response.status}`;
                    let errorData = null;
                    try {
                        const responseText = await response.text();
                        errorData = JSON.parse(responseText);
                        errorMessage = errorData.message || errorData.error || errorMessage;
                    } catch (e) {
                        errorMessage = responseText || response.statusText || errorMessage;
                    }

                    if (response.status === 401) {
                        throw new Error('Invalid or expired token');
                    }

                    throw new Error(errorMessage);
                }

                const responseText = await response.text();
                let data;
                try {
                    data = JSON.parse(responseText);
                } catch (e) {
                    throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
                }

                return data;
            } catch (error) {
                throw error;
            }
        },

        // CRUD operations for specific entities
        // ...
    };
}();
```

### Adding CRUD Functions

To add CRUD functions for a new entity, add methods to `_dataFunctions`:

```javascript
// ===== <ENTITY> MANAGEMENT FUNCTIONS =====

/**
 * Get all <entities>
 */
get<Entities>: async function (token = null) {
    return await this.callFunction('get_<entities>', {}, token);
},

/**
 * Get <entity> by ID
 */
get<Entity>ById: async function (<entity>Id, token = null) {
    return await this.callFunction('get_<entity>_by_id', { p_id: <entity>Id }, token);
},

/**
 * Create <entity>
 */
create<Entity>: async function (<entity>Data, token = null) {
    const params = {
        p_<field1>: <entity>Data.<field1>,
        p_<field2>: <entity>Data.<field2> || null,
        ...
    };
    return await this.callFunction('create_<entity>_simple', params, token);
},

/**
 * Update <entity>
 */
update<Entity>: async function (<entity>Id, <entity>Data, token = null) {
    const params = {
        p_<entity>_id: <entity>Id,
        p_<field1>: <entity>Data.<field1> || null,
        p_<field2>: <entity>Data.<field2> || null,
        ...
    };
    return await this.callFunction('update_<entity>_simple', params, token);
},

/**
 * Delete <entity> (hard delete)
 */
delete<Entity>: async function (<entity>Id, token = null) {
    return await this.callFunction('delete_<entity>_hard', { p_<entity>_id: <entity>Id }, token);
},

/**
 * Deactivate <entity> (soft delete)
 */
deactivate<Entity>: async function (<entity>Id, token = null) {
    return await this.callFunction('deactivate_<entity>', { p_<entity>_id: <entity>Id }, token);
}
```

## Lambda Proxy Integration

### Request Format

The Lambda proxy expects requests in this format:

```json
{
    "function": "function_name",
    "params": {
        "p_param1": "value1",
        "p_param2": "value2"
    }
}
```

### Response Format

**Success:**
```json
{
    "success": true,
    "<entity>": { ... }
}
```

**Error:**
```json
{
    "success": false,
    "error": "Error message"
}
```

### Lambda Function Pattern

```javascript
exports.handler = async (event) => {
    try {
        // Parse request
        const body = JSON.parse(event.body);
        const { function: functionName, params } = body;

        // Validate authentication
        const token = event.headers.Authorization?.replace('Bearer ', '');
        if (!token) {
            return {
                statusCode: 401,
                body: JSON.stringify({ success: false, error: 'Unauthorized' })
            };
        }

        // Validate token and get user
        const user = await validateToken(token);

        // Route to appropriate function
        let result;
        switch (functionName) {
            case 'get_<entities>':
                result = await supabase.rpc('get_<entities>', params);
                break;
            case 'create_<entity>_simple':
                result = await supabase.rpc('create_<entity>_simple', params);
                break;
            // ... other cases
            default:
                return {
                    statusCode: 404,
                    body: JSON.stringify({ success: false, error: 'Function not found' })
                };
        }

        // Handle Supabase response
        if (result.error) {
            return {
                statusCode: 500,
                body: JSON.stringify({ success: false, error: result.error.message })
            };
        }

        // Return success
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(result.data || result)
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                success: false, 
                error: error.message 
            })
        };
    }
};
```

## Creating New CRUD Functions

### Step-by-Step Guide

#### Step 1: Create Database Function

Use Supabase MCP or SQL editor to create the function:

```sql
-- Example: Create function for "products" entity
CREATE OR REPLACE FUNCTION public.create_product_simple(
    p_name text,
    p_description text DEFAULT NULL::text,
    p_price numeric DEFAULT NULL::numeric,
    p_category_id uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_product_id UUID;
    v_result JSON;
BEGIN
    -- Validation
    IF p_name IS NULL OR p_name = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Product name is required'
        );
    END IF;

    -- Insert
    INSERT INTO public.products (
        name,
        description,
        price,
        category_id,
        created_at,
        updated_at
    ) VALUES (
        p_name,
        p_description,
        p_price,
        p_category_id,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_product_id;

    -- Return success
    SELECT json_build_object(
        'success', true,
        'product', json_build_object(
            'id', v_product_id,
            'name', p_name,
            'description', p_description,
            'price', p_price,
            'category_id', p_category_id
        )
    ) INTO v_result;

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Error creating product: ' || SQLERRM
        );
END;
$function$;
```

#### Step 2: Add Frontend Functions

Add to `data-functions.js`:

```javascript
// ===== PRODUCT MANAGEMENT FUNCTIONS =====

/**
 * Get all products
 */
getProducts: async function (token = null) {
    return await this.callFunction('get_products', {}, token);
},

/**
 * Get product by ID
 */
getProductById: async function (productId, token = null) {
    return await this.callFunction('get_product_by_id', { p_id: productId }, token);
},

/**
 * Create product
 */
createProduct: async function (productData, token = null) {
    const params = {
        p_name: productData.name,
        p_description: productData.description || null,
        p_price: productData.price || null,
        p_category_id: productData.category_id || null
    };
    return await this.callFunction('create_product_simple', params, token);
},

/**
 * Update product
 */
updateProduct: async function (productId, productData, token = null) {
    const params = {
        p_product_id: productId,
        p_name: productData.name || null,
        p_description: productData.description || null,
        p_price: productData.price || null,
        p_category_id: productData.category_id || null
    };
    return await this.callFunction('update_product_simple', params, token);
},

/**
 * Delete product
 */
deleteProduct: async function (productId, token = null) {
    return await this.callFunction('delete_product_hard', { p_product_id: productId }, token);
}
```

#### Step 3: Update Lambda Function

Add case to Lambda switch statement:

```javascript
case 'create_product_simple':
    result = await supabase.rpc('create_product_simple', params);
    break;
case 'get_products':
    result = await supabase.rpc('get_products', params);
    break;
// ... etc
```

#### Step 4: Use in Module

Use in your module JavaScript file:

```javascript
// Create product
async saveProduct() {
    try {
        const productData = {
            name: document.getElementById('productName').value,
            description: document.getElementById('productDescription').value,
            price: parseFloat(document.getElementById('productPrice').value),
            category_id: document.getElementById('productCategory').value || null
        };

        const result = await _dataFunctions.createProduct(productData);
        
        if (result.success) {
            this.showSuccess('Product created successfully');
            await this.loadProducts();
        } else {
            this.showError(result.error || 'Failed to create product');
        }
    } catch (error) {
        console.error('Error creating product:', error);
        this.showError('Failed to create product: ' + error.message);
    }
}
```

## Examples

### Complete Example: User Management

#### Database Function

```sql
CREATE OR REPLACE FUNCTION public.create_user_simple(
    p_email text,
    p_username text DEFAULT NULL::text,
    p_password text DEFAULT NULL::text,
    p_role_id uuid DEFAULT NULL::uuid,
    p_first_name text DEFAULT NULL::text,
    p_last_name text DEFAULT NULL::text,
    p_full_name text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_user_id UUID;
    v_password_hash TEXT;
    v_username TEXT;
    v_result JSON;
BEGIN
    -- Validate email
    IF p_email IS NULL OR p_email = '' THEN
        RETURN json_build_object('success', false, 'error', 'Email is required');
    END IF;

    -- Check if email exists
    IF EXISTS (SELECT 1 FROM public.users WHERE email = p_email) THEN
        RETURN json_build_object('success', false, 'error', 'Email already exists');
    END IF;

    -- Hash password
    IF p_password IS NOT NULL AND p_password != '' THEN
        v_password_hash := crypt(p_password, gen_salt('bf'));
    END IF;

    -- Determine username
    IF p_username IS NOT NULL AND p_username != '' THEN
        v_username := p_username;
    ELSIF p_first_name IS NOT NULL AND p_last_name IS NOT NULL THEN
        v_username := p_first_name || ' ' || p_last_name;
    ELSIF p_full_name IS NOT NULL THEN
        v_username := p_full_name;
    ELSE
        v_username := p_email;
    END IF;

    -- Insert user
    INSERT INTO public.users (
        email, username, password_hash, role_id,
        first_name, last_name, full_name,
        is_active, created_at, updated_at
    ) VALUES (
        p_email, v_username, v_password_hash, p_role_id,
        p_first_name, p_last_name, p_full_name,
        TRUE, NOW(), NOW()
    )
    RETURNING id INTO v_user_id;

    -- Return success
    SELECT json_build_object(
        'success', true,
        'user', json_build_object(
            'id', v_user_id,
            'email', p_email,
            'username', v_username,
            'role_id', p_role_id
        )
    ) INTO v_result;

    RETURN v_result;

EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'error', 'Email or username already exists');
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Error creating user: ' || SQLERRM);
END;
$function$;
```

#### Frontend Usage

```javascript
// In users_grid.js or similar module
async saveUser() {
    try {
        const userData = {
            email: document.getElementById('email').value,
            username: document.getElementById('username').value || null,
            password: document.getElementById('password').value || null,
            role_id: document.getElementById('roleId').value || null,
            first_name: document.getElementById('firstName').value || null,
            last_name: document.getElementById('lastName').value || null
        };

        const result = await _dataFunctions.createUser(userData);
        
        if (result.success) {
            Swal.fire({
                icon: 'success',
                title: 'Success',
                text: 'User created successfully'
            });
            await this.loadUsers();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: result.error || 'Failed to create user'
            });
        }
    } catch (error) {
        console.error('Error creating user:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to create user: ' + error.message
        });
    }
}
```

## Error Handling

### Database Function Error Handling

Always use try-catch blocks and return proper error responses:

```sql
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'error', 'Duplicate entry');
    WHEN foreign_key_violation THEN
        RETURN json_build_object('success', false, 'error', 'Invalid reference');
    WHEN check_violation THEN
        RETURN json_build_object('success', false, 'error', 'Validation failed');
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Error: ' || SQLERRM);
```

### Frontend Error Handling

Always check the `success` field and handle errors:

```javascript
try {
    const result = await _dataFunctions.createEntity(entityData);
    
    if (result.success) {
        // Handle success
        this.showSuccess('Entity created successfully');
    } else {
        // Handle function-level error
        this.showError(result.error || 'Operation failed');
    }
} catch (error) {
    // Handle network/HTTP errors
    console.error('Error:', error);
    this.showError('Failed to create entity: ' + error.message);
}
```

## RBAC (Role-Based Access Control) Permissions

After creating CRUD functions, you **must** add RBAC permissions to the `role_permissions` table. This ensures that only authorized roles can execute specific functions.

### Step 1: Add Permissions After Creating Functions

For each CRUD function you create, add permissions following this pattern:

```sql
-- Read functions: All authenticated roles can read
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_<entities>', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin', 'manager', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Get by ID: All authenticated roles can read
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_<entity>_by_id', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin', 'manager', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Create functions: Only super_user and admin can create
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_<entity>_simple', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Explicitly deny create for other roles
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_<entity>_simple', 'EXECUTE', false
FROM public.roles r 
WHERE r.role_name IN ('manager', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = false;

-- Update functions: Only super_user and admin can update
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_<entity>_simple', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Explicitly deny update for other roles
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_<entity>_simple', 'EXECUTE', false
FROM public.roles r 
WHERE r.role_name IN ('manager', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = false;

-- Delete functions: Only super_user can delete
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'delete_<entity>_hard', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name = 'super_user'
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Explicitly deny delete for all other roles
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'delete_<entity>_hard', 'EXECUTE', false
FROM public.roles r 
WHERE r.role_name IN ('admin', 'manager', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = false;
```

### Step 2: Permission Levels

**Standard Permission Levels:**

| Role | Read | Create | Update | Delete |
|------|------|--------|--------|--------|
| `super_user` | ✅ | ✅ | ✅ | ✅ |
| `admin` | ✅ | ✅ | ✅ | ❌ |
| `manager` | ✅ | ❌ | ❌ | ❌ |
| `user` | ✅ | ❌ | ❌ | ❌ |
| `viewer` | ✅ | ❌ | ❌ | ❌ |

### Step 3: Complete Example (Companies Module)

```sql
-- Get companies (read) - All authenticated roles
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_companies', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin', 'manager', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Get company by ID (read) - All authenticated roles
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_company_by_id', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin', 'manager', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Create company (write) - Only super_user and admin
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_company_simple', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Update company (write) - Only super_user and admin
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_company_simple', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- Delete company (delete) - Only super_user
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'delete_company', 'EXECUTE', true
FROM public.roles r 
WHERE r.role_name = 'super_user'
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;
```

### Step 4: Verify Permissions

After adding permissions, verify they were created correctly:

```sql
-- Check permissions for a specific function
SELECT r.role_name, rp.object_name, rp.operation, rp.allowed
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.id
WHERE rp.object_name = 'get_companies'
ORDER BY r.role_name;
```

### Important Notes

1. **Always add permissions after creating functions** - Functions without permissions will be blocked by the Lambda proxy
2. **Use ON CONFLICT** - This allows you to re-run permission scripts without errors
3. **Explicitly deny when needed** - For security, explicitly set `allowed = false` for roles that should not have access
4. **Test with different roles** - Always test your functions with users having different roles to verify permissions work correctly

For more detailed RBAC information, see the [RBAC Guide](./RBAC_GUIDE.md).

## Security Considerations

### 1. Authentication

- All function calls require a valid authentication token
- Tokens are validated by the Lambda proxy
- Expired tokens result in 401 errors

### 2. Authorization

- Use `SECURITY DEFINER` for functions that need to bypass RLS
- Implement role-based checks within functions when needed
- Validate user permissions in Lambda before calling functions

### 3. Input Validation

Always validate inputs in database functions:

```sql
-- Check required fields
IF p_field IS NULL OR p_field = '' THEN
    RETURN json_build_object('success', false, 'error', 'Field is required');
END IF;

-- Check data types and formats
IF NOT p_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email format');
END IF;

-- Check constraints
IF p_price < 0 THEN
    RETURN json_build_object('success', false, 'error', 'Price cannot be negative');
END IF;
```

### 4. SQL Injection Prevention

- Always use parameterized queries (automatic with function parameters)
- Never concatenate user input into SQL strings
- Use proper data types for all parameters

### 5. Password Handling

- Always hash passwords using bcrypt
- Never return password hashes in responses
- Use `crypt()` function from pgcrypto extension

```sql
v_password_hash := crypt(p_password, gen_salt('bf'));
```

## Best Practices

### 1. Naming Conventions

- Use snake_case for database functions: `create_user_simple`
- Use camelCase for JavaScript functions: `createUser`
- Prefix parameters with `p_`: `p_email`, `p_user_id`
- Prefix variables with `v_`: `v_user_id`, `v_result`

### 2. Parameter Order

1. Required parameters first
2. ID parameters (for updates/deletes)
3. Optional parameters with defaults last

### 3. Response Consistency

Always return:
- `success: true/false`
- Entity data or error message
- Consistent structure across all functions

### 4. Transaction Management

For complex operations, use transactions:

```sql
BEGIN
    -- Multiple operations
    INSERT INTO table1 ...;
    INSERT INTO table2 ...;
    UPDATE table3 ...;
    
    -- Return success
    RETURN json_build_object('success', true, ...);
EXCEPTION
    WHEN OTHERS THEN
        -- Rollback happens automatically
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
```

### 5. Logging

Log important operations (consider adding audit logs):

```sql
-- Example: Log user creation
INSERT INTO audit_logs (
    action, entity_type, entity_id, user_id, details, created_at
) VALUES (
    'CREATE', 'user', v_user_id, current_user_id(), 
    json_build_object('email', p_email), NOW()
);
```

### 6. Performance

- Use indexes on frequently queried columns
- Limit result sets for list functions
- Use pagination for large datasets

### 7. Documentation

Document all functions:

```sql
COMMENT ON FUNCTION public.create_user_simple IS 
'Creates a new user with email, username, password, and optional role. 
Returns JSON with success status and user data.';
```

## Testing

### Testing Database Functions

Test functions directly in Supabase SQL editor:

```sql
-- Test create function
SELECT public.create_user_simple(
    'test@example.com',
    'testuser',
    'password123',
    NULL::uuid,
    'Test',
    'User',
    'Test User'
);

-- Test get function
SELECT * FROM public.get_users();

-- Test update function
SELECT public.update_user_simple(
    'user-id-here'::uuid,
    'newemail@example.com',
    'newusername',
    NULL::uuid,
    true,
    NULL::text
);
```

### Testing Frontend Integration

1. Open browser console
2. Call function directly:
```javascript
await _dataFunctions.createUser({
    email: 'test@example.com',
    username: 'testuser',
    password: 'password123'
});
```

3. Check network tab for Lambda request/response
4. Verify data in Supabase dashboard

## Troubleshooting

### Common Issues

**Issue: "Function not found in schema cache"**
- Solution: Wait a few seconds for cache to refresh, or restart Supabase connection

**Issue: "Invalid or expired token"**
- Solution: User needs to sign in again, token may have expired

**Issue: "RLS policy violation"**
- Solution: Ensure function uses `SECURITY DEFINER` or add appropriate RLS policies

**Issue: "Parameter type mismatch"**
- Solution: Check parameter types match function signature exactly

**Issue: "Unique constraint violation"**
- Solution: Check for duplicate values before inserting

### Debugging Tips

1. **Check Lambda Logs**: Look for detailed error messages
2. **Check Browser Console**: See JavaScript errors
3. **Check Network Tab**: Verify request/response format
4. **Test Function Directly**: Use Supabase SQL editor to test database function
5. **Verify Parameters**: Ensure all required parameters are provided

## Additional Resources

- [Supabase Functions Documentation](https://supabase.com/docs/guides/database/functions)
- [PostgreSQL Function Documentation](https://www.postgresql.org/docs/current/xfunc.html)
- [Lambda Proxy Pattern](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html)

---

**Last Updated:** January 2026  
**Version:** 1.1.0

**Changelog:**
- Added RBAC Permissions section with complete examples
- Updated to include permission setup as a required step after creating functions
