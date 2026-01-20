-- QA Database Tables for Test Management
-- Run this script in Supabase SQL Editor to create/update required tables
--
-- NOTE: test_scenarios table already exists - we only add missing columns
-- ===========================================

-- ===========================================
-- UPDATE: test_scenarios table
-- Add missing columns for QA Viewer
-- ===========================================
DO $$
BEGIN
    -- Add test_steps column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                   AND table_name = 'test_scenarios'
                   AND column_name = 'test_steps') THEN
        ALTER TABLE public.test_scenarios ADD COLUMN test_steps JSONB;
        RAISE NOTICE 'Added test_steps column to test_scenarios';
    END IF;

    -- Add automation_script_path column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                   AND table_name = 'test_scenarios'
                   AND column_name = 'automation_script_path') THEN
        ALTER TABLE public.test_scenarios ADD COLUMN automation_script_path VARCHAR(500);
        RAISE NOTICE 'Added automation_script_path column to test_scenarios';
    END IF;
END $$;

-- ===========================================
-- Table: test_run_batches
-- Stores test execution batch summaries
-- ===========================================
CREATE TABLE IF NOT EXISTS public.test_run_batches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    batch_name VARCHAR(255) NOT NULL,
    description TEXT,
    environment VARCHAR(50) DEFAULT 'local',
    version_tested VARCHAR(50),
    build_number VARCHAR(100),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    total_tests INTEGER DEFAULT 0,
    passed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    blocked_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    overall_status VARCHAR(20) DEFAULT 'pending',
    deployment_recommendation VARCHAR(50),
    recommendation_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================
-- Table: test_instances
-- Stores individual test execution results
-- ===========================================
CREATE TABLE IF NOT EXISTS public.test_instances (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    scenario_id UUID REFERENCES public.test_scenarios(id) ON DELETE SET NULL,
    scenario_code VARCHAR(50),
    run_batch_id UUID REFERENCES public.test_run_batches(id) ON DELETE CASCADE,
    run_number INTEGER DEFAULT 1,
    environment VARCHAR(50) DEFAULT 'local',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    status VARCHAR(20) DEFAULT 'pending',
    actual_result TEXT,
    error_message TEXT,
    error_stack TEXT,
    step_results JSONB,
    browser_info JSONB,
    tester_notes TEXT,
    severity_level_at_run VARCHAR(20) DEFAULT 'medium',
    executed_by UUID,
    executed_by_name VARCHAR(255) DEFAULT 'Playwright Automation',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================
-- Table: test_audit
-- Comprehensive audit log for test executions
-- ===========================================
CREATE TABLE IF NOT EXISTS public.test_audit (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    scenario_id UUID REFERENCES public.test_scenarios(id) ON DELETE SET NULL,
    scenario_code VARCHAR(50),
    scenario_name VARCHAR(255),
    module_name VARCHAR(100),
    test_type VARCHAR(50) DEFAULT 'functional',
    instance_id UUID REFERENCES public.test_instances(id) ON DELETE SET NULL,
    batch_id UUID REFERENCES public.test_run_batches(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL,
    tester_name VARCHAR(255),
    executed_by UUID,
    executed_at TIMESTAMPTZ DEFAULT NOW(),
    duration_ms INTEGER,
    step_results JSONB,
    test_data_used JSONB,
    expected_result TEXT,
    actual_result TEXT,
    defects JSONB,
    notes TEXT,
    comments TEXT,
    evidence JSONB,
    screenshots JSONB,
    environment VARCHAR(50) DEFAULT 'local',
    browser_info JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================
-- NOTE: test_scenarios table already exists
-- Missing columns (test_steps, automation_script_path)
-- are added via ALTER TABLE at the top of this script
-- ===========================================

-- ===========================================
-- Table: e2e_test_data_sets
-- Stores test data set definitions
-- ===========================================
CREATE TABLE IF NOT EXISTS public.e2e_test_data_sets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    set_name VARCHAR(100) NOT NULL,
    module VARCHAR(100),
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================
-- Table: e2e_test_data_records
-- Stores individual test data records
-- ===========================================
CREATE TABLE IF NOT EXISTS public.e2e_test_data_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    set_id UUID REFERENCES public.e2e_test_data_sets(id) ON DELETE CASCADE,
    data_key VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    data_json JSONB NOT NULL,
    purpose VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================
-- Indexes for better performance
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_test_instances_batch_id ON public.test_instances(run_batch_id);
CREATE INDEX IF NOT EXISTS idx_test_instances_scenario_id ON public.test_instances(scenario_id);
CREATE INDEX IF NOT EXISTS idx_test_instances_status ON public.test_instances(status);
CREATE INDEX IF NOT EXISTS idx_test_instances_executed_at ON public.test_instances(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_audit_scenario_id ON public.test_audit(scenario_id);
CREATE INDEX IF NOT EXISTS idx_test_audit_batch_id ON public.test_audit(batch_id);
CREATE INDEX IF NOT EXISTS idx_test_audit_status ON public.test_audit(status);
CREATE INDEX IF NOT EXISTS idx_test_audit_executed_at ON public.test_audit(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_scenarios_code ON public.test_scenarios(scenario_code);
CREATE INDEX IF NOT EXISTS idx_test_scenarios_module ON public.test_scenarios(module_name);
CREATE INDEX IF NOT EXISTS idx_test_scenarios_active ON public.test_scenarios(is_active);

CREATE INDEX IF NOT EXISTS idx_test_run_batches_started ON public.test_run_batches(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_run_batches_status ON public.test_run_batches(overall_status);

-- ===========================================
-- Enable Row Level Security (RLS)
-- Allows public read access for the QA viewer
-- ===========================================
ALTER TABLE public.test_run_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.e2e_test_data_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.e2e_test_data_records ENABLE ROW LEVEL SECURITY;

-- Policies for public read access (for anon key)
CREATE POLICY IF NOT EXISTS "Allow public read access to test_run_batches"
    ON public.test_run_batches FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to test_instances"
    ON public.test_instances FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to test_audit"
    ON public.test_audit FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to test_scenarios"
    ON public.test_scenarios FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to e2e_test_data_sets"
    ON public.e2e_test_data_sets FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Allow public read access to e2e_test_data_records"
    ON public.e2e_test_data_records FOR SELECT USING (true);

-- Policies for authenticated write access (for service key)
CREATE POLICY IF NOT EXISTS "Allow authenticated insert to test_run_batches"
    ON public.test_run_batches FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Allow authenticated insert to test_instances"
    ON public.test_instances FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Allow authenticated insert to test_audit"
    ON public.test_audit FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Allow authenticated insert to test_scenarios"
    ON public.test_scenarios FOR INSERT WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON public.test_run_batches TO anon;
GRANT SELECT ON public.test_instances TO anon;
GRANT SELECT ON public.test_audit TO anon;
GRANT SELECT ON public.test_scenarios TO anon;
GRANT SELECT ON public.e2e_test_data_sets TO anon;
GRANT SELECT ON public.e2e_test_data_records TO anon;

GRANT ALL ON public.test_run_batches TO authenticated;
GRANT ALL ON public.test_instances TO authenticated;
GRANT ALL ON public.test_audit TO authenticated;
GRANT ALL ON public.test_scenarios TO authenticated;
GRANT ALL ON public.e2e_test_data_sets TO authenticated;
GRANT ALL ON public.e2e_test_data_records TO authenticated;

-- Success message
SELECT 'QA Database tables created successfully!' AS result;
