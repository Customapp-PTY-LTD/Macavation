# Oil Production Workflow Module (11 Steps)

## Overview
Manages the complete 11-step production workflow for macadamia oil production from raw material intake through to final dispatch.

## Production Workflow Steps

1. **Raw Material Intake** - Receive butter grade kernels or broken kernels
2. **Kernel Preparation** - Sort and prepare kernels for pressing
3. **Cold Pressing** - Extract oil via cold press method
4. **Settling** - Allow oil to settle and separate solids
5. **Filtering** - Filter oil to remove particulates
6. **Quality Testing** - Test FFA, PV, moisture, color, clarity
7. **Storage Tanks** - Store in food-grade stainless steel tanks
8. **Packing** - Fill bottles/drums with oil
9. **Gas Flushing** - Nitrogen flush for shelf life extension
10. **Labeling & Boxing** - Apply labels and pack in cartons
11. **Dispatch** - Load and dispatch to customers

## Database Entities

### oil_production_batches
```sql
CREATE TABLE oil_production_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Input Material
    kernel_input_kg DECIMAL(10,2) NOT NULL,
    kernel_source VARCHAR(100), -- butter grade, broken, etc.
    kernel_batch_numbers TEXT[],
    
    -- Production Dates
    production_date DATE NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    
    -- Oil Output
    oil_output_litres DECIMAL(10,2),
    oil_output_kg DECIMAL(10,2),
    oil_yield_percentage DECIMAL(5,2),
    
    -- Cake Output (by-product)
    oil_cake_kg DECIMAL(10,2),
    
    -- Current Status
    current_step INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'intake' CHECK (status IN (
        'intake', 'preparation', 'pressing', 'settling', 'filtering',
        'testing', 'storage', 'packing', 'gas_flush', 'labeling', 'completed', 'hold'
    )),
    
    -- Quality
    quality_hold BOOLEAN DEFAULT false,
    positive_release BOOLEAN DEFAULT false,
    release_date TIMESTAMP WITH TIME ZONE,
    released_by UUID REFERENCES users(id),
    
    -- Personnel
    production_manager_id UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);
```

### oil_batch_step_records
```sql
CREATE TABLE oil_batch_step_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    oil_batch_id UUID REFERENCES oil_production_batches(id),
    step_number INTEGER NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    
    operator_id UUID REFERENCES users(id),
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
    
    input_quantity DECIMAL(10,2),
    output_quantity DECIMAL(10,2),
    
    -- Step-specific data
    step_data JSONB,
    
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(oil_batch_id, step_number)
);
```

### oil_pressing_records
```sql
CREATE TABLE oil_pressing_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    oil_batch_id UUID REFERENCES oil_production_batches(id),
    
    pressing_date DATE NOT NULL,
    pressing_time TIME,
    
    -- Input
    kernel_input_kg DECIMAL(10,2),
    
    -- Output
    oil_output_litres DECIMAL(10,2),
    oil_output_kg DECIMAL(10,2),
    oil_cake_kg DECIMAL(10,2),
    
    -- Pressing Parameters
    press_temperature_celsius DECIMAL(5,2),
    press_pressure_bar DECIMAL(5,2),
    press_speed_rpm DECIMAL(5,2),
    
    -- Yield
    oil_yield_percentage DECIMAL(5,2),
    
    -- Quality checks during pressing
    color_observation VARCHAR(255),
    clarity_observation VARCHAR(255),
    smell_observation VARCHAR(255),
    
    operator_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### oil_filtering_records
```sql
CREATE TABLE oil_filtering_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    oil_batch_id UUID REFERENCES oil_production_batches(id),
    
    filtering_date DATE NOT NULL,
    
    -- Input
    unfiltered_oil_litres DECIMAL(10,2),
    
    -- Output
    filtered_oil_litres DECIMAL(10,2),
    filter_waste_litres DECIMAL(10,2),
    
    -- Filter Details
    filter_type VARCHAR(100),
    filter_micron_rating INTEGER,
    filter_passes INTEGER,
    
    -- Quality
    clarity_before VARCHAR(50),
    clarity_after VARCHAR(50),
    
    operator_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### oil_packing_records
```sql
CREATE TABLE oil_packing_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    oil_batch_id UUID REFERENCES oil_production_batches(id),
    
    packing_date DATE NOT NULL,
    
    -- Container Type
    container_type VARCHAR(50), -- 250ml, 500ml, 1L, 5L, 20L drum, IBC
    container_size_ml INTEGER,
    
    -- Quantities
    units_packed INTEGER,
    total_volume_litres DECIMAL(10,2),
    
    -- Batch Code
    batch_code VARCHAR(100),
    best_before_date DATE,
    
    -- Gas Flushing
    gas_flushed BOOLEAN DEFAULT false,
    nitrogen_pressure_bar DECIMAL(5,2),
    
    operator_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### oil_stock_on_hand
```sql
CREATE TABLE oil_stock_on_hand (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Product Details
    oil_type VARCHAR(50) DEFAULT 'macadamia',
    product_code VARCHAR(100),
    batch_number VARCHAR(100),
    
    -- Container
    container_type VARCHAR(50),
    container_size_ml INTEGER,
    units_available INTEGER,
    
    -- Volume
    volume_litres DECIMAL(10,2),
    volume_kg DECIMAL(10,2),
    
    -- Location
    storage_location VARCHAR(100),
    tank_number VARCHAR(50),
    
    -- Dates
    production_date DATE,
    packing_date DATE,
    best_before_date DATE,
    
    -- Quality
    quality_status VARCHAR(20) DEFAULT 'released',
    ffa_percentage DECIMAL(5,2),
    peroxide_value DECIMAL(10,2),
    
    -- Status
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'hold', 'dispatched')),
    
    oil_batch_id UUID REFERENCES oil_production_batches(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### oil_gmp_checklists
```sql
CREATE TABLE oil_gmp_checklists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    checklist_date DATE NOT NULL,
    
    -- Cleanliness
    equipment_cleaned BOOLEAN,
    floor_cleaned BOOLEAN,
    walls_cleaned BOOLEAN,
    
    -- Equipment Checks
    press_operational BOOLEAN,
    press_temperature_calibrated BOOLEAN,
    filters_clean BOOLEAN,
    tanks_sanitized BOOLEAN,
    
    -- Quality Checks
    ffa_test_completed BOOLEAN,
    ffa_result DECIMAL(5,2),
    
    -- Packing Equipment
    filling_machine_calibrated BOOLEAN,
    nitrogen_system_operational BOOLEAN,
    nitrogen_purity_check BOOLEAN,
    
    -- Storage Conditions
    tank_temperatures_check BOOLEAN,
    tank_1_temp_celsius DECIMAL(5,2),
    tank_2_temp_celsius DECIMAL(5,2),
    tank_3_temp_celsius DECIMAL(5,2),
    
    -- Personnel Hygiene
    staff_hairnets BOOLEAN,
    staff_gloves BOOLEAN,
    hand_washing_compliance BOOLEAN,
    
    -- General
    general_observations TEXT,
    issues_found TEXT,
    corrective_actions TEXT,
    
    checked_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Business Rules

### Production Rules

1. **Raw Material Requirements**
   - Only butter grade or broken kernels accepted
   - Moisture content: <2%
   - FFA: <0.15%
   - No rancidity or off-flavors

2. **Cold Pressing Parameters**
   - Temperature: <50°C (cold press)
   - Yield target: 68-72% by weight
   - Press speed optimized for quality over yield

3. **Oil Quality Standards**
   ```
   Virgin Macadamia Oil:
   - FFA: ≤0.10%
   - PV: ≤2.0 meq/kg
   - Moisture: ≤0.05%
   - Color: Pale yellow to golden
   - Clarity: Clear, no sediment
   ```

4. **Settling Time**
   - Minimum 24 hours before filtering
   - Temperature controlled 18-22°C

5. **Filtration**
   - Dual filtration: 10 micron then 5 micron
   - Verify clarity after each pass

### Packing Rules

1. **Container Specifications**
   - Food-grade materials only
   - Dark glass or opaque containers for retail
   - Stainless steel drums for bulk
   - IBCs for very large orders

2. **Gas Flushing**
   - Nitrogen flush for extended shelf life
   - Reduces oxygen to <2%
   - Increases shelf life from 18 to 24 months

3. **Labeling Requirements**
   - Product name and description
   - Batch number
   - Best before date
   - Storage instructions
   - Nutritional information
   - Allergen statements
   - Company details

4. **Best Before Dates**
   - Unflushed: 18 months from packing
   - Gas flushed: 24 months from packing
   - Once opened: 6 months

### Storage Rules

1. **Tank Storage**
   - Food-grade stainless steel tanks
   - Temperature: 15-20°C
   - Nitrogen blanket over oil
   - Regular FFA monitoring
   - Maximum storage: 6 months

2. **Packed Product Storage**
   - Cool, dark location
   - Temperature: <25°C
   - Away from direct sunlight
   - FIFO rotation

### Quality Control

1. **Testing Frequency**
   - Raw material: FFA before pressing
   - During production: Visual checks
   - Post-filtering: FFA, PV, moisture
   - Pre-packing: Full quality panel
   - Monthly: Microbiological testing

2. **Hold Conditions**
   - FFA >0.10%: Hold for investigation
   - PV >2.0: Hold, may downgrade
   - Off-flavor/smell: Automatic rejection
   - Foreign material: Hold, re-filter or reject

## Integration Points

### Kernel Production Integration
- Butter grade kernels automatically available for oil production
- Broken kernels from sorting tracked for oil use
- Real-time availability of suitable kernels

### Stock Management Integration
- Oil stock updated automatically after packing
- Tank levels tracked in real-time
- Packed product stock managed
- FIFO enforcement

### Quality Assurance Integration
- Quality tests linked to oil batches
- COA generation for oil shipments
- Hold management integrated

### Palladium ERP Integration
- Oil production recipes
- By-product (oil cake) tracking
- Finished goods stock
- Sales order fulfillment

## Key Features

- Real-time production tracking
- Yield monitoring and analysis
- Quality tracking throughout process
- Tank inventory management
- Batch genealogy (kernel to oil traceability)
- GMP checklist compliance
- Material Journey Dashboard integration for material journey

## Testing Checklist

- [ ] Create oil production batch
- [ ] Record raw material intake
- [ ] Complete pressing step
- [ ] Record settling period
- [ ] Complete filtering
- [ ] Perform quality testing
- [ ] Transfer to storage tank
- [ ] Pack oil into containers
- [ ] Apply gas flushing
- [ ] Generate batch labels
- [ ] Update oil stock
- [ ] Release batch for dispatch
- [ ] Complete GMP checklist
- [ ] Generate oil COA
- [ ] Calculate yield variance

## Future Enhancements

1. **Automated Monitoring**
   - IoT sensors on press temperature/pressure
   - Automatic FFA analyzers
   - Tank level sensors

2. **Process Optimization**
   - ML-based yield optimization
   - Predictive quality modeling
   - Energy efficiency tracking

3. **Traceability**
   - QR codes on bottles
   - Blockchain batch tracking
   - Customer portal for batch info
