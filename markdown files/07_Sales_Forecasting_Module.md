# Sales & Forecasting Module

## Overview
Manages sales orders, forecasting, invoice generation, and customer communications.

## Database Entities

### sales_orders
```sql
CREATE TABLE sales_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID REFERENCES contacts(id),
    quote_id UUID REFERENCES quotes(id),
    
    order_date DATE NOT NULL,
    delivery_date DATE,
    delivery_address TEXT,
    
    subtotal DECIMAL(15,2),
    tax_amount DECIMAL(15,2),
    total_amount DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'ZAR',
    
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'production', 'ready', 'dispatched', 'delivered', 'cancelled')),
    
    payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'partial', 'paid', 'overdue')),
    payment_terms VARCHAR(255),
    
    sales_person_id UUID REFERENCES users(id),
    
    palladium_order_id VARCHAR(100),
    synced_to_palladium BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### sales_order_items
```sql
CREATE TABLE sales_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sales_order_id UUID REFERENCES sales_orders(id),
    line_number INTEGER,
    
    product_type VARCHAR(20),
    style VARCHAR(50),
    grade VARCHAR(50),
    description TEXT,
    
    quantity_kg DECIMAL(12,2),
    unit_price DECIMAL(12,2),
    line_total DECIMAL(15,2),
    
    reserved_stock_items UUID[],
    allocated BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### sales_forecasts
```sql
CREATE TABLE sales_forecasts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    forecast_period VARCHAR(20),
    forecast_month DATE,
    
    product_type VARCHAR(20),
    style VARCHAR(50),
    
    forecasted_quantity_kg DECIMAL(12,2),
    forecasted_value_zar DECIMAL(15,2),
    
    actual_quantity_kg DECIMAL(12,2),
    actual_value_zar DECIMAL(15,2),
    
    variance_percentage DECIMAL(5,2),
    
    notes TEXT,
    
    created_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### invoices
```sql
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    invoice_type VARCHAR(20) CHECK (invoice_type IN ('sales', 'credit_note', 'debit_note')),
    
    sales_order_id UUID REFERENCES sales_orders(id),
    customer_id UUID REFERENCES contacts(id),
    
    invoice_date DATE NOT NULL,
    due_date DATE,
    
    subtotal DECIMAL(15,2),
    tax_amount DECIMAL(15,2),
    total_amount DECIMAL(15,2),
    amount_paid DECIMAL(15,2) DEFAULT 0,
    balance_due DECIMAL(15,2),
    
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled')),
    
    payment_terms VARCHAR(255),
    payment_reference VARCHAR(100),
    
    palladium_invoice_id VARCHAR(100),
    synced_to_palladium BOOLEAN DEFAULT false,
    
    document_url VARCHAR(500),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE
);
```

## Business Rules

1. **Order Processing**: Draft → Confirmed → Production → Ready → Dispatched
2. **Stock Allocation**: Reserve stock when order confirmed
3. **Pricing**: Current price list, volume discounts, customer-specific pricing
4. **Credit Check**: Check credit limit before order confirmation
5. **Invoicing**: Generate invoice on dispatch
6. **Payment Terms**: Standard 30 days, key accounts 60 days
7. **Forecasting**: Monthly forecasts by product/style, reviewed quarterly

## Key Features

- Order entry and management
- Stock allocation and reservation
- Automated invoice generation
- Payment tracking
- Sales forecasting with variance analysis
- Customer order history
- Integration with Palladium ERP for orders and invoices
