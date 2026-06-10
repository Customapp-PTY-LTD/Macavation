-- Migration: Create oil table + migrate data from production_batches
-- Mirrors the kernel consolidation pattern.
-- One row per oil production sheet (what was one row in production_batches).
-- SAFE: Does NOT drop old tables. Idempotent (IF NOT EXISTS + ON CONFLICT).

-- ============================================================
-- STEP 1: Create oil table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.oil (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,

    -- Scalar fields (queryable for grids / dashboards)
    production_date date NULL,
    shift           varchar(50) NULL,
    product_name    varchar(255) NULL,

    status varchar(50) NOT NULL DEFAULT 'production',
    CONSTRAINT oil_status_check CHECK (
        status IN ('production', 'complete')
    ),

    total_oil_litre numeric NULL,  -- sum of IBC litres; stored for fast grid display

    -- All other sheet fields packed into JSONB
    -- Structure: { shift_supervisor, supervisor_signature,
    --              start_oil_bn, start_oil_litre,
    --              ibc1_bn, ibc1_litre, ibc2_bn, ibc2_litre, ibc3_bn, ibc3_litre,
    --              recipe: { oil_kernel, cracker_dust, kernel_dust, crush, cake, notes },
    --              waste:  { general_kg, floor_kg, product_kg, oil_from_filter_kg },
    --              raw_materials: [ { batch_number, raw_material_in_kg, oil_out_kg, cake_out_kg } ],
    --              mixes: [ { mix_number, crush_value, time_value, raw_material_type,
    --                         raw_material_batch, quantity_kg, notes } ] }
    sheet_data jsonb NOT NULL DEFAULT '{}'::jsonb,

    is_active  boolean   NOT NULL DEFAULT true,
    created_by uuid      NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid      NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.oil IS 'Oil production journey. One row per production sheet. Migrated from production_batches (batch_type=oil).';
COMMENT ON COLUMN public.oil.sheet_data IS '{ shift_supervisor, supervisor_signature, ibc data, recipe, waste, raw_materials, mixes }';

CREATE UNIQUE INDEX IF NOT EXISTS idx_oil_batch_id       ON public.oil(batch_id);
CREATE INDEX       IF NOT EXISTS idx_oil_status          ON public.oil(status);
CREATE INDEX       IF NOT EXISTS idx_oil_production_date ON public.oil(production_date DESC);
CREATE INDEX       IF NOT EXISTS idx_oil_is_active       ON public.oil(is_active) WHERE is_active = true;
CREATE INDEX       IF NOT EXISTS idx_oil_sheet_gin       ON public.oil USING gin(sheet_data);

-- RLS (same pattern as kernel)
ALTER TABLE public.oil ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='oil' AND policyname='oil_service_role_all') THEN
        EXECUTE 'CREATE POLICY oil_service_role_all ON public.oil FOR ALL TO service_role USING (true) WITH CHECK (true)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='oil' AND policyname='oil_authenticated_read') THEN
        EXECUTE 'CREATE POLICY oil_authenticated_read ON public.oil FOR SELECT TO authenticated USING (true)';
    END IF;
END;
$$;


-- ============================================================
-- STEP 2: Migrate data from production_batches (batch_type = 'oil')
-- Uses to_jsonb(row.*) so missing columns return NULL rather than error.
-- ============================================================
DO $$
DECLARE
    v_pb            RECORD;
    v_data          jsonb;
    v_batch_id      uuid;
    v_oil_status    varchar;
    v_total_litre   numeric;
    v_migrated      integer := 0;
    v_skipped       integer := 0;
BEGIN
    -- Bail out if production_batches doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'production_batches'
    ) THEN
        RAISE NOTICE 'production_batches not found — skipping oil data migration';
        RETURN;
    END IF;

    FOR v_pb IN
        SELECT
            pb.id,
            pb.batch_number,
            pb.status,
            pb.created_at,
            pb.updated_at,
            to_jsonb(pb.*) AS all_data
        FROM public.production_batches pb
        WHERE pb.batch_type = 'oil'
          AND COALESCE((to_jsonb(pb.*)->>'is_active')::boolean, true)
        ORDER BY pb.created_at
    LOOP
        v_data := v_pb.all_data;

        -- ── Status mapping ────────────────────────────────────────────
        v_oil_status := CASE
            WHEN v_pb.status IN ('complete', 'in_finished_stock', 'dispatched', 'closed', 'archived')
                THEN 'complete'
            ELSE 'production'
        END;

        -- ── Total oil litres ──────────────────────────────────────────
        -- Prefer summing the three IBC columns; fall back to stored total_oil_litre
        v_total_litre := COALESCE((v_data->>'ibc1_litre')::numeric, 0)
                       + COALESCE((v_data->>'ibc2_litre')::numeric, 0)
                       + COALESCE((v_data->>'ibc3_litre')::numeric, 0);
        IF v_total_litre = 0 THEN
            v_total_litre := (v_data->>'total_oil_litre')::numeric;
        END IF;

        -- ── Insert parent batch record ────────────────────────────────
        INSERT INTO public.batches (batch_id, batch_type, is_active, created_at, updated_at)
        VALUES (
            v_pb.batch_number,
            'oil',
            true,
            COALESCE(v_pb.created_at, NOW()),
            COALESCE(v_pb.updated_at, NOW())
        )
        ON CONFLICT (batch_id) DO NOTHING;

        SELECT id INTO v_batch_id
        FROM public.batches
        WHERE batch_id = v_pb.batch_number;

        IF v_batch_id IS NULL THEN
            RAISE WARNING 'oil migration: batch_number=% conflicts with existing batch — skipped', v_pb.batch_number;
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        -- ── Insert oil row ────────────────────────────────────────────
        INSERT INTO public.oil (
            batch_id,
            production_date,
            shift,
            product_name,
            status,
            total_oil_litre,
            sheet_data,
            is_active,
            created_at,
            updated_at
        )
        VALUES (
            v_batch_id,
            (v_data->>'production_date')::date,
            v_data->>'shift',
            v_data->>'product_name',
            v_oil_status,
            v_total_litre,
            jsonb_build_object(
                'shift_supervisor',     v_data->>'shift_supervisor',
                'supervisor_signature', v_data->>'supervisor_signature',
                'start_oil_bn',         v_data->>'start_oil_bn',
                'start_oil_litre',      (v_data->>'start_oil_litre')::numeric,
                'ibc1_bn',              v_data->>'ibc1_bn',
                'ibc1_litre',           (v_data->>'ibc1_litre')::numeric,
                'ibc2_bn',              v_data->>'ibc2_bn',
                'ibc2_litre',           (v_data->>'ibc2_litre')::numeric,
                'ibc3_bn',              v_data->>'ibc3_bn',
                'ibc3_litre',           (v_data->>'ibc3_litre')::numeric,
                'recipe', jsonb_build_object(
                    'oil_kernel',   (v_data->>'recipe_oil_kernel')::numeric,
                    'cracker_dust', (v_data->>'recipe_cracker_dust')::numeric,
                    'kernel_dust',  (v_data->>'recipe_kernel_dust')::numeric,
                    'crush',        (v_data->>'recipe_crush')::numeric,
                    'cake',         (v_data->>'recipe_cake')::numeric,
                    'notes',        v_data->>'recipe_notes'
                ),
                'waste', jsonb_build_object(
                    'general_kg',         (v_data->>'general_waste_kg')::numeric,
                    'floor_kg',           (v_data->>'floor_waste_kg')::numeric,
                    'product_kg',         (v_data->>'product_waste_kg')::numeric,
                    'oil_from_filter_kg', (v_data->>'oil_from_filter_kg')::numeric
                ),
                -- raw_materials / mixes: read from JSONB column if it already exists there,
                -- otherwise default to empty array
                'raw_materials', COALESCE(v_data->'raw_materials', '[]'::jsonb),
                'mixes',         COALESCE(v_data->'mixes',         '[]'::jsonb)
            ),
            true,
            COALESCE(v_pb.created_at, NOW()),
            COALESCE(v_pb.updated_at, NOW())
        )
        ON CONFLICT DO NOTHING;

        v_migrated := v_migrated + 1;
    END LOOP;

    RAISE NOTICE 'Oil migration complete — migrated: %, skipped: %, total oil rows: %',
        v_migrated, v_skipped, (SELECT COUNT(*) FROM public.oil);
END;
$$;
