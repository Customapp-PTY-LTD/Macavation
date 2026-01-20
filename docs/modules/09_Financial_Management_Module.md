# Financial Management Module

## Overview
Manages grower payments, purchase orders, creditors, invoicing, account management, and financial reporting.

## Database Entities

### purchase_orders
```sql
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_number VARCHAR(50) UNIQUE NOT NULL,
    
    supplier_id UUID REFERENCES contacts(id),
    supplier_name VARCHAR(255),
    
    po_date DATE NOT NULL,
    delivery_date DATE,
    
    order_type VARCHAR(50) CHECK (order_type IN ('raw_material', 'packaging', 'services', 'equipment', 'other')),
    
    subtotal DECIMAL(15,2),
    vat_amount DECIMAL(15,2),
    total_amount DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'ZAR',
    
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'acknowledged', 'delivered', 'invoiced', 'paid', 'cancelled')),
    
    payment_terms VARCHAR(255),
    delivery_address TEXT,
    
    requested_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    palladium_po_id VARCHAR(100),
    synced_to_palladium BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_at TIMESTAMP WITH TIME ZONE
);
```

### purchase_order_items
```sql
CREATE TABLE purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID REFERENCES purchase_orders(id),
    line_number INTEGER,
    
    item_code VARCHAR(100),
    description TEXT NOT NULL,
    
    quantity DECIMAL(12,2),
    unit_of_measure VARCHAR(20),
    unit_price DECIMAL(12,2),
    line_total DECIMAL(15,2),
    
    delivery_date DATE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### supplier_invoices
```sql
CREATE TABLE supplier_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) NOT NULL,
    supplier_invoice_number VARCHAR(100),
    
    supplier_id UUID REFERENCES contacts(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),
    
    invoice_date DATE NOT NULL,
    due_date DATE,
    
    subtotal DECIMAL(15,2),
    vat_amount DECIMAL(15,2),
    total_amount DECIMAL(15,2),
    amount_paid DECIMAL(15,2) DEFAULT 0,
    balance_due DECIMAL(15,2),
    
    status VARCHAR(20) DEFAULT 'received' CHECK (status IN ('received', 'verified', 'approved', 'scheduled', 'paid', 'disputed')),
    
    payment_terms VARCHAR(255),
    
    invoice_document_url VARCHAR(500),
    
    verified_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    paid_by UUID REFERENCES users(id),
    
    palladium_invoice_id VARCHAR(100),
    synced_to_palladium BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    paid_at TIMESTAMP WITH TIME ZONE
);
```

### payments
```sql
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_number VARCHAR(50) UNIQUE NOT NULL,
    
    payment_type VARCHAR(20) CHECK (payment_type IN ('supplier', 'grower', 'expense', 'refund')),
    
    payee_type VARCHAR(20) CHECK (payee_type IN ('supplier', 'grower', 'employee', 'other')),
    payee_id UUID, -- References contacts or users
    payee_name VARCHAR(255),
    
    payment_date DATE NOT NULL,
    payment_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',
    
    payment_method VARCHAR(50) CHECK (payment_method IN ('eft', 'cash', 'cheque', 'card', 'other')),
    payment_reference VARCHAR(100),
    bank_reference VARCHAR(100),
    
    -- Related Documents
    invoice_id UUID,
    grower_payment_id UUID REFERENCES grower_payments(id),
    purchase_order_id UUID REFERENCES purchase_orders(id),
    
    notes TEXT,
    
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processed', 'cleared', 'failed', 'cancelled')),
    
    processed_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    palladium_payment_id VARCHAR(100),
    synced_to_palladium BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);
```

### expense_claims
```sql
CREATE TABLE expense_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    claim_number VARCHAR(50) UNIQUE NOT NULL,
    
    employee_id UUID REFERENCES users(id),
    employee_name VARCHAR(255),
    
    claim_date DATE NOT NULL,
    expense_date DATE NOT NULL,
    
    expense_category VARCHAR(100),
    expense_description TEXT,
    
    amount DECIMAL(15,2) NOT NULL,
    vat_amount DECIMAL(15,2),
    
    receipt_url VARCHAR(500),
    
    status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'paid')),
    
    approved_by UUID REFERENCES users(id),
    approval_date DATE,
    rejection_reason TEXT,
    
    paid_by UUID REFERENCES users(id),
    payment_date DATE,
    payment_reference VARCHAR(100),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### budget_items
```sql
CREATE TABLE budget_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    fiscal_year INTEGER NOT NULL,
    fiscal_month INTEGER,
    
    category VARCHAR(100) NOT NULL,
    subcategory VARCHAR(100),
    
    budgeted_amount DECIMAL(15,2) NOT NULL,
    actual_amount DECIMAL(15,2) DEFAULT 0,
    variance DECIMAL(15,2),
    variance_percentage DECIMAL(5,2),
    
    notes TEXT,
    
    created_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### account_reconciliation
```sql
CREATE TABLE account_reconciliation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reconciliation_number VARCHAR(50) UNIQUE NOT NULL,
    
    account_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100),
    
    statement_date DATE NOT NULL,
    reconciliation_date DATE NOT NULL,
    
    opening_balance DECIMAL(15,2),
    closing_balance DECIMAL(15,2),
    
    system_balance DECIMAL(15,2),
    statement_balance DECIMAL(15,2),
    variance DECIMAL(15,2),
    
    reconciled BOOLEAN DEFAULT false,
    variance_explanation TEXT,
    
    reconciled_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    statement_document_url VARCHAR(500),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Business Rules

### Purchase Order Rules

1. **PO Approval Limits**
   - <R10,000: Office Administrator
   - R10,000-R50,000: General Manager
   - >R50,000: General Manager + Director approval

2. **PO Workflow**
   - Draft → Approval → Sent to Supplier → Acknowledged → Delivered → Invoiced → Paid

3. **Three-Way Matching**
   - PO vs. Goods Receipt vs. Invoice
   - Quantities must match within tolerance (±5%)
   - Prices must match exactly

### Payment Rules

1. **Payment Terms**
   - Standard: 30 days from invoice date
   - Key suppliers: Negotiate terms
   - Growers: 7 days from batch completion
   - Cash purchases: Immediate

2. **Payment Approval**
   - <R50,000: Office Administrator
   - R50,000-R200,000: General Manager
   - >R200,000: General Manager + Director

3. **Payment Methods**
   - EFT: Primary method (95%)
   - Cash: Petty cash <R5,000
   - Cheque: Legacy suppliers only
   - Card: Small purchases only

4. **Payment Batch Processing**
   - Weekly payment runs: Wednesdays
   - Urgent payments: As required with approval
   - Grower payments: Weekly on Fridays

### Grower Payment Integration

1. **Payment Calculation** (from Grower Intake module)
   ```
   Net Kernel Kg × Price per Kg = Gross Amount
   - Deductions (moisture, unsound)
   - Transport fees
   = Net Amount
   + VAT (15%)
   = Total Payment
   ```

2. **Payment Authorization**
   - Requires completed batch processing
   - Quality release required
   - GM approval >R100,000
   - Supplier invoice received

3. **Payment Processing**
   - Generate payment in system
   - Sync to Palladium
   - Process via banking system
   - Email remittance advice to grower

### Invoice Processing

1. **Invoice Receipt**
   - Receive physical/electronic invoice
   - Capture in system
   - Match to PO and goods receipt
   - Verify pricing and quantities

2. **Invoice Approval**
   - Finance verification
   - Department manager approval
   - GM approval for high-value

3. **Payment Scheduling**
   - Respect payment terms
   - Take early payment discounts where beneficial
   - Batch payments for efficiency

### Budget Management

1. **Budget Creation**
   - Annual budget by category
   - Monthly breakdown
   - Departmental allocation
   - Approved by management

2. **Budget Monitoring**
   - Monthly variance reports
   - Alert when >10% over budget
   - Explanation required for variances
   - Quarterly budget reviews

3. **Budget Adjustments**
   - Requires justification
   - GM approval
   - Document reason for change

## Integration Points

### Palladium ERP Integration

1. **Purchase Orders**
   - POs created in custom system
   - Synced to Palladium for procurement
   - GRN in Palladium updates custom system

2. **Supplier Invoices**
   - Invoices captured in custom system
   - Three-way match performed
   - Approved invoices sync to Palladium
   - Payment processed in Palladium

3. **Grower Payments**
   - Payment calculations in custom system
   - Create purchase invoice in Palladium
   - Payment processed via Palladium
   - Status synced back to custom system

4. **Customer Invoices**
   - Sales orders from custom system
   - Invoices generated in Palladium
   - Status synced to custom system
   - Payment receipts update custom system

### Banking Integration

1. **Payment File Generation**
   - Export payments in bank format
   - SWIFT/ACH format support
   - Batch payment files

2. **Bank Statement Import**
   - Import bank statements
   - Auto-match payments
   - Reconciliation assistance

## Key Features

- Purchase order management
- Three-way matching
- Supplier invoice processing
- Payment scheduling and batch processing
- Grower payment calculations
- Expense claim management
- Budget tracking and variance analysis
- Account reconciliation
- Financial reporting
- Integration with Palladium ERP

## Reporting Requirements

### Standard Reports

1. **Accounts Payable Aging**
   - Outstanding invoices by age bracket
   - By supplier
   - Overdue invoices highlighted

2. **Accounts Receivable Aging**
   - Outstanding customer invoices
   - By customer
   - Credit limit monitoring

3. **Cash Flow Forecast**
   - Expected receipts
   - Expected payments
   - Net cash position

4. **Budget vs. Actual**
   - By category and month
   - Variance analysis
   - Year-to-date summary

5. **Payment Summary**
   - Payments by type
   - Payments by supplier/grower
   - Payment method analysis

6. **Grower Payment Report**
   - Payments by grower
   - Payment history
   - Outstanding payments

## Testing Checklist

- [ ] Create purchase order
- [ ] Approve purchase order
- [ ] Receive goods against PO
- [ ] Capture supplier invoice
- [ ] Perform three-way match
- [ ] Approve invoice for payment
- [ ] Schedule payment
- [ ] Process payment batch
- [ ] Record grower payment
- [ ] Sync payment to Palladium
- [ ] Submit expense claim
- [ ] Approve expense claim
- [ ] Reconcile bank account
- [ ] Generate AP aging report
- [ ] Generate budget variance report
- [ ] Calculate cash flow forecast

## Future Enhancements

1. **AI-Powered Insights**
   - Spend analysis and optimization
   - Supplier payment term optimization
   - Cash flow predictions

2. **Automated Workflows**
   - OCR for invoice capture
   - Automated PO-GRN-Invoice matching
   - Smart payment scheduling

3. **Enhanced Reporting**
   - Real-time dashboards
   - Predictive analytics
   - Drill-down capabilities
