# Grower/Supplier Intake Module

## Overview
Manages the intake process for macadamia nuts in shell (NIS) from growers/suppliers, including sample submission, quality testing, approval/rejection workflow, and main run document generation.

---

## Database Entities

### 1. sample_submissions
Initial sample submissions from growers
```sql
CREATE TABLE sample_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Supplier Information
    supplier_id UUID REFERENCES contacts(id),
    grower_name VARCHAR(255) NOT NULL,
    delivery_date DATE NOT NULL,
    
    -- Sample Details
    batch_number VARCHAR(100),
    wet_nut_in_shell_kg DECIMAL(10,2) NOT NULL,
    moisture_content_percentage DECIMAL(5,2) NOT NULL,
    
    -- Sample Crack-Out Results
    sound_kernel_weight_kg DECIMAL(10,3),
    unsound_kernel_weight_kg DECIMAL(10,3),
    shell_weight_kg DECIMAL(10,3),
    total_sample_weight_kg DECIMAL(10,3),
    
    -- Float Test Results
    floating_kernel_wet_kg DECIMAL(10,3),
    sinking_kernel_wet_kg DECIMAL(10,3),
    total_wet_kg DECIMAL(10,3),
    
    -- Unsound Kernel Breakdown
    germination_weight_g DECIMAL(10,2),
    late_stinkbug_weight_g DECIMAL(10,2),
    early_stinkbug_weight_g DECIMAL(10,2),
    dark_centre_weight_g DECIMAL(10,2),
    mould_weight_g DECIMAL(10,2),
    rotten_weight_g DECIMAL(10,2),
    immature_split_weight_g DECIMAL(10,2),
    shrivelled_weight_g DECIMAL(10,2),
    nut_borer_weight_g DECIMAL(10,2),
    total_unsound_weight_g DECIMAL(10,2),
    
    -- Quality Testing
    ffa_percentage DECIMAL(5,2),
    peroxide_value DECIMAL(10,2),
    taste_test_result VARCHAR(50),
    organoleptic_test_result VARCHAR(50),
    visual_inspection_notes TEXT,
    
    -- Status and Approval
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'testing', 'approved', 'rejected', 'main_run_issued')),
    approval_date TIMESTAMP WITH TIME ZONE,
    approved_by UUID REFERENCES users(id),
    rejection_reason TEXT,
    
    -- Document References
    submission_form_url VARCHAR(500),
    incoming_checklist_url VARCHAR(500),
    main_run_document_id UUID,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_sample_submissions_number ON sample_submissions(submission_number);
CREATE INDEX idx_sample_submissions_supplier ON sample_submissions(supplier_id);
CREATE INDEX idx_sample_submissions_status ON sample_submissions(status);
CREATE INDEX idx_sample_submissions_date ON sample_submissions(delivery_date DESC);
CREATE INDEX idx_sample_submissions_batch ON sample_submissions(batch_number);
```

### 2. main_run_documents
Main run authorization documents issued after sample approval
```sql
CREATE TABLE main_run_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_number VARCHAR(50) UNIQUE NOT NULL,
    sample_submission_id UUID REFERENCES sample_submissions(id),
    
    -- Supplier Information
    supplier_id UUID REFERENCES contacts(id),
    supplier_code VARCHAR(50),
    
    -- Delivery Authorization
    authorized_delivery_date DATE,
    estimated_quantity_kg DECIMAL(12,2),
    
    -- Quality Requirements
    max_moisture_percentage DECIMAL(5,2) DEFAULT 20.0,
    min_sound_kernel_percentage DECIMAL(5,2),
    max_ffa_percentage DECIMAL(5,2),
    
    -- Estimated Payment
    estimated_kernel_recovery_percentage DECIMAL(5,2),
    estimated_kernel_kg DECIMAL(10,2),
    price_per_kg DECIMAL(10,2),
    estimated_payment_amount DECIMAL(15,2),
    
    -- Terms and Conditions
    payment_terms TEXT,
    quality_specifications TEXT,
    delivery_instructions TEXT,
    special_notes TEXT,
    
    -- Status
    status VARCHAR(20) DEFAULT 'issued' CHECK (status IN ('issued', 'accepted', 'delivered', 'completed', 'cancelled')),
    
    -- Document Management
    document_url VARCHAR(500),
    sent_date TIMESTAMP WITH TIME ZONE,
    sent_to_email VARCHAR(255),
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    issued_by UUID REFERENCES users(id)
);

CREATE INDEX idx_main_run_documents_number ON main_run_documents(document_number);
CREATE INDEX idx_main_run_documents_sample ON main_run_documents(sample_submission_id);
CREATE INDEX idx_main_run_documents_supplier ON main_run_documents(supplier_id);
CREATE INDEX idx_main_run_documents_status ON main_run_documents(status);
CREATE INDEX idx_main_run_documents_delivery_date ON main_run_documents(authorized_delivery_date);
```

### 3. incoming_receiving_checklists
Quality checks performed at receiving
```sql
CREATE TABLE incoming_receiving_checklists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    checklist_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Related Records
    sample_submission_id UUID REFERENCES sample_submissions(id),
    main_run_document_id UUID REFERENCES main_run_documents(id),
    
    -- Receiving Details
    received_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    supplier_id UUID REFERENCES contacts(id),
    batch_number VARCHAR(100),
    
    -- Vehicle and Cleanliness Checks
    vehicle_registration VARCHAR(50),
    vehicle_cleanliness_check BOOLEAN,
    vehicle_condition VARCHAR(100),
    vehicle_temperature_celsius DECIMAL(5,2),
    
    -- Load Inspection
    load_condition VARCHAR(100),
    visible_contamination BOOLEAN,
    contamination_details TEXT,
    insect_presence BOOLEAN,
    insect_details TEXT,
    mould_visible BOOLEAN,
    mould_details TEXT,
    
    -- Quantity Verification
    declared_weight_kg DECIMAL(12,2),
    actual_weight_kg DECIMAL(12,2),
    weight_variance_kg DECIMAL(12,2),
    
    -- Initial Quality Checks
    moisture_content_percentage DECIMAL(5,2),
    ffa_percentage DECIMAL(5,2),
    temperature_celsius DECIMAL(5,2),
    
    -- Sample Collection
    sample_collected BOOLEAN DEFAULT true,
    sample_reference VARCHAR(100),
    
    -- Acceptance Decision
    accepted BOOLEAN,
    rejection_reason TEXT,
    conditional_acceptance BOOLEAN,
    conditions TEXT,
    
    -- Personnel
    received_by UUID REFERENCES users(id),
    inspected_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    -- Photos/Documents
    photo_urls TEXT[],
    document_urls TEXT[],
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_incoming_receiving_supplier ON incoming_receiving_checklists(supplier_id);
CREATE INDEX idx_incoming_receiving_date ON incoming_receiving_checklists(received_date DESC);
CREATE INDEX idx_incoming_receiving_batch ON incoming_receiving_checklists(batch_number);
CREATE INDEX idx_incoming_receiving_sample ON incoming_receiving_checklists(sample_submission_id);
```

### 4. grower_payments
Payment calculations and records for growers
```sql
CREATE TABLE grower_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Related Records
    supplier_id UUID REFERENCES contacts(id),
    main_run_document_id UUID REFERENCES main_run_documents(id),
    batch_id UUID, -- Links to production batch after processing
    
    -- Weight Details
    wet_nut_delivered_kg DECIMAL(12,2),
    kernel_recovered_kg DECIMAL(10,2),
    kernel_recovery_percentage DECIMAL(5,2),
    
    -- Quality Deductions
    moisture_deduction_percentage DECIMAL(5,2),
    unsound_deduction_percentage DECIMAL(5,2),
    quality_deduction_amount DECIMAL(12,2),
    
    -- Pricing
    base_price_per_kg DECIMAL(10,2),
    quality_adjustment DECIMAL(10,2),
    final_price_per_kg DECIMAL(10,2),
    
    -- Payment Calculation
    gross_amount DECIMAL(15,2),
    deductions_amount DECIMAL(15,2),
    net_amount DECIMAL(15,2),
    vat_amount DECIMAL(15,2),
    total_payment_amount DECIMAL(15,2),
    
    -- Payment Status
    status VARCHAR(20) DEFAULT 'calculated' CHECK (status IN ('calculated', 'approved', 'paid', 'disputed')),
    payment_date DATE,
    payment_reference VARCHAR(100),
    payment_method VARCHAR(50),
    
    -- Palladium Integration
    synced_to_palladium BOOLEAN DEFAULT false,
    palladium_transaction_id VARCHAR(100),
    sync_date TIMESTAMP WITH TIME ZONE,
    
    -- Invoice Details
    invoice_number VARCHAR(50),
    invoice_date DATE,
    invoice_received BOOLEAN DEFAULT false,
    
    -- Audit
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    calculated_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by UUID REFERENCES users(id),
    paid_at TIMESTAMP WITH TIME ZONE,
    paid_by UUID REFERENCES users(id)
);

CREATE INDEX idx_grower_payments_number ON grower_payments(payment_number);
CREATE INDEX idx_grower_payments_supplier ON grower_payments(supplier_id);
CREATE INDEX idx_grower_payments_status ON grower_payments(status);
CREATE INDEX idx_grower_payments_batch ON grower_payments(batch_id);
CREATE INDEX idx_grower_payments_date ON grower_payments(payment_date DESC);
```

---

## Frontend Implementation

### HTML Structure (Sample Submission Form)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sample Submission - Macavation</title>
    <link rel="stylesheet" href="/css/main.css">
</head>
<body>
    <div class="app-container">
        <nav class="sidebar">
            <!-- Navigation component -->
        </nav>

        <main class="main-content">
            <header class="page-header">
                <h1>Grower Sample Submission</h1>
                <div class="header-actions">
                    <button class="btn btn-secondary" onclick="intakeManager.viewSubmissions()">
                        View All Submissions
                    </button>
                    <button class="btn btn-primary" onclick="intakeManager.newSubmission()">
                        <span>➕</span> New Sample Submission
                    </button>
                </div>
            </header>

            <!-- Sample Submission Form -->
            <div class="form-container">
                <form id="sampleSubmissionForm">
                    <input type="hidden" id="submissionId">

                    <!-- Supplier Information -->
                    <section class="form-section">
                        <h2>Supplier Information</h2>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Supplier/Grower *</label>
                                <select id="supplierId" required onchange="intakeManager.loadSupplierDetails()">
                                    <option value="">Select Supplier</option>
                                    <!-- Populated by JavaScript -->
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Grower Name *</label>
                                <input type="text" id="growerName" required>
                            </div>

                            <div class="form-group">
                                <label>Delivery Date *</label>
                                <input type="date" id="deliveryDate" required>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Batch Number</label>
                                <input type="text" id="batchNumber">
                            </div>
                        </div>
                    </section>

                    <!-- Batch Information -->
                    <section class="form-section">
                        <h2>Batch Information</h2>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Wet Nut in Shell (kg) *</label>
                                <input type="number" id="wetNutInShellKg" step="0.01" required 
                                       onchange="intakeManager.calculateTotals()">
                            </div>

                            <div class="form-group">
                                <label>Moisture Content (%) *</label>
                                <input type="number" id="moistureContentPercentage" step="0.01" required 
                                       min="0" max="100">
                            </div>
                        </div>
                    </section>

                    <!-- Sample Crack-Out -->
                    <section class="form-section">
                        <h2>Sample Crack-Out</h2>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Sound Kernel (Pre-Float Test) (kg)</label>
                                <input type="number" id="soundKernelWeight" step="0.001" 
                                       onchange="intakeManager.calculateCrackOut()">
                            </div>

                            <div class="form-group">
                                <label>Unsound Kernel (kg)</label>
                                <input type="number" id="unsoundKernelWeight" step="0.001" 
                                       onchange="intakeManager.calculateCrackOut()">
                            </div>

                            <div class="form-group">
                                <label>Shell (kg)</label>
                                <input type="number" id="shellWeight" step="0.001" 
                                       onchange="intakeManager.calculateCrackOut()">
                            </div>

                            <div class="form-group">
                                <label>Total (kg)</label>
                                <input type="number" id="totalSampleWeight" step="0.001" readonly>
                            </div>
                        </div>
                    </section>

                    <!-- Float Test -->
                    <section class="form-section">
                        <h2>Float Test</h2>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Floating Kernel (Wet) (kg)</label>
                                <input type="number" id="floatingKernelWet" step="0.001" 
                                       onchange="intakeManager.calculateFloatTest()">
                            </div>

                            <div class="form-group">
                                <label>Sinking Kernel (Wet) (kg)</label>
                                <input type="number" id="sinkingKernelWet" step="0.001" 
                                       onchange="intakeManager.calculateFloatTest()">
                            </div>

                            <div class="form-group">
                                <label>Total (Wet) (kg)</label>
                                <input type="number" id="totalWetWeight" step="0.001" readonly>
                            </div>
                        </div>
                    </section>

                    <!-- Unsound Kernel Breakdown -->
                    <section class="form-section">
                        <h2>Unsound Kernel Breakdown</h2>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>Germination (g)</label>
                                <input type="number" id="germinationWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>

                            <div class="form-group">
                                <label>Late Stinkbug (g)</label>
                                <input type="number" id="lateStinkbugWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>

                            <div class="form-group">
                                <label>Early Stinkbug (g)</label>
                                <input type="number" id="earlyStinkbugWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Dark Centre (g)</label>
                                <input type="number" id="darkCentreWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>

                            <div class="form-group">
                                <label>Mould (g)</label>
                                <input type="number" id="mouldWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>

                            <div class="form-group">
                                <label>Rotten (g)</label>
                                <input type="number" id="rottenWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Immature Split (g)</label>
                                <input type="number" id="immatureSplitWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>

                            <div class="form-group">
                                <label>Shrivelled (g)</label>
                                <input type="number" id="shrivelledWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>

                            <div class="form-group">
                                <label>Nut Borer (g)</label>
                                <input type="number" id="nutBorerWeight" step="0.01" 
                                       onchange="intakeManager.calculateUnsound()">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Total Unsound (g)</label>
                                <input type="number" id="totalUnsoundWeight" step="0.01" readonly>
                            </div>
                        </div>
                    </section>

                    <!-- Quality Testing -->
                    <section class="form-section">
                        <h2>Quality Testing</h2>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>FFA (%)</label>
                                <input type="number" id="ffaPercentage" step="0.01">
                            </div>

                            <div class="form-group">
                                <label>Peroxide Value</label>
                                <input type="number" id="peroxideValue" step="0.01">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Taste Test Result</label>
                                <select id="tasteTestResult">
                                    <option value="">Not Tested</option>
                                    <option value="pass">Pass</option>
                                    <option value="fail">Fail</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label>Organoleptic Test Result</label>
                                <select id="organolepticTestResult">
                                    <option value="">Not Tested</option>
                                    <option value="pass">Pass</option>
                                    <option value="fail">Fail</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group full-width">
                                <label>Visual Inspection Notes</label>
                                <textarea id="visualInspectionNotes" rows="3"></textarea>
                            </div>
                        </div>
                    </section>

                    <!-- Calculated Results -->
                    <section class="form-section results-section">
                        <h2>Calculated Results</h2>
                        
                        <div class="results-grid">
                            <div class="result-card">
                                <div class="result-label">Sound Kernel %</div>
                                <div class="result-value" id="soundKernelPercentage">0.00%</div>
                            </div>

                            <div class="result-card">
                                <div class="result-label">Unsound Kernel %</div>
                                <div class="result-value" id="unsoundKernelPercentage">0.00%</div>
                            </div>

                            <div class="result-card">
                                <div class="result-label">Shell %</div>
                                <div class="result-value" id="shellPercentage">0.00%</div>
                            </div>

                            <div class="result-card">
                                <div class="result-label">Float %</div>
                                <div class="result-value" id="floatPercentage">0.00%</div>
                            </div>

                            <div class="result-card">
                                <div class="result-label">Quality Grade</div>
                                <div class="result-value" id="qualityGrade">-</div>
                            </div>
                        </div>
                    </section>

                    <!-- Form Actions -->
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" onclick="intakeManager.cancel()">
                            Cancel
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="intakeManager.saveDraft()">
                            Save as Draft
                        </button>
                        <button type="submit" class="btn btn-primary">
                            Submit for Approval
                        </button>
                    </div>
                </form>
            </div>

            <!-- Approval/Rejection Section (for QA/Management) -->
            <div id="approvalSection" class="approval-section" style="display: none;">
                <h2>Quality Approval</h2>
                
                <div class="approval-actions">
                    <button class="btn btn-success" onclick="intakeManager.approveSubmission()">
                        ✓ Approve & Generate Main Run Document
                    </button>
                    <button class="btn btn-danger" onclick="intakeManager.rejectSubmission()">
                        ✗ Reject Sample
                    </button>
                </div>

                <div class="form-group">
                    <label>Rejection Reason (if rejecting)</label>
                    <textarea id="rejectionReason" rows="3"></textarea>
                </div>
            </div>
        </main>
    </div>

    <script src="/js/intake.js"></script>
</body>
</html>
```

### JavaScript Implementation (intake.js)

```javascript
class IntakeManager {
    constructor() {
        this.currentSubmission = null;
        this.suppliers = [];
        this.init();
    }

    async init() {
        await this.loadSuppliers();
        this.setupEventListeners();
    }

    async loadSuppliers() {
        try {
            const { data, error } = await supabase
                .from('contacts')
                .select('id, company_name, trading_name')
                .in('contact_type', ['supplier', 'both'])
                .eq('status', 'active')
                .order('company_name');

            if (error) throw error;

            this.suppliers = data;
            this.populateSupplierDropdown();
        } catch (error) {
            console.error('Error loading suppliers:', error);
        }
    }

    populateSupplierDropdown() {
        const select = document.getElementById('supplierId');
        select.innerHTML = '<option value="">Select Supplier</option>';
        
        this.suppliers.forEach(supplier => {
            const option = document.createElement('option');
            option.value = supplier.id;
            option.textContent = supplier.company_name;
            select.appendChild(option);
        });
    }

    setupEventListeners() {
        const form = document.getElementById('sampleSubmissionForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }

        // Set default date to today
        document.getElementById('deliveryDate').valueAsDate = new Date();
    }

    async loadSupplierDetails() {
        const supplierId = document.getElementById('supplierId').value;
        if (!supplierId) return;

        const supplier = this.suppliers.find(s => s.id === supplierId);
        if (supplier) {
            document.getElementById('growerName').value = supplier.company_name;
        }
    }

    calculateCrackOut() {
        const soundKernel = parseFloat(document.getElementById('soundKernelWeight').value) || 0;
        const unsoundKernel = parseFloat(document.getElementById('unsoundKernelWeight').value) || 0;
        const shell = parseFloat(document.getElementById('shellWeight').value) || 0;
        
        const total = soundKernel + unsoundKernel + shell;
        document.getElementById('totalSampleWeight').value = total.toFixed(3);

        // Calculate percentages
        if (total > 0) {
            const soundPercentage = (soundKernel / total) * 100;
            const unsoundPercentage = (unsoundKernel / total) * 100;
            const shellPercentage = (shell / total) * 100;

            document.getElementById('soundKernelPercentage').textContent = soundPercentage.toFixed(2) + '%';
            document.getElementById('unsoundKernelPercentage').textContent = unsoundPercentage.toFixed(2) + '%';
            document.getElementById('shellPercentage').textContent = shellPercentage.toFixed(2) + '%';

            this.calculateQualityGrade(soundPercentage, unsoundPercentage);
        }
    }

    calculateFloatTest() {
        const floating = parseFloat(document.getElementById('floatingKernelWet').value) || 0;
        const sinking = parseFloat(document.getElementById('sinkingKernelWet').value) || 0;
        
        const total = floating + sinking;
        document.getElementById('totalWetWeight').value = total.toFixed(3);

        if (total > 0) {
            const floatPercentage = (floating / total) * 100;
            document.getElementById('floatPercentage').textContent = floatPercentage.toFixed(2) + '%';
        }
    }

    calculateUnsound() {
        const fields = [
            'germinationWeight', 'lateStinkbugWeight', 'earlyStinkbugWeight',
            'darkCentreWeight', 'mouldWeight', 'rottenWeight',
            'immatureSplitWeight', 'shrivelledWeight', 'nutBorerWeight'
        ];

        let total = 0;
        fields.forEach(field => {
            const value = parseFloat(document.getElementById(field).value) || 0;
            total += value;
        });

        document.getElementById('totalUnsoundWeight').value = total.toFixed(2);
    }

    calculateQualityGrade(soundPercentage, unsoundPercentage) {
        let grade = 'Reject';

        if (soundPercentage >= 95 && unsoundPercentage <= 2) {
            grade = 'Premium';
        } else if (soundPercentage >= 90 && unsoundPercentage <= 5) {
            grade = 'Grade A';
        } else if (soundPercentage >= 85 && unsoundPercentage <= 10) {
            grade = 'Grade B';
        } else if (soundPercentage >= 80 && unsoundPercentage <= 15) {
            grade = 'Grade C';
        }

        document.getElementById('qualityGrade').textContent = grade;
        
        // Color code the grade
        const gradeElement = document.getElementById('qualityGrade');
        gradeElement.className = 'result-value grade-' + grade.toLowerCase().replace(' ', '-');
    }

    async handleSubmit(event) {
        event.preventDefault();

        const submissionData = this.getFormData();
        submissionData.status = 'testing';

        try {
            if (this.currentSubmission) {
                // Update existing submission
                const { error } = await supabase
                    .from('sample_submissions')
                    .update(submissionData)
                    .eq('id', this.currentSubmission.id);

                if (error) throw error;
            } else {
                // Create new submission
                submissionData.submission_number = await this.generateSubmissionNumber();
                
                const { data, error } = await supabase
                    .from('sample_submissions')
                    .insert(submissionData)
                    .select()
                    .single();

                if (error) throw error;

                this.currentSubmission = data;
            }

            // Create audit log
            await this.createAuditLog('submit_sample', this.currentSubmission.id);

            // Send notification to QA team
            await this.notifyQATeam(this.currentSubmission.id);

            alert('Sample submission saved successfully');
            window.location.href = '/intake/submissions';
        } catch (error) {
            console.error('Error saving submission:', error);
            alert('Failed to save submission: ' + error.message);
        }
    }

    async saveDraft() {
        const submissionData = this.getFormData();
        submissionData.status = 'pending';

        try {
            if (this.currentSubmission) {
                const { error } = await supabase
                    .from('sample_submissions')
                    .update(submissionData)
                    .eq('id', this.currentSubmission.id);

                if (error) throw error;
            } else {
                submissionData.submission_number = await this.generateSubmissionNumber();
                
                const { data, error } = await supabase
                    .from('sample_submissions')
                    .insert(submissionData)
                    .select()
                    .single();

                if (error) throw error;
                this.currentSubmission = data;
            }

            alert('Draft saved successfully');
        } catch (error) {
            console.error('Error saving draft:', error);
            alert('Failed to save draft');
        }
    }

    getFormData() {
        return {
            supplier_id: document.getElementById('supplierId').value || null,
            grower_name: document.getElementById('growerName').value,
            delivery_date: document.getElementById('deliveryDate').value,
            batch_number: document.getElementById('batchNumber').value || null,
            
            wet_nut_in_shell_kg: parseFloat(document.getElementById('wetNutInShellKg').value),
            moisture_content_percentage: parseFloat(document.getElementById('moistureContentPercentage').value),
            
            sound_kernel_weight_kg: parseFloat(document.getElementById('soundKernelWeight').value) || null,
            unsound_kernel_weight_kg: parseFloat(document.getElementById('unsoundKernelWeight').value) || null,
            shell_weight_kg: parseFloat(document.getElementById('shellWeight').value) || null,
            total_sample_weight_kg: parseFloat(document.getElementById('totalSampleWeight').value) || null,
            
            floating_kernel_wet_kg: parseFloat(document.getElementById('floatingKernelWet').value) || null,
            sinking_kernel_wet_kg: parseFloat(document.getElementById('sinkingKernelWet').value) || null,
            total_wet_kg: parseFloat(document.getElementById('totalWetWeight').value) || null,
            
            germination_weight_g: parseFloat(document.getElementById('germinationWeight').value) || null,
            late_stinkbug_weight_g: parseFloat(document.getElementById('lateStinkbugWeight').value) || null,
            early_stinkbug_weight_g: parseFloat(document.getElementById('earlyStinkbugWeight').value) || null,
            dark_centre_weight_g: parseFloat(document.getElementById('darkCentreWeight').value) || null,
            mould_weight_g: parseFloat(document.getElementById('mouldWeight').value) || null,
            rotten_weight_g: parseFloat(document.getElementById('rottenWeight').value) || null,
            immature_split_weight_g: parseFloat(document.getElementById('immatureSplitWeight').value) || null,
            shrivelled_weight_g: parseFloat(document.getElementById('shrivelledWeight').value) || null,
            nut_borer_weight_g: parseFloat(document.getElementById('nutBorerWeight').value) || null,
            total_unsound_weight_g: parseFloat(document.getElementById('totalUnsoundWeight').value) || null,
            
            ffa_percentage: parseFloat(document.getElementById('ffaPercentage').value) || null,
            peroxide_value: parseFloat(document.getElementById('peroxideValue').value) || null,
            taste_test_result: document.getElementById('tasteTestResult').value || null,
            organoleptic_test_result: document.getElementById('organolepticTestResult').value || null,
            visual_inspection_notes: document.getElementById('visualInspectionNotes').value || null,
            
            updated_at: new Date().toISOString(),
            updated_by: window.authManager.currentUser.id
        };
    }

    async generateSubmissionNumber() {
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        
        // Get last submission number for current month
        const { data, error } = await supabase
            .from('sample_submissions')
            .select('submission_number')
            .like('submission_number', `SS-${year}${month}%`)
            .order('submission_number', { ascending: false })
            .limit(1);

        let nextNumber = 1;
        if (data && data.length > 0) {
            const lastNumber = parseInt(data[0].submission_number.split('-')[2]);
            nextNumber = lastNumber + 1;
        }

        return `SS-${year}${month}-${String(nextNumber).padStart(5, '0')}`;
    }

    async approveSubmission() {
        if (!this.currentSubmission) return;

        if (!confirm('Are you sure you want to approve this sample? This will generate a main run document.')) {
            return;
        }

        try {
            // Update submission status
            const { error: updateError } = await supabase
                .from('sample_submissions')
                .update({
                    status: 'approved',
                    approval_date: new Date().toISOString(),
                    approved_by: window.authManager.currentUser.id
                })
                .eq('id', this.currentSubmission.id);

            if (updateError) throw updateError;

            // Generate main run document
            await this.generateMainRunDocument(this.currentSubmission.id);

            // Create audit log
            await this.createAuditLog('approve_sample', this.currentSubmission.id);

            // Send notification to supplier
            await this.notifySupplier(this.currentSubmission.supplier_id, 'approved');

            alert('Sample approved and main run document generated');
            window.location.reload();
        } catch (error) {
            console.error('Error approving submission:', error);
            alert('Failed to approve submission');
        }
    }

    async rejectSubmission() {
        if (!this.currentSubmission) return;

        const reason = document.getElementById('rejectionReason').value;
        if (!reason) {
            alert('Please provide a rejection reason');
            return;
        }

        if (!confirm('Are you sure you want to reject this sample?')) {
            return;
        }

        try {
            const { error } = await supabase
                .from('sample_submissions')
                .update({
                    status: 'rejected',
                    rejection_reason: reason,
                    approval_date: new Date().toISOString(),
                    approved_by: window.authManager.currentUser.id
                })
                .eq('id', this.currentSubmission.id);

            if (error) throw error;

            // Create audit log
            await this.createAuditLog('reject_sample', this.currentSubmission.id);

            // Send notification to supplier
            await this.notifySupplier(this.currentSubmission.supplier_id, 'rejected');

            alert('Sample rejected');
            window.location.reload();
        } catch (error) {
            console.error('Error rejecting submission:', error);
            alert('Failed to reject submission');
        }
    }

    async generateMainRunDocument(submissionId) {
        try {
            // Get submission details
            const { data: submission, error: fetchError } = await supabase
                .from('sample_submissions')
                .select('*, contacts(*)')
                .eq('id', submissionId)
                .single();

            if (fetchError) throw fetchError;

            // Calculate estimated values
            const estimatedRecovery = this.calculateEstimatedRecovery(submission);
            const estimatedKernelKg = submission.wet_nut_in_shell_kg * (estimatedRecovery / 100);
            const pricePerKg = await this.getCurrentPrice(submission.supplier_id);
            const estimatedPayment = estimatedKernelKg * pricePerKg;

            // Create main run document
            const mainRunData = {
                document_number: await this.generateMainRunNumber(),
                sample_submission_id: submissionId,
                supplier_id: submission.supplier_id,
                supplier_code: submission.contacts.registration_number,
                authorized_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days from now
                estimated_quantity_kg: submission.wet_nut_in_shell_kg,
                max_moisture_percentage: 20.0,
                min_sound_kernel_percentage: 80.0,
                max_ffa_percentage: 0.15,
                estimated_kernel_recovery_percentage: estimatedRecovery,
                estimated_kernel_kg: estimatedKernelKg,
                price_per_kg: pricePerKg,
                estimated_payment_amount: estimatedPayment,
                payment_terms: '30 days from receipt of invoice',
                status: 'issued',
                created_by: window.authManager.currentUser.id,
                issued_by: window.authManager.currentUser.id
            };

            const { data, error } = await supabase
                .from('main_run_documents')
                .insert(mainRunData)
                .select()
                .single();

            if (error) throw error;

            // Update submission with main run document reference
            await supabase
                .from('sample_submissions')
                .update({ 
                    main_run_document_id: data.id,
                    status: 'main_run_issued'
                })
                .eq('id', submissionId);

            // Generate PDF document
            await this.generateMainRunPDF(data.id);

            return data;
        } catch (error) {
            console.error('Error generating main run document:', error);
            throw error;
        }
    }

    calculateEstimatedRecovery(submission) {
        // Calculate based on crack-out results
        const soundPercentage = (submission.sound_kernel_weight_kg / submission.total_sample_weight_kg) * 100;
        const moistureAdjustment = Math.max(0, (submission.moisture_content_percentage - 10) * 0.5);
        
        return Math.max(0, soundPercentage - moistureAdjustment);
    }

    async getCurrentPrice(supplierId) {
        // In production, this would fetch from pricing table
        // For now, return a default price
        return 150.00; // ZAR per kg
    }

    async generateMainRunNumber() {
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        
        const { data, error } = await supabase
            .from('main_run_documents')
            .select('document_number')
            .like('document_number', `MRD-${year}${month}%`)
            .order('document_number', { ascending: false })
            .limit(1);

        let nextNumber = 1;
        if (data && data.length > 0) {
            const lastNumber = parseInt(data[0].document_number.split('-')[2]);
            nextNumber = lastNumber + 1;
        }

        return `MRD-${year}${month}-${String(nextNumber).padStart(5, '0')}`;
    }

    async generateMainRunPDF(mainRunDocId) {
        // Implementation would use a PDF generation library
        // For now, this is a placeholder
        console.log('Generating PDF for main run document:', mainRunDocId);
    }

    async notifyQATeam(submissionId) {
        // Send notification to QA team about new sample submission
        console.log('Notifying QA team about submission:', submissionId);
    }

    async notifySupplier(supplierId, status) {
        // Send notification to supplier about sample approval/rejection
        console.log('Notifying supplier:', supplierId, 'Status:', status);
    }

    async createAuditLog(action, entityId) {
        try {
            await supabase
                .from('audit_log')
                .insert({
                    user_id: window.authManager.currentUser.id,
                    action: action,
                    entity_type: 'sample_submissions',
                    entity_id: entityId
                });
        } catch (error) {
            console.error('Error creating audit log:', error);
        }
    }

    viewSubmissions() {
        window.location.href = '/intake/submissions';
    }

    newSubmission() {
        window.location.href = '/intake/new';
    }

    cancel() {
        if (confirm('Are you sure you want to cancel? Any unsaved changes will be lost.')) {
            window.location.href = '/intake/submissions';
        }
    }
}

// Initialize Intake Manager
const intakeManager = new IntakeManager();
```

---

## Business Rules

### Sample Submission Rules

1. **Sample Collection**
   - Minimum sample size: 1 kg wet nut in shell
   - Samples collected within 24 hours of delivery
   - Samples stored in controlled conditions (15-20°C)
   - Sample reference number assigned automatically

2. **Testing Requirements**
   - Moisture content measured within 4 hours of receipt
   - Float test performed on all samples
   - Crack-out performed on representative sample (min 0.5kg)
   - FFA and peroxide testing for samples >500kg batch

3. **Quality Acceptance Criteria**
   - Moisture content: ≤20% (deductions apply >10%)
   - Sound kernel: ≥80% minimum
   - Unsound kernel: ≤15% maximum
   - Mould presence: Automatic rejection
   - FFA: ≤0.15% for premium grade

4. **Sample Results Validity**
   - Test results valid for 7 days
   - Retest required if delivery delayed >7 days
   - Environmental conditions may affect results

### Main Run Document Rules

1. **Document Generation**
   - Automatically generated upon sample approval
   - Unique document number assigned (MRD-YYYYMM-NNNNN)
   - Valid for 30 days from issue date
   - Must specify authorized delivery date

2. **Estimated Payment Calculation**
   ```
   Kernel Recovery % = (Sound Kernel Weight / Total Sample Weight) * 100
   Moisture Adjustment = Max(0, (Moisture % - 10) * 0.5%)
   Net Recovery % = Kernel Recovery % - Moisture Adjustment
   
   Estimated Kernel Kg = Wet NIS Delivered * (Net Recovery % / 100)
   Estimated Payment = Estimated Kernel Kg * Price per Kg
   ```

3. **Pricing Rules**
   - Base price from current price list
   - Seasonal adjustments apply
   - Volume bonuses for deliveries >10,000kg
   - Quality premiums for sound kernel >95%
   - Moisture penalties for >15% moisture

4. **Document Approval**
   - Requires QA Supervisor approval
   - General Manager approval for >20,000kg batches
   - Special pricing requires Sales Executive approval

### Receiving Rules

1. **Pre-Delivery Requirements**
   - Valid main run document required
   - Delivery scheduled minimum 24 hours in advance
   - Delivery must occur within authorized date window
   - Vehicle cleanliness certificate required

2. **Receiving Inspection**
   - Visual inspection of vehicle cleanliness
   - Check for contamination, insects, mould
   - Verify batch matches main run document
   - Moisture check at receiving
   - Sample collection for quality verification

3. **Acceptance Criteria**
   - Batch matches main run document specifications
   - No visible contamination or insect presence
   - Moisture content within acceptable range (≤25%)
   - No mould visible
   - Vehicle in acceptable condition

4. **Conditional Acceptance**
   - Minor moisture variances (20-25%) may be accepted with deductions
   - Small contamination areas can be segregated
   - Requires Production Manager approval
   - Conditions documented in receiving checklist

5. **Rejection Criteria**
   - Moisture >25%
   - Significant mould presence
   - Heavy insect infestation
   - Severe contamination
   - Batch doesn't match main run document
   - Vehicle condition unacceptable

### Payment Calculation Rules

1. **Weight Reconciliation**
   ```
   Delivered Weight = Wet NIS Received (kg)
   Kernel Recovered = Actual Kernel from Processing (kg)
   Actual Recovery % = (Kernel Recovered / Delivered Weight) * 100
   ```

2. **Deduction Calculations**
   ```
   Moisture Deduction % = Max(0, (Moisture % - 10) * 2%)
   Unsound Deduction % = Max(0, Unsound % - 5%)
   Total Deduction % = Moisture Deduction % + Unsound Deduction %
   
   Payable Kernel = Kernel Recovered * (1 - Total Deduction % / 100)
   ```

3. **Payment Formula**
   ```
   Base Amount = Payable Kernel * Price per Kg
   Quality Adjustment = Apply premiums/penalties
   Gross Amount = Base Amount + Quality Adjustment
   Deductions = Transport fees, previous advances
   Net Amount = Gross Amount - Deductions
   VAT = Net Amount * 0.15
   Total Payment = Net Amount + VAT
   ```

4. **Payment Timing**
   - Payment processed within 7 days of batch completion
   - Requires supplier invoice
   - Payment via EFT to registered bank account
   - Payment reference includes batch and payment number

5. **Payment Approval**
   - Payments <R50,000: Office Administrator
   - Payments R50,000-R200,000: General Manager
   - Payments >R200,000: General Manager + Finance Director

### Quality Hold Rules

1. **Quality Hold Triggers**
   - FFA >0.15%
   - Peroxide value >2.0
   - Failed organoleptic test
   - Visual quality concerns
   - Customer complaint related to batch

2. **Hold Process**
   - Production immediately stopped
   - Batch segregated
   - QA Supervisor investigation
   - Root cause analysis required
   - Corrective action plan

3. **Hold Release**
   - Requires QA Supervisor approval
   - May require retest
   - May require rework
   - May result in grade downgrade
   - Documentation required for release

---

## Integration Points

### Palladium ERP Integration

1. **Supplier Master Sync**
   - Supplier codes synced from Palladium
   - Payment terms synced
   - Contact details updated bidirectionally

2. **Grower Payment Sync**
   - Payment calculations sent to Palladium
   - Creates purchase invoice in Palladium
   - Payment status updated from Palladium
   - Bank details validated

3. **Stock Receipt**
   - Main run delivery creates goods receipt in Palladium
   - Batch numbers synchronized
   - Weight reconciliation

### Production Module Integration

1. **Batch Creation**
   - Approved main runs create production batches
   - Sample results transferred to batch record
   - Main run document linked to batch

2. **Weight Reconciliation**
   - Actual vs. estimated kernel recovery tracked
   - Variance analysis automated
   - Payment adjustment triggers

### Document Management Integration

1. **Document Storage**
   - Sample submission forms stored
   - Main run documents archived
   - Receiving checklists filed
   - Photos and supporting documents linked

2. **Document Retrieval**
   - Quick access from batch records
   - Audit trail maintained
   - Version control for updated documents

---

## Reporting Requirements

### Standard Reports

1. **Daily Sample Log**
   - All samples received today
   - Testing status
   - Pending approvals

2. **Main Run Documents Outstanding**
   - Issued but not yet delivered
   - Expired documents
   - Approaching expiry

3. **Grower Payment Summary**
   - Payments pending approval
   - Payments pending processing
   - Payments processed this month
   - Payment reconciliation

4. **Quality Acceptance Rate**
   - Samples approved vs. rejected
   - Rejection reasons analysis
   - Supplier quality trends

5. **Supplier Performance Report**
   - Average quality metrics by supplier
   - Delivery compliance
   - Payment history

---

## Testing Checklist

- [ ] Create new sample submission
- [ ] Calculate crack-out percentages
- [ ] Calculate float test percentages
- [ ] Calculate unsound kernel breakdown
- [ ] Determine quality grade
- [ ] Save submission as draft
- [ ] Submit for approval
- [ ] Approve sample submission
- [ ] Generate main run document
- [ ] Reject sample submission
- [ ] Create incoming receiving checklist
- [ ] Accept delivery with conditions
- [ ] Reject delivery
- [ ] Calculate grower payment
- [ ] Apply moisture deductions
- [ ] Apply unsound deductions
- [ ] Approve payment
- [ ] Sync payment to Palladium
- [ ] Generate payment report
- [ ] View supplier history

---

## Future Enhancements

1. **Mobile Sample Entry**
   - Tablet-based sample entry
   - Offline capability
   - Photo capture integration

2. **Automated Quality Grading**
   - Machine vision integration
   - AI-based defect detection
   - Automated crack-out analysis

3. **Supplier Portal**
   - Real-time sample status
   - Main run document download
   - Payment statement access
   - Historical data access

4. **Predictive Analytics**
   - Seasonal quality forecasting
   - Optimal pricing suggestions
   - Supplier quality predictions
