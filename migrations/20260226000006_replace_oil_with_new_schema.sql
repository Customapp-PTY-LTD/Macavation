-- Migration: Replace old oil table with new oil/shift/product/oil_bin schema
-- Drops the interim oil table created in 20260226000004.
-- Creates the correct production schema as designed.
-- Migrates existing data from oil_production_sheets into the new oil table.

-- ============================================================
-- STEP 1: Drop old oil table + old SPs
-- ============================================================
DROP TABLE IF EXISTS public.oil CASCADE;

-- Remove old SP RBAC rows before dropping functions
DELETE FROM public.role_permissions
WHERE object_type = 'function'
  AND object_name IN ('get_oil_batches', 'upsert_oil_production', 'complete_oil_batch');

DROP FUNCTION IF EXISTS public.get_oil_batches(varchar, varchar, integer, integer);
DROP FUNCTION IF EXISTS public.upsert_oil_production(uuid, date, varchar, varchar, varchar, varchar, varchar, varchar, numeric, varchar, numeric, varchar, numeric, varchar, numeric, numeric, numeric, numeric, numeric, numeric, varchar, numeric, numeric, numeric, numeric, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.complete_oil_batch(uuid);

-- Clean up any oil-type batches from the batches parent table
-- (the new oil table uses its own batch_id varchar, not a FK to batches)
DELETE FROM public.batches WHERE batch_type = 'oil';


-- ============================================================
-- STEP 2: shift table
-- Tracks daily shifts and their material processing activities
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shift (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    shift_date       date                     NOT NULL,
    shift_name       character varying,
    shift_supervisor character varying,

    -- shift_tracking.entries[]: time, crude_kernel, kernel_dust, crush, cracker_dust, cake, description, batches[]
    -- shift_tracking.totals:    crude_kernel, kernel_dust, crush, cracker_dust, cake
    -- shift_tracking.oil_batches: array of oil.id
    shift_tracking jsonb,

    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_date       ON public.shift(shift_date);
CREATE INDEX IF NOT EXISTS idx_shift_supervisor ON public.shift(shift_supervisor);


-- ============================================================
-- STEP 3: product table
-- Defines product types and their specifications
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    product_name character varying NOT NULL UNIQUE,
    product_type character varying,   -- 'protein_powder', 'food_grade', 'cosmetic'

    -- product_specs: standard_temperature, standard_speed_infeed, standard_speed_press,
    --               press_type, expected_yield_percentage, packaging_options[], certifications[], oil_batches[]
    product_specs jsonb,

    is_active boolean DEFAULT true,

    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_type   ON public.product(product_type);
CREATE INDEX IF NOT EXISTS idx_product_active ON public.product(is_active);


-- ============================================================
-- STEP 4: oil_bin table
-- Tracks oil storage bins and their contents
-- ============================================================
CREATE TABLE IF NOT EXISTS public.oil_bin (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    bin_name     character varying NOT NULL UNIQUE,  -- "IBC 1", "IBC 2", "IBC 3"
    start_oil_bn character varying,

    -- bin_data: capacity_litres, current_level_litres, oil_batches[], last_cleaned, location
    bin_data jsonb,

    is_active boolean DEFAULT true,

    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oil_bin_name   ON public.oil_bin(bin_name);
CREATE INDEX IF NOT EXISTS idx_oil_bin_active ON public.oil_bin(is_active);


-- ============================================================
-- STEP 5: oil table (new schema)
-- Main production tracking for oil and protein batches
-- ============================================================
CREATE TABLE IF NOT EXISTS public.oil (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    batch_id        character varying NOT NULL UNIQUE,
    production_date date,

    status character varying,  -- 'intake', 'production', 'stock', 'dispatch', 'complete'

    total_oil_litre numeric,

    -- intake_data: date_received, delivery_note_reference, supplier, items[], vehicle_checks{}
    intake_data jsonb,

    -- production_data: batch_number_product_produced, name_of_product, oil_bins[], raw_materials[],
    --                  waste{}, gmp_checklist{}, protein_details{}
    production_data jsonb,

    -- stock_data: location, bin_location, quantity_available, reserved, qa_tests{}
    stock_data jsonb,

    -- dispatch_data: orders[{ lines[{ style, quantity_kg }] }]
    dispatch_data jsonb,

    -- Stage completion timestamps
    intake_completed_at     timestamp with time zone,
    production_completed_at timestamp with time zone,
    stock_completed_at      timestamp with time zone,
    dispatch_completed_at   timestamp with time zone,

    is_active boolean DEFAULT true,

    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oil_batch_id       ON public.oil(batch_id);
CREATE INDEX IF NOT EXISTS idx_oil_status         ON public.oil(status);
CREATE INDEX IF NOT EXISTS idx_oil_production_date ON public.oil(production_date);
CREATE INDEX IF NOT EXISTS idx_oil_is_active      ON public.oil(is_active);

-- RLS
ALTER TABLE public.shift   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oil_bin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oil     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    v_tbl varchar;
BEGIN
    FOREACH v_tbl IN ARRAY ARRAY['shift', 'product', 'oil_bin', 'oil'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=v_tbl AND policyname=v_tbl || '_service_role_all') THEN
            EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', v_tbl || '_service_role_all', v_tbl);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=v_tbl AND policyname=v_tbl || '_authenticated_read') THEN
            EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', v_tbl || '_authenticated_read', v_tbl);
        END IF;
    END LOOP;
END;
$$;


-- ============================================================
-- STEP 6: Migrate existing oil data from oil_production_sheets
-- Uses to_jsonb(row.*) for safe column access on an unknown schema
-- ============================================================
DO $$
DECLARE
    v_row       RECORD;
    v_data      jsonb;
    v_status    varchar;
    v_total_l   numeric;
    v_batch_id  varchar;
    v_migrated  integer := 0;
    v_skipped   integer := 0;
BEGIN
    -- Bail if source table doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'oil_production_sheets'
    ) THEN
        RAISE NOTICE 'oil_production_sheets not found — skipping oil data migration';
        RETURN;
    END IF;

    FOR v_row IN
        SELECT
            id,
            to_jsonb(ops.*) AS all_data
        FROM public.oil_production_sheets ops
        WHERE COALESCE((to_jsonb(ops.*))->>'is_active', 'true') != 'false'
        ORDER BY (to_jsonb(ops.*)->>'created_at')::timestamptz NULLS LAST
    LOOP
        v_data := v_row.all_data;

        -- Status mapping (old → new 5-state)
        v_status := CASE v_data->>'status'
            WHEN 'complete'          THEN 'complete'
            WHEN 'in_finished_stock' THEN 'stock'
            WHEN 'dispatched'        THEN 'dispatch'
            ELSE 'production'
        END;

        -- Total oil litres
        v_total_l := COALESCE((v_data->>'ibc1_litre')::numeric, 0)
                   + COALESCE((v_data->>'ibc2_litre')::numeric, 0)
                   + COALESCE((v_data->>'ibc3_litre')::numeric, 0);
        IF v_total_l = 0 THEN
            v_total_l := (v_data->>'total_oil_litre')::numeric;
        END IF;

        -- Batch ID: use batch_number or generate a fallback
        v_batch_id := COALESCE(
            NULLIF(trim(v_data->>'batch_number'), ''),
            'OIL-MIGRATED-' || v_row.id::text
        );

        -- Insert into new oil table
        INSERT INTO public.oil (
            batch_id,
            production_date,
            status,
            total_oil_litre,
            intake_data,
            production_data,
            stock_data,
            dispatch_data,
            is_active,
            created_at,
            updated_at
        )
        VALUES (
            v_batch_id,
            (v_data->>'production_date')::date,
            v_status,
            v_total_l,
            '{}'::jsonb,
            jsonb_build_object(
                'name_of_product',             v_data->>'product_name',
                'batch_number_product_produced', v_data->>'batch_number',
                'raw_materials',               COALESCE(v_data->'raw_materials', '[]'::jsonb),
                'waste', jsonb_build_object(
                    'general_waste', (v_data->>'general_waste_kg')::numeric,
                    'floor_waste',   (v_data->>'floor_waste_kg')::numeric,
                    'product_waste', (v_data->>'product_waste_kg')::numeric
                ),
                'oil_bins',          '[]'::jsonb,
                'gmp_checklist',     '{}'::jsonb,
                'protein_details', jsonb_build_object(
                    'start_oil_bn',   v_data->>'start_oil_bn',
                    'start_oil_litre', (v_data->>'start_oil_litre')::numeric,
                    'ibc1_bn',        v_data->>'ibc1_bn',
                    'ibc1_litre',     (v_data->>'ibc1_litre')::numeric,
                    'ibc2_bn',        v_data->>'ibc2_bn',
                    'ibc2_litre',     (v_data->>'ibc2_litre')::numeric,
                    'ibc3_bn',        v_data->>'ibc3_bn',
                    'ibc3_litre',     (v_data->>'ibc3_litre')::numeric
                ),
                'recipe', jsonb_build_object(
                    'oil_kernel',   (v_data->>'recipe_oil_kernel')::numeric,
                    'cracker_dust', (v_data->>'recipe_cracker_dust')::numeric,
                    'kernel_dust',  (v_data->>'recipe_kernel_dust')::numeric,
                    'crush',        (v_data->>'recipe_crush')::numeric,
                    'cake',         (v_data->>'recipe_cake')::numeric,
                    'notes',        v_data->>'recipe_notes'
                ),
                'shift_supervisor',     v_data->>'shift_supervisor',
                'supervisor_signature', v_data->>'supervisor_signature',
                'shift',                v_data->>'shift'
            ),
            '{}'::jsonb,
            '{}'::jsonb,
            true,
            COALESCE((v_data->>'created_at')::timestamptz, NOW()),
            COALESCE((v_data->>'updated_at')::timestamptz, NOW())
        )
        ON CONFLICT (batch_id) DO NOTHING;

        v_migrated := v_migrated + 1;
    END LOOP;

    RAISE NOTICE 'Oil migration complete — migrated: %, skipped: %, total oil rows: %',
        v_migrated, v_skipped, (SELECT COUNT(*) FROM public.oil);
END;
$$;
