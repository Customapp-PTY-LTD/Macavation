# FruitLive - Module 4: Chemical Management

## Overview
The Chemical Management module handles spray programs, chemical inventory, application records, PHI tracking, storage compliance, and scouting justifications for complete audit trails.

## Purpose
- Season spray programs linked to biological events
- Detailed spray application records
- Chemical inventory and stock control
- Infield scouting records (justification)
- PHI (Pre-Harvest Interval) auto-calculation
- Storage compliance tracking
- Cost allocation per block
- Disposal certificate management

## Key Features
1. Season spray programs (auto-adjust dates based on full bloom)
2. Spray application recording (weather, operator, PHI)
3. Chemical inventory with stock levels
4. Scouting records linked to applications
5. Storage facility compliance
6. Disposal tracking with certificates
7. Cost per block calculation
8. Spray calendar visualization
9. PHI countdown alerts
10. Application history by block

## Database Schema

```sql
-- Chemicals (Master List)
CREATE TABLE chemicals (
    id UUID PRIMARY KEY,
    active_ingredient VARCHAR(255),
    trade_name VARCHAR(255),
    registration_number VARCHAR(100),
    chemical_class VARCHAR(100), -- 'fungicide', 'insecticide', 'herbicide', 'growth_regulator'
    manufacturer VARCHAR(255),
    phi_days INT, -- Pre-Harvest Interval
    reaentry_hours INT, -- Worker re-entry period
    max_applications_per_season INT,
    max_rate_per_hectare DECIMAL(10,2),
    unit VARCHAR(20), -- 'L/ha', 'kg/ha', 'g/100L'
    mixing_restrictions TEXT[],
    temperature_max DECIMAL(4,1),
    rain_withholding_hours INT,
    safety_data_sheet_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Chemical Inventory
CREATE TABLE chemical_inventory (
    id UUID PRIMARY KEY,
    chemical_id UUID REFERENCES chemicals(id),
    farm_id UUID REFERENCES farms(id),
    batch_number VARCHAR(100),
    quantity DECIMAL(10,2),
    unit VARCHAR(20),
    purchase_date DATE,
    supplier VARCHAR(255),
    cost DECIMAL(10,2),
    invoice_number VARCHAR(100),
    storage_location VARCHAR(255),
    expiry_date DATE,
    status VARCHAR(20), -- 'in_stock', 'low_stock', 'depleted', 'expired'
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Spray Programs (Season Templates)
CREATE TABLE spray_programs (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    variety_id UUID REFERENCES varieties(id),
    season_year INT,
    full_bloom_date DATE, -- Anchor date for calculations
    status VARCHAR(20), -- 'draft', 'active', 'completed'
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Spray Program Applications (Schedule)
CREATE TABLE spray_program_applications (
    id UUID PRIMARY KEY,
    program_id UUID REFERENCES spray_programs(id),
    application_number INT,
    chemical_id UUID REFERENCES chemicals(id),
    target_pest_disease VARCHAR(255),
    days_from_bloom INT, -- e.g., "+14" or "-7"
    scheduled_date DATE, -- Auto-calculated from full_bloom_date
    rate_per_hectare DECIMAL(10,2),
    unit VARCHAR(20),
    application_method VARCHAR(50), -- 'airblast', 'ground', 'aerial'
    notes TEXT,
    is_completed BOOLEAN DEFAULT FALSE,
    sort_order INT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Scouting Records (Justification)
CREATE TABLE scouting_records (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    block_id UUID REFERENCES blocks(id),
    variety_id UUID REFERENCES varieties(id),
    scouting_date DATE,
    scout_name VARCHAR(255),
    pest_disease_identified VARCHAR(255),
    severity VARCHAR(20), -- 'low', 'medium', 'high', 'severe'
    affected_area_percentage DECIMAL(5,2),
    photo_urls TEXT[],
    recommended_action TEXT,
    action_required BOOLEAN,
    linked_application_id UUID REFERENCES spray_applications(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Spray Applications (Actual Records)
CREATE TABLE spray_applications (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    block_id UUID REFERENCES blocks(id),
    variety_id UUID REFERENCES varieties(id),
    application_date DATE,
    chemical_id UUID REFERENCES chemicals(id),
    quantity_used DECIMAL(10,2),
    unit VARCHAR(20),
    area_treated DECIMAL(10,2), -- hectares
    rate_applied DECIMAL(10,2),
    application_method VARCHAR(50),
    equipment_used VARCHAR(255),
    operator_id UUID REFERENCES workers(id),
    operator_certificate_number VARCHAR(100),
    start_time TIME,
    end_time TIME,
    weather_conditions JSONB, -- {temp, wind_speed, wind_direction, humidity}
    phi_date DATE, -- Auto-calculated: application_date + chemical.phi_days
    reentry_datetime TIMESTAMP,
    scouting_record_id UUID REFERENCES scouting_records(id),
    program_application_id UUID REFERENCES spray_program_applications(id),
    cost DECIMAL(10,2),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Chemical Storage Facilities
CREATE TABLE storage_facilities (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    name VARCHAR(255),
    location VARCHAR(255),
    capacity DECIMAL(10,2),
    unit VARCHAR(20),
    has_ventilation BOOLEAN,
    has_fire_extinguisher BOOLEAN,
    has_spill_kit BOOLEAN,
    has_lockable_door BOOLEAN,
    has_warning_signs BOOLEAN,
    last_inspection_date DATE,
    next_inspection_date DATE,
    compliance_certificate_url VARCHAR(500),
    status VARCHAR(20), -- 'compliant', 'needs_attention', 'non_compliant'
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Storage Inspections
CREATE TABLE storage_inspections (
    id UUID PRIMARY KEY,
    facility_id UUID REFERENCES storage_facilities(id),
    inspection_date DATE,
    inspector_name VARCHAR(255),
    checklist_items JSONB,
    findings TEXT,
    corrective_actions TEXT,
    passed BOOLEAN,
    certificate_url VARCHAR(500),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Chemical Disposal
CREATE TABLE chemical_disposals (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    disposal_date DATE,
    chemical_id UUID REFERENCES chemicals(id),
    quantity DECIMAL(10,2),
    unit VARCHAR(20),
    disposal_method VARCHAR(100),
    disposal_company VARCHAR(255),
    certificate_number VARCHAR(100),
    certificate_url VARCHAR(500),
    cost DECIMAL(10,2),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

## API Endpoints

### Chemicals

#### GET /api/chemicals
Get chemical master list

#### POST /api/chemicals
Add new chemical

#### PUT /api/chemicals/:id
Update chemical details

### Inventory

#### GET /api/chemicals/inventory
Get inventory by farm

**Query Parameters:**
- `farmId` - Required
- `status` - 'in_stock', 'low_stock', 'depleted'

**Response:**
```json
{
  "inventory": [
    {
      "id": "uuid",
      "chemical": "Captan 80 WP",
      "activeIngredient": "Captan",
      "batchNumber": "B2024-1234",
      "quantity": 45.5,
      "unit": "kg",
      "storageLocation": "Main Chemical Store",
      "status": "in_stock",
      "expiryDate": "2026-06-30"
    }
  ],
  "lowStock": 3,
  "expiringSoon": 2
}
```

#### POST /api/chemicals/inventory
Record chemical purchase

#### PUT /api/chemicals/inventory/:id/adjust
Adjust stock levels

### Spray Programs

#### GET /api/chemicals/programs
Get spray programs

**Query Parameters:**
- `farmId`
- `varietyId`
- `seasonYear`
- `status`

#### POST /api/chemicals/programs
Create spray program

**Request:**
```json
{
  "farmId": "uuid",
  "varietyId": "uuid",
  "seasonYear": 2025,
  "fullBloomDate": "2025-09-15",
  "applications": [
    {
      "applicationNumber": 1,
      "chemicalId": "uuid",
      "targetPestDisease": "Codling Moth",
      "daysFromBloom": -7,
      "ratePerHectare": 0.8,
      "unit": "L/ha",
      "applicationMethod": "airblast"
    }
  ]
}
```

#### PUT /api/chemicals/programs/:id/bloom-date
Update full bloom date (recalculates all scheduled dates)

**Request:**
```json
{
  "fullBloomDate": "2025-09-18"
}
```

### Scouting

#### GET /api/chemicals/scouting
Get scouting records

**Query Parameters:**
- `farmId`
- `blockId`
- `dateRange`
- `actionRequired` - true/false

**Response:**
```json
{
  "records": [
    {
      "id": "uuid",
      "block": "Block A3",
      "variety": "Granny Smith",
      "scoutingDate": "2025-12-10",
      "scoutName": "Rich van der Merwe",
      "pestDisease": "Aphids",
      "severity": "medium",
      "affectedPercentage": 15,
      "actionRequired": true,
      "linkedApplication": "APP-2025-1234"
    }
  ]
}
```

#### POST /api/chemicals/scouting
Record scouting observation

### Spray Applications

#### GET /api/chemicals/applications
Get spray applications

**Query Parameters:**
- `farmId`
- `blockId`
- `dateRange`
- `chemicalId`

**Response:**
```json
{
  "applications": [
    {
      "id": "uuid",
      "applicationDate": "2025-12-11",
      "block": "Block A3",
      "variety": "Granny Smith",
      "chemical": "Captan 80 WP",
      "quantityUsed": 12.5,
      "unit": "kg",
      "areaTreated": 15.6,
      "operator": "Johannes Botha",
      "phiDate": "2025-12-25",
      "daysUntilPHI": 14,
      "weather": {
        "temp": 22,
        "windSpeed": 8,
        "humidity": 65
      },
      "cost": 2850
    }
  ]
}
```

#### POST /api/chemicals/applications
Record spray application

**Request:**
```json
{
  "farmId": "uuid",
  "blockId": "uuid",
  "varietyId": "uuid",
  "applicationDate": "2025-12-11",
  "chemicalId": "uuid",
  "quantityUsed": 12.5,
  "unit": "kg",
  "areaTreated": 15.6,
  "rateApplied": 0.8,
  "applicationMethod": "airblast",
  "operatorId": "uuid",
  "startTime": "07:00",
  "endTime": "09:30",
  "weatherConditions": {
    "temperature": 22,
    "windSpeed": 8,
    "windDirection": "NW",
    "humidity": 65
  },
  "scoutingRecordId": "uuid"
}
```

#### GET /api/chemicals/applications/phi-status
Get PHI status for all blocks

**Response:**
```json
{
  "blocks": [
    {
      "blockId": "uuid",
      "blockName": "Block A3",
      "variety": "Granny Smith",
      "lastApplication": "2025-12-11",
      "chemical": "Captan 80 WP",
      "phiDate": "2025-12-25",
      "daysRemaining": 14,
      "status": "restricted"
    }
  ]
}
```

### Storage

#### GET /api/chemicals/storage
Get storage facilities

#### POST /api/chemicals/storage/inspections
Record storage inspection

### Disposal

#### GET /api/chemicals/disposals
Get disposal records

#### POST /api/chemicals/disposals
Record chemical disposal

## Business Logic

### PHI Auto-Calculation
```typescript
async function calculatePHI(applicationDate: Date, chemicalId: string) {
  const chemical = await getChemical(chemicalId);
  const phiDate = addDays(applicationDate, chemical.phiDays);
  const reentryDatetime = addHours(applicationDate, chemical.reentryHours);
  
  return {
    phiDate,
    reentryDatetime,
    daysRemaining: differenceInDays(phiDate, new Date()),
    canHarvest: isAfter(new Date(), phiDate)
  };
}
```

### Spray Program Date Recalculation
```typescript
async function recalculateSprayProgram(programId: string, newBloomDate: Date) {
  const program = await getSprayProgram(programId);
  const applications = await getProgramApplications(programId);
  
  for (const app of applications) {
    const newDate = addDays(newBloomDate, app.daysFromBloom);
    await updateProgramApplication(app.id, {
      scheduledDate: newDate
    });
  }
  
  await updateSprayProgram(programId, {
    fullBloomDate: newBloomDate
  });
}
```

### Cost Allocation
```typescript
async function calculateSprayCost(application: SprayApplication) {
  const inventory = await getChemicalInventoryItem(
    application.chemicalId,
    application.farmId
  );
  
  const costPerUnit = inventory.cost / inventory.quantity;
  const totalCost = costPerUnit * application.quantityUsed;
  
  // Allocate to block
  await createCostAllocation({
    farmId: application.farmId,
    blockId: application.blockId,
    category: 'chemicals',
    amount: totalCost,
    date: application.applicationDate,
    reference: `Spray: ${application.id}`
  });
  
  // Update inventory
  await adjustInventory(inventory.id, -application.quantityUsed);
  
  return totalCost;
}
```

## UI Components

### 1. Spray Calendar
```tsx
interface SprayCalendarProps {
  farmId: string;
  programs: SprayProgram[];
  applications: SprayApplication[];
  onScheduleSpray: (date: Date, blockId: string) => void;
}
```

### 2. Chemical Inventory Dashboard
```tsx
interface InventoryDashboardProps {
  farmId: string;
  inventory: ChemicalInventory[];
  lowStock: ChemicalInventory[];
  onPurchase: (purchase: PurchaseInput) => void;
}
```

### 3. Spray Application Form
```tsx
interface SprayApplicationFormProps {
  farmId: string;
  blocks: Block[];
  chemicals: Chemical[];
  operators: Worker[];
  scoutingRecords: ScoutingRecord[];
  onSubmit: (application: ApplicationInput) => void;
}
```

### 4. Scouting Record Capture
```tsx
interface ScoutingFormProps {
  farmId: string;
  blocks: Block[];
  onSubmit: (record: ScoutingInput) => void;
  onUploadPhoto: (photo: File) => Promise<string>;
}
```

## State Management

```typescript
interface ChemicalState {
  chemicals: Chemical[];
  inventory: ChemicalInventory[];
  programs: SprayProgram[];
  applications: SprayApplication[];
  scouting: ScoutingRecord[];
  storage: StorageFacility[];
  selectedProgram: SprayProgram | null;
  phiStatus: PHIStatus[];
  loading: boolean;
}
```

## Implementation Notes

### File Structure
```
src/
├── features/
│   └── chemicals/
│       ├── components/
│       │   ├── SprayCalendar.tsx
│       │   ├── InventoryDashboard.tsx
│       │   ├── ApplicationForm.tsx
│       │   └── ScoutingForm.tsx
│       ├── services/
│       │   └── chemicalApi.ts
│       └── pages/
│           └── ChemicalManagementPage.tsx
```

## Dependencies
```json
{
  "dependencies": {
    "react-big-calendar": "^1.8.5",
    "date-fns": "^2.30.0"
  }
}
```
