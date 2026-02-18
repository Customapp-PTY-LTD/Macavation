-- Kernel packing samples (end sample / PACKING modal) – table and functions

CREATE TABLE IF NOT EXISTS public.kernel_packing_samples (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    production_batch_id uuid NOT NULL REFERENCES public.production_batches(id) ON DELETE CASCADE,

    moisture_required boolean NOT NULL DEFAULT false,
    moisture_result numeric(10,4) NULL,
    peroxide_required boolean NOT NULL DEFAULT false,
    peroxide_result numeric(10,4) NULL,
    ffa_required boolean NOT NULL DEFAULT false,
    ffa_result numeric(10,4) NULL,
    internal_micro_required boolean NOT NULL DEFAULT false,
    internal_micro_result text NULL,
    external_lab_required boolean NOT NULL DEFAULT false,
    external_lab_result text NULL,

    supervisor_signed_by text NULL,
    nut_plant_manager_signed_by text NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kernel_packing_samples_batch ON public.kernel_packing_samples(production_batch_id);

-- Create: one packing sample per production batch (end sample)
CREATE OR REPLACE FUNCTION public.create_kernel_packing_sample(
    production_batch_id uuid,
    moisture_required boolean DEFAULT false,
    moisture_result numeric DEFAULT NULL,
    peroxide_required boolean DEFAULT false,
    peroxide_result numeric DEFAULT NULL,
    ffa_required boolean DEFAULT false,
    ffa_result numeric DEFAULT NULL,
    internal_micro_required boolean DEFAULT false,
    internal_micro_result text DEFAULT NULL,
    external_lab_required boolean DEFAULT false,
    external_lab_result text DEFAULT NULL,
    supervisor_signed_by text DEFAULT NULL,
    nut_plant_manager_signed_by text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF production_batch_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'production_batch_id is required');
    END IF;

    INSERT INTO public.kernel_packing_samples (
        production_batch_id,
        moisture_required,
        moisture_result,
        peroxide_required,
        peroxide_result,
        ffa_required,
        ffa_result,
        internal_micro_required,
        internal_micro_result,
        external_lab_required,
        external_lab_result,
        supervisor_signed_by,
        nut_plant_manager_signed_by,
        updated_at
    )
    VALUES (
        production_batch_id,
        COALESCE(moisture_required, false),
        moisture_result,
        COALESCE(peroxide_required, false),
        peroxide_result,
        COALESCE(ffa_required, false),
        ffa_result,
        COALESCE(internal_micro_required, false),
        internal_micro_result,
        COALESCE(external_lab_required, false),
        external_lab_result,
        supervisor_signed_by,
        nut_plant_manager_signed_by,
        now()
    )
    RETURNING id INTO v_id;

    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'production_batch_id', production_batch_id,
        'message', 'Kernel packing sample created'
    );
EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN json_build_object('success', false, 'error', 'Invalid production_batch_id');
    WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'error', 'Packing sample already exists for this batch');
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', 'Failed to create packing sample: ' || SQLERRM);
END;
$$;

-- Get all kernel packing samples (for grid enrichment)
CREATE OR REPLACE FUNCTION public.get_kernel_packing_samples()
RETURNS SETOF public.kernel_packing_samples
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT * FROM public.kernel_packing_samples ORDER BY created_at DESC;
$$;

-- Get one kernel packing sample by id
CREATE OR REPLACE FUNCTION public.get_kernel_packing_sample(p_id uuid)
RETURNS public.kernel_packing_samples
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT * FROM public.kernel_packing_samples WHERE id = p_id LIMIT 1;
$$;

-- Grant EXECUTE to all roles (align with grant_all_data_functions_to_all_roles)
DO $$
DECLARE
    v_role_id uuid;
    v_func_name text;
BEGIN
    FOREACH v_func_name IN ARRAY ARRAY['get_kernel_packing_samples', 'get_kernel_packing_sample', 'create_kernel_packing_sample']
    LOOP
        FOR v_role_id IN SELECT id FROM public.roles
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
