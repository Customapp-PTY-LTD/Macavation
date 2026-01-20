# Kernel Production Workflow Module (17 Steps)

## Overview
Manages the complete 17-step production workflow for macadamia kernel processing from receiving wet nuts in shell through to final dispatch of packed kernels.

---

## Production Workflow Steps

1. **Receiving** - Accept delivery, verify weight, initial quality check
2. **Cracking** - Crack nuts in shell to extract kernels
3. **Washing** - Wash kernels with peracetic acid sanitizer
4. **Sorting (Pre-Dry)** - Initial sort of wet kernels (floaters/sinkers)
5. **Drying** - Reduce moisture content to <2%
6. **Cooling** - Cool dried kernels to ambient temperature
7. **Sorting (Post-Dry)** - Sort by style (SP, 0, 1, 1S, 4L, 5, 6, 7/8)
8. **Butter Grade Separation** - Separate butter high/low oil kernels
9. **Quality Inspection** - Visual and physical quality checks
10. **Packing** - Pack into cartons by style
11. **Metal Detection** - Pass through metal detector
12. **Weight Verification** - Verify carton weights
13. **Batch Sampling** - Final quality samples
14. **Positive Release** - QA approval for dispatch
15. **Cold Storage** - Store in temperature-controlled facility
16. **Order Picking** - Pick for customer orders
17. **Dispatch** - Load and dispatch to customers

---

## Database Entities

### 1. production_batches
Main production batch tracking
```sql
CREATE TABLE production_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_number VARCHAR(50) UNIQUE NOT NULL,
    batch_type VARCHAR(20) DEFAULT 'kernel' CHECK (batch_type IN ('kernel', 'oil')),
    
    -- Source Information
    main_run_document_id UUID REFERENCES main_run_documents(id),
    supplier_id UUID REFERENCES contacts(id),
    grower_name VARCHAR(255),
    
    -- Input Weights
    wet_nis_received_kg DECIMAL(12,2) NOT NULL,
    received_date DATE NOT NULL,
    receiving_moisture_percentage DECIMAL(5,2),
    
    -- Processing Dates
    start_date DATE,
    completion_date DATE,
    estimated_completion_date DATE,
    
    -- Status
    current_step INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'receiving' CHECK (status IN (
        'receiving', 'cracking', 'washing', 'sorting_wet', 'drying', 
        'cooling', 'sorting_dry', 'butter_separation', 'inspection',
        'packing', 'metal_detection', 'weight_verification', 'sampling',
        'pending_release', 'released', 'cold_storage', 'completed', 'hold'
    )),
    hold_reason TEXT,
    
    -- Production Manager Assignment
    production_manager_id UUID REFERENCES users(id),
    qa_supervisor_id UUID REFERENCES users(id),
    
    -- Totals (updated as batch progresses)
    total_kernel_kg DECIMAL(10,2),
    kernel_recovery_percentage DECIMAL(5,2),
    waste_kg DECIMAL(10,2),
    
    -- Quality Flags
    quality_hold BOOLEAN DEFAULT false,
    positive_release BOOLEAN DEFAULT false,
    release_date TIMESTAMP WITH TIME ZONE,
    released_by UUID REFERENCES users(id),
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_production_batches_number ON production_batches(batch_number);
CREATE INDEX idx_production_batches_supplier ON production_batches(supplier_id);
CREATE INDEX idx_production_batches_status ON production_batches(status);
CREATE INDEX idx_production_batches_date ON production_batches(received_date DESC);
CREATE INDEX idx_production_batches_main_run ON production_batches(main_run_document_id);
```

### 2. batch_step_records
Track each step in the production workflow
```sql
CREATE TABLE batch_step_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    
    -- Timing
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    
    -- Personnel
    operator_id UUID REFERENCES users(id),
    supervisor_id UUID REFERENCES users(id),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
    
    -- Input/Output Quantities
    input_quantity_kg DECIMAL(10,2),
    output_quantity_kg DECIMAL(10,2),
    waste_quantity_kg DECIMAL(10,2),
    
    -- Step-Specific Data (JSONB for flexibility)
    step_data JSONB,
    
    -- Notes
    notes TEXT,
    issues TEXT,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(batch_id, step_number)
);

CREATE INDEX idx_batch_step_records_batch ON batch_step_records(batch_id);
CREATE INDEX idx_batch_step_records_step ON batch_step_records(step_number);
CREATE INDEX idx_batch_step_records_status ON batch_step_records(status);
```

### 3. cracking_records
Detailed cracking step records
```sql
CREATE TABLE cracking_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE,
    batch_step_record_id UUID REFERENCES batch_step_records(id),
    
    -- Date and Grower
    cracking_date DATE NOT NULL,
    grower_name VARCHAR(255),
    batch_number VARCHAR(100),
    
    -- Time Tracking
    start_time TIME,
    end_time TIME,
    time_spent_hours DECIMAL(5,2),
    
    -- Quantities
    start_quantity_kg DECIMAL(10,2),
    end_quantity_kg DECIMAL(10,2),
    silo_quantity_kg DECIMAL(10,2),
    
    -- Minute Tests (quality checks during processing)
    minute_test_time_1 TIME,
    minute_test_wholes_1 DECIMAL(10,2),
    minute_test_uncracks_1 DECIMAL(10,2),
    minute_test_total_1 DECIMAL(10,2),
    
    minute_test_time_2 TIME,
    minute_test_wholes_2 DECIMAL(10,2),
    minute_test_uncracks_2 DECIMAL(10,2),
    minute_test_total_2 DECIMAL(10,2),
    
    minute_test_time_3 TIME,
    minute_test_wholes_3 DECIMAL(10,2),
    minute_test_uncracks_3 DECIMAL(10,2),
    minute_test_total_3 DECIMAL(10,2),
    
    -- Averages
    average_wholes DECIMAL(10,2),
    average_uncracks DECIMAL(10,2),
    
    -- Shell Waste
    shell_waste_bags INTEGER,
    shell_waste_batch_number VARCHAR(100),
    shell_waste_quantities TEXT[],
    total_shell_waste_kg DECIMAL(10,2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_cracking_records_batch ON cracking_records(batch_id);
CREATE INDEX idx_cracking_records_date ON cracking_records(cracking_date DESC);
```

### 4. washing_records
Washing step with peracetic acid testing
```sql
CREATE TABLE washing_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE,
    batch_step_record_id UUID REFERENCES batch_step_records(id),
    
    -- Date and Batch
    washing_date DATE NOT NULL,
    grower_name VARCHAR(255),
    batch_number VARCHAR(100),
    
    -- Quantities
    crates_in INTEGER,
    quantity_in_kg DECIMAL(10,2),
    
    floater_crates_out INTEGER,
    floater_quantity_out_kg DECIMAL(10,2),
    
    sinker_crates_out INTEGER,
    sinker_quantity_out_kg DECIMAL(10,2),
    
    total_crates_out INTEGER,
    total_quantity_out_kg DECIMAL(10,2),
    
    crate_difference INTEGER,
    quantity_difference_kg DECIMAL(10,2),
    
    -- Peracetic Acid Testing (3 tests during shift)
    peracetic_test_1_time TIME,
    peracetic_test_1_pass BOOLEAN,
    peracetic_test_1_fail BOOLEAN,
    
    peracetic_test_2_time TIME,
    peracetic_test_2_pass BOOLEAN,
    peracetic_test_2_fail BOOLEAN,
    
    peracetic_test_3_time TIME,
    peracetic_test_3_pass BOOLEAN,
    peracetic_test_3_fail BOOLEAN,
    
    -- Waste
    salt_pepper_waste_kg DECIMAL(10,2),
    shell_fines_kg DECIMAL(10,2),
    compost_kg DECIMAL(10,2),
    total_waste_kg DECIMAL(10,2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_washing_records_batch ON washing_records(batch_id);
CREATE INDEX idx_washing_records_date ON washing_records(washing_date DESC);
```

### 5. sorting_records
Sorting step records (both wet and dry sorting)
```sql
CREATE TABLE sorting_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE,
    batch_step_record_id UUID REFERENCES batch_step_records(id),
    
    -- Sorting Type
    sorting_type VARCHAR(20) CHECK (sorting_type IN ('wet', 'dry')),
    sorting_date DATE NOT NULL,
    grower_name VARCHAR(255),
    batch_number VARCHAR(100),
    
    -- Floater Input (for dry sorting)
    floater_crates_in INTEGER,
    floater_quantity_in_kg DECIMAL(10,2),
    
    -- Style Output (by carton count and weight)
    style_sp_cartons INTEGER,
    style_sp_quantity_kg DECIMAL(10,2),
    
    style_0_cartons INTEGER,
    style_0_quantity_kg DECIMAL(10,2),
    
    style_1_cartons INTEGER,
    style_1_quantity_kg DECIMAL(10,2),
    
    style_1s_cartons INTEGER,
    style_1s_quantity_kg DECIMAL(10,2),
    
    style_4l_cartons INTEGER,
    style_4l_quantity_kg DECIMAL(10,2),
    
    style_5_cartons INTEGER,
    style_5_quantity_kg DECIMAL(10,2),
    
    style_6_cartons INTEGER,
    style_6_quantity_kg DECIMAL(10,2),
    
    style_7_8_cartons INTEGER,
    style_7_8_quantity_kg DECIMAL(10,2),
    
    -- Sound Kernel Totals
    sound_kernel_total_cartons INTEGER,
    sound_kernel_total_kg DECIMAL(10,2),
    
    -- Sinker Input (for butter grade)
    sinker_crates_in INTEGER,
    sinker_quantity_in_kg DECIMAL(10,2),
    
    -- Butter Grade Output
    butter_kernel_total_cartons INTEGER,
    butter_kernel_total_kg DECIMAL(10,2),
    
    -- Waste Output
    butter_high_oil_floaters_cartons INTEGER,
    butter_high_oil_floaters_kg DECIMAL(10,2),
    
    butter_low_oil_sinkers_cartons INTEGER,
    butter_low_oil_sinkers_kg DECIMAL(10,2),
    
    oil_waste_kg DECIMAL(10,2),
    compost_waste_kg DECIMAL(10,2),
    
    -- Totals
    total_crates_in INTEGER,
    total_quantity_in_kg DECIMAL(10,2),
    total_crates_out INTEGER,
    total_quantity_out_kg DECIMAL(10,2),
    crate_difference INTEGER,
    quantity_difference_kg DECIMAL(10,2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_sorting_records_batch ON sorting_records(batch_id);
CREATE INDEX idx_sorting_records_date ON sorting_records(sorting_date DESC);
CREATE INDEX idx_sorting_records_type ON sorting_records(sorting_type);
```

### 6. packing_records
Packing step with carton tracking
```sql
CREATE TABLE packing_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE,
    batch_step_record_id UUID REFERENCES batch_step_records(id),
    
    -- Packing Date
    packing_date DATE NOT NULL,
    grower_batch_numbers TEXT[], -- Can pack multiple grower batches together
    
    -- Style-specific packing
    style VARCHAR(20) CHECK (style IN ('SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter')),
    cartons_packed INTEGER,
    quantity_packed_kg DECIMAL(10,2),
    
    -- Best Before Date
    start_date DATE,
    completion_date DATE,
    best_before_date DATE,
    
    -- Commercial designation
    commercial_pack BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_packing_records_batch ON packing_records(batch_id);
CREATE INDEX idx_packing_records_date ON packing_records(packing_date DESC);
CREATE INDEX idx_packing_records_style ON packing_records(style);
```

### 7. daily_moisture_sheets
Daily moisture content tracking during drying
```sql
CREATE TABLE daily_moisture_sheets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Date and Batch Info
    sheet_date DATE NOT NULL,
    year INTEGER NOT NULL,
    grower_name VARCHAR(255),
    batch_number VARCHAR(100),
    
    -- Moisture Readings (Floaters)
    floaters_2nd_dryer_moisture DECIMAL(5,2),
    floaters_container_moisture DECIMAL(5,2),
    floaters_continue_moisture DECIMAL(5,2),
    
    -- Moisture Readings (Sinkers)
    sinkers_3rd_dryer_moisture DECIMAL(5,2),
    sinkers_container_moisture DECIMAL(5,2),
    
    -- Packing Moisture
    packing_moisture_reading DECIMAL(5,2),
    
    -- Associated batch
    batch_id UUID REFERENCES production_batches(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_daily_moisture_batch ON daily_moisture_sheets(batch_id);
CREATE INDEX idx_daily_moisture_date ON daily_moisture_sheets(sheet_date DESC);
```

### 8. gmp_checklists
Good Manufacturing Practice daily checklists
```sql
CREATE TABLE gmp_checklists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    checklist_date DATE NOT NULL,
    checklist_type VARCHAR(50) DEFAULT 'kernel_production',
    
    -- Cleanliness Checks
    cleaning_completed BOOLEAN,
    cleaning_schedule_followed BOOLEAN,
    cleaning_notes TEXT,
    
    -- Sanitation
    oxi_act_solution_check BOOLEAN,
    oxi_act_test_07h00_pass BOOLEAN,
    oxi_act_test_12h30_pass BOOLEAN,
    peracetic_acid_concentration DECIMAL(5,2),
    
    -- Product Handling
    product_on_floor_check BOOLEAN,
    containers_closed_check BOOLEAN,
    
    -- Equipment
    product_scale_accuracy_check BOOLEAN,
    scale_tolerance VARCHAR(50),
    scale_1_actual_weight DECIMAL(10,2),
    scale_2_actual_weight DECIMAL(10,2),
    
    -- Cold Room Temperatures
    cold_room_temps_check BOOLEAN,
    room_1_temp_celsius DECIMAL(5,2),
    room_1_spec_celsius VARCHAR(20),
    room_2_temp_celsius DECIMAL(5,2),
    room_2_spec_celsius VARCHAR(20),
    room_3_temp_celsius DECIMAL(5,2),
    room_3_spec_celsius VARCHAR(20),
    
    -- Drying Room Temperature
    silo_temp_check BOOLEAN,
    silo_4_temp_celsius DECIMAL(5,2),
    
    -- Metal Detector
    metal_detector_accuracy_check BOOLEAN,
    metal_detector_ferrous_pass BOOLEAN,
    metal_detector_non_ferrous_pass BOOLEAN,
    metal_detector_stainless_steel_pass BOOLEAN,
    metal_detector_ferrous_size_mm DECIMAL(5,2),
    metal_detector_non_ferrous_size_mm DECIMAL(5,2),
    metal_detector_stainless_size_mm DECIMAL(5,2),
    
    -- Consumables
    consumable_utensils_check BOOLEAN,
    broken_items_noted TEXT,
    broken_items_replaced BOOLEAN,
    stanley_knives_check BOOLEAN,
    cleaning_equipment_check BOOLEAN,
    scoops_check BOOLEAN,
    
    -- Machinery
    belts_machinery_check BOOLEAN,
    belts_intact BOOLEAN,
    machinery_maintenance_needed TEXT,
    
    -- Production Sheets
    production_sheets_completed BOOLEAN,
    
    -- Glass and Hard Plastics
    glass_hard_plastics_check BOOLEAN,
    glass_chips_noted TEXT,
    
    -- Hand Washing
    hand_washing_check BOOLEAN,
    
    -- Protective Clothing
    protective_clothing_check BOOLEAN,
    hair_nets_worn BOOLEAN,
    ear_coverage BOOLEAN,
    factory_boots BOOLEAN,
    
    -- Cleaning of Protective Clothing
    protective_clothing_cleaning_check BOOLEAN,
    clothing_washed_frequency VARCHAR(100),
    
    -- Factory Protocol
    factory_protocol_check BOOLEAN,
    no_cell_phones BOOLEAN,
    no_watches BOOLEAN,
    no_jewelry BOOLEAN,
    no_nail_varnish BOOLEAN,
    protocol_violations TEXT,
    
    -- Personal Hygiene
    personal_hygiene_check BOOLEAN,
    nails_clean BOOLEAN,
    nails_clipped BOOLEAN,
    illnesses_reported TEXT,
    
    -- Footbath Sanitiser
    footbath_sanitiser_check BOOLEAN,
    footbath_07h00_pass BOOLEAN,
    footbath_12h30_pass BOOLEAN,
    footbath_concentration DECIMAL(5,2),
    
    -- Quality Checks
    quality_checks_performed BOOLEAN,
    batch_grade_identified BOOLEAN,
    batch_grade VARCHAR(50),
    batch_style VARCHAR(50),
    air_separated BOOLEAN,
    light_foreign_matter_check BOOLEAN,
    
    -- Gas Flushing and Vacuum Sealing
    gas_flushing_check BOOLEAN,
    gas_flushing_operational BOOLEAN,
    vacuum_sealing_check BOOLEAN,
    vacuum_sealing_operational BOOLEAN,
    operator_check_sheet_completed BOOLEAN,
    
    -- Cold Container Temps
    cold_container_temps_check BOOLEAN,
    container_1_actual_celsius DECIMAL(5,2),
    container_1_spec_celsius VARCHAR(20),
    container_2_actual_celsius DECIMAL(5,2),
    container_2_spec_celsius VARCHAR(20),
    container_3_actual_celsius DECIMAL(5,2),
    container_3_spec_celsius VARCHAR(20),
    
    -- UV Lamp
    uv_lamp_check BOOLEAN,
    uv_lamp_operational BOOLEAN,
    blue_glow_visible BOOLEAN,
    
    -- General Observations
    general_observations TEXT,
    improvements_needed TEXT,
    actions_taken TEXT,
    
    -- Sign-off
    checked_by UUID REFERENCES users(id),
    signed_by UUID REFERENCES users(id),
    factory_manager_signature VARCHAR(255),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_gmp_checklists_date ON gmp_checklists(checklist_date DESC);
CREATE INDEX idx_gmp_checklists_checked_by ON gmp_checklists(checked_by);
```

### 9. batch_summary_documents
Summary document for completed batches
```sql
CREATE TABLE batch_summary_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id UUID REFERENCES production_batches(id) ON DELETE CASCADE,
    summary_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Cracking Summary
    cracking_time_hours DECIMAL(5,2),
    cracking_quantity_kg DECIMAL(10,2),
    cracking_wholes DECIMAL(10,2),
    cracking_uncracks DECIMAL(10,2),
    shell_waste_kg DECIMAL(10,2),
    
    -- Washing Summary
    washing_quantity_in_kg DECIMAL(10,2),
    washing_floater_quantity_kg DECIMAL(10,2),
    washing_sinker_quantity_kg DECIMAL(10,2),
    washing_total_quantity_kg DECIMAL(10,2),
    washing_waste_kg DECIMAL(10,2),
    
    -- Sorting Summary
    sorting_floater_quantity_kg DECIMAL(10,2),
    sound_kernel_quantity_kg DECIMAL(10,2),
    butter_kernel_quantity_kg DECIMAL(10,2),
    oil_waste_kg DECIMAL(10,2),
    compost_waste_kg DECIMAL(10,2),
    
    -- Packing Summary (by style)
    packing_sp_kg DECIMAL(10,2),
    packing_0_kg DECIMAL(10,2),
    packing_1_kg DECIMAL(10,2),
    packing_1s_kg DECIMAL(10,2),
    packing_4l_kg DECIMAL(10,2),
    packing_5_kg DECIMAL(10,2),
    packing_6_kg DECIMAL(10,2),
    packing_7_8_kg DECIMAL(10,2),
    packing_butter_kg DECIMAL(10,2),
    packing_total_kg DECIMAL(10,2),
    
    -- Overall Mass Balance
    total_input_kg DECIMAL(10,2),
    total_output_kg DECIMAL(10,2),
    total_waste_kg DECIMAL(10,2),
    mass_balance_percentage DECIMAL(5,2),
    
    -- Document Management
    document_url VARCHAR(500),
    generated_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    generated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_batch_summary_batch ON batch_summary_documents(batch_id);
CREATE INDEX idx_batch_summary_number ON batch_summary_documents(summary_number);
```

---

## Frontend Implementation

### HTML Structure (Production Dashboard)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kernel Production - Macavation</title>
    <link rel="stylesheet" href="/css/main.css">
</head>
<body>
    <div class="app-container">
        <nav class="sidebar">
            <!-- Navigation component -->
        </nav>

        <main class="main-content">
            <header class="page-header">
                <h1>Kernel Production</h1>
                <div class="header-actions">
                    <button class="btn btn-secondary" onclick="productionManager.viewGMPChecklist()">
                        GMP Checklist
                    </button>
                    <button class="btn btn-primary" onclick="productionManager.startNewBatch()">
                        <span>➕</span> Start New Batch
                    </button>
                </div>
            </header>

            <!-- Production Pipeline Overview -->
            <section class="production-pipeline">
                <h2>Production Pipeline</h2>
                
                <div class="pipeline-stages">
                    <div class="stage-column" data-stage="receiving">
                        <div class="stage-header">
                            <h3>Receiving</h3>
                            <span class="batch-count" id="receivingCount">0</span>
                        </div>
                        <div class="stage-batches" id="receivingBatches">
                            <!-- Batches populated by JavaScript -->
                        </div>
                    </div>

                    <div class="stage-column" data-stage="cracking">
                        <div class="stage-header">
                            <h3>Cracking</h3>
                            <span class="batch-count" id="crackingCount">0</span>
                        </div>
                        <div class="stage-batches" id="crackingBatches"></div>
                    </div>

                    <div class="stage-column" data-stage="washing">
                        <div class="stage-header">
                            <h3>Washing</h3>
                            <span class="batch-count" id="washingCount">0</span>
                        </div>
                        <div class="stage-batches" id="washingBatches"></div>
                    </div>

                    <div class="stage-column" data-stage="drying">
                        <div class="stage-header">
                            <h3>Drying</h3>
                            <span class="batch-count" id="dryingCount">0</span>
                        </div>
                        <div class="stage-batches" id="dryingBatches"></div>
                    </div>

                    <div class="stage-column" data-stage="sorting">
                        <div class="stage-header">
                            <h3>Sorting</h3>
                            <span class="batch-count" id="sortingCount">0</span>
                        </div>
                        <div class="stage-batches" id="sortingBatches"></div>
                    </div>

                    <div class="stage-column" data-stage="packing">
                        <div class="stage-header">
                            <h3>Packing</h3>
                            <span class="batch-count" id="packingCount">0</span>
                        </div>
                        <div class="stage-batches" id="packingBatches"></div>
                    </div>

                    <div class="stage-column" data-stage="release">
                        <div class="stage-header">
                            <h3>Pending Release</h3>
                            <span class="batch-count" id="releaseCount">0</span>
                        </div>
                        <div class="stage-batches" id="releaseBatches"></div>
                    </div>

                    <div class="stage-column" data-stage="storage">
                        <div class="stage-header">
                            <h3>Cold Storage</h3>
                            <span class="batch-count" id="storageCount">0</span>
                        </div>
                        <div class="stage-batches" id="storageBatches"></div>
                    </div>
                </div>
            </section>

            <!-- Active Batches Table -->
            <section class="active-batches-section">
                <h2>Active Batches</h2>
                
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Batch Number</th>
                            <th>Grower</th>
                            <th>Received</th>
                            <th>Weight (kg)</th>
                            <th>Current Step</th>
                            <th>Status</th>
                            <th>Progress</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="activeBatchesTable">
                        <!-- Populated by JavaScript -->
                    </tbody>
                </table>
            </section>
        </main>
    </div>

    <!-- Batch Detail Modal -->
    <div id="batchModal" class="modal">
        <div class="modal-content extra-large">
            <div class="modal-header">
                <h2 id="batchModalTitle">Batch Details</h2>
                <button class="modal-close" onclick="productionManager.closeBatchModal()">&times;</button>
            </div>

            <div class="modal-body">
                <!-- Batch Overview -->
                <div class="batch-overview">
                    <div class="overview-cards">
                        <div class="overview-card">
                            <div class="card-label">Batch Number</div>
                            <div class="card-value" id="batchNumber">-</div>
                        </div>
                        <div class="overview-card">
                            <div class="card-label">Grower</div>
                            <div class="card-value" id="batchGrowerName">-</div>
                        </div>
                        <div class="overview-card">
                            <div class="card-label">Weight Received</div>
                            <div class="card-value" id="batchWeight">-</div>
                        </div>
                        <div class="overview-card">
                            <div class="card-label">Current Step</div>
                            <div class="card-value" id="batchCurrentStep">-</div>
                        </div>
                    </div>
                </div>

                <!-- Production Steps Progress -->
                <div class="steps-progress">
                    <h3>Production Progress</h3>
                    <div class="steps-timeline" id="stepsTimeline">
                        <!-- Steps populated by JavaScript -->
                    </div>
                </div>

                <!-- Current Step Form -->
                <div id="currentStepForm" class="step-form">
                    <!-- Form content changes based on current step -->
                </div>
            </div>

            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="productionManager.closeBatchModal()">Close</button>
                <button class="btn btn-primary" onclick="productionManager.completeCurrentStep()">Complete Step</button>
            </div>
        </div>
    </div>

    <script src="/js/production.js"></script>
</body>
</html>
```

### JavaScript Implementation (production.js)

```javascript
class ProductionManager {
    constructor() {
        this.batches = [];
        this.currentBatch = null;
        this.currentStep = null;
        this.steps = [
            { number: 1, name: 'Receiving', status: 'receiving' },
            { number: 2, name: 'Cracking', status: 'cracking' },
            { number: 3, name: 'Washing', status: 'washing' },
            { number: 4, name: 'Sorting (Wet)', status: 'sorting_wet' },
            { number: 5, name: 'Drying', status: 'drying' },
            { number: 6, name: 'Cooling', status: 'cooling' },
            { number: 7, name: 'Sorting (Dry)', status: 'sorting_dry' },
            { number: 8, name: 'Butter Separation', status: 'butter_separation' },
            { number: 9, name: 'Inspection', status: 'inspection' },
            { number: 10, name: 'Packing', status: 'packing' },
            { number: 11, name: 'Metal Detection', status: 'metal_detection' },
            { number: 12, name: 'Weight Verification', status: 'weight_verification' },
            { number: 13, name: 'Sampling', status: 'sampling' },
            { number: 14, name: 'Positive Release', status: 'pending_release' },
            { number: 15, name: 'Cold Storage', status: 'cold_storage' },
            { number: 16, name: 'Order Picking', status: 'order_picking' },
            { number: 17, name: 'Dispatch', status: 'completed' }
        ];
        this.init();
    }

    async init() {
        await this.loadActiveBatches();
        this.renderPipeline();
        this.renderBatchesTable();
        this.setupRefreshInterval();
    }

    async loadActiveBatches() {
        try {
            const { data, error } = await supabase
                .from('production_batches')
                .select(`
                    *,
                    supplier:contacts(company_name),
                    production_manager:users!production_manager_id(first_name, last_name)
                `)
                .neq('status', 'completed')
                .order('received_date', { ascending: false });

            if (error) throw error;

            this.batches = data;
        } catch (error) {
            console.error('Error loading batches:', error);
        }
    }

    renderPipeline() {
        // Clear all stage columns
        this.steps.forEach(step => {
            const container = document.getElementById(`${step.status}Batches`);
            if (container) container.innerHTML = '';
        });

        // Group batches by status
        const batchesByStatus = {};
        this.batches.forEach(batch => {
            if (!batchesByStatus[batch.status]) {
                batchesByStatus[batch.status] = [];
            }
            batchesByStatus[batch.status].push(batch);
        });

        // Render batches in appropriate columns
        Object.keys(batchesByStatus).forEach(status => {
            const container = document.getElementById(`${status}Batches`);
            const count = document.getElementById(`${status}Count`);
            
            if (container && count) {
                count.textContent = batchesByStatus[status].length;
                
                batchesByStatus[status].forEach(batch => {
                    const batchCard = this.createBatchCard(batch);
                    container.appendChild(batchCard);
                });
            }
        });
    }

    createBatchCard(batch) {
        const card = document.createElement('div');
        card.className = 'batch-card';
        card.onclick = () => this.viewBatch(batch.id);
        
        const daysSinceReceived = Math.floor((new Date() - new Date(batch.received_date)) / (1000 * 60 * 60 * 24));
        const urgencyClass = daysSinceReceived > 7 ? 'urgent' : daysSinceReceived > 3 ? 'warning' : '';
        
        card.innerHTML = `
            <div class="batch-card-header ${urgencyClass}">
                <strong>${batch.batch_number}</strong>
                ${batch.quality_hold ? '<span class="hold-badge">HOLD</span>' : ''}
            </div>
            <div class="batch-card-body">
                <div class="batch-grower">${batch.grower_name}</div>
                <div class="batch-weight">${batch.wet_nis_received_kg.toFixed(0)} kg</div>
                <div class="batch-days">${daysSinceReceived} days</div>
            </div>
        `;
        
        return card;
    }

    renderBatchesTable() {
        const tbody = document.getElementById('activeBatchesTable');
        tbody.innerHTML = '';

        this.batches.forEach(batch => {
            const row = tbody.insertRow();
            const stepInfo = this.steps.find(s => s.number === batch.current_step);
            const progress = (batch.current_step / this.steps.length) * 100;
            
            row.innerHTML = `
                <td><strong>${batch.batch_number}</strong></td>
                <td>${batch.grower_name}</td>
                <td>${new Date(batch.received_date).toLocaleDateString()}</td>
                <td>${batch.wet_nis_received_kg.toFixed(0)}</td>
                <td>Step ${batch.current_step}: ${stepInfo ? stepInfo.name : '-'}</td>
                <td><span class="badge badge-${batch.status}">${batch.status.replace('_', ' ')}</span></td>
                <td>
                    <div class="progress-bar-mini">
                        <div class="progress-fill-mini" style="width: ${progress}%"></div>
                    </div>
                    <small>${progress.toFixed(0)}%</small>
                </td>
                <td>
                    <button class="btn-icon" onclick="productionManager.viewBatch('${batch.id}')" title="View">👁️</button>
                    <button class="btn-icon" onclick="productionManager.advanceBatch('${batch.id}')" title="Next Step">▶️</button>
                </td>
            `;
        });
    }

    async viewBatch(batchId) {
        try {
            const { data, error } = await supabase
                .from('production_batches')
                .select(`
                    *,
                    supplier:contacts(*),
                    batch_step_records(*)
                `)
                .eq('id', batchId)
                .single();

            if (error) throw error;

            this.currentBatch = data;
            this.showBatchModal();
        } catch (error) {
            console.error('Error loading batch details:', error);
        }
    }

    showBatchModal() {
        if (!this.currentBatch) return;

        // Populate batch overview
        document.getElementById('batchNumber').textContent = this.currentBatch.batch_number;
        document.getElementById('batchGrowerName').textContent = this.currentBatch.grower_name;
        document.getElementById('batchWeight').textContent = `${this.currentBatch.wet_nis_received_kg.toFixed(0)} kg`;
        
        const stepInfo = this.steps.find(s => s.number === this.currentBatch.current_step);
        document.getElementById('batchCurrentStep').textContent = stepInfo ? stepInfo.name : '-';

        // Render steps timeline
        this.renderStepsTimeline();

        // Load current step form
        this.loadStepForm(this.currentBatch.current_step);

        // Show modal
        document.getElementById('batchModal').style.display = 'flex';
    }

    renderStepsTimeline() {
        const timeline = document.getElementById('stepsTimeline');
        timeline.innerHTML = '';

        this.steps.forEach(step => {
            const stepDiv = document.createElement('div');
            stepDiv.className = 'timeline-step';
            
            if (step.number < this.currentBatch.current_step) {
                stepDiv.classList.add('completed');
            } else if (step.number === this.currentBatch.current_step) {
                stepDiv.classList.add('active');
            } else {
                stepDiv.classList.add('pending');
            }

            const stepRecord = this.currentBatch.batch_step_records?.find(r => r.step_number === step.number);

            stepDiv.innerHTML = `
                <div class="step-number">${step.number}</div>
                <div class="step-info">
                    <div class="step-name">${step.name}</div>
                    ${stepRecord ? `<div class="step-time">${this.formatDuration(stepRecord.duration_minutes)}</div>` : ''}
                </div>
            `;

            timeline.appendChild(stepDiv);
        });
    }

    loadStepForm(stepNumber) {
        const formContainer = document.getElementById('currentStepForm');
        
        // Load appropriate form based on step number
        switch(stepNumber) {
            case 2: // Cracking
                this.renderCrackingForm(formContainer);
                break;
            case 3: // Washing
                this.renderWashingForm(formContainer);
                break;
            case 7: // Sorting
                this.renderSortingForm(formContainer);
                break;
            case 10: // Packing
                this.renderPackingForm(formContainer);
                break;
            default:
                this.renderGenericStepForm(formContainer, stepNumber);
        }
    }

    renderCrackingForm(container) {
        container.innerHTML = `
            <h3>Cracking Step</h3>
            <form id="crackingStepForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Start Time</label>
                        <input type="time" id="crackingStartTime" required>
                    </div>
                    <div class="form-group">
                        <label>End Time</label>
                        <input type="time" id="crackingEndTime" required>
                    </div>
                    <div class="form-group">
                        <label>Time Spent (hours)</label>
                        <input type="number" id="crackingTimeSpent" step="0.1" readonly>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Start Quantity (kg)</label>
                        <input type="number" id="crackingStartQuantity" step="0.01" required>
                    </div>
                    <div class="form-group">
                        <label>End Quantity (kg)</label>
                        <input type="number" id="crackingEndQuantity" step="0.01" required>
                    </div>
                    <div class="form-group">
                        <label>Silo Quantity (kg)</label>
                        <input type="number" id="crackingSiloQuantity" step="0.01">
                    </div>
                </div>

                <h4>Minute Tests</h4>
                <div class="minute-tests">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Test 1 Time</label>
                            <input type="time" id="minuteTest1Time">
                        </div>
                        <div class="form-group">
                            <label>Wholes</label>
                            <input type="number" id="minuteTest1Wholes" step="0.01">
                        </div>
                        <div class="form-group">
                            <label>Uncracks</label>
                            <input type="number" id="minuteTest1Uncracks" step="0.01">
                        </div>
                    </div>
                    <!-- Similar rows for Test 2 and Test 3 -->
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Shell Waste Bags</label>
                        <input type="number" id="shellWasteBags">
                    </div>
                    <div class="form-group">
                        <label>Total Shell Waste (kg)</label>
                        <input type="number" id="totalShellWaste" step="0.01">
                    </div>
                </div>
            </form>
        `;

        // Set up time calculation
        const startTime = document.getElementById('crackingStartTime');
        const endTime = document.getElementById('crackingEndTime');
        const timeSpent = document.getElementById('crackingTimeSpent');

        const calculateTime = () => {
            if (startTime.value && endTime.value) {
                const start = new Date(`2000-01-01 ${startTime.value}`);
                const end = new Date(`2000-01-01 ${endTime.value}`);
                const hours = (end - start) / (1000 * 60 * 60);
                timeSpent.value = hours.toFixed(2);
            }
        };

        startTime.addEventListener('change', calculateTime);
        endTime.addEventListener('change', calculateTime);
    }

    renderGenericStepForm(container, stepNumber) {
        const stepInfo = this.steps.find(s => s.number === stepNumber);
        
        container.innerHTML = `
            <h3>${stepInfo.name}</h3>
            <form id="genericStepForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Start Time</label>
                        <input type="datetime-local" id="stepStartTime" required>
                    </div>
                    <div class="form-group">
                        <label>End Time</label>
                        <input type="datetime-local" id="stepEndTime" required>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Input Quantity (kg)</label>
                        <input type="number" id="stepInputQuantity" step="0.01">
                    </div>
                    <div class="form-group">
                        <label>Output Quantity (kg)</label>
                        <input type="number" id="stepOutputQuantity" step="0.01">
                    </div>
                    <div class="form-group">
                        <label>Waste Quantity (kg)</label>
                        <input type="number" id="stepWasteQuantity" step="0.01">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group full-width">
                        <label>Notes</label>
                        <textarea id="stepNotes" rows="3"></textarea>
                    </div>
                </div>
            </form>
        `;
    }

    async completeCurrentStep() {
        if (!this.currentBatch) return;

        try {
            // Get form data based on current step
            const stepData = this.getStepFormData(this.currentBatch.current_step);

            // Calculate duration
            const startTime = new Date(stepData.start_time);
            const endTime = new Date(stepData.end_time);
            const durationMinutes = (endTime - startTime) / (1000 * 60);

            // Create batch step record
            const stepRecord = {
                batch_id: this.currentBatch.id,
                step_number: this.currentBatch.current_step,
                step_name: this.steps.find(s => s.number === this.currentBatch.current_step).name,
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                duration_minutes: Math.round(durationMinutes),
                operator_id: window.authManager.currentUser.id,
                status: 'completed',
                input_quantity_kg: stepData.input_quantity_kg,
                output_quantity_kg: stepData.output_quantity_kg,
                waste_quantity_kg: stepData.waste_quantity_kg,
                step_data: stepData.additional_data,
                notes: stepData.notes
            };

            const { error: stepError } = await supabase
                .from('batch_step_records')
                .insert(stepRecord);

            if (stepError) throw stepError;

            // Update batch to next step
            const nextStep = this.currentBatch.current_step + 1;
            const nextStepInfo = this.steps.find(s => s.number === nextStep);

            const { error: batchError } = await supabase
                .from('production_batches')
                .update({
                    current_step: nextStep,
                    status: nextStepInfo ? nextStepInfo.status : 'completed',
                    updated_at: new Date().toISOString()
                })
                .eq('id', this.currentBatch.id);

            if (batchError) throw batchError;

            // Create audit log
            await this.createAuditLog('complete_step', this.currentBatch.id);

            alert('Step completed successfully');
            this.closeBatchModal();
            await this.loadActiveBatches();
            this.renderPipeline();
            this.renderBatchesTable();
        } catch (error) {
            console.error('Error completing step:', error);
            alert('Failed to complete step: ' + error.message);
        }
    }

    getStepFormData(stepNumber) {
        // Extract form data based on step number
        // This is a simplified version - actual implementation would be more detailed
        return {
            start_time: document.getElementById('stepStartTime')?.value || new Date().toISOString(),
            end_time: document.getElementById('stepEndTime')?.value || new Date().toISOString(),
            input_quantity_kg: parseFloat(document.getElementById('stepInputQuantity')?.value) || null,
            output_quantity_kg: parseFloat(document.getElementById('stepOutputQuantity')?.value) || null,
            waste_quantity_kg: parseFloat(document.getElementById('stepWasteQuantity')?.value) || null,
            notes: document.getElementById('stepNotes')?.value || null,
            additional_data: {} // Step-specific data
        };
    }

    closeBatchModal() {
        document.getElementById('batchModal').style.display = 'none';
        this.currentBatch = null;
    }

    formatDuration(minutes) {
        if (!minutes) return '-';
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    }

    setupRefreshInterval() {
        // Refresh data every 2 minutes
        setInterval(async () => {
            await this.loadActiveBatches();
            this.renderPipeline();
            this.renderBatchesTable();
        }, 120000);
    }

    async createAuditLog(action, batchId) {
        try {
            await supabase
                .from('audit_log')
                .insert({
                    user_id: window.authManager.currentUser.id,
                    action: action,
                    entity_type: 'production_batches',
                    entity_id: batchId
                });
        } catch (error) {
            console.error('Error creating audit log:', error);
        }
    }

    async startNewBatch() {
        window.location.href = '/production/new-batch';
    }

    async viewGMPChecklist() {
        window.location.href = '/production/gmp-checklist';
    }

    async advanceBatch(batchId) {
        await this.viewBatch(batchId);
    }
}

// Initialize Production Manager
const productionManager = new ProductionManager();
```

---

## Business Rules

### Production Workflow Rules

1. **Sequential Processing**
   - Steps must be completed in order (1-17)
   - Cannot skip steps
   - Previous step must be marked complete before next step begins
   - Exception: Steps can be marked as "skipped" with supervisor approval

2. **Batch Sizing**
   - Minimum batch size: 500 kg wet NIS
   - Maximum batch size: 5,000 kg wet NIS
   - Large batches (>3,000 kg) may be split for processing

3. **Time Limits**
   - Cracking: Must begin within 48 hours of receiving
   - Washing: Must follow cracking within 4 hours
   - Drying: Maximum drying time 48 hours
   - Total cycle time target: 7 days from receiving to release

4. **Hold Procedures**
   - Quality hold stops all processing
   - Batch segregated pending investigation
   - Supervisor approval required to release hold
   - Hold reason documented

### Step-Specific Rules

#### Step 1: Receiving
- Match to main run document
- Verify supplier and batch number
- Check vehicle cleanliness
- Collect sample for verification
- Initial moisture check
- Create production batch record

#### Step 2: Cracking
- Adjust cracker settings for nut size
- Perform minute tests every hour
- Target: <2% wholes, <5% uncracks
- Shell waste weighed and recorded
- Equipment cleaned between batches

#### Step 3: Washing
- Peracetic acid concentration: 500ppm
- Test sanitizer 3 times per shift (07h00, lunch, end of shift)
- Failed test requires immediate corrective action
- Separate floaters and sinkers
- Record waste (salt & pepper, shell fines, compost)

#### Step 4-5: Drying
- Target moisture: <2%
- Monitor temperature: 60-70°C
- Daily moisture checks recorded
- Cooling required before sorting

#### Step 6-7: Sorting
- Sort by style: SP, 0, 1, 1S, 4L, 5, 6, 7/8
- Visual inspection for quality
- Butter grade separated (floaters vs sinkers)
- Record quantities by style

#### Step 10: Packing
- Pack by style into cartons
- Label with batch number, style, date, best before
- Record carton count and weight
- Best before date: 18 months from packing for conventional, 24 months for gas-flushed

#### Step 11: Metal Detection
- All cartons must pass metal detector
- Daily calibration checks
- Ferrous: <1.5mm, Non-ferrous: <2.0mm, Stainless: <1.5mm
- Failed cartons re-inspected and repacked

#### Step 12: Weight Verification
- Verify carton weights against declared weight
- Tolerance: ±10g per carton
- Out-of-spec cartons repacked

#### Step 13: Batch Sampling
- Collect samples from each style
- QA testing: moisture, FFA, peroxide, visual
- Samples retained for 2 years

#### Step 14: Positive Release
- QA approval required
- All testing complete and passed
- Documentation complete
- Batch released for dispatch

#### Step 15: Cold Storage
- Temperature: 6-8°C
- First-in-first-out (FIFO)
- Regular temperature monitoring
- Maximum storage: 12 months

### Mass Balance Rules

1. **Tracking Requirements**
   - Input weight recorded at each step
   - Output weight recorded at each step
   - Waste weight recorded at each step
   - Mass balance calculated: (Output + Waste) / Input

2. **Acceptable Variance**
   - Overall mass balance: 95-105%
   - Variances >5% require investigation
   - Document cause of variance
   - Adjust procedures if pattern identified

3. **Reconciliation**
   - Daily reconciliation for active batches
   - Weekly reconciliation report
   - Monthly variance analysis

### Quality Hold Rules

1. **Automatic Hold Triggers**
   - Failed peracetic acid test
   - Moisture >2% at packing
   - FFA >0.15%
   - Foreign material detected
   - Customer complaint

2. **Hold Process**
   - Immediate stop of processing
   - QA Supervisor notified
   - Batch segregated and labeled
   - Investigation initiated
   - Root cause analysis

3. **Release from Hold**
   - Requires QA Supervisor approval
   - May require rework
   - May require downgrade
   - May require disposal
   - Document corrective actions

---

## Testing Checklist

- [ ] Create new production batch
- [ ] Complete Step 1: Receiving
- [ ] Complete Step 2: Cracking with minute tests
- [ ] Complete Step 3: Washing with peracetic tests
- [ ] Record daily moisture readings
- [ ] Complete sorting steps
- [ ] Record packing by style
- [ ] Verify metal detection pass
- [ ] Complete weight verification
- [ ] Request positive release
- [ ] Approve positive release (QA)
- [ ] Place batch on quality hold
- [ ] Release batch from hold
- [ ] View batch in production pipeline
- [ ] Generate batch summary document
- [ ] Calculate mass balance
- [ ] Complete GMP checklist
- [ ] View production reports

---

## Future Enhancements

1. **Real-Time Equipment Monitoring**
   - IoT sensors on equipment
   - Automatic data capture
   - Predictive maintenance alerts

2. **Mobile Data Entry**
   - Tablet-based step completion
   - Barcode scanning
   - Photo capture integration

3. **AI-Based Quality Control**
   - Computer vision for sorting
   - Automated defect detection
   - Predictive quality scoring

4. **Advanced Scheduling**
   - Optimal batch sequencing
   - Resource allocation
   - Bottleneck identification
