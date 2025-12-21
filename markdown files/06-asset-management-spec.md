# FruitLive - Module 6: Asset Management

## Overview
Fleet & equipment control with automated fuel tracking and SARS-compliant mileage allocation.

## Key Features
- Vehicle fleet management
- Automated fuel tracking (bowser + commercial)
- Kilometre allocation to blocks for SARS
- Service schedules & reminders
- Equipment inventory (secateurs, ladders, tools)
- Cross-farm asset transfers
- Maintenance history
- Bowser inventory tracking

## Database Schema

```sql
CREATE TABLE vehicles (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id), -- Home farm
    current_farm_id UUID REFERENCES farms(id),
    registration_number VARCHAR(50) UNIQUE,
    make VARCHAR(100),
    model VARCHAR(100),
    year INT,
    vin VARCHAR(50),
    vehicle_type VARCHAR(50), -- 'bakkie', 'tractor', 'forklift'
    fuel_type VARCHAR(20), -- 'diesel', 'petrol'
    current_odometer INT,
    last_service_date DATE,
    last_service_odometer INT,
    next_service_odometer INT,
    next_service_date DATE,
    license_expiry DATE,
    insurance_expiry DATE,
    status VARCHAR(20), -- 'active', 'in_service', 'transferred'
    created_at TIMESTAMP
);

CREATE TABLE fuel_transactions (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    farm_id UUID REFERENCES farms(id),
    transaction_date DATE,
    transaction_time TIME,
    litres DECIMAL(8,2),
    cost DECIMAL(10,2),
    price_per_litre DECIMAL(6,2),
    fuel_source VARCHAR(20), -- 'bowser', 'commercial'
    odometer_reading INT,
    operator_id UUID REFERENCES workers(id),
    created_at TIMESTAMP
);

CREATE TABLE mileage_allocations (
    id UUID PRIMARY KEY,
    fuel_transaction_id UUID REFERENCES fuel_transactions(id),
    block_id UUID REFERENCES blocks(id),
    distance_km DECIMAL(8,2),
    percentage DECIMAL(5,2),
    allocated_cost DECIMAL(10,2),
    purpose TEXT,
    created_at TIMESTAMP
);

CREATE TABLE bowser_inventory (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    name VARCHAR(100),
    capacity_litres DECIMAL(10,2),
    current_level_litres DECIMAL(10,2),
    last_refill_date DATE,
    last_refill_amount DECIMAL(10,2),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE equipment_inventory (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    current_farm_id UUID REFERENCES farms(id),
    name VARCHAR(255),
    category VARCHAR(100), -- 'pruning', 'harvesting', 'spraying'
    unit_cost DECIMAL(10,2),
    quantity_total INT,
    quantity_in_stock INT,
    quantity_assigned INT,
    quantity_lost INT,
    status VARCHAR(20),
    created_at TIMESTAMP
);

CREATE TABLE vehicle_maintenance (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    maintenance_date DATE,
    maintenance_type VARCHAR(50), -- 'service', 'repair', 'inspection'
    description TEXT,
    odometer_reading INT,
    cost DECIMAL(10,2),
    next_service_odometer INT,
    next_service_date DATE,
    performed_by VARCHAR(255),
    created_at TIMESTAMP
);

CREATE TABLE asset_transfers (
    id UUID PRIMARY KEY,
    transfer_number VARCHAR(50) UNIQUE,
    asset_type VARCHAR(20), -- 'vehicle', 'equipment'
    asset_id UUID,
    origin_farm_id UUID REFERENCES farms(id),
    destination_farm_id UUID REFERENCES farms(id),
    transfer_date DATE,
    return_date DATE,
    status VARCHAR(20),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP
);
```

## API Endpoints

### GET /api/assets/vehicles?farmId=
### POST /api/assets/vehicles
### PUT /api/assets/vehicles/:id
### GET /api/assets/fuel-transactions?farmId=&startDate=&endDate=
### POST /api/assets/fuel-transactions
### POST /api/assets/fuel-transactions/:id/allocate
### GET /api/assets/bowser?farmId=
### PUT /api/assets/bowser/:id/refill
### GET /api/assets/equipment?farmId=
### POST /api/assets/equipment
### PUT /api/assets/equipment/:id/adjust
### POST /api/assets/transfers
### GET /api/assets/maintenance-due?farmId=

## Business Logic

```typescript
async function recordFuelTransaction(input: FuelTransactionInput) {
  // 1. Create transaction
  const transaction = await createFuelTransaction(input);
  
  // 2. Update vehicle odometer
  await updateVehicle(input.vehicleId, {
    currentOdometer: input.odometerReading
  });
  
  // 3. Update bowser if from bowser
  if (input.fuelSource === 'bowser') {
    await updateBowserLevel(input.farmId, -input.litres);
  }
  
  // 4. Calculate cost
  const cost = input.litres * input.pricePerLitre;
  
  return { transaction, cost };
}

async function allocateMileage(transactionId: string, allocations: MileageAllocation[]) {
  const transaction = await getFuelTransaction(transactionId);
  const totalCost = transaction.cost;
  
  // Validate percentages sum to 100
  const totalPercentage = sum(allocations, 'percentage');
  if (totalPercentage !== 100) {
    throw new Error('Allocations must sum to 100%');
  }
  
  // Create allocations
  for (const alloc of allocations) {
    await createMileageAllocation({
      fuelTransactionId: transactionId,
      blockId: alloc.blockId,
      distanceKm: alloc.distanceKm,
      percentage: alloc.percentage,
      allocatedCost: (totalCost * alloc.percentage) / 100,
      purpose: alloc.purpose
    });
  }
  
  // Generate SARS logbook entry
  return generateSARSLogbookEntry(transactionId);
}
```

## UI Components

```tsx
interface VehicleFleetProps {
  farmId: string;
  vehicles: Vehicle[];
  serviceDue: Vehicle[];
}

interface FuelTrackerProps {
  farmId: string;
  transactions: FuelTransaction[];
  onRecordFuel: (transaction: FuelInput) => void;
  onAllocate: (transactionId: string, allocations: Allocation[]) => void;
}

interface EquipmentInventoryProps {
  farmId: string;
  equipment: Equipment[];
  onAdjustStock: (id: string, quantity: number) => void;
}
```
