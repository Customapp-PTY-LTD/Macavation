-- Dispatch form: inspection of vehicle + dispatch details (1:1 with kernel_dispatch_orders)
CREATE TABLE IF NOT EXISTS public.kernel_dispatch_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_order_id uuid NOT NULL REFERENCES public.kernel_dispatch_orders(id) ON DELETE CASCADE,
    vehicle_clean_yn text NULL CHECK (vehicle_clean_yn IN ('Yes', 'No')),
    vehicle_enclosed_yn text NULL CHECK (vehicle_enclosed_yn IN ('Yes', 'No')),
    hazard_substances_yn text NULL CHECK (hazard_substances_yn IN ('Yes', 'No')),
    pest_infestations_yn text NULL CHECK (pest_infestations_yn IN ('Yes', 'No')),
    pallets_condition_yn text NULL CHECK (pallets_condition_yn IN ('Yes', 'No')),
    truck_bin_locked_yn text NULL CHECK (truck_bin_locked_yn IN ('Yes', 'No')),
    dispatch_person text NULL,
    transport_company text NULL,
    delivery_note_number text NULL,
    date_dispatched date NULL,
    truck_registration text NULL,
    driver_name text NULL,
    time_dispatched time NULL,
    dispatched_to text NULL,
    dispatch_signature text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(dispatch_order_id)
);

CREATE INDEX IF NOT EXISTS idx_kernel_dispatch_records_order ON public.kernel_dispatch_records(dispatch_order_id);

CREATE OR REPLACE FUNCTION public.save_kernel_dispatch_record(
    p_dispatch_order_id uuid,
    p_vehicle_clean_yn text DEFAULT NULL,
    p_vehicle_enclosed_yn text DEFAULT NULL,
    p_hazard_substances_yn text DEFAULT NULL,
    p_pest_infestations_yn text DEFAULT NULL,
    p_pallets_condition_yn text DEFAULT NULL,
    p_truck_bin_locked_yn text DEFAULT NULL,
    p_dispatch_person text DEFAULT NULL,
    p_transport_company text DEFAULT NULL,
    p_delivery_note_number text DEFAULT NULL,
    p_date_dispatched date DEFAULT NULL,
    p_truck_registration text DEFAULT NULL,
    p_driver_name text DEFAULT NULL,
    p_time_dispatched time DEFAULT NULL,
    p_dispatched_to text DEFAULT NULL,
    p_dispatch_signature text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_dispatch_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'dispatch_order_id is required');
    END IF;

    INSERT INTO public.kernel_dispatch_records (
        dispatch_order_id,
        vehicle_clean_yn, vehicle_enclosed_yn, hazard_substances_yn,
        pest_infestations_yn, pallets_condition_yn, truck_bin_locked_yn,
        dispatch_person, transport_company, delivery_note_number,
        date_dispatched, truck_registration, driver_name,
        time_dispatched, dispatched_to, dispatch_signature,
        updated_at
    )
    VALUES (
        p_dispatch_order_id,
        p_vehicle_clean_yn, p_vehicle_enclosed_yn, p_hazard_substances_yn,
        p_pest_infestations_yn, p_pallets_condition_yn, p_truck_bin_locked_yn,
        p_dispatch_person, p_transport_company, p_delivery_note_number,
        p_date_dispatched, p_truck_registration, p_driver_name,
        p_time_dispatched, p_dispatched_to, p_dispatch_signature,
        now()
    )
    ON CONFLICT (dispatch_order_id)
    DO UPDATE SET
        vehicle_clean_yn = EXCLUDED.vehicle_clean_yn,
        vehicle_enclosed_yn = EXCLUDED.vehicle_enclosed_yn,
        hazard_substances_yn = EXCLUDED.hazard_substances_yn,
        pest_infestations_yn = EXCLUDED.pest_infestations_yn,
        pallets_condition_yn = EXCLUDED.pallets_condition_yn,
        truck_bin_locked_yn = EXCLUDED.truck_bin_locked_yn,
        dispatch_person = EXCLUDED.dispatch_person,
        transport_company = EXCLUDED.transport_company,
        delivery_note_number = EXCLUDED.delivery_note_number,
        date_dispatched = EXCLUDED.date_dispatched,
        truck_registration = EXCLUDED.truck_registration,
        driver_name = EXCLUDED.driver_name,
        time_dispatched = EXCLUDED.time_dispatched,
        dispatched_to = EXCLUDED.dispatched_to,
        dispatch_signature = EXCLUDED.dispatch_signature,
        updated_at = now()
    RETURNING id INTO v_id;

    UPDATE public.kernel_dispatch_orders SET status = 'dispatched', updated_at = now() WHERE id = p_dispatch_order_id;

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'Dispatch record saved; order marked as dispatched');
EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN json_build_object('success', false, 'error', 'Invalid dispatch_order_id');
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

DO $$
DECLARE v_role_id uuid; v_func text := 'save_kernel_dispatch_record';
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_func AND operation = 'EXECUTE') THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed) VALUES (v_role_id, 'function', v_func, 'EXECUTE', true);
        END IF;
    END LOOP;
END $$;
