# FruitLive - Module 3: Compliance & Audits

## Overview
The Compliance & Audits module manages all regulatory requirements, particularly Global GAP certification, training certificates, policies, procedures, and audit preparation. It provides a digital document management system aligned with certification standards.

## Purpose
- Digital Global GAP document template (33 folders)
- Certificate expiry tracking and alerts
- Staff training matrix management
- Policy and procedure version control
- Caesar (labour) audit preparation
- Document upload and categorization
- Audit checklist generation
- Compliance score calculation

## Key Features
1. Global GAP folder structure (digital template)
2. Certificate management with expiry alerts
3. Training matrix tracking
4. Policy/procedure document management
5. Audit preparation checklists
6. Compliance scoring dashboard
7. Document version control
8. Multi-standard support (Global GAP, FSSC 22000, CGA, WIETA)
9. Export audit packs
10. Mock recall exercise tracking

## Database Schema

### Tables Required

```sql
-- Document Categories (Global GAP Structure)
CREATE TABLE document_categories (
    id UUID PRIMARY KEY,
    parent_id UUID REFERENCES document_categories(id),
    standard VARCHAR(50), -- 'global_gap', 'fssc_22000', 'cga', 'wieta'
    code VARCHAR(20), -- e.g., 'AF.1.1'
    name VARCHAR(255),
    description TEXT,
    is_mandatory BOOLEAN DEFAULT TRUE,
    sort_order INT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Documents
CREATE TABLE documents (
    id UUID PRIMARY KEY,
    category_id UUID REFERENCES document_categories(id),
    farm_id UUID REFERENCES farms(id),
    title VARCHAR(255),
    description TEXT,
    file_url VARCHAR(500),
    file_type VARCHAR(50), -- 'pdf', 'docx', 'jpg', 'xlsx'
    file_size INT,
    version INT DEFAULT 1,
    status VARCHAR(20), -- 'draft', 'approved', 'expired', 'archived'
    effective_date DATE,
    review_date DATE,
    expiry_date DATE,
    uploaded_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    tags TEXT[],
    metadata JSONB,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Document Versions
CREATE TABLE document_versions (
    id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(id),
    version_number INT,
    file_url VARCHAR(500),
    changes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP
);

-- Certificates
CREATE TABLE certificates (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    certificate_type VARCHAR(100), -- 'first_aid', 'chemical_handling', 'forklift', 'health_safety'
    holder_type VARCHAR(20), -- 'worker', 'farm', 'equipment'
    holder_id UUID, -- Worker ID, Farm ID, or Equipment ID
    certificate_number VARCHAR(100),
    issuing_authority VARCHAR(255),
    issue_date DATE,
    expiry_date DATE,
    document_url VARCHAR(500),
    renewal_required BOOLEAN DEFAULT TRUE,
    alert_days_before INT DEFAULT 30,
    status VARCHAR(20), -- 'valid', 'expiring', 'expired', 'renewed'
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Training Matrix
CREATE TABLE training_records (
    id UUID PRIMARY KEY,
    worker_id UUID REFERENCES workers(id),
    farm_id UUID REFERENCES farms(id),
    training_type VARCHAR(100),
    training_date DATE,
    expiry_date DATE,
    trainer VARCHAR(255),
    duration_hours DECIMAL(4,2),
    certificate_url VARCHAR(500),
    score DECIMAL(5,2),
    passed BOOLEAN,
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Policies
CREATE TABLE policies (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    category_id UUID REFERENCES document_categories(id),
    title VARCHAR(255),
    policy_number VARCHAR(50),
    version VARCHAR(20),
    effective_date DATE,
    review_frequency_months INT, -- e.g., 12 for annual review
    next_review_date DATE,
    content TEXT,
    document_url VARCHAR(500),
    owner_id UUID REFERENCES users(id), -- Policy owner
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    status VARCHAR(20), -- 'draft', 'active', 'under_review', 'archived'
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Policy Acknowledgments (who has read and signed)
CREATE TABLE policy_acknowledgments (
    id UUID PRIMARY KEY,
    policy_id UUID REFERENCES policies(id),
    user_id UUID REFERENCES users(id),
    acknowledged_at TIMESTAMP,
    signature_url VARCHAR(500),
    ip_address VARCHAR(50),
    created_at TIMESTAMP
);

-- Audit Checklists
CREATE TABLE audit_checklists (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    audit_type VARCHAR(50), -- 'global_gap', 'caesar', 'internal', 'fssc_22000'
    audit_date DATE,
    auditor_name VARCHAR(255),
    auditor_organization VARCHAR(255),
    status VARCHAR(20), -- 'scheduled', 'in_progress', 'completed', 'passed', 'failed'
    score DECIMAL(5,2),
    findings TEXT,
    corrective_actions TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Audit Checklist Items
CREATE TABLE audit_checklist_items (
    id UUID PRIMARY KEY,
    checklist_id UUID REFERENCES audit_checklists(id),
    category_id UUID REFERENCES document_categories(id),
    requirement_code VARCHAR(50),
    requirement_text TEXT,
    compliance_status VARCHAR(20), -- 'compliant', 'minor_nc', 'major_nc', 'not_applicable'
    evidence_type VARCHAR(50), -- 'document', 'record', 'observation'
    evidence_url VARCHAR(500),
    auditor_notes TEXT,
    corrective_action TEXT,
    due_date DATE,
    completed BOOLEAN DEFAULT FALSE,
    sort_order INT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Compliance Alerts
CREATE TABLE compliance_alerts (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    alert_type VARCHAR(50), -- 'certificate_expiry', 'policy_review', 'audit_due', 'training_required'
    severity VARCHAR(20), -- 'critical', 'warning', 'info'
    title VARCHAR(255),
    message TEXT,
    related_entity_type VARCHAR(50), -- 'certificate', 'policy', 'document', 'audit'
    related_entity_id UUID,
    action_required TEXT,
    due_date DATE,
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMP
);

-- Mock Recall Exercises
CREATE TABLE mock_recalls (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    exercise_date DATE,
    product_type VARCHAR(100),
    batch_number VARCHAR(100),
    contamination_scenario TEXT,
    start_time TIMESTAMP,
    completion_time TIMESTAMP,
    duration_minutes INT,
    pallets_located INT,
    total_pallets INT,
    success BOOLEAN,
    findings TEXT,
    corrective_actions TEXT,
    conducted_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

## API Endpoints

### Documents

#### GET /api/compliance/documents
Get documents by category/farm

**Query Parameters:**
- `farmId` - Required
- `categoryId` - Filter by category
- `standard` - 'global_gap', 'fssc_22000', 'cga'
- `status` - 'draft', 'approved', 'expired'

**Response:**
```json
{
  "documents": [
    {
      "id": "uuid",
      "category": "AF.1.1 - Site Management",
      "title": "Fire Safety Policy",
      "fileUrl": "https://...",
      "version": 2,
      "status": "approved",
      "effectiveDate": "2025-01-01",
      "reviewDate": "2026-01-01"
    }
  ],
  "categories": [
    {
      "code": "AF.1",
      "name": "Site Management",
      "mandatory": true,
      "documentCount": 5,
      "compliance": "complete"
    }
  ]
}
```

#### POST /api/compliance/documents
Upload new document

**Request (multipart/form-data):**
```
categoryId: uuid
farmId: uuid
title: Fire Safety Policy
description: Updated fire safety procedures
effectiveDate: 2025-01-01
file: [binary]
```

#### PUT /api/compliance/documents/:id
Update document (creates new version)

#### DELETE /api/compliance/documents/:id
Archive document

#### GET /api/compliance/documents/:id/versions
Get document version history

### Certificates

#### GET /api/compliance/certificates
Get certificates with filters

**Query Parameters:**
- `farmId`
- `status` - 'valid', 'expiring', 'expired'
- `holderType` - 'worker', 'farm', 'equipment'
- `certificateType`

**Response:**
```json
{
  "certificates": [
    {
      "id": "uuid",
      "type": "First Aid Training",
      "holderName": "Johannes Botha",
      "certificateNumber": "FA-2024-001",
      "issueDate": "2024-12-01",
      "expiryDate": "2025-12-01",
      "status": "valid",
      "daysUntilExpiry": 352
    }
  ],
  "summary": {
    "total": 45,
    "valid": 40,
    "expiring": 3,
    "expired": 2
  }
}
```

#### POST /api/compliance/certificates
Add new certificate

#### PUT /api/compliance/certificates/:id
Update certificate

#### POST /api/compliance/certificates/:id/renew
Mark certificate as renewed

### Training

#### GET /api/compliance/training
Get training records

**Query Parameters:**
- `farmId`
- `workerId`
- `trainingType`
- `status` - 'valid', 'expiring', 'expired'

**Response:**
```json
{
  "trainingMatrix": [
    {
      "workerId": "uuid",
      "workerName": "Johannes Botha",
      "trainings": [
        {
          "type": "Health & Safety",
          "date": "2024-06-15",
          "expiryDate": "2025-06-15",
          "status": "valid"
        },
        {
          "type": "Chemical Handling",
          "date": "2024-08-20",
          "expiryDate": "2025-08-20",
          "status": "expiring"
        }
      ],
      "complianceScore": 85
    }
  ]
}
```

#### POST /api/compliance/training
Record training session

#### GET /api/compliance/training/requirements
Get training requirements by role

### Policies

#### GET /api/compliance/policies
Get all policies

**Query Parameters:**
- `farmId`
- `status` - 'draft', 'active', 'under_review'
- `categoryId`

#### POST /api/compliance/policies
Create new policy

#### PUT /api/compliance/policies/:id
Update policy

#### POST /api/compliance/policies/:id/acknowledge
User acknowledges reading policy

**Request:**
```json
{
  "userId": "uuid",
  "signature": "base64_image"
}
```

#### GET /api/compliance/policies/:id/acknowledgments
Get who has acknowledged policy

### Audits

#### GET /api/compliance/audits
Get audit history

#### POST /api/compliance/audits
Create audit checklist

**Request:**
```json
{
  "farmId": "uuid",
  "auditType": "global_gap",
  "auditDate": "2026-01-15",
  "auditorName": "John Smith",
  "auditorOrganization": "SGS"
}
```

#### PUT /api/compliance/audits/:id/items/:itemId
Update checklist item compliance status

**Request:**
```json
{
  "complianceStatus": "compliant",
  "evidenceUrl": "https://...",
  "auditorNotes": "All documents verified"
}
```

#### GET /api/compliance/audits/:id/score
Calculate audit score

**Response:**
```json
{
  "totalItems": 150,
  "compliant": 141,
  "minorNC": 8,
  "majorNC": 1,
  "notApplicable": 0,
  "score": 94,
  "status": "passed"
}
```

#### POST /api/compliance/audits/:id/export
Export audit pack (PDF)

### Compliance Score

#### GET /api/compliance/score/:farmId
Get overall compliance score

**Response:**
```json
{
  "overallScore": 94,
  "breakdown": {
    "documents": 96,
    "certificates": 92,
    "training": 90,
    "policies": 98
  },
  "readiness": "audit_ready",
  "gaps": [
    {
      "category": "Training",
      "issue": "3 workers need chemical handling renewal",
      "severity": "medium"
    }
  ]
}
```

### Mock Recalls

#### GET /api/compliance/mock-recalls
Get mock recall history

#### POST /api/compliance/mock-recalls
Conduct mock recall exercise

**Request:**
```json
{
  "farmId": "uuid",
  "exerciseDate": "2025-12-22",
  "productType": "Granny Smith Apples",
  "batchNumber": "GS-A3-2025-00842",
  "contaminationScenario": "Glass found in carton"
}
```

#### PUT /api/compliance/mock-recalls/:id/complete
Complete mock recall with results

## UI Components

### 1. Document Library
```tsx
interface DocumentLibraryProps {
  farmId: string;
  standard: 'global_gap' | 'fssc_22000' | 'cga';
  categories: DocumentCategory[];
  documents: Document[];
  onUpload: (file: File, categoryId: string) => void;
}
```

### 2. Global GAP Folder Structure
```tsx
interface GlobalGAPStructureProps {
  farmId: string;
  categories: GlobalGAPCategory[];
  compliance: ComplianceStatus;
  onCategoryClick: (categoryId: string) => void;
}
```

### 3. Certificate Manager
```tsx
interface CertificateManagerProps {
  certificates: Certificate[];
  expiringCertificates: Certificate[];
  onAdd: (certificate: CertificateInput) => void;
  onRenew: (id: string) => void;
}
```

### 4. Training Matrix
```tsx
interface TrainingMatrixProps {
  workers: Worker[];
  trainingTypes: TrainingType[];
  records: TrainingRecord[];
  onAddTraining: (record: TrainingInput) => void;
}
```

### 5. Policy Manager
```tsx
interface PolicyManagerProps {
  policies: Policy[];
  onCreatePolicy: (policy: PolicyInput) => void;
  onAcknowledge: (policyId: string, signature: string) => void;
}
```

### 6. Audit Checklist Builder
```tsx
interface AuditChecklistProps {
  auditType: string;
  checklist: AuditChecklist;
  items: AuditChecklistItem[];
  onUpdateItem: (itemId: string, status: string) => void;
}
```

### 7. Compliance Dashboard
```tsx
interface ComplianceDashboardProps {
  farmId: string;
  score: ComplianceScore;
  alerts: ComplianceAlert[];
  upcomingAudits: Audit[];
}
```

### 8. Mock Recall Tracker
```tsx
interface MockRecallTrackerProps {
  farmId: string;
  exercises: MockRecall[];
  onStartExercise: (exercise: MockRecallInput) => void;
}
```

## Business Logic

### Compliance Score Calculation
```typescript
async function calculateComplianceScore(farmId: string) {
  // 1. Document completeness (30%)
  const categories = await getRequiredCategories('global_gap');
  const documents = await getDocuments(farmId);
  const docScore = (documents.length / categories.length) * 100 * 0.30;
  
  // 2. Certificate validity (25%)
  const certificates = await getCertificates(farmId);
  const validCerts = certificates.filter(c => c.status === 'valid');
  const certScore = (validCerts.length / certificates.length) * 100 * 0.25;
  
  // 3. Training compliance (25%)
  const workers = await getWorkers(farmId);
  const trainedWorkers = await getTrainedWorkers(farmId);
  const trainingScore = (trainedWorkers.length / workers.length) * 100 * 0.25;
  
  // 4. Policy acknowledgment (20%)
  const policies = await getPolicies(farmId);
  const acknowledgedPolicies = await getAcknowledgedPolicies(farmId);
  const policyScore = (acknowledgedPolicies.length / policies.length) * 100 * 0.20;
  
  const overallScore = docScore + certScore + trainingScore + policyScore;
  
  return {
    overallScore: Math.round(overallScore),
    breakdown: {
      documents: Math.round(docScore / 0.30),
      certificates: Math.round(certScore / 0.25),
      training: Math.round(trainingScore / 0.25),
      policies: Math.round(policyScore / 0.20)
    },
    readiness: overallScore >= 90 ? 'audit_ready' : 
                overallScore >= 75 ? 'needs_attention' : 'not_ready'
  };
}
```

### Certificate Expiry Alerts
```typescript
async function checkCertificateExpiry() {
  const certificates = await db.certificates.findMany({
    where: {
      status: { in: ['valid', 'expiring'] },
      expiryDate: { gte: new Date() }
    }
  });
  
  for (const cert of certificates) {
    const daysUntilExpiry = differenceInDays(cert.expiryDate, new Date());
    
    if (daysUntilExpiry <= cert.alertDaysBefore && daysUntilExpiry > 0) {
      // Create alert
      await createComplianceAlert({
        farmId: cert.farmId,
        alertType: 'certificate_expiry',
        severity: daysUntilExpiry <= 7 ? 'critical' : 'warning',
        title: `${cert.certificateType} Expiring Soon`,
        message: `${cert.holderName}'s certificate expires in ${daysUntilExpiry} days`,
        relatedEntityType: 'certificate',
        relatedEntityId: cert.id,
        dueDate: cert.expiryDate
      });
      
      // Update certificate status
      await updateCertificate(cert.id, { status: 'expiring' });
    } else if (daysUntilExpiry <= 0) {
      // Mark as expired
      await updateCertificate(cert.id, { status: 'expired' });
    }
  }
}
```

### Audit Pack Export
```typescript
async function generateAuditPack(farmId: string, auditType: string) {
  // 1. Get all required documents
  const categories = await getAuditRequirements(auditType);
  const documents = await getDocumentsByCategories(farmId, categories);
  
  // 2. Get certificates
  const certificates = await getCertificates(farmId, { status: 'valid' });
  
  // 3. Get training records
  const training = await getTrainingRecords(farmId);
  
  // 4. Get policies
  const policies = await getPolicies(farmId, { status: 'active' });
  
  // 5. Generate PDF report
  const pdf = await generatePDF({
    title: `${auditType.toUpperCase()} Audit Pack - ${farmId}`,
    sections: [
      { title: 'Farm Information', content: getFarmInfo(farmId) },
      { title: 'Documents', content: documents },
      { title: 'Certificates', content: certificates },
      { title: 'Training Records', content: training },
      { title: 'Policies', content: policies }
    ]
  });
  
  return pdf;
}
```

### Policy Review Workflow
```typescript
async function initiatePolicy Review(policyId: string) {
  const policy = await getPolicy(policyId);
  
  // 1. Update status
  await updatePolicy(policyId, { 
    status: 'under_review',
    nextReviewDate: addMonths(new Date(), policy.reviewFrequencyMonths)
  });
  
  // 2. Notify policy owner
  await notifyUser(policy.ownerId, {
    type: 'policy_review_required',
    message: `Policy "${policy.title}" is due for review`
  });
  
  // 3. Create compliance alert
  await createComplianceAlert({
    farmId: policy.farmId,
    alertType: 'policy_review',
    severity: 'warning',
    title: 'Policy Review Required',
    message: `${policy.title} (${policy.policyNumber}) needs review`,
    relatedEntityType: 'policy',
    relatedEntityId: policyId,
    dueDate: policy.nextReviewDate
  });
}
```

## Integration Points

### With Other Modules
1. **Labour** → Worker training certificates
2. **Chemical** → Chemical handling certificates, storage compliance
3. **Water** → Water license documents
4. **Post-Harvest** → Traceability documentation
5. **Dashboard** → Compliance alerts, score

### Event Subscriptions
```typescript
// Listen to events from other modules
events.on('labour.worker_created', async (worker) => {
  // Create training requirements
  await createTrainingRequirements(worker.id);
});

events.on('chemical.storage_inspection', async (inspection) => {
  // Link to compliance documents
  await linkDocument(inspection.farmId, 'chemical_storage', inspection.reportUrl);
});
```

## State Management

```typescript
interface ComplianceState {
  documents: Document[];
  categories: DocumentCategory[];
  certificates: Certificate[];
  training: TrainingRecord[];
  policies: Policy[];
  audits: Audit[];
  alerts: ComplianceAlert[];
  complianceScore: ComplianceScore | null;
  selectedStandard: 'global_gap' | 'fssc_22000' | 'cga';
  loading: boolean;
}

const complianceSlice = createSlice({
  name: 'compliance',
  initialState,
  reducers: {
    setDocuments,
    uploadDocument,
    setCategories,
    setCertificates,
    addCertificate,
    renewCertificate,
    setTraining,
    addTrainingRecord,
    setPolicies,
    createPolicy,
    acknowledgePolicy,
    setAudits,
    updateAuditItem,
    setComplianceScore,
    setAlerts,
    resolveAlert
  }
});
```

## UI Screens

### Main Compliance Screen
**Route:** `/compliance`

**Tabs:**
1. Dashboard (score, alerts, upcoming audits)
2. Documents (Global GAP folders)
3. Certificates
4. Training Matrix
5. Policies
6. Audits

## Performance Considerations

- Lazy load document categories
- Cache compliance score for 1 hour
- Index on expiry_date for certificate queries
- Compress uploaded documents
- Use CDN for document storage

## Testing Requirements

### Unit Tests
- Compliance score calculation
- Expiry alert generation
- Document version tracking

### Integration Tests
- Document upload flow
- Certificate renewal workflow
- Audit pack generation

## Implementation Notes

### File Structure
```
src/
├── features/
│   └── compliance/
│       ├── components/
│       │   ├── DocumentLibrary.tsx
│       │   ├── CertificateManager.tsx
│       │   ├── TrainingMatrix.tsx
│       │   ├── PolicyManager.tsx
│       │   └── AuditChecklist.tsx
│       ├── services/
│       │   └── complianceApi.ts
│       └── pages/
│           └── CompliancePage.tsx
```

## Dependencies
```json
{
  "dependencies": {
    "react-dropzone": "^14.2.3",
    "pdfjs-dist": "^3.11.174",
    "jspdf": "^2.5.1"
  }
}
```
