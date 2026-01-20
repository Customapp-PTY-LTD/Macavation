# Quality Assurance & Food Safety Module

## Overview
Manages all quality assurance activities, food safety protocols, lab testing, compliance checklists, audits, and Certificate of Analysis (COA) generation for both kernel and oil production.

---

## Database Entities

### 1. quality_tests
All quality testing records
```sql
CREATE TABLE quality_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Test Subject
    test_type VARCHAR(50) NOT NULL CHECK (test_type IN ('sample', 'batch', 'final_product', 'raw_material', 'oil', 'finished_goods')),
    product_type VARCHAR(20) CHECK (product_type IN ('kernel', 'oil', 'nis')),
    
    -- Related Records
    sample_submission_id UUID REFERENCES sample_submissions(id),
    batch_id UUID REFERENCES production_batches(id),
    stock_item_id UUID,
    
    -- Test Details
    test_date DATE NOT NULL,
    sample_reference VARCHAR(100),
    batch_number VARCHAR(100),
    style VARCHAR(50),
    
    -- Moisture Content
    moisture_percentage DECIMAL(5,2),
    moisture_method VARCHAR(100),
    moisture_pass BOOLEAN,
    
    -- Free Fatty Acid (FFA)
    ffa_percentage DECIMAL(5,2),
    ffa_method VARCHAR(100),
    ffa_pass BOOLEAN,
    
    -- Peroxide Value (PV)
    peroxide_value DECIMAL(10,2),
    peroxide_method VARCHAR(100),
    peroxide_pass BOOLEAN,
    
    -- Organoleptic Testing
    taste_test_result VARCHAR(50),
    taste_test_notes TEXT,
    taste_test_pass BOOLEAN,
    
    smell_test_result VARCHAR(50),
    smell_test_notes TEXT,
    smell_test_pass BOOLEAN,
    
    appearance_test_result VARCHAR(50),
    appearance_test_notes TEXT,
    appearance_test_pass BOOLEAN,
    
    -- Microbiological Testing
    ecoli_result VARCHAR(50),
    ecoli_pass BOOLEAN,
    
    salmonella_result VARCHAR(50),
    salmonella_pass BOOLEAN,
    
    listeria_result VARCHAR(50),
    listeria_pass BOOLEAN,
    
    total_plate_count VARCHAR(50),
    total_plate_count_pass BOOLEAN,
    
    yeast_mould_count VARCHAR(50),
    yeast_mould_count_pass BOOLEAN,
    
    -- Mycotoxins
    aflatoxin_ppb DECIMAL(10,2),
    aflatoxin_pass BOOLEAN,
    
    -- Physical Characteristics
    color_description VARCHAR(255),
    color_pass BOOLEAN,
    
    size_mm_min DECIMAL(5,2),
    size_mm_max DECIMAL(5,2),
    size_pass BOOLEAN,
    
    -- Foreign Matter
    foreign_matter_found BOOLEAN,
    foreign_matter_description TEXT,
    foreign_matter_pass BOOLEAN,
    
    -- Insects/Pests
    insect_presence BOOLEAN,
    insect_description TEXT,
    insect_pass BOOLEAN,
    
    -- Overall Result
    overall_result VARCHAR(20) CHECK (overall_result IN ('pass', 'conditional_pass', 'fail', 'pending')),
    overall_notes TEXT,
    
    -- Testing Personnel
    tested_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'reviewed', 'approved')),
    
    -- External Testing
    external_lab BOOLEAN DEFAULT false,
    external_lab_name VARCHAR(255),
    external_lab_reference VARCHAR(100),
    external_report_url VARCHAR(500),
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_quality_tests_number ON quality_tests(test_number);
CREATE INDEX idx_quality_tests_date ON quality_tests(test_date DESC);
CREATE INDEX idx_quality_tests_batch ON quality_tests(batch_id);
CREATE INDEX idx_quality_tests_sample ON quality_tests(sample_submission_id);
CREATE INDEX idx_quality_tests_status ON quality_tests(status);
CREATE INDEX idx_quality_tests_result ON quality_tests(overall_result);
```

### 2. certificates_of_analysis
COA documents issued for products
```sql
CREATE TABLE certificates_of_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coa_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Product Information
    product_type VARCHAR(20) CHECK (product_type IN ('kernel', 'oil')),
    product_style VARCHAR(50),
    product_grade VARCHAR(50),
    batch_number VARCHAR(100),
    
    -- Customer
    customer_id UUID REFERENCES contacts(id),
    customer_name VARCHAR(255),
    
    -- Quantity
    quantity_kg DECIMAL(10,2),
    unit_of_measure VARCHAR(20) DEFAULT 'kg',
    
    -- Quality Test Results (Summary)
    moisture_percentage DECIMAL(5,2),
    ffa_percentage DECIMAL(5,2),
    peroxide_value DECIMAL(10,2),
    
    -- Test References
    quality_test_ids UUID[],
    
    -- Additional Specifications
    specifications JSONB,
    certifications TEXT[], -- halal, kosher, organic, etc.
    
    -- Document Details
    issue_date DATE NOT NULL,
    expiry_date DATE,
    best_before_date DATE,
    
    -- Status
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'revised', 'cancelled')),
    
    -- Signatures
    issued_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    -- Document Management
    document_url VARCHAR(500),
    digital_signature TEXT,
    
    -- Revision History
    revision_number INTEGER DEFAULT 1,
    previous_coa_id UUID REFERENCES certificates_of_analysis(id),
    revision_reason TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_coa_number ON certificates_of_analysis(coa_number);
CREATE INDEX idx_coa_customer ON certificates_of_analysis(customer_id);
CREATE INDEX idx_coa_batch ON certificates_of_analysis(batch_number);
CREATE INDEX idx_coa_date ON certificates_of_analysis(issue_date DESC);
CREATE INDEX idx_coa_status ON certificates_of_analysis(status);
```

### 3. quality_hold_records
Track quality holds and resolutions
```sql
CREATE TABLE quality_hold_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hold_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Hold Subject
    hold_type VARCHAR(50) CHECK (hold_type IN ('batch', 'stock', 'equipment', 'supplier')),
    batch_id UUID REFERENCES production_batches(id),
    stock_item_id UUID,
    equipment_id UUID,
    supplier_id UUID REFERENCES contacts(id),
    
    -- Hold Details
    hold_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    hold_reason VARCHAR(255) NOT NULL,
    hold_description TEXT,
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    
    -- Quality Issue
    issue_category VARCHAR(100),
    quality_test_id UUID REFERENCES quality_tests(id),
    customer_complaint_id UUID,
    
    -- Impact Assessment
    quantity_affected_kg DECIMAL(10,2),
    estimated_value_zar DECIMAL(15,2),
    customer_impact TEXT,
    
    -- Investigation
    root_cause_analysis TEXT,
    investigation_findings TEXT,
    corrective_action_required TEXT,
    preventive_action_required TEXT,
    
    -- Resolution
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'investigating', 'resolved', 'escalated')),
    resolution_date TIMESTAMP WITH TIME ZONE,
    resolution_action VARCHAR(100) CHECK (resolution_action IN ('released', 'rework', 'downgrade', 'disposal', 'return_to_supplier')),
    resolution_notes TEXT,
    
    -- Disposition
    disposition_approved_by UUID REFERENCES users(id),
    disposition_approval_date TIMESTAMP WITH TIME ZONE,
    
    -- Personnel
    reported_by UUID REFERENCES users(id),
    assigned_to UUID REFERENCES users(id),
    resolved_by UUID REFERENCES users(id),
    
    -- Follow-up
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_date DATE,
    follow_up_completed BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_quality_hold_number ON quality_hold_records(hold_number);
CREATE INDEX idx_quality_hold_batch ON quality_hold_records(batch_id);
CREATE INDEX idx_quality_hold_status ON quality_hold_records(status);
CREATE INDEX idx_quality_hold_date ON quality_hold_records(hold_date DESC);
```

### 4. audit_schedules
Food safety audit scheduling and tracking
```sql
CREATE TABLE audit_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Audit Details
    audit_type VARCHAR(100) NOT NULL,
    audit_category VARCHAR(50) CHECK (audit_category IN ('internal', 'external', 'customer', 'certification', 'regulatory')),
    audit_standard VARCHAR(100), -- FSSC 22000, HACCP, ISO, etc.
    
    -- Scheduling
    scheduled_date DATE NOT NULL,
    scheduled_duration_days INTEGER,
    notification_days_before INTEGER DEFAULT 14,
    
    -- Auditor
    auditor_type VARCHAR(50) CHECK (auditor_type IN ('internal', 'external', 'customer', 'certification_body')),
    auditor_name VARCHAR(255),
    auditor_organization VARCHAR(255),
    auditor_contact_email VARCHAR(255),
    auditor_contact_phone VARCHAR(20),
    
    -- Scope
    audit_scope TEXT,
    areas_to_audit TEXT[],
    
    -- Status
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'notified', 'in_progress', 'completed', 'cancelled', 'rescheduled')),
    
    -- Completion
    actual_audit_date DATE,
    completion_date DATE,
    
    -- Results
    audit_result VARCHAR(20) CHECK (audit_result IN ('pass', 'pass_with_observations', 'minor_nc', 'major_nc', 'critical_nc')),
    findings_count INTEGER,
    nc_count INTEGER,
    observation_count INTEGER,
    
    -- Documents
    audit_report_url VARCHAR(500),
    certificate_url VARCHAR(500),
    
    -- Follow-up
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_due_date DATE,
    follow_up_completed BOOLEAN DEFAULT false,
    
    -- Personnel
    coordinator_id UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_schedules_date ON audit_schedules(scheduled_date);
CREATE INDEX idx_audit_schedules_status ON audit_schedules(status);
CREATE INDEX idx_audit_schedules_type ON audit_schedules(audit_type);
```

### 5. audit_findings
Non-conformances and observations from audits
```sql
CREATE TABLE audit_findings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_number VARCHAR(50) UNIQUE NOT NULL,
    
    audit_schedule_id UUID REFERENCES audit_schedules(id),
    
    -- Finding Details
    finding_type VARCHAR(50) CHECK (finding_type IN ('critical_nc', 'major_nc', 'minor_nc', 'observation', 'opportunity')),
    finding_category VARCHAR(100),
    
    -- Description
    finding_description TEXT NOT NULL,
    evidence TEXT,
    standard_reference VARCHAR(255),
    requirement_not_met TEXT,
    
    -- Risk Assessment
    risk_level VARCHAR(20) CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    potential_impact TEXT,
    
    -- Corrective Action
    immediate_action_taken TEXT,
    root_cause TEXT,
    corrective_action_plan TEXT,
    preventive_action_plan TEXT,
    
    -- Responsibility
    responsible_person_id UUID REFERENCES users(id),
    due_date DATE,
    
    -- Status
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'verified', 'closed')),
    
    -- Verification
    verification_evidence TEXT,
    verified_by UUID REFERENCES users(id),
    verification_date DATE,
    effective BOOLEAN,
    
    -- Closure
    closed_by UUID REFERENCES users(id),
    closed_date DATE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_findings_number ON audit_findings(finding_number);
CREATE INDEX idx_audit_findings_audit ON audit_findings(audit_schedule_id);
CREATE INDEX idx_audit_findings_status ON audit_findings(status);
CREATE INDEX idx_audit_findings_type ON audit_findings(finding_type);
```

### 6. food_safety_incidents
Track food safety incidents and responses
```sql
CREATE TABLE food_safety_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Incident Details
    incident_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    incident_type VARCHAR(100) CHECK (incident_type IN ('contamination', 'foreign_object', 'allergen', 'microbiological', 'chemical', 'physical', 'labeling', 'recall')),
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    
    -- Product Information
    product_type VARCHAR(20),
    batch_numbers TEXT[],
    quantity_affected_kg DECIMAL(10,2),
    
    -- Discovery
    discovered_by VARCHAR(100) CHECK (discovered_by IN ('internal_qa', 'production', 'customer', 'supplier', 'regulatory', 'audit')),
    discovery_location VARCHAR(255),
    discovery_description TEXT,
    
    -- Impact Assessment
    consumer_health_risk BOOLEAN,
    regulatory_notification_required BOOLEAN,
    customer_notification_required BOOLEAN,
    recall_required BOOLEAN,
    
    -- Response Actions
    immediate_actions_taken TEXT,
    quarantine_applied BOOLEAN,
    product_withdrawn BOOLEAN,
    product_recalled BOOLEAN,
    
    -- Investigation
    investigation_team TEXT[],
    root_cause TEXT,
    contributing_factors TEXT,
    
    -- Corrective Actions
    corrective_actions TEXT,
    preventive_actions TEXT,
    verification_actions TEXT,
    
    -- Status
    status VARCHAR(20) DEFAULT 'reported' CHECK (status IN ('reported', 'investigating', 'contained', 'resolved', 'closed')),
    
    -- Regulatory
    regulatory_body_notified BOOLEAN DEFAULT false,
    regulatory_reference VARCHAR(100),
    regulatory_response TEXT,
    
    -- Closure
    closed_by UUID REFERENCES users(id),
    closed_date DATE,
    lessons_learned TEXT,
    
    -- Personnel
    reported_by UUID REFERENCES users(id),
    incident_manager_id UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_food_safety_incidents_number ON food_safety_incidents(incident_number);
CREATE INDEX idx_food_safety_incidents_date ON food_safety_incidents(incident_date DESC);
CREATE INDEX idx_food_safety_incidents_status ON food_safety_incidents(status);
CREATE INDEX idx_food_safety_incidents_severity ON food_safety_incidents(severity);
```

---

## Business Rules

### Quality Testing Rules

1. **Testing Frequency**
   - **Sample submissions**: All samples tested before approval
   - **Production batches**: Test at receiving, mid-production, and final product
   - **Finished goods**: Test before positive release
   - **Oil**: Test every production run

2. **Test Parameters**
   - **Kernels**: Moisture, FFA, PV, taste, smell, appearance, size, foreign matter
   - **Oil**: FFA, PV, moisture, color, clarity, taste, smell
   - **Microbiological**: Quarterly for kernels, every batch for oil
   - **Mycotoxins**: Annual testing or as required by customer

3. **Acceptance Criteria**
   ```
   Kernels:
   - Moisture: ≤2.0%
   - FFA: ≤0.15%
   - PV: ≤2.0 meq/kg
   - Foreign matter: None visible
   - Insects: None present
   
   Oil:
   - FFA: ≤0.10% (virgin), ≤0.50% (refined)
   - PV: ≤2.0 meq/kg (virgin), ≤5.0 meq/kg (refined)
   - Moisture: ≤0.05%
   ```

4. **Test Result Actions**
   - **Pass**: Product released
   - **Conditional Pass**: Released with conditions (e.g., limited use)
   - **Fail**: Quality hold, investigation required

### Certificate of Analysis (COA) Rules

1. **COA Generation**
   - Generated for every customer shipment
   - Based on actual test results from batch
   - Includes all requested parameters
   - Digitally signed by QA Supervisor

2. **COA Content Requirements**
   - Product identification (type, style, grade, batch)
   - Test results (moisture, FFA, PV, micro if applicable)
   - Compliance statements
   - Certifications (halal, kosher, organic if applicable)
   - Best before date
   - Issue date and signature

3. **COA Revision**
   - Revisions numbered sequentially
   - Reason for revision documented
   - Previous version archived
   - Customer notified of revision

4. **COA Approval**
   - Requires QA Supervisor approval
   - General Manager approval for export shipments
   - Cannot be issued without completed testing

### Quality Hold Rules

1. **Hold Triggers**
   - Failed quality test
   - Foreign material found
   - Customer complaint
   - Equipment malfunction affecting product
   - Supplier issue

2. **Hold Process**
   - Immediate segregation of affected product
   - Clear "HOLD" labeling
   - QA Supervisor notification
   - Production stopped if necessary
   - Investigation initiated within 4 hours

3. **Investigation Requirements**
   - Root cause analysis
   - Impact assessment (quantity, value, customers)
   - Corrective action plan
   - Preventive action plan
   - Timeline for resolution

4. **Hold Release Options**
   - **Release**: Product meets specs, released as-is
   - **Rework**: Product reprocessed to meet specs
   - **Downgrade**: Product reclassified to lower grade
   - **Disposal**: Product destroyed
   - **Return to Supplier**: Raw material returned

5. **Hold Approval**
   - Release/disposition requires QA Supervisor approval
   - Downgrades require General Manager approval
   - Disposal requires dual approval (QA + GM)

### Audit Management Rules

1. **Audit Schedule**
   - Internal audits: Quarterly
   - External certification audits: Annual
   - Customer audits: As requested
   - Regulatory audits: As required

2. **Audit Preparation**
   - 14 days notice minimum (internal)
   - 30 days notice minimum (external)
   - Pre-audit document review
   - Audit team briefing

3. **Audit Conduct**
   - Opening meeting
   - Document review
   - Site inspection
   - Interviews
   - Closing meeting
   - Audit report within 5 days

4. **Non-Conformance Management**
   - **Critical NC**: Immediate action required, follow-up audit
   - **Major NC**: 30 days to close, verification required
   - **Minor NC**: 60 days to close
   - **Observations**: 90 days to address

5. **Follow-Up Audits**
   - Required for major or critical NCs
   - Scheduled within 30-60 days
   - Verify effectiveness of corrective actions

### Food Safety Incident Rules

1. **Incident Classification**
   - **Critical**: Immediate health risk, recall likely
   - **High**: Potential health risk, investigation urgent
   - **Medium**: Quality issue, customer impact
   - **Low**: Minor deviation, no customer impact

2. **Incident Response Time**
   - **Critical**: Immediate response (within 1 hour)
   - **High**: 4 hours
   - **Medium**: 24 hours
   - **Low**: 48 hours

3. **Regulatory Notification**
   - Critical incidents: Notify within 24 hours
   - High incidents: Notify within 72 hours
   - Document all communications
   - Follow regulatory guidelines

4. **Product Recall**
   - General Manager authorization required
   - Immediate customer notification
   - Product withdrawal/recall initiated
   - Regulatory notification
   - Effectiveness checks at 24h, 48h, 1 week

---

## Testing Checklist

- [ ] Record new quality test
- [ ] Enter moisture test results
- [ ] Enter FFA test results
- [ ] Enter peroxide value results
- [ ] Record organoleptic test results
- [ ] Record microbiological test results
- [ ] Approve/reject test results
- [ ] Generate Certificate of Analysis
- [ ] Issue COA to customer
- [ ] Revise existing COA
- [ ] Create quality hold
- [ ] Investigate quality hold
- [ ] Release from quality hold
- [ ] Schedule internal audit
- [ ] Schedule external audit
- [ ] Record audit findings
- [ ] Create corrective action for finding
- [ ] Verify corrective action effectiveness
- [ ] Close audit finding
- [ ] Report food safety incident
- [ ] Investigate food safety incident
- [ ] Close food safety incident
- [ ] Generate quality reports

---

## Future Enhancements

1. **Mobile Lab App**
   - Tablet-based test entry
   - Photo capture of results
   - Immediate result availability

2. **Automated Testing Equipment**
   - Digital moisture meters with auto-sync
   - Automated FFA analyzers
   - Direct data capture

3. **Predictive Quality**
   - ML models for quality prediction
   - Early warning of quality issues
   - Trend analysis

4. **Digital COA Management**
   - QR codes on COAs
   - Customer portal access
   - Blockchain verification
