# Database Guide

This guide covers database patterns, schema design, and function creation.

## Database Setup

### Creating Tables

Standard table structure with common fields:

```sql
CREATE TABLE public.items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add indexes
CREATE INDEX idx_items_is_active ON public.items(is_active);
CREATE INDEX idx_items_created_at ON public.items(created_at DESC);

-- Enable Row Level Security (if needed)
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
```

### Standard Fields

Every table should include:
- `id` (uuid, primary key)
- `is_active` (boolean, for soft deletes)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

## Function Naming Convention

### Read Functions

```sql
-- Get all records
CREATE FUNCTION get_items() RETURNS TABLE (...)

-- Get by ID
CREATE FUNCTION get_item_by_id(p_id uuid) RETURNS json

-- Get with filters
CREATE FUNCTION get_items_by_status(p_status boolean) RETURNS TABLE (...)
```

### Write Functions

```sql
-- Create new record
CREATE FUNCTION create_item_simple(
    p_name text,
    p_description text DEFAULT NULL
) RETURNS json

-- Update existing record
CREATE FUNCTION update_item_simple(
    p_id uuid,
    p_name text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
) RETURNS json
```

### Delete Functions

```sql
-- Soft delete (set is_active = false)
CREATE FUNCTION deactivate_item(p_id uuid) RETURNS json

-- Hard delete (permanent removal)
CREATE FUNCTION delete_item_hard(p_id uuid) RETURNS json
```

## Function Template: Get All

```sql
CREATE OR REPLACE FUNCTION get_items()
RETURNS TABLE (
    id uuid,
    name text,
    description text,
    is_active boolean,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.id,
        i.name,
        i.description,
        i.is_active,
        i.created_at
    FROM public.items i
    WHERE i.is_active = true  -- Only return active records
    ORDER BY i.created_at DESC;
END;
$$;
```

## Function Template: Get By ID

```sql
CREATE OR REPLACE FUNCTION get_item_by_id(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item json;
BEGIN
    SELECT json_build_object(
        'id', i.id,
        'name', i.name,
        'description', i.description,
        'is_active', i.is_active,
        'created_at', i.created_at,
        'updated_at', i.updated_at
    ) INTO v_item
    FROM public.items i
    WHERE i.id = p_id;
    
    RETURN v_item;
END;
$$;
```

## Function Template: Create

```sql
CREATE OR REPLACE FUNCTION create_item_simple(
    p_name text,
    p_description text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    -- Validate input
    IF p_name IS NULL OR trim(p_name) = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Name is required'
        );
    END IF;
    
    -- Insert record
    INSERT INTO public.items (name, description)
    VALUES (trim(p_name), p_description)
    RETURNING id INTO v_id;
    
    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'message', 'Item created successfully'
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item with this name already exists'
        );
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;
```

## Function Template: Update

```sql
CREATE OR REPLACE FUNCTION update_item_simple(
    p_id uuid,
    p_name text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated boolean := false;
BEGIN
    -- Check if record exists
    IF NOT EXISTS (SELECT 1 FROM public.items WHERE id = p_id) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item not found'
        );
    END IF;
    
    -- Update only provided fields
    UPDATE public.items
    SET 
        name = COALESCE(p_name, name),
        description = COALESCE(p_description, description),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Item updated successfully'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;
```

## Function Template: Delete (Hard)

```sql
CREATE OR REPLACE FUNCTION delete_item_hard(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if record exists
    IF NOT EXISTS (SELECT 1 FROM public.items WHERE id = p_id) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item not found'
        );
    END IF;
    
    -- Delete record
    DELETE FROM public.items WHERE id = p_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Item deleted successfully'
    );
EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cannot delete item: referenced by other records'
        );
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;
```

## Function Template: Soft Delete

```sql
CREATE OR REPLACE FUNCTION deactivate_item(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.items
    SET 
        is_active = false,
        updated_at = now()
    WHERE id = p_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Item not found'
        );
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Item deactivated successfully'
    );
END;
$$;
```

## Parameter Naming Convention

Use `p_` prefix for function parameters:

```sql
CREATE FUNCTION create_item_simple(
    p_name text,           -- p_ prefix
    p_description text,    -- p_ prefix
    p_user_id uuid         -- p_ prefix
)
```

Use `v_` prefix for local variables:

```sql
DECLARE
    v_id uuid;             -- v_ prefix
    v_count integer;       -- v_ prefix
    v_result json;         -- v_ prefix
```

## Error Handling

Always include error handling:

```sql
AS $$
BEGIN
    -- Function logic
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'error', 'Duplicate entry');
    WHEN foreign_key_violation THEN
        RETURN json_build_object('success', false, 'error', 'Foreign key violation');
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

## Security Best Practices

### 1. Use SECURITY DEFINER

```sql
CREATE FUNCTION get_items()
SECURITY DEFINER  -- Runs with creator's privileges
AS $$ ... $$;
```

### 2. Set search_path

```sql
CREATE FUNCTION get_items()
SECURITY DEFINER
SET search_path = public  -- Prevent search_path injection
AS $$ ... $$;
```

### 3. Validate Input

```sql
IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Name required');
END IF;
```

### 4. Use Parameterized Queries

Never concatenate user input:
```sql
-- ❌ WRONG
EXECUTE 'SELECT * FROM items WHERE name = ''' || p_name || '''';

-- ✅ CORRECT
SELECT * FROM items WHERE name = p_name;
```

## Common Patterns

### Pattern 1: Filtered Queries

```sql
CREATE FUNCTION get_items_by_status(p_is_active boolean DEFAULT NULL)
RETURNS TABLE (...)
AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM public.items i
    WHERE (p_is_active IS NULL OR i.is_active = p_is_active)
    ORDER BY i.created_at DESC;
END;
$$;
```

### Pattern 2: Pagination

```sql
CREATE FUNCTION get_items_paginated(
    p_limit integer DEFAULT 10,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (...)
AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM public.items
    WHERE is_active = true
    ORDER BY created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
```

### Pattern 3: Search

```sql
CREATE FUNCTION search_items(p_search_term text)
RETURNS TABLE (...)
AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM public.items
    WHERE is_active = true
    AND (
        name ILIKE '%' || p_search_term || '%'
        OR description ILIKE '%' || p_search_term || '%'
    )
    ORDER BY created_at DESC;
END;
$$;
```

## Testing Functions

Test functions in Supabase SQL Editor:

```sql
-- Test get all
SELECT * FROM get_items();

-- Test get by ID
SELECT * FROM get_item_by_id('your-uuid-here');

-- Test create
SELECT * FROM create_item_simple('Test Item', 'Test Description');

-- Test update
SELECT * FROM update_item_simple(
    'item-uuid',
    'Updated Name',
    'Updated Description',
    true
);

-- Test delete
SELECT * FROM delete_item_hard('item-uuid');
```

## Checklist

When creating database functions:

- [ ] Function follows naming convention
- [ ] Parameters use p_ prefix
- [ ] SECURITY DEFINER used
- [ ] search_path set
- [ ] Input validation added
- [ ] Error handling included
- [ ] Returns JSON with success/error
- [ ] Only returns active records (get functions)
- [ ] RBAC permissions added
- [ ] Function tested
- [ ] Documented

## Next Steps

- See `RBAC_GUIDE.md` for permission setup
- Review `MODULE_GUIDE.md` for module creation
- Check `PATTERNS.md` for design patterns

