# Document Management Module

## Overview
Centralized document storage, version control, and retrieval for all production documents, quality records, compliance documentation, and business files.

## Database Entities

### documents
```sql
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Document Details
    document_name VARCHAR(255) NOT NULL,
    document_type VARCHAR(100),
    document_category VARCHAR(100),
    
    -- File Information
    file_name VARCHAR(255),
    file_size_bytes BIGINT,
    file_type VARCHAR(50),
    file_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    
    -- Classification
    is_confidential BOOLEAN DEFAULT false,
    is_quality_record BOOLEAN DEFAULT false,
    retention_years INTEGER DEFAULT 7,
    
    -- Related Entities
    related_entity_type VARCHAR(50),
    related_entity_id UUID,
    
    -- Metadata
    tags TEXT[],
    description TEXT,
    
    -- Version Control
    version_number INTEGER DEFAULT 1,
    is_current_version BOOLEAN DEFAULT true,
    previous_version_id UUID REFERENCES documents(id),
    
    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived', 'deleted')),
    
    -- Approval
    requires_approval BOOLEAN DEFAULT false,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    archived_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_documents_number ON documents(document_number);
CREATE INDEX idx_documents_type ON documents(document_type);
CREATE INDEX idx_documents_category ON documents(document_category);
CREATE INDEX idx_documents_related ON documents(related_entity_type, related_entity_id);
CREATE INDEX idx_documents_tags ON documents USING gin(tags);
```

### document_access_log
```sql
CREATE TABLE document_access_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id),
    
    access_type VARCHAR(20) CHECK (access_type IN ('view', 'download', 'edit', 'delete')),
    accessed_by UUID REFERENCES users(id),
    accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    ip_address VARCHAR(45),
    user_agent TEXT
);

CREATE INDEX idx_document_access_log_document ON document_access_log(document_id);
CREATE INDEX idx_document_access_log_user ON document_access_log(accessed_by);
```

### document_folders
```sql
CREATE TABLE document_folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_name VARCHAR(255) NOT NULL,
    folder_path VARCHAR(500) NOT NULL,
    parent_folder_id UUID REFERENCES document_folders(id),
    
    description TEXT,
    
    is_system_folder BOOLEAN DEFAULT false,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Document Types & Categories

### Production Documents
- Sample submission forms
- Main run documents
- Production sheets
- Cracking records
- Washing records
- Sorting records
- Packing records
- GMP checklists
- Batch summary documents

### Quality Documents
- Quality test reports
- Certificates of Analysis (COA)
- Quality hold reports
- Audit reports
- Non-conformance reports
- Food safety incident reports
- Corrective action reports
- Lab test reports

### Financial Documents
- Invoices (customer & supplier)
- Purchase orders
- Grower payment documents
- Expense receipts
- Bank statements
- Financial reports

### Customer Documents
- Quotes
- Sales orders
- Delivery notes
- Customer correspondence
- Customer contracts

### Compliance Documents
- Food safety policies
- Quality manual
- Standard operating procedures (SOPs)
- HACCP plans
- Audit certificates
- Regulatory submissions
- Training records

### HR Documents
- Employee contracts
- Training certificates
- Performance reviews
- Leave records

## Business Rules

### Document Retention
- Quality records: 7 years minimum
- Financial records: 7 years minimum
- Production records: 5 years
- Audit records: Permanent
- General correspondence: 2 years
- Training records: Duration of employment + 5 years

### Document Approval Workflow
1. **Upload**: Document uploaded in draft status
2. **Review**: Designated reviewer checks document
3. **Approve**: Approver signs off
4. **Active**: Document available for use
5. **Archive**: Document moved to archive after retention period

### Version Control
- New versions automatically created when document edited
- Previous versions retained
- Version history tracked
- Only current version shown by default
- Previous versions accessible from version history

### Access Control
- Documents inherit permissions from folders
- Confidential documents: Restricted access
- Quality records: QA team + Management
- Financial documents: Finance team + Management
- Production documents: Production team + Management

### Search & Retrieval
- Full-text search across document content
- Filter by type, category, date, tags
- Quick filters for common searches
- Batch number search
- Customer/supplier search

## Key Features

- Drag-and-drop file upload
- Automatic OCR for scanned documents
- Document preview (PDF, images, Office docs)
- Bulk upload capability
- Email documents directly from system
- QR code generation for physical documents
- Mobile document capture
- Automated naming conventions
- Digital signatures
- Watermarking for confidential documents

## Integration Points

### Production Modules
- Automatically attach production sheets to batches
- Link quality tests to documents
- Attach GMP checklists to production dates

### Quality Module
- Auto-generate COA documents
- Attach test reports to quality records
- Link audit findings to evidence documents

### Financial Module
- Attach invoices to payments
- Link POs to supplier documents
- Scan and attach expense receipts

### Customer Module
- Attach quotes to customer records
- Store signed contracts
- Email documents to customers

## Folder Structure

```
/Documents
├── /Production
│   ├── /Sample_Submissions
│   ├── /Main_Run_Documents
│   ├── /Production_Sheets
│   ├── /GMP_Checklists
│   └── /Batch_Summaries
├── /Quality
│   ├── /Test_Reports
│   ├── /Certificates_Of_Analysis
│   ├── /Audit_Reports
│   ├── /Non_Conformances
│   └── /Food_Safety_Incidents
├── /Financial
│   ├── /Customer_Invoices
│   ├── /Supplier_Invoices
│   ├── /Purchase_Orders
│   ├── /Grower_Payments
│   └── /Bank_Statements
├── /Customers
│   ├── /Quotes
│   ├── /Contracts
│   └── /Correspondence
├── /Suppliers
│   ├── /Contracts
│   └── /Certificates
├── /Compliance
│   ├── /Policies
│   ├── /SOPs
│   ├── /HACCP
│   └── /Audit_Certificates
└── /HR
    ├── /Contracts
    ├── /Training
    └── /Performance_Reviews
```

## Testing Checklist

- [ ] Upload document
- [ ] Create new version of document
- [ ] View document history
- [ ] Search for document by name
- [ ] Search by batch number
- [ ] Filter documents by category
- [ ] Download document
- [ ] Email document
- [ ] Delete document (soft delete)
- [ ] Archive old documents
- [ ] Generate document access report
- [ ] Bulk upload documents
- [ ] Apply digital signature
- [ ] Generate QR code for document

## Future Enhancements

1. **AI-Powered Features**
   - Automatic document classification
   - Smart tagging
   - Content extraction
   - Document summarization

2. **Advanced Search**
   - Natural language search
   - Similar document suggestions
   - Semantic search

3. **Collaboration**
   - Document commenting
   - Real-time co-editing
   - Approval workflows

4. **Integration**
   - Google Drive sync
   - OneDrive sync
   - Email system integration
