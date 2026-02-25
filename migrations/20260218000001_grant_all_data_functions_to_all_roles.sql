-- Grant EXECUTE on all app data functions to ALL roles (every user has access to data functions).
-- Aligns with RBAC_TROUBLESHOOTING.md and ROLE_ACCESS_UPDATE.md: all authenticated users can call data functions.
-- Apply this migration so that any role (Super Admin, admin, PWA roles, Office Administrator, etc.) can use the app without 403.

DO $$
DECLARE
    v_role_id uuid;
    v_func_name text;
    v_functions text[] := ARRAY[
        'get_user_by_id', 'get_user_with_permissions', 'get_users', 'get_roles', 'get_role_by_id',
        'create_user_simple', 'update_user_simple', 'update_user', 'delete_user_hard', 'deactivate_user',
        'create_role_simple', 'update_role_simple', 'deactivate_role',
        'get_role_permissions', 'get_role_permissions_filtered', 'get_role_permission_by_id',
        'create_role_permission_simple', 'update_role_permission_simple', 'delete_role_permission_simple',
        'get_drivers', 'create_driver_simple', 'update_driver_simple', 'delete_driver_simple',
        'get_vehicles', 'create_vehicle_simple', 'update_vehicle_simple', 'delete_vehicle_simple',
        'get_inspections', 'get_driver_by_user_id', 'get_inspection_template',
        'create_inspection', 'create_inspection_simple', 'update_inspection_simple', 'delete_inspection_simple',
        'get_features', 'get_role_features', 'get_role_feature_by_id',
        'create_role_feature_simple', 'update_role_feature_simple', 'delete_role_feature_simple',
        'get_companies', 'get_company_by_id', 'create_company_simple', 'update_company_simple', 'delete_company',
        'get_dashboard_stats', 'get_dashboard_alerts', 'get_recent_activity',
        'get_contacts', 'get_contact_by_id', 'create_contact_simple', 'update_contact_simple', 'deactivate_contact',
        'get_production_batches', 'create_production_batch_simple', 'update_production_batch', 'update_production_batch_actual_weight',
        -- Batches + new oil schema (migrations 20260225–20260226)
        'upsert_batch', 'upsert_oil_batch', 'get_oil_batches', 'complete_oil_batch',
        'get_shift_list', 'upsert_shift',
        'get_product_list', 'upsert_product',
        'get_oil_bin_list', 'upsert_oil_bin',
        -- Kernel new schema
        'get_kernel_batches', 'get_kernel_batch_detail',
        'upsert_kernel_production', 'upsert_kernel_job_card', 'upsert_kernel_qa',
        'create_kernel_batch', 'complete_kernel_batch', 'get_kernel_production_history',
        'get_sample_submissions', 'get_quality_tests', 'get_quality_test_by_id',
        'create_quality_test_simple', 'update_quality_test_simple',
        'get_stock_items', 'get_oil_stock_lots', 'get_oil_stock_summary',
        'create_oil_stock_lot_simple', 'update_oil_stock_lot_simple', 'deactivate_oil_stock_lot',
        'get_executive_kpis', 'get_sales_forecasts', 'get_oil_production_sheets', 'get_oil_production_weekly_summary',
        'create_kernel_job_card', 'create_kernel_production_day', 'get_kernel_production_days', 'get_kernel_production_days_list',
        'get_kernel_production_stages', 'get_kernel_production_stages_by_day', 'save_kernel_production_stages', 'finish_kernel_batch_production',
        'get_kernel_packing_samples', 'get_kernel_packing_sample', 'create_kernel_packing_sample',
        'create_stock_take', 'get_stock_takes',
        'get_receiving_checklists', 'get_receiving_checklist', 'get_receiving_checklist_by_id', 'create_receiving_checklist', 'update_receiving_checklist',
        'get_raw_material_issued', 'get_financial_transactions', 'get_documents',
        'get_palladium_sync_status', 'sync_palladium', 'sync_palladium_entity',
        'get_workflow_tasks', 'get_watching_items', 'get_due_items', 'get_recent_activity_by_role', 'get_active_anomalies',
        'get_test_scenarios', 'get_test_scenario_by_id', 'get_test_scenarios_filtered',
        'get_e2e_test_data_sets', 'get_e2e_test_data_records', 'get_e2e_test_data_records_by_set',
        'get_test_run_batches', 'get_test_instances_by_batch', 'get_test_instances_by_scenario',
        'create_test_scenario_simple', 'update_test_scenario_simple', 'delete_test_scenario_hard', 'deactivate_test_scenario', 'search_test_scenarios',
        'get_test_data_sets', 'get_test_data_set_by_id', 'create_test_data_set_simple', 'update_test_data_set_simple', 'delete_test_data_set_hard', 'search_test_data_sets',
        'get_test_data_records_by_set', 'get_test_data_record_by_id', 'create_test_data_record_simple', 'update_test_data_record_simple', 'delete_test_data_record_hard', 'search_test_data_records',
        'get_project_documentation', 'get_project_documentation_by_id', 'create_project_documentation', 'update_project_documentation', 'delete_project_documentation',
        'get_table_columns', 'import_table_rows'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_func_name IN ARRAY v_functions
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_func_name AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_func_name, 'EXECUTE', true);
            END IF;
        END LOOP;
    END LOOP;
END $$;
