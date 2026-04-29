-- Stock (Kernel): create update_kernel_stock_batch_info if missing, grant Postgres EXECUTE,
-- and grant RBAC role_permissions for every role (fixes "operation EXECUTE is not allowed" for
-- users such as stock staff editing batches from Stock Management).
-- Extends grant_login_menu_permissions_for_new_role so new roles inherit the same.

CREATE OR REPLACE FUNCTION public.update_kernel_stock_batch_info(
    p_kernel_id uuid,
    p_batch_number varchar,
    p_grower_name varchar DEFAULT NULL,
    p_received_date date DEFAULT NULL,
    p_wet_nis_received_kg numeric DEFAULT NULL,
    p_best_before_date date DEFAULT NULL,
    p_ffa numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_uuid uuid;
    v_new_bn text;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch is required');
    END IF;

    SELECT k.batch_id INTO v_batch_uuid
    FROM public.kernel k
    WHERE k.id = p_kernel_id AND k.is_active = true;

    IF v_batch_uuid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    v_new_bn := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF v_new_bn IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.batches b
        WHERE b.batch_id = v_new_bn AND b.id <> v_batch_uuid
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'That batch number is already in use');
    END IF;

    UPDATE public.batches
    SET batch_id = v_new_bn,
        updated_at = now()
    WHERE id = v_batch_uuid;

    UPDATE public.kernel k
    SET
        grower_name = NULLIF(trim(COALESCE(p_grower_name, '')), ''),
        received_date = p_received_date,
        wet_nis_received_kg = p_wet_nis_received_kg,
        job_card_data = CASE
            WHEN p_best_before_date IS NOT NULL THEN
                COALESCE(k.job_card_data, '{}'::jsonb) || jsonb_build_object('best_before_date', p_best_before_date::text)
            ELSE k.job_card_data
        END,
        qa_data = CASE
            WHEN p_ffa IS NOT NULL THEN
                COALESCE(k.qa_data, '{}'::jsonb) || jsonb_build_object('ffa_result', p_ffa::numeric)
            ELSE k.qa_data
        END,
        updated_at = now()
    WHERE k.id = p_kernel_id AND k.is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id);
END;
$$;

COMMENT ON FUNCTION public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric) IS
    'Updates batches.batch_id (display batch number) and kernel row fields used by Stock Management (grower, dates, wet NIS, job_card best_before_date, qa ffa_result).';

GRANT EXECUTE ON FUNCTION public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_kernel_stock_batch_info(uuid, varchar, varchar, date, numeric, date, numeric) TO anon;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'update_kernel_stock_batch_info', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.object_type = 'function'
      AND rp.object_name = 'update_kernel_stock_batch_info'
      AND rp.operation = 'EXECUTE'
);

UPDATE public.role_permissions
SET allowed = true, updated_at = now()
WHERE object_type = 'function'
  AND object_name = 'update_kernel_stock_batch_info'
  AND operation = 'EXECUTE';

CREATE OR REPLACE FUNCTION public.grant_login_menu_permissions_for_new_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fn text;
    v_fns text[] := ARRAY[
        'get_users',
        'get_roles',
        'get_user_by_id',
        'get_features_for_role',
        'get_role_by_id',
        'get_features',
        'get_role_features',
        'save_kernel_dispatch_record',
        'create_kernel_dispatch_order',
        'update_kernel_dispatch_order_cartons',
        'update_kernel_dispatch_order',
        'get_kernel_dispatch_orders',
        'get_kernel_dispatch_order',
        'update_kernel_stock_batch_info',
        'adjust_kernel_stock_on_hand'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        SELECT NEW.id, 'function', v_fn, 'EXECUTE', true
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.role_permissions rp
            WHERE rp.role_id = NEW.id
              AND rp.object_type = 'function'
              AND rp.object_name = v_fn
              AND rp.operation = 'EXECUTE'
        );
    END LOOP;
    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
