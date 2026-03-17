-- Grant EXECUTE on kernel production, release-to-stock, send-to-dispatch and related actions to ALL roles.
-- Removes permission blocks so users can release batch to stock, create batches, send to dispatch, move to production, etc.

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'complete_kernel_batch',
        'deactivate_kernel_batch',
        'create_kernel_batch',
        'get_next_batch_number',
        'upsert_batch',
        'initialize_kernel_for_batch',
        'upsert_kernel_production',
        'upsert_kernel_job_card',
        'upsert_kernel_qa',
        'release_kernel_to_production',
        'finish_kernel_batch_production',
        'save_kernel_production_stages',
        'get_kernel_production_days',
        'get_kernel_production_days_list',
        'create_kernel_production_day',
        'get_kernel_production_stages',
        'get_kernel_production_stages_by_day',
        'get_kernel_packing_samples',
        'get_kernel_packing_sample',
        'create_kernel_packing_sample',
        'create_kernel_job_card',
        'create_kernel_dispatch_order',
        'update_kernel_dispatch_order_cartons',
        'get_kernel_dispatch_orders',
        'get_kernel_dispatch_order',
        'send_oil_bin_batch_to_stock',
        'start_oil_bin_batch',
        'get_oil_bin_batches',
        'update_oil_bin_batch',
        'save_kernel_intake_sample',
        'upsert_kernel_checklist',
        'create_sample_submission_for_batch',
        'get_receiving_checklists',
        'get_receiving_checklist',
        'get_receiving_checklist_by_id',
        'create_receiving_checklist',
        'update_receiving_checklist',
        'get_silos',
        'set_silo_empty',
        'assign_kernel_to_silos',
        'get_kernel_batches',
        'get_kernel_batch_detail',
        'get_kernel_production_history',
        'get_stock_items',
        'get_oil_stock_lots'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_fn IN ARRAY v_fns
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true);
            ELSE
                UPDATE public.role_permissions
                SET allowed = true, updated_at = now()
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE';
            END IF;
        END LOOP;
    END LOOP;
END $$;
