-- ============================================================
-- Migration: Consolidate kernel production into batches + kernel
--
-- Merges 8+ tables (production_batches, sample_submissions,
-- receiving_checklists, kernel_production_days/stages,
-- kernel_job_cards, kernel_packing_samples, kernel_dispatch_*)
-- into 2 clean tables: batches (parent) + kernel (full journey).
--
-- SAFE: Does NOT drop old tables. Idempotent (IF NOT EXISTS).
-- ============================================================

-- ============================================================
-- STEP 1: Create batches table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id varchar(100) NOT NULL UNIQUE,
    batch_type varchar(50) NOT NULL DEFAULT 'kernel',
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT batches_batch_type_check CHECK (
        batch_type IN ('kernel', 'oil')
    )
);

COMMENT ON TABLE public.batches IS 'Unified batch header. One row per physical batch (kernel or oil).';
COMMENT ON COLUMN public.batches.batch_id IS 'Human-readable batch number (e.g. BATCH-2026-01-001). Formerly batch_number.';
COMMENT ON COLUMN public.batches.batch_type IS 'Discriminator: kernel or oil.';

CREATE INDEX IF NOT EXISTS idx_batches_batch_type ON public.batches(batch_type);
CREATE INDEX IF NOT EXISTS idx_batches_is_active ON public.batches(is_active) WHERE is_active = true;


-- ============================================================
-- STEP 2: Create kernel table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.kernel (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
    supplier_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
    grower_name varchar(255) NULL,

    status varchar(50) NOT NULL DEFAULT 'intake',
    CONSTRAINT kernel_status_check CHECK (
        status IN ('intake', 'receiving', 'production', 'qa', 'dispatch', 'complete')
    ),

    -- Key scalar fields (queryable for grids/dashboards)
    wet_nis_received_kg numeric NULL,
    actual_wet_nis_kg numeric NULL,

    -- JSONB journey columns
    intake_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    cracking_data jsonb NOT NULL DEFAULT '[]'::jsonb,
    washing_data jsonb NOT NULL DEFAULT '[]'::jsonb,
    sorting_data jsonb NOT NULL DEFAULT '[]'::jsonb,
    packing_data jsonb NOT NULL DEFAULT '[]'::jsonb,
    job_card_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    qa_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    dispatch_data jsonb NOT NULL DEFAULT '{}'::jsonb,

    production_finished_at timestamptz NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kernel IS 'Kernel production journey. One row per kernel batch. Consolidates intake, production stages, job card, QA, and dispatch.';
COMMENT ON COLUMN public.kernel.status IS 'Business phase: intake → receiving → production → qa → dispatch → complete';
COMMENT ON COLUMN public.kernel.intake_data IS '{ ziplock_sample: {...}, five_kg_sample: {...}, receiving_checklist: {...} }';
COMMENT ON COLUMN public.kernel.cracking_data IS 'Array of day entries: [ { date, runs, quality_checks, shell_waste, ... } ]';
COMMENT ON COLUMN public.kernel.washing_data IS 'Array of day entries: [ { date, crates_in, qty_in, floater, sinker, chlorine_tests, waste, ... } ]';
COMMENT ON COLUMN public.kernel.sorting_data IS 'Array of day entries: [ { date, floater_in, sound_kernel styles, sinker_in, butter_grade, ... } ]';
COMMENT ON COLUMN public.kernel.packing_data IS 'Array of day entries: [ { date, sound_kernel styles+cartons, butter_grade styles+cartons, ... } ]';
COMMENT ON COLUMN public.kernel.job_card_data IS '{ received_date, weights, moisture, dates, sound_kernel_styles, butter_grade_styles, waste, mass_balance }';
COMMENT ON COLUMN public.kernel.qa_data IS '{ moisture, peroxide, ffa, internal_micro, external_lab, lab_test_pdf_url, signatures }';
COMMENT ON COLUMN public.kernel.dispatch_data IS '{ orders: [ { buyer, delivery_date, lines: [...], record: {...} } ] }';

CREATE UNIQUE INDEX IF NOT EXISTS idx_kernel_batch_id ON public.kernel(batch_id);
CREATE INDEX IF NOT EXISTS idx_kernel_supplier_id ON public.kernel(supplier_id);
CREATE INDEX IF NOT EXISTS idx_kernel_status ON public.kernel(status);
CREATE INDEX IF NOT EXISTS idx_kernel_is_active ON public.kernel(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_kernel_created_at ON public.kernel(created_at DESC);

-- GIN indexes for JSONB path queries
CREATE INDEX IF NOT EXISTS idx_kernel_intake_gin ON public.kernel USING gin(intake_data);
CREATE INDEX IF NOT EXISTS idx_kernel_job_card_gin ON public.kernel USING gin(job_card_data);
CREATE INDEX IF NOT EXISTS idx_kernel_dispatch_gin ON public.kernel USING gin(dispatch_data);


-- ============================================================
-- STEP 3: Status mapping helper (used during migration only)
-- ============================================================
CREATE OR REPLACE FUNCTION public._migration_map_kernel_status(old_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN old_status IN ('receiving', 'intake_received', 'supplier_intake')
            THEN 'intake'
        WHEN old_status IN ('quality_pending', 'quality_approved', 'awaiting_production')
            THEN 'receiving'
        WHEN old_status IN (
            'in_production', 'cracking', 'washing', 'sorting_wet',
            'drying', 'cooling', 'sorting_dry', 'butter_separation',
            'inspection', 'packing', 'metal_detection',
            'weight_verification', 'sampling'
        )
            THEN 'production'
        WHEN old_status IN ('awaiting_test', 'release_ready', 'pending_release')
            THEN 'qa'
        WHEN old_status IN ('released', 'cold_storage')
            THEN 'dispatch'
        WHEN old_status IN ('completed', 'in_finished_stock')
            THEN 'complete'
        ELSE 'intake'
    END;
$$;


-- ============================================================
-- STEP 4: Migrate data into batches
-- ============================================================
INSERT INTO public.batches (id, batch_id, batch_type, is_active, created_at, updated_at)
SELECT
    pb.id,
    pb.batch_number,
    COALESCE(pb.batch_type, 'kernel'),
    true,
    COALESCE(pb.created_at, now()),
    COALESCE(pb.updated_at, now())
FROM public.production_batches pb
WHERE pb.batch_type = 'kernel'
  AND pb.batch_number IS NOT NULL
ON CONFLICT (batch_id) DO NOTHING;


-- ============================================================
-- STEP 5: Migrate data into kernel (JSONB assembly)
-- ============================================================
DO $$
DECLARE
    v_batch record;
    v_intake_data jsonb;
    v_cracking_data jsonb;
    v_washing_data jsonb;
    v_sorting_data jsonb;
    v_packing_data jsonb;
    v_job_card_data jsonb;
    v_qa_data jsonb;
    v_dispatch_data jsonb;
    v_dispatch_orders jsonb;
    v_sample record;
    v_checklist record;
    v_job_card record;
    v_packing_sample record;
    v_day record;
    v_stages record;
    v_has_days_table boolean := false;
    v_has_stages_table boolean := false;
    v_has_job_cards_table boolean := false;
    v_has_dispatch_orders_table boolean := false;
    v_has_dispatch_records_table boolean := false;
    v_has_dispatch_lines_table boolean := false;
    v_checklist_table_name text := NULL;
    v_migrated_count integer := 0;
BEGIN
    -- --------------------------------------------------------
    -- Detect which tables exist (some created directly in Supabase)
    -- --------------------------------------------------------
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'kernel_production_days'
    ) INTO v_has_days_table;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'kernel_production_stages'
    ) INTO v_has_stages_table;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'kernel_job_cards'
    ) INTO v_has_job_cards_table;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'kernel_dispatch_orders'
    ) INTO v_has_dispatch_orders_table;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'kernel_dispatch_records'
    ) INTO v_has_dispatch_records_table;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'kernel_dispatch_order_lines'
    ) INTO v_has_dispatch_lines_table;

    -- Detect receiving checklist table name (two possible names)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'incoming_receiving_checklists') THEN
        v_checklist_table_name := 'incoming_receiving_checklists';
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'receiving_checklists') THEN
        v_checklist_table_name := 'receiving_checklists';
    END IF;

    RAISE NOTICE 'Table detection: days=%, stages=%, job_cards=%, dispatch_orders=%, dispatch_records=%, dispatch_lines=%, checklist=%',
        v_has_days_table, v_has_stages_table, v_has_job_cards_table,
        v_has_dispatch_orders_table, v_has_dispatch_records_table, v_has_dispatch_lines_table,
        v_checklist_table_name;

    -- --------------------------------------------------------
    -- Loop each kernel batch
    -- --------------------------------------------------------
    FOR v_batch IN
        SELECT pb.*
        FROM public.production_batches pb
        INNER JOIN public.batches b ON b.id = pb.id
        WHERE pb.batch_type = 'kernel'
        ORDER BY pb.created_at
    LOOP
        -- Skip if already migrated
        IF EXISTS (SELECT 1 FROM public.kernel WHERE batch_id = v_batch.id) THEN
            CONTINUE;
        END IF;

        -- ====================================================
        -- BUILD intake_data
        -- ====================================================
        v_intake_data := '{}'::jsonb;

        -- Ziplock + 5kg sample from sample_submissions
        IF v_batch.sample_submission_id IS NOT NULL THEN
            BEGIN
                SELECT * INTO v_sample
                FROM public.sample_submissions
                WHERE id = v_batch.sample_submission_id;

                IF v_sample.id IS NOT NULL THEN
                    v_intake_data := v_intake_data || jsonb_build_object(
                        'ziplock_sample', jsonb_build_object(
                            'submission_number', v_sample.submission_number,
                            'moisture', jsonb_build_object(
                                'required', COALESCE(v_sample.moisture_content_percentage IS NOT NULL, false),
                                'result', v_sample.moisture_content_percentage
                            ),
                            'peroxide', jsonb_build_object(
                                'required', COALESCE(v_sample.peroxide_value IS NOT NULL, false),
                                'result', v_sample.peroxide_value
                            ),
                            'ffa', jsonb_build_object(
                                'required', COALESCE(v_sample.ffa_percentage IS NOT NULL, false),
                                'result', v_sample.ffa_percentage
                            ),
                            'completed_at', v_sample.ziplock_completed_at
                        ),
                        'five_kg_sample', jsonb_build_object(
                            'crack_out', jsonb_build_object(
                                'sound_kernel_g', v_sample.crack_out_sound_kernel_g,
                                'unsound_kernel_g', v_sample.crack_out_unsound_kernel_g,
                                'shell_g', v_sample.crack_out_shell_g
                            ),
                            'float_test', jsonb_build_object(
                                'floating_g', v_sample.float_floating_g,
                                'sinking_g', v_sample.float_sinking_g
                            ),
                            'unsound', jsonb_build_object(
                                'germination_g', v_sample.unsound_germination_g,
                                'late_stinkbug_g', v_sample.unsound_late_stinkbug_g,
                                'early_stinkbug_g', v_sample.unsound_early_stinkbug_g,
                                'dark_centre_g', v_sample.unsound_dark_centre_g,
                                'mould_g', v_sample.unsound_mould_g,
                                'rotten_g', v_sample.unsound_rotten_g,
                                'immature_split_g', v_sample.unsound_immature_split_g,
                                'shrivelled_g', v_sample.unsound_shrivelled_g,
                                'nut_borer_g', v_sample.unsound_nut_borer_g
                            ),
                            'completed_at', v_sample.sample_5kg_completed_at
                        )
                    );
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not read sample_submission for batch %: %', v_batch.batch_number, SQLERRM;
            END;
        END IF;

        -- Receiving checklist
        IF v_batch.receiving_checklist_id IS NOT NULL AND v_checklist_table_name IS NOT NULL THEN
            BEGIN
                EXECUTE format(
                    'SELECT row_to_json(t)::jsonb AS data FROM (
                        SELECT id, date_received, delivery_note_ref, supplier_id,
                               vehicle_clean, vehicle_enclosed, hazard_substances,
                               pest_infestations, pallets_condition,
                               raw_materials_condition, comments, received_items
                        FROM public.%I WHERE id = $1
                    ) t', v_checklist_table_name
                ) INTO v_checklist USING v_batch.receiving_checklist_id;

                IF v_checklist IS NOT NULL AND v_checklist.data IS NOT NULL THEN
                    v_intake_data := v_intake_data || jsonb_build_object(
                        'receiving_checklist', v_checklist.data - 'id' - 'supplier_id'
                    );
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not read checklist % for batch %: %',
                    v_batch.receiving_checklist_id, v_batch.batch_number, SQLERRM;
            END;
        END IF;

        -- ====================================================
        -- BUILD cracking/washing/sorting/packing arrays
        -- ====================================================
        v_cracking_data := '[]'::jsonb;
        v_washing_data := '[]'::jsonb;
        v_sorting_data := '[]'::jsonb;
        v_packing_data := '[]'::jsonb;

        IF v_has_days_table AND v_has_stages_table THEN
            BEGIN
                FOR v_day IN
                    EXECUTE 'SELECT d.id, d.day_number,
                                    COALESCE(d.kernel_production_stages_id, NULL) as stages_id
                             FROM public.kernel_production_days d
                             WHERE d.production_batch_id = $1
                             ORDER BY d.day_number'
                    USING v_batch.id
                LOOP
                    -- Try stages_id first, then fall back to querying by day_id
                    BEGIN
                        IF v_day.stages_id IS NOT NULL THEN
                            EXECUTE 'SELECT cracking_data, washing_data, sorting_data, packing_data
                                     FROM public.kernel_production_stages
                                     WHERE id = $1'
                            INTO v_stages USING v_day.stages_id;
                        ELSE
                            EXECUTE 'SELECT cracking_data, washing_data, sorting_data, packing_data
                                     FROM public.kernel_production_stages
                                     WHERE kernel_production_day_id = $1
                                     ORDER BY created_at DESC LIMIT 1'
                            INTO v_stages USING v_day.id;
                        END IF;

                        IF v_stages IS NOT NULL THEN
                            -- Append each non-empty stage with day_number for traceability
                            IF v_stages.cracking_data IS NOT NULL
                               AND v_stages.cracking_data != '{}'::jsonb
                               AND v_stages.cracking_data != 'null'::jsonb THEN
                                v_cracking_data := v_cracking_data || jsonb_build_array(
                                    v_stages.cracking_data || jsonb_build_object('day_number', v_day.day_number)
                                );
                            END IF;

                            IF v_stages.washing_data IS NOT NULL
                               AND v_stages.washing_data != '{}'::jsonb
                               AND v_stages.washing_data != 'null'::jsonb THEN
                                v_washing_data := v_washing_data || jsonb_build_array(
                                    v_stages.washing_data || jsonb_build_object('day_number', v_day.day_number)
                                );
                            END IF;

                            IF v_stages.sorting_data IS NOT NULL
                               AND v_stages.sorting_data != '{}'::jsonb
                               AND v_stages.sorting_data != 'null'::jsonb THEN
                                v_sorting_data := v_sorting_data || jsonb_build_array(
                                    v_stages.sorting_data || jsonb_build_object('day_number', v_day.day_number)
                                );
                            END IF;

                            IF v_stages.packing_data IS NOT NULL
                               AND v_stages.packing_data != '{}'::jsonb
                               AND v_stages.packing_data != 'null'::jsonb THEN
                                v_packing_data := v_packing_data || jsonb_build_array(
                                    v_stages.packing_data || jsonb_build_object('day_number', v_day.day_number)
                                );
                            END IF;
                        END IF;
                    EXCEPTION WHEN OTHERS THEN
                        RAISE NOTICE 'Could not read stages for day % (batch %): %',
                            v_day.id, v_batch.batch_number, SQLERRM;
                    END;
                END LOOP;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Error iterating production days for batch %: %',
                    v_batch.batch_number, SQLERRM;
            END;
        END IF;

        -- ====================================================
        -- BUILD job_card_data
        -- ====================================================
        v_job_card_data := '{}'::jsonb;

        IF v_has_job_cards_table THEN
            BEGIN
                EXECUTE 'SELECT row_to_json(t)::jsonb AS data FROM (
                             SELECT * FROM public.kernel_job_cards
                             WHERE production_batch_id = $1
                                OR batch_number = $2
                             ORDER BY created_at DESC LIMIT 1
                         ) t'
                INTO v_job_card USING v_batch.id, v_batch.batch_number;

                IF v_job_card IS NOT NULL AND v_job_card.data IS NOT NULL THEN
                    -- Strip internal IDs — they live on the kernel row itself
                    v_job_card_data := v_job_card.data - 'id' - 'production_batch_id' - 'created_at' - 'updated_at';
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not read job card for batch %: %',
                    v_batch.batch_number, SQLERRM;
            END;
        END IF;

        -- ====================================================
        -- BUILD qa_data
        -- ====================================================
        v_qa_data := '{}'::jsonb;

        BEGIN
            SELECT * INTO v_packing_sample
            FROM public.kernel_packing_samples
            WHERE production_batch_id = v_batch.id
            ORDER BY created_at DESC LIMIT 1;

            IF v_packing_sample IS NOT NULL AND v_packing_sample.id IS NOT NULL THEN
                v_qa_data := jsonb_build_object(
                    'moisture', jsonb_build_object(
                        'required', COALESCE(v_packing_sample.moisture_required, false),
                        'result', v_packing_sample.moisture_result
                    ),
                    'peroxide', jsonb_build_object(
                        'required', COALESCE(v_packing_sample.peroxide_required, false),
                        'result', v_packing_sample.peroxide_result
                    ),
                    'ffa', jsonb_build_object(
                        'required', COALESCE(v_packing_sample.ffa_required, false),
                        'result', v_packing_sample.ffa_result
                    ),
                    'internal_micro', jsonb_build_object(
                        'required', COALESCE(v_packing_sample.internal_micro_required, false),
                        'result', v_packing_sample.internal_micro_result
                    ),
                    'external_lab', jsonb_build_object(
                        'required', COALESCE(v_packing_sample.external_lab_required, false),
                        'result', v_packing_sample.external_lab_result
                    ),
                    'lab_test_pdf_url', v_packing_sample.lab_test_pdf_url,
                    'supervisor_signed_by', v_packing_sample.supervisor_signed_by,
                    'nut_plant_manager_signed_by', v_packing_sample.nut_plant_manager_signed_by,
                    'completed_at', v_packing_sample.created_at
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not read packing sample for batch %: %',
                v_batch.batch_number, SQLERRM;
        END;

        -- ====================================================
        -- BUILD dispatch_data
        -- ====================================================
        v_dispatch_data := '{}'::jsonb;

        IF v_has_dispatch_orders_table AND v_has_dispatch_lines_table THEN
            BEGIN
                EXECUTE '
                    SELECT COALESCE(jsonb_agg(
                        jsonb_build_object(
                            ''buyer_name'', o.buyer_name,
                            ''buyer_contact_id'', o.buyer_contact_id,
                            ''delivery_date'', o.delivery_date,
                            ''best_before_date'', o.best_before_date,
                            ''status'', o.status,
                            ''lines'', COALESCE((
                                SELECT jsonb_agg(jsonb_build_object(
                                    ''style'', l.style,
                                    ''quantity_kg'', l.quantity_kg
                                ))
                                FROM public.kernel_dispatch_order_lines l
                                WHERE l.dispatch_order_id = o.id
                            ), ''[]''::jsonb)' ||
                            CASE WHEN v_has_dispatch_records_table THEN ',
                            ''record'', (
                                SELECT jsonb_build_object(
                                    ''vehicle_clean'', r.vehicle_clean_yn,
                                    ''vehicle_enclosed'', r.vehicle_enclosed_yn,
                                    ''hazard_substances'', r.hazard_substances_yn,
                                    ''pest_infestations'', r.pest_infestations_yn,
                                    ''pallets_condition'', r.pallets_condition_yn,
                                    ''truck_bin_locked'', r.truck_bin_locked_yn,
                                    ''dispatch_person'', r.dispatch_person,
                                    ''transport_company'', r.transport_company,
                                    ''delivery_note_number'', r.delivery_note_number,
                                    ''date_dispatched'', r.date_dispatched,
                                    ''truck_registration'', r.truck_registration,
                                    ''driver_name'', r.driver_name,
                                    ''time_dispatched'', r.time_dispatched,
                                    ''dispatched_to'', r.dispatched_to,
                                    ''dispatch_signature'', r.dispatch_signature
                                )
                                FROM public.kernel_dispatch_records r
                                WHERE r.dispatch_order_id = o.id
                                LIMIT 1
                            )'
                            ELSE '' END
                        || ')
                    ), ''[]''::jsonb)
                    FROM public.kernel_dispatch_orders o
                    WHERE o.id IN (
                        SELECT DISTINCT l2.dispatch_order_id
                        FROM public.kernel_dispatch_order_lines l2
                        WHERE l2.production_batch_id = $1
                    )'
                INTO v_dispatch_orders USING v_batch.id;

                IF v_dispatch_orders IS NOT NULL AND v_dispatch_orders != '[]'::jsonb THEN
                    v_dispatch_data := jsonb_build_object('orders', v_dispatch_orders);
                END IF;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Could not read dispatch data for batch %: %',
                    v_batch.batch_number, SQLERRM;
            END;
        END IF;

        -- ====================================================
        -- INSERT into kernel
        -- ====================================================
        INSERT INTO public.kernel (
            batch_id,
            supplier_id,
            grower_name,
            status,
            wet_nis_received_kg,
            actual_wet_nis_kg,
            intake_data,
            cracking_data,
            washing_data,
            sorting_data,
            packing_data,
            job_card_data,
            qa_data,
            dispatch_data,
            production_finished_at,
            is_active,
            created_at,
            updated_at
        ) VALUES (
            v_batch.id,
            v_batch.supplier_id,
            v_batch.grower_name,
            public._migration_map_kernel_status(COALESCE(v_batch.status, 'receiving')),
            v_batch.wet_nis_received_kg,
            v_batch.actual_wet_nis_kg,
            v_intake_data,
            v_cracking_data,
            v_washing_data,
            v_sorting_data,
            v_packing_data,
            v_job_card_data,
            v_qa_data,
            v_dispatch_data,
            v_batch.production_finished_at,
            true,
            COALESCE(v_batch.created_at, now()),
            COALESCE(v_batch.updated_at, now())
        );

        v_migrated_count := v_migrated_count + 1;
    END LOOP;

    RAISE NOTICE 'Migration complete. Migrated % kernel batches into kernel table.', v_migrated_count;
END $$;


-- ============================================================
-- STEP 6: Enable RLS
-- ============================================================
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kernel ENABLE ROW LEVEL SECURITY;

-- service_role: full access
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'batches' AND policyname = 'service_role_full_batches') THEN
        CREATE POLICY service_role_full_batches ON public.batches FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kernel' AND policyname = 'service_role_full_kernel') THEN
        CREATE POLICY service_role_full_kernel ON public.kernel FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- authenticated: read access
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'batches' AND policyname = 'authenticated_read_batches') THEN
        CREATE POLICY authenticated_read_batches ON public.batches FOR SELECT TO authenticated USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'kernel' AND policyname = 'authenticated_read_kernel') THEN
        CREATE POLICY authenticated_read_kernel ON public.kernel FOR SELECT TO authenticated USING (true);
    END IF;
END $$;


-- ============================================================
-- STEP 7: Clean up migration helper
-- ============================================================
DROP FUNCTION IF EXISTS public._migration_map_kernel_status(text);


-- ============================================================
-- STEP 8: Verification queries (run these manually to confirm)
-- ============================================================

-- 8a: Row count comparison
-- SELECT 'production_batches (kernel)' AS source, COUNT(*) FROM production_batches WHERE batch_type = 'kernel'
-- UNION ALL
-- SELECT 'batches' AS source, COUNT(*) FROM batches
-- UNION ALL
-- SELECT 'kernel' AS source, COUNT(*) FROM kernel;

-- 8b: Status distribution in new table
-- SELECT status, COUNT(*) FROM kernel GROUP BY status ORDER BY status;

-- 8c: Check JSONB population
-- SELECT
--     batch_id,
--     intake_data != '{}'::jsonb AS has_intake,
--     jsonb_array_length(cracking_data) AS cracking_days,
--     jsonb_array_length(washing_data) AS washing_days,
--     jsonb_array_length(sorting_data) AS sorting_days,
--     jsonb_array_length(packing_data) AS packing_days,
--     job_card_data != '{}'::jsonb AS has_job_card,
--     qa_data != '{}'::jsonb AS has_qa,
--     dispatch_data != '{}'::jsonb AS has_dispatch
-- FROM kernel
-- ORDER BY created_at DESC
-- LIMIT 20;

-- 8d: Spot-check a specific batch
-- SELECT k.*, b.batch_id AS batch_number
-- FROM kernel k
-- JOIN batches b ON k.batch_id = b.id
-- LIMIT 1;
