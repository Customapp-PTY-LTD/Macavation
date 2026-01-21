# Supabase Best Practices

**Version: 1.0.0**  
**Last Updated: January 2026**  
**Target Audience: Developers & Database Administrators**

---

## Table of Contents

1. [Database Functions](#database-functions)
2. [Row Level Security (RLS)](#row-level-security-rls)
3. [API Integration Patterns](#api-integration-patterns)
4. [Authentication & Authorization](#authentication--authorization)
5. [Error Handling](#error-handling)
6. [Database Schema Design](#database-schema-design)
7. [Performance Optimization](#performance-optimization)
8. [Security Practices](#security-practices)
9. [Migration Management](#migration-management)
10. [Testing & Validation](#testing--validation)

---

## 1. Database Functions

### 1.1 Function Structure

Always use a consistent structure for database functions:

```sql
CREATE OR REPLACE FUNCTION function_name(
    p_param1 VARCHAR(255),
    p_param2 INTEGER DEFAULT NULL,
    p_param3 BOOLEAN DEFAULT false
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSON;
    v_id UUID;
BEGIN
    -- Input validation
    IF p_param1 IS NULL OR p_param1 = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Parameter 1 is required'
        );
    END IF;

    -- Business logic here
    -- ...

    -- Return success response
    RETURN json_build_object(
        'success', true,
        'data', v_result
    );

EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Duplicate entry'
        );
    WHEN foreign_key_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Referenced record does not exist'
        );
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Error: ' || SQLERRM
        );
END;
$$;
```

### 1.2 Naming Conventions

- **Function names**: Use snake_case with descriptive verbs
  - `create_user_simple`
  - `update_item_status`
  - `get_user_by_email`
  - `delete_entity_soft`

- **Parameters**: Prefix with `p_` (e.g., `p_email`, `p_user_id`)
- **Variables**: Prefix with `v_` (e.g., `v_result`, `v_count`)
- **Constants**: Prefix with `c_` (e.g., `c_max_retries`)

### 1.3 Return Format

Always return JSON with a consistent structure:

```sql
-- Success response
json_build_object(
    'success', true,
    'data', result_data,
    'message', 'Optional success message'
)

-- Error response
json_build_object(
    'success', false,
    'error', 'Error message here'
)
```

### 1.4 Input Validation

Always validate inputs at the function level:

```sql
-- Check for required fields
IF p_email IS NULL OR p_email = '' THEN
    RETURN json_build_object('success', false, 'error', 'Email is required');
END IF;

-- Validate email format
IF NOT p_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid email format');
END IF;

-- Check for duplicates before insert
IF EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN
    RETURN json_build_object('success', false, 'error', 'Email already exists');
END IF;
```

### 1.5 Security Considerations

- **Use SECURITY DEFINER sparingly**: Only when the function needs elevated privileges
- **Set search_path**: Always set `SET search_path = public` to prevent schema injection
- **Validate all inputs**: Never trust user input
- **Use parameterized queries**: Never concatenate user input into SQL strings

### 1.6 Error Handling

Always include comprehensive exception handling:

```sql
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'error', 'Duplicate entry');
    WHEN foreign_key_violation THEN
        RETURN json_build_object('success', false, 'error', 'Referenced record not found');
    WHEN check_violation THEN
        RETURN json_build_object('success', false, 'error', 'Data validation failed');
    WHEN not_null_violation THEN
        RETURN json_build_object('success', false, 'error', 'Required field is missing');
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Unexpected error: ' || SQLERRM);
```

### 1.7 Function Permissions

Grant execute permissions appropriately:

```sql
-- Grant to authenticated users
GRANT EXECUTE ON FUNCTION function_name TO authenticated;

-- Grant to anonymous users (only if necessary)
GRANT EXECUTE ON FUNCTION function_name TO anon;

-- Revoke from public (security best practice)
REVOKE EXECUTE ON FUNCTION function_name FROM public;
```

### 1.8 Documentation

Always add comments to functions:

```sql
COMMENT ON FUNCTION function_name IS 
'Description of what the function does. 
Parameters: p_param1 - description, p_param2 - description
Returns: JSON with success status and data or error message';
```

---

## 2. Row Level Security (RLS)

### 2.1 Enable RLS on All Tables

Always enable RLS on tables containing sensitive data:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
```

### 2.2 Policy Naming Convention

Use descriptive policy names:

```sql
-- Format: {operation}_{table}_{description}
CREATE POLICY select_users_own_data ON users
    FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY insert_users_public ON users
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY update_users_own_data ON users
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
```

### 2.3 Policy Patterns

**Select Policies:**
```sql
-- Users can only see their own data
CREATE POLICY select_own_data ON table_name
    FOR SELECT
    USING (user_id = auth.uid());

-- Users can see all active records
CREATE POLICY select_active_records ON table_name
    FOR SELECT
    USING (is_active = true);

-- Role-based access
CREATE POLICY select_by_role ON table_name
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE u.id = auth.uid()
            AND r.role_name IN ('Admin', 'Manager')
        )
    );
```

**Insert Policies:**
```sql
-- Users can insert their own records
CREATE POLICY insert_own_data ON table_name
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Public insert with validation
CREATE POLICY insert_public ON table_name
    FOR INSERT
    WITH CHECK (is_active = true);
```

**Update Policies:**
```sql
-- Users can update their own records
CREATE POLICY update_own_data ON table_name
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Admins can update any record
CREATE POLICY update_admin ON table_name
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE u.id = auth.uid()
            AND r.role_name = 'Admin'
        )
    );
```

**Delete Policies:**
```sql
-- Soft delete only (set is_active = false)
-- Hard delete restricted to admins
CREATE POLICY delete_admin_only ON table_name
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE u.id = auth.uid()
            AND r.role_name = 'Admin'
        )
    );
```

### 2.4 Testing RLS Policies

Always test policies with different user contexts:

```sql
-- Test as authenticated user
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = 'user-uuid-here';
SELECT * FROM table_name;

-- Test as anonymous user
SET LOCAL role anon;
SELECT * FROM table_name;
```

---

## 3. API Integration Patterns

### 3.1 Function Call Pattern

Use a consistent pattern for calling database functions from the frontend:

```javascript
async callFunction(functionName, params = {}, token = null) {
    const authToken = token || this.getToken();
    
    if (!authToken) {
        throw new Error('No authentication token available');
    }
    
    try {
        const response = await fetch(`${this.proxyUrl}/proxy/function`, {
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
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || errorData.error || 'Request failed');
        }
        
        const result = await response.json();
        
        // CRITICAL: Always check the success field
        if (result.success === false) {
            throw new Error(result.error || 'Operation failed');
        }
        
        return result;
    } catch (error) {
        console.error(`Error calling ${functionName}:`, error);
        throw error;
    }
}
```

### 3.2 Response Validation

Always validate API responses:

```javascript
// Check HTTP status
if (!response.ok) {
    // Handle HTTP errors
}

// Check success field from database function
if (result.success === false) {
    throw new Error(result.error || 'Operation failed');
}

// Validate data structure
if (!result.data || !Array.isArray(result.data)) {
    throw new Error('Invalid response format');
}
```

### 3.3 Error Handling

Implement comprehensive error handling:

```javascript
try {
    const result = await dataFunctions.callFunction('create_item', params);
    // Handle success
} catch (error) {
    // Check error type
    if (error.message.includes('already exists')) {
        // Handle duplicate
    } else if (error.message.includes('required')) {
        // Handle validation error
    } else {
        // Handle generic error
    }
    
    // Show user-friendly message
    showError(error.message);
}
```

### 3.4 Parameter Mapping

Map frontend data to database function parameters consistently:

```javascript
async createItem(itemData, token = null) {
    const params = {
        p_name: itemData.name,
        p_description: itemData.description || null,
        p_status: itemData.status || 'active',
        p_category_id: itemData.categoryId || null
    };
    
    // Remove undefined values
    Object.keys(params).forEach(key => {
        if (params[key] === undefined) {
            delete params[key];
        }
    });
    
    return await this.callFunction('create_item_simple', params, token);
}
```

### 3.5 Null Handling

Always handle null values explicitly:

```javascript
// In frontend
const params = {
    p_name: itemData.name,
    p_description: itemData.description || null,  // Explicit null
    p_date: itemData.date || null
};

// In database function
IF p_description IS NULL OR p_description = '' THEN
    -- Handle null case
END IF;
```

---

## 4. Authentication & Authorization

### 4.1 Token Management

Store and retrieve tokens securely:

```javascript
// Store token
localStorage.setItem('lambda_token', token);

// Retrieve token
const token = localStorage.getItem('lambda_token');

// Clear token on logout
localStorage.removeItem('lambda_token');
```

### 4.2 Token Validation

Always validate tokens before making requests:

```javascript
isAuthenticated() {
    const token = this.getToken();
    return !!token && token.length > 0;
}

// Check token expiration (if JWT)
isTokenValid(token) {
    try {
        const decoded = jwt.decode(token);
        if (!decoded || !decoded.exp) return false;
        return decoded.exp * 1000 > Date.now();
    } catch (error) {
        return false;
    }
}
```

### 4.3 Role-Based Access Control (RBAC)

Implement RBAC checks in database functions:

```sql
-- Check if user has required role
CREATE OR REPLACE FUNCTION check_user_role(
    p_user_id UUID,
    p_required_role VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_has_role BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE u.id = p_user_id
        AND r.role_name = p_required_role
    ) INTO v_has_role;
    
    RETURN v_has_role;
END;
$$;
```

### 4.4 Permission Checking

Check permissions before operations:

```sql
-- In database function
IF NOT check_user_role(p_user_id, 'Admin') THEN
    RETURN json_build_object(
        'success', false,
        'error', 'Insufficient permissions'
    );
END IF;
```

---

## 5. Error Handling

### 5.1 Frontend Error Handling

Always handle errors gracefully:

```javascript
try {
    const result = await dataFunctions.callFunction('function_name', params);
    
    if (result.success === false) {
        // Database function returned an error
        throw new Error(result.error);
    }
    
    // Process success
} catch (error) {
    // Log error for debugging
    console.error('Operation failed:', error);
    
    // Show user-friendly message
    if (error.message.includes('already exists')) {
        showError('This record already exists');
    } else if (error.message.includes('required')) {
        showError('Please fill in all required fields');
    } else {
        showError('An error occurred. Please try again.');
    }
}
```

### 5.2 Database Error Handling

Handle all possible exceptions:

```sql
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'error', 'Record already exists');
    WHEN foreign_key_violation THEN
        RETURN json_build_object('success', false, 'error', 'Referenced record not found');
    WHEN check_violation THEN
        RETURN json_build_object('success', false, 'error', 'Data validation failed');
    WHEN not_null_violation THEN
        RETURN json_build_object('success', false, 'error', 'Required field missing');
    WHEN OTHERS THEN
        -- Log the actual error for debugging
        RAISE WARNING 'Unexpected error in function_name: %', SQLERRM;
        RETURN json_build_object('success', false, 'error', 'An unexpected error occurred');
```

### 5.3 Error Messages

Use clear, user-friendly error messages:

```sql
-- Good: Clear and actionable
RETURN json_build_object('success', false, 'error', 'Email address is already registered');

-- Bad: Technical and unclear
RETURN json_build_object('success', false, 'error', 'UNIQUE constraint violation on users.email');
```

---

## 6. Database Schema Design

### 6.1 Table Naming

Use consistent naming conventions:

- **Tables**: Plural, snake_case (e.g., `users`, `order_items`)
- **Columns**: snake_case (e.g., `created_at`, `user_id`)
- **Primary Keys**: Always `id` (UUID or INTEGER)
- **Foreign Keys**: `{table}_id` (e.g., `user_id`, `order_id`)

### 6.2 Standard Columns

Include standard columns in all tables:

```sql
CREATE TABLE example_table (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- Your columns here
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);
```

### 6.3 Indexes

Create indexes for frequently queried columns:

```sql
-- Foreign keys
CREATE INDEX idx_table_user_id ON table_name(user_id);

-- Search columns
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(is_active);

-- Composite indexes for common queries
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
```

### 6.4 Constraints

Use constraints to enforce data integrity:

```sql
-- Unique constraints
ALTER TABLE users ADD CONSTRAINT unique_email UNIQUE (email);

-- Check constraints
ALTER TABLE orders ADD CONSTRAINT positive_amount CHECK (amount > 0);

-- Foreign key constraints
ALTER TABLE order_items 
    ADD CONSTRAINT fk_order_items_order 
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
```

### 6.5 Soft Deletes

Prefer soft deletes over hard deletes:

```sql
-- Add is_deleted column
ALTER TABLE table_name ADD COLUMN is_deleted BOOLEAN DEFAULT false;
ALTER TABLE table_name ADD COLUMN deleted_at TIMESTAMPTZ;

-- Update instead of delete
UPDATE table_name 
SET is_deleted = true, deleted_at = now() 
WHERE id = :id;

-- Filter deleted records in queries
SELECT * FROM table_name WHERE is_deleted = false;
```

---

## 7. Performance Optimization

### 7.1 Query Optimization

- **Use indexes**: Create indexes on frequently queried columns
- **Limit results**: Always use LIMIT in queries
- **Select specific columns**: Don't use `SELECT *`
- **Use EXPLAIN**: Analyze query performance

```sql
-- Good: Specific columns with limit
SELECT id, name, email 
FROM users 
WHERE is_active = true 
ORDER BY created_at DESC 
LIMIT 50;

-- Bad: All columns, no limit
SELECT * FROM users WHERE is_active = true;
```

### 7.2 Function Optimization

- **Avoid loops**: Use set-based operations
- **Use EXISTS**: Instead of COUNT when checking existence
- **Batch operations**: Process multiple records at once

```sql
-- Good: Set-based operation
UPDATE items 
SET status = 'processed' 
WHERE id = ANY(ARRAY[1, 2, 3]);

-- Bad: Loop-based operation
FOR item_id IN SELECT id FROM items WHERE status = 'pending' LOOP
    UPDATE items SET status = 'processed' WHERE id = item_id;
END LOOP;
```

### 7.3 Connection Pooling

Use connection pooling for better performance:

```javascript
// Configure connection pool
const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
```

### 7.4 Caching

Cache frequently accessed data:

```javascript
// Cache user data
const userCache = new Map();

async function getUser(id) {
    if (userCache.has(id)) {
        return userCache.get(id);
    }
    
    const user = await fetchUser(id);
    userCache.set(id, user);
    return user;
}
```

---

## 8. Security Practices

### 8.1 Input Sanitization

Always sanitize user input:

```sql
-- Use parameterized queries (automatic with function parameters)
-- Never concatenate user input into SQL strings

-- Bad: SQL injection risk
EXECUTE 'SELECT * FROM users WHERE email = ''' || p_email || '''';

-- Good: Parameterized
SELECT * FROM users WHERE email = p_email;
```

### 8.2 Password Handling

Never store plain text passwords:

```sql
-- Hash passwords using crypt
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Hash password
v_password_hash := crypt(p_password, gen_salt('bf'));

-- Verify password
SELECT (password_hash = crypt(p_password, password_hash)) AS is_valid
FROM users WHERE email = p_email;
```

### 8.3 Sensitive Data

Encrypt sensitive data:

```sql
-- Use pgcrypto for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt
v_encrypted := pgp_sym_encrypt(p_sensitive_data, 'encryption_key');

-- Decrypt
v_decrypted := pgp_sym_decrypt(v_encrypted, 'encryption_key');
```

### 8.4 Audit Logging

Log important operations:

```sql
-- Create audit log table
CREATE TABLE audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    action VARCHAR(50),
    table_name VARCHAR(100),
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Log in function
INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
VALUES (p_user_id, 'INSERT', 'items', v_item_id, to_jsonb(v_item_data));
```

### 8.5 Rate Limiting

Implement rate limiting at the API level:

```javascript
// Track request counts
const rateLimiter = {
    requests: new Map(),
    
    check(userId, maxRequests = 100, windowMs = 60000) {
        const now = Date.now();
        const userRequests = this.requests.get(userId) || [];
        
        // Remove old requests
        const recentRequests = userRequests.filter(time => now - time < windowMs);
        
        if (recentRequests.length >= maxRequests) {
            throw new Error('Rate limit exceeded');
        }
        
        recentRequests.push(now);
        this.requests.set(userId, recentRequests);
    }
};
```

---

## 9. Migration Management

### 9.1 Migration Naming

Use descriptive migration names:

```
20260115_001_create_users_table.sql
20260115_002_add_email_index.sql
20260116_001_create_orders_table.sql
```

### 9.2 Migration Structure

Structure migrations consistently:

```sql
-- Migration: 20260115_001_create_users_table.sql

-- Create table
CREATE TABLE users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_users_email ON users(email);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY select_users_own_data ON users
    FOR SELECT
    USING (auth.uid() = id);

-- Add comments
COMMENT ON TABLE users IS 'User accounts table';
COMMENT ON COLUMN users.email IS 'User email address (unique)';
```

### 9.3 Rollback Strategy

Always plan for rollbacks:

```sql
-- Migration file should include rollback
-- Up migration
CREATE TABLE example_table (...);

-- Down migration (in separate file or commented)
-- DROP TABLE IF EXISTS example_table;
```

### 9.4 Version Control

Track schema versions:

```sql
-- Create version table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
);

-- Record migration
INSERT INTO schema_migrations (version)
VALUES ('20260115_001_create_users_table');
```

---

## 10. Testing & Validation

### 10.1 Function Testing

Test database functions thoroughly:

```sql
-- Test successful case
SELECT create_user_simple('test@example.com', 'John', 'Doe');

-- Test validation
SELECT create_user_simple(NULL, 'John', 'Doe');  -- Should return error

-- Test duplicate
SELECT create_user_simple('test@example.com', 'John', 'Doe');
SELECT create_user_simple('test@example.com', 'Jane', 'Doe');  -- Should return error
```

### 10.2 RLS Testing

Test RLS policies with different users:

```sql
-- Test as authenticated user
SET LOCAL role authenticated;
SET LOCAL request.jwt.claim.sub = 'user-uuid';
SELECT * FROM table_name;

-- Test as anonymous user
SET LOCAL role anon;
SELECT * FROM table_name;
```

### 10.3 Integration Testing

Test API integration:

```javascript
// Test successful call
const result = await dataFunctions.callFunction('get_users', {});
expect(result.success).toBe(true);
expect(result.data).toBeDefined();

// Test error handling
try {
    await dataFunctions.callFunction('get_users', { invalid: 'param' });
    fail('Should have thrown error');
} catch (error) {
    expect(error.message).toBeDefined();
}
```

### 10.4 Performance Testing

Test query performance:

```sql
-- Use EXPLAIN to analyze queries
EXPLAIN ANALYZE
SELECT * FROM users WHERE email = 'test@example.com';

-- Check index usage
EXPLAIN (FORMAT JSON)
SELECT * FROM orders WHERE user_id = 'uuid-here';
```

---

## Summary

### Key Principles

1. **Consistency**: Use consistent naming, structure, and patterns
2. **Security**: Always validate input, use RLS, and handle errors securely
3. **Performance**: Optimize queries, use indexes, and limit results
4. **Maintainability**: Document code, use clear error messages, and plan migrations
5. **Testing**: Test functions, policies, and integrations thoroughly

### Checklist for New Functions

- [ ] Function follows naming conventions
- [ ] Input validation implemented
- [ ] Error handling with specific exceptions
- [ ] Returns consistent JSON format
- [ ] Security DEFINER used appropriately
- [ ] search_path set to public
- [ ] Permissions granted correctly
- [ ] Function documented with comments
- [ ] RLS policies created (if needed)
- [ ] Function tested with various inputs
- [ ] Performance considered (indexes, query optimization)

### Checklist for New Tables

- [ ] Table follows naming conventions
- [ ] Standard columns included (id, created_at, updated_at, etc.)
- [ ] Appropriate indexes created
- [ ] Constraints defined (unique, foreign keys, checks)
- [ ] RLS enabled
- [ ] RLS policies created for all operations
- [ ] Soft delete implemented (if needed)
- [ ] Table and columns documented

---

*This document provides best practices for working with Supabase. Adapt these patterns to your specific project needs while maintaining consistency and security.*
