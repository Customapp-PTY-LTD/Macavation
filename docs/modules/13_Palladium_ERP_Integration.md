# Palladium ERP Integration Module

## Overview
Bidirectional integration with Macavation's existing Palladium ERP system via SOAP API for seamless data synchronization across customer master, stock, orders, invoices, and financial transactions.

## Integration Architecture

### Integration Method
- **Protocol**: SOAP (Simple Object Access Protocol)
- **Data Format**: XML
- **Authentication**: API credentials provided by L Systems
- **Connection**: HTTPS with SSL/TLS encryption
- **Frequency**: Real-time for critical data, batch for bulk operations

### Contact Person
- **Paul Baillie** - L Systems (Palladium support provider)
- Responsible for API access, documentation, and technical support

## Database Entities

### integration_sync_log
```sql
CREATE TABLE integration_sync_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    sync_type VARCHAR(100) NOT NULL,
    sync_direction VARCHAR(20) CHECK (sync_direction IN ('to_palladium', 'from_palladium', 'bidirectional')),
    
    entity_type VARCHAR(100),
    entity_id UUID,
    entity_reference VARCHAR(255),
    
    palladium_id VARCHAR(100),
    
    sync_status VARCHAR(20) CHECK (sync_status IN ('pending', 'in_progress', 'success', 'failed', 'partial')),
    
    request_payload TEXT,
    response_payload TEXT,
    error_message TEXT,
    
    sync_started_at TIMESTAMP WITH TIME ZONE,
    sync_completed_at TIMESTAMP WITH TIME ZONE,
    
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_integration_sync_log_type ON integration_sync_log(sync_type);
CREATE INDEX idx_integration_sync_log_status ON integration_sync_log(sync_status);
CREATE INDEX idx_integration_sync_log_entity ON integration_sync_log(entity_type, entity_id);
CREATE INDEX idx_integration_sync_log_palladium ON integration_sync_log(palladium_id);
```

### integration_mapping
```sql
CREATE TABLE integration_mapping (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    custom_entity VARCHAR(100) NOT NULL,
    custom_field VARCHAR(100) NOT NULL,
    custom_value VARCHAR(255),
    
    palladium_entity VARCHAR(100) NOT NULL,
    palladium_field VARCHAR(100) NOT NULL,
    palladium_value VARCHAR(255),
    
    mapping_type VARCHAR(50),
    transformation_rule TEXT,
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Integration Points

### 1. Customer Master Data

**Direction**: Bidirectional

**Custom System → Palladium**
- New customer creation
- Customer details updates (address, contact, terms)
- Credit limit changes
- Customer status changes

**Palladium → Custom System**
- Customer account numbers
- Credit status updates
- Payment history
- Account balance

**Sync Frequency**: Real-time on changes

**Data Mapping**:
```
Custom System              Palladium
------------------        ------------------
contacts.id               CustomerID
contacts.company_name     CustomerName
contacts.vat_number       TaxNumber
contacts.credit_limit     CreditLimit
contacts.payment_terms    PaymentTerms
```

### 2. Supplier Master Data

**Direction**: Bidirectional

**Custom System → Palladium**
- New supplier creation
- Supplier details updates
- Payment terms

**Palladium → Custom System**
- Supplier account numbers
- Payment status
- Account balance

**Sync Frequency**: Real-time on changes

### 3. Stock/Inventory

**Direction**: Bidirectional

**Custom System → Palladium**
- Production completion (goods receipt)
- Stock adjustments
- Stock transfers
- Quality release status

**Palladium → Custom System**
- Stock levels (for reconciliation)
- Stock locations
- Stock valuations
- Stock movements from Palladium sales

**Sync Frequency**: 
- Production completion: Real-time
- Stock reconciliation: Daily at 6 AM

**Data Mapping**:
```
Custom System                  Palladium
----------------------------  ----------------------------
stock_items.stock_number      StockItemCode
stock_items.product_type      ProductType
stock_items.style             ProductStyle
stock_items.quantity_kg       QuantityOnHand
stock_items.location          WarehouseLocation
stock_items.batch_number      BatchNumber
```

### 4. Sales Orders

**Direction**: Bidirectional

**Custom System → Palladium**
- New sales orders
- Order status updates
- Order cancellations

**Palladium → Custom System**
- Order confirmations
- Dispatch status
- Delivery status

**Sync Frequency**: Real-time

**Data Mapping**:
```
Custom System                    Palladium
------------------------------  ------------------------------
sales_orders.order_number       SalesOrderNumber
sales_orders.customer_id        CustomerID
sales_orders.order_date         OrderDate
sales_orders.delivery_date      DeliveryDate
sales_orders.total_amount       OrderTotal
sales_order_items.product_code  ProductCode
sales_order_items.quantity_kg   OrderQuantity
sales_order_items.unit_price    UnitPrice
```

### 5. Invoicing

**Direction**: Bidirectional

**Custom System → Palladium**
- Invoice generation requests
- Credit notes
- Debit notes

**Palladium → Custom System**
- Generated invoices (with Palladium invoice numbers)
- Invoice status updates
- Payment receipts

**Sync Frequency**: Real-time for invoice generation

**Data Mapping**:
```
Custom System                 Palladium
---------------------------  ---------------------------
invoices.invoice_number      InvoiceNumber (Palladium-generated)
invoices.customer_id         CustomerID
invoices.invoice_date        InvoiceDate
invoices.due_date            DueDate
invoices.total_amount        InvoiceTotal
invoices.status              InvoiceStatus
```

### 6. Grower Payments (Purchase Invoices)

**Direction**: Custom System → Palladium

**Flow**:
1. Custom system calculates grower payment
2. Create purchase invoice in Palladium
3. Payment processed via Palladium
4. Payment status synced back to custom system

**Sync Frequency**: Real-time on payment approval

**Data Mapping**:
```
Custom System                        Palladium
----------------------------------  ----------------------------------
grower_payments.payment_number      PurchaseInvoiceNumber
grower_payments.supplier_id         SupplierID
grower_payments.batch_id            BatchReference
grower_payments.total_payment       InvoiceAmount
grower_payments.payment_date        PaymentDate
```

### 7. Purchase Orders

**Direction**: Bidirectional

**Custom System → Palladium**
- PO creation
- PO updates
- PO cancellations

**Palladium → Custom System**
- PO acknowledgment
- Goods received notes (GRN)
- PO completion status

**Sync Frequency**: Real-time

### 8. Financial Transactions

**Direction**: Bidirectional

**Custom System → Palladium**
- Payment instructions
- Journal entries (if applicable)

**Palladium → Custom System**
- Payment confirmations
- Bank reconciliation data
- General ledger summaries

**Sync Frequency**: 
- Payments: Real-time
- GL data: Daily

## API Endpoints (SOAP Services)

### Customer Services
```xml
<!-- Create Customer -->
<CreateCustomer>
  <CustomerName>string</CustomerName>
  <TaxNumber>string</TaxNumber>
  <Address>string</Address>
  <ContactPerson>string</ContactPerson>
  <Email>string</Email>
  <Phone>string</Phone>
  <CreditLimit>decimal</CreditLimit>
  <PaymentTerms>string</PaymentTerms>
</CreateCustomer>

<!-- Update Customer -->
<UpdateCustomer>
  <CustomerID>string</CustomerID>
  <CustomerData>...</CustomerData>
</UpdateCustomer>

<!-- Get Customer -->
<GetCustomer>
  <CustomerID>string</CustomerID>
</GetCustomer>
```

### Stock Services
```xml
<!-- Create Stock Item -->
<CreateStockItem>
  <ProductCode>string</ProductCode>
  <ProductDescription>string</ProductDescription>
  <Quantity>decimal</Quantity>
  <UOM>string</UOM>
  <BatchNumber>string</BatchNumber>
  <Location>string</Location>
</CreateStockItem>

<!-- Update Stock Quantity -->
<UpdateStockQuantity>
  <ProductCode>string</ProductCode>
  <QuantityChange>decimal</QuantityChange>
  <TransactionType>string</TransactionType>
  <Reference>string</Reference>
</UpdateStockQuantity>

<!-- Get Stock Level -->
<GetStockLevel>
  <ProductCode>string</ProductCode>
  <Location>string</Location>
</GetStockLevel>
```

### Sales Order Services
```xml
<!-- Create Sales Order -->
<CreateSalesOrder>
  <CustomerID>string</CustomerID>
  <OrderDate>date</OrderDate>
  <DeliveryDate>date</DeliveryDate>
  <OrderLines>
    <OrderLine>
      <ProductCode>string</ProductCode>
      <Quantity>decimal</Quantity>
      <UnitPrice>decimal</UnitPrice>
    </OrderLine>
  </OrderLines>
</CreateSalesOrder>

<!-- Update Order Status -->
<UpdateOrderStatus>
  <OrderNumber>string</OrderNumber>
  <Status>string</Status>
</UpdateOrderStatus>
```

### Invoice Services
```xml
<!-- Generate Invoice -->
<GenerateInvoice>
  <OrderNumber>string</OrderNumber>
  <InvoiceDate>date</InvoiceDate>
  <DueDate>date</DueDate>
</GenerateInvoice>

<!-- Get Invoice Status -->
<GetInvoiceStatus>
  <InvoiceNumber>string</InvoiceNumber>
</GetInvoiceStatus>
```

### Payment Services
```xml
<!-- Create Purchase Invoice (Grower Payment) -->
<CreatePurchaseInvoice>
  <SupplierID>string</SupplierID>
  <InvoiceDate>date</InvoiceDate>
  <InvoiceAmount>decimal</InvoiceAmount>
  <TaxAmount>decimal</TaxAmount>
  <Reference>string</Reference>
</CreatePurchaseInvoice>

<!-- Process Payment -->
<ProcessPayment>
  <InvoiceNumber>string</InvoiceNumber>
  <PaymentAmount>decimal</PaymentAmount>
  <PaymentDate>date</PaymentDate>
  <PaymentMethod>string</PaymentMethod>
</ProcessPayment>
```

## Error Handling & Retry Logic

### Error Categories

1. **Connection Errors**
   - Network timeout
   - Service unavailable
   - Authentication failure
   
   **Action**: Retry with exponential backoff (1min, 5min, 15min, 30min, 1hr)

2. **Data Validation Errors**
   - Invalid data format
   - Missing required fields
   - Business rule violations
   
   **Action**: Log error, notify user, no automatic retry

3. **Business Logic Errors**
   - Customer credit limit exceeded
   - Stock not available
   - Duplicate record
   
   **Action**: Log error, notify user, manual intervention required

4. **Partial Success**
   - Some records processed, some failed
   
   **Action**: Mark successful records, retry failed records

### Retry Policy

- Maximum retries: 5
- Retry intervals: 1min, 5min, 15min, 30min, 1hr
- After 5 failures: Manual intervention required
- Critical transactions: Immediate notification to admin

### Monitoring & Alerts

- Failed sync count threshold: 10 failures → Alert
- Sync lag threshold: >30 minutes → Alert
- Error rate threshold: >5% → Alert
- Daily sync summary report

## Sync Status Dashboard

### Metrics Displayed

- Sync success rate (last 24 hours)
- Failed syncs requiring attention
- Average sync time
- Last successful sync by entity type
- Pending sync queue size
- Error breakdown by type

### Alert Notifications

- Email to: Office Administrator, General Manager
- SMS for critical failures
- Dashboard badge for pending items

## Data Consistency & Reconciliation

### Daily Reconciliation

1. **Customer Balance Reconciliation**
   - Compare customer balances
   - Identify discrepancies
   - Generate reconciliation report

2. **Stock Reconciliation**
   - Compare stock levels
   - Identify variances
   - Investigate discrepancies >2%

3. **Invoice Reconciliation**
   - Match invoices in both systems
   - Verify amounts and statuses
   - Flag missing or duplicate invoices

4. **Payment Reconciliation**
   - Match payment records
   - Verify payment amounts
   - Identify unmatched payments

### Reconciliation Report

Generated daily at 6 AM, includes:
- Total records compared
- Matching records count
- Discrepancy count
- Value of discrepancies
- Action items

## Testing & Validation

### Integration Testing

- [ ] Create customer in custom system, verify in Palladium
- [ ] Update customer in Palladium, verify sync to custom system
- [ ] Create stock item from production, verify in Palladium
- [ ] Update stock quantity in Palladium, verify in custom system
- [ ] Create sales order, verify sync to Palladium
- [ ] Generate invoice in Palladium, verify in custom system
- [ ] Create grower payment, verify purchase invoice in Palladium
- [ ] Process payment in Palladium, verify status update in custom system
- [ ] Test error handling for network failures
- [ ] Test retry logic for failed syncs
- [ ] Verify data consistency after sync failures
- [ ] Test reconciliation process

### Performance Testing

- Sync 100 records, measure time
- Concurrent sync operations
- Large batch sync (1000+ records)
- Peak load testing

## Documentation Requirements

### Technical Documentation

- API endpoint specifications
- Authentication procedures
- Data mapping tables
- Error codes and meanings
- Retry logic flowcharts
- Reconciliation procedures

### User Documentation

- Sync status interpretation
- Manual sync triggers
- Error resolution procedures
- Reconciliation report reading
- When to contact support

## Support & Maintenance

### L Systems Support

- **Contact**: Paul Baillie
- **For**: API issues, Palladium configuration, data mapping questions
- **SLA**: Response within 4 business hours

### Internal Support

- **Office Administrator**: First-line support for sync issues
- **IT Administrator**: Technical troubleshooting
- **General Manager**: Escalation for critical failures

### Maintenance Windows

- Palladium updates: Scheduled by L Systems
- Integration updates: Coordinated with Palladium maintenance
- Testing window: After business hours

## Security & Compliance

- API credentials stored encrypted
- HTTPS only for all communications
- Audit log of all sync activities
- Data privacy compliance (POPIA)
- Regular security reviews

## Future Enhancements

1. **Real-time Event Webhooks**
   - Replace polling with event-driven sync
   - Immediate updates from Palladium

2. **Advanced Reconciliation**
   - AI-powered discrepancy detection
   - Automatic reconciliation suggestions

3. **Performance Optimization**
   - Batch processing optimization
   - Parallel sync operations
   - Caching layer

4. **Enhanced Monitoring**
   - Real-time sync dashboard
   - Predictive failure alerts
   - Performance analytics
