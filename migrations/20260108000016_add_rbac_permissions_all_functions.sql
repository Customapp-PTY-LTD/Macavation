-- Add RBAC permissions for all functions following RBAC_GUIDE.md patterns
-- This ensures all functions have proper permissions based on role hierarchy

DO $$
DECLARE
    v_super_admin_id uuid;
    v_admin_id uuid;
    v_user_id uuid;
    v_viewer_id uuid;
    v_function_name varchar;
    v_read_functions varchar[] := ARRAY[
        'get_inspection_template', 'get_driver_by_user_id',
        'get_driver_by_employee_id', 'get_driver_by_phone', 'get_driver_with_vehicle',
        'get_inspections_by_trip_id', 'get_inspections_new',
        'get_session_data', 'get_next_driver_trip',
        'get_user_features', 'get_user_role_features', 'get_user_role_permissions',
        'list_features', 'list_identity_providers'
    ];
    v_write_functions varchar[] := ARRAY[
        'create_inspection_simple', 'api_create_vehicle_inspection',
        'complete_inspection', 'save_category_a', 'save_category_b', 'save_category_c',
        'save_driver_info', 'save_vehicle_info',
        'start_inspection_session', 'update_trip_start_time', 'update_trip_end_time',
        'insert_vehicle_inspection', 'update_company'
    ];
    v_admin_only_functions varchar[] := ARRAY[
        'create_feature', 'update_feature', 'delete_feature',
        'create_identity_provider', 'update_identity_provider', 'delete_identity_provider',
        'get_identity_provider',
        'create_user_role_feature', 'update_user_role_feature', 'delete_user_role_feature',
        'create_user_role_permission', 'update_user_role_permission', 'delete_user_role_permission',
        'check_user_permission'
    ];
    v_super_user_only_functions varchar[] := ARRAY[
        'delete_feature', 'delete_identity_provider',
        'delete_user_role_feature', 'delete_user_role_permission',
        'update_user_last_login', 'validate_user_password', 'verify_password',
        'verify_driver_otp'
    ];
BEGIN
    -- Get role IDs
    SELECT id INTO v_super_admin_id FROM roles WHERE role_name = 'Super Admin' LIMIT 1;
    SELECT id INTO v_admin_id FROM roles WHERE role_name ILIKE '%admin%' AND role_name != 'Super Admin' LIMIT 1;
    SELECT id INTO v_user_id FROM roles WHERE role_name = 'user' OR role_name = 'User' LIMIT 1;
    SELECT id INTO v_viewer_id FROM roles WHERE role_name = 'viewer' OR role_name = 'Viewer' LIMIT 1;
    
    -- Add read permissions (super_user, admin, user, viewer)
    IF v_super_admin_id IS NOT NULL THEN
        FOREACH v_function_name IN ARRAY v_read_functions
        LOOP
            INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_super_admin_id, 'function', v_function_name, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
        
        IF v_admin_id IS NOT NULL THEN
            FOREACH v_function_name IN ARRAY v_read_functions
            LOOP
                INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_admin_id, 'function', v_function_name, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
        
        IF v_user_id IS NOT NULL THEN
            FOREACH v_function_name IN ARRAY v_read_functions
            LOOP
                INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_user_id, 'function', v_function_name, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
        
        IF v_viewer_id IS NOT NULL THEN
            FOREACH v_function_name IN ARRAY v_read_functions
            LOOP
                INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_viewer_id, 'function', v_function_name, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END IF;
    
    -- Add write permissions (super_user, admin)
    IF v_super_admin_id IS NOT NULL THEN
        FOREACH v_function_name IN ARRAY v_write_functions
        LOOP
            INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_super_admin_id, 'function', v_function_name, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
        
        IF v_admin_id IS NOT NULL THEN
            FOREACH v_function_name IN ARRAY v_write_functions
            LOOP
                INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_admin_id, 'function', v_function_name, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END IF;
    
    -- Add admin-only permissions (super_user, admin)
    IF v_super_admin_id IS NOT NULL THEN
        FOREACH v_function_name IN ARRAY v_admin_only_functions
        LOOP
            INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_super_admin_id, 'function', v_function_name, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
        
        IF v_admin_id IS NOT NULL THEN
            FOREACH v_function_name IN ARRAY v_admin_only_functions
            LOOP
                INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_admin_id, 'function', v_function_name, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END IF;
    
    -- Add super_user-only permissions
    IF v_super_admin_id IS NOT NULL THEN
        FOREACH v_function_name IN ARRAY v_super_user_only_functions
        LOOP
            INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_super_admin_id, 'function', v_function_name, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;
END $$;
