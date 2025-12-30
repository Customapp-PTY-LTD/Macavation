# Stock Management Module

## Overview
Tracks kernel and oil stock on hand, batch movements, transfer sheets, stock takes, and mass balance calculations.

## Database Entities

### stock_items
```sql
CREATE TABLE stock_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stock_number VARCHAR(50) UNIQUE NOT NULL,
    product_type VARCHAR(20) CHECK (product_type IN ('kernel', 'oil', 'nis')),
    style VARCHAR(50),
    grade VARCHAR(50),
    batch_number VARCHAR(100),
    
    quantity_kg DECIMAL(12,2) NOT NULL,
    location VARCHAR(100),
    cold_room VARCHAR(50),
    position VARCHAR(50),
    
    received_date DATE,
    packed_date DATE,
    best_before_date DATE,
    
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'hold', 'dispatched', 'disposed')),
    quality_status VARCHAR(20) DEFAULT 'released' CHECK (quality_status IN ('pending', 'released', 'hold', 'rejected')),
    
    production_batch_id UUID REFERENCES production_batches(id),
    supplier_id UUID REFERENCES contacts(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### stock_movements
```sql
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    movement_number VARCHAR(50) UNIQUE NOT NULL,
    stock_item_id UUID REFERENCES stock_items(id),
    
    movement_type VARCHAR(50) CHECK (movement_type IN ('receipt', 'production', 'transfer', 'dispatch', 'adjustment', 'disposal')),
    movement_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    quantity_kg DECIMAL(12,2) NOT NULL,
    
    from_location VARCHAR(100),
    to_location VARCHAR(100),
    
    reference_type VARCHAR(50),
    reference_id UUID,
    
    reason TEXT,
    notes TEXT,
    
    moved_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### stock_takes
```sql
CREATE TABLE stock_takes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stock_take_number VARCHAR(50) UNIQUE NOT NULL,
    stock_take_date DATE NOT NULL,
    
    location VARCHAR(100),
    product_type VARCHAR(20),
    
    status VARCHAR(20) DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'approved')),
    
    system_quantity_kg DECIMAL(12,2),
    physical_quantity_kg DECIMAL(12,2),
    variance_kg DECIMAL(12,2),
    variance_percentage DECIMAL(5,2),
    
    conducted_by UUID REFERENCES users(id),
    verified_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    variance_explanation TEXT,
    adjustments_made TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);
```

## Business Rules

1. **FIFO Principle**: First-in-first-out for stock allocation
2. **Stock Reservations**: Stock reserved for confirmed orders
3. **Minimum Stock Levels**: Alert when stock falls below minimum
4. **Stock Takes**: Monthly for all stock, weekly for high-value items
5. **Variance Tolerance**: ±2% acceptable, >2% requires investigation
6. **Quality Release**: Stock cannot be dispatched without positive release

## Key Features

- Real-time stock tracking
- Automatic stock updates from production
- Transfer sheet generation
- Stock age analysis (FEFO - First Expired First Out)
- Stock valuation
- Integration with Palladium ERP
