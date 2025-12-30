-- RBAC Setup Template
-- Run this after creating your database functions
-- Replace 'example_item' with your function prefix

-- ============================================
-- PERMISSIONS FOR: get_example_items
-- ============================================
-- Grant read access to all authenticated users
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_example_items', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- ============================================
-- PERMISSIONS FOR: get_example_item_by_id
-- ============================================
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_example_item_by_id', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user', 'viewer')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- ============================================
-- PERMISSIONS FOR: create_example_item_simple
-- ============================================
-- Grant write access to admins only
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'create_example_item_simple', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- ============================================
-- PERMISSIONS FOR: update_example_item_simple
-- ============================================
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_example_item_simple', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- ============================================
-- PERMISSIONS FOR: delete_example_item_hard
-- ============================================
-- Grant delete access to super_user only
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'delete_example_item_hard', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'super_user'
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- ============================================
-- PERMISSIONS FOR: deactivate_example_item
-- ============================================
-- Grant soft delete to admins
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'deactivate_example_item', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin')
ON CONFLICT (role_id, object_type, object_name, operation) 
DO UPDATE SET allowed = true;

-- ============================================
-- VERIFY PERMISSIONS
-- ============================================
-- Run this query to verify permissions were created
SELECT 
    r.role_name,
    rp.object_name,
    rp.operation,
    rp.allowed
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
WHERE rp.object_name LIKE 'example_item%'
ORDER BY r.role_name, rp.object_name;

