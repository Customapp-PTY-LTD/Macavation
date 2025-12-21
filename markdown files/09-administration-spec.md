# FruitLive - Module 9: Administration

## Overview
The control center for multi-farm portfolio management, shared resources, and system configuration.

## Key Features
- Farm portfolio management (add/edit farms)
- User roles & permissions
- Shared resource allocation (547 workers across farms)
- Crop type configuration
- Cross-farm transfers & logistics
- Portfolio analytics
- System settings

## Database Schema

```sql
CREATE TABLE farms (
    id UUID PRIMARY KEY,
    name VARCHAR(255),
    location VARCHAR(255),
    region VARCHAR(100),
    hectares DECIMAL(10,2),
    crop_type VARCHAR(100), -- 'apples', 'citrus', 'grapes', 'kiwis'
    manager_id UUID REFERENCES users(id),
    status VARCHAR(20), -- 'active', 'inactive'
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role VARCHAR(50), -- 'super_admin', 'farm_admin', 'farm_manager', 'field_user'
    status VARCHAR(20), -- 'active', 'inactive'
    created_at TIMESTAMP
);

CREATE TABLE user_farm_access (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    farm_id UUID REFERENCES farms(id),
    access_level VARCHAR(50), -- 'full', 'read_only'
    created_at TIMESTAMP,
    UNIQUE(user_id, farm_id)
);

CREATE TABLE user_permissions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    module VARCHAR(50),
    can_view BOOLEAN DEFAULT FALSE,
    can_create BOOLEAN DEFAULT FALSE,
    can_edit BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP
);

CREATE TABLE crop_types (
    id UUID PRIMARY KEY,
    name VARCHAR(100),
    category VARCHAR(50),
    compliance_standards TEXT[],
    created_at TIMESTAMP
);

CREATE TABLE varieties (
    id UUID PRIMARY KEY,
    crop_type_id UUID REFERENCES crop_types(id),
    farm_id UUID REFERENCES farms(id),
    name VARCHAR(100),
    hectares DECIMAL(10,2),
    planting_year INT,
    created_at TIMESTAMP
);

CREATE TABLE blocks (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    variety_id UUID REFERENCES varieties(id),
    name VARCHAR(100),
    hectares DECIMAL(10,2),
    row_count INT,
    tree_count INT,
    planting_date DATE,
    status VARCHAR(20),
    created_at TIMESTAMP
);
```

## API Endpoints

### Farms
- GET /api/admin/farms
- POST /api/admin/farms
- PUT /api/admin/farms/:id
- DELETE /api/admin/farms/:id

### Users
- GET /api/admin/users
- POST /api/admin/users
- PUT /api/admin/users/:id
- PUT /api/admin/users/:id/permissions

### Shared Resources
- GET /api/admin/resources/summary
- GET /api/admin/resources/workers
- GET /api/admin/resources/assets
- POST /api/admin/resources/transfer

### Portfolio Analytics
- GET /api/admin/analytics/portfolio
- GET /api/admin/analytics/by-crop
- GET /api/admin/analytics/by-farm

## Business Logic

```typescript
async function createFarm(input: FarmInput) {
  // 1. Create farm
  const farm = await db.farms.create({ data: input });
  
  // 2. Initialize default blocks/varieties
  // 3. Assign manager permissions
  await grantUserAccess(input.managerId, farm.id, 'full');
  
  // 4. Create compliance folders
  await initializeComplianceFolders(farm.id);
  
  return farm;
}

async function getSharedResourceSummary() {
  const farms = await getFarms();
  
  const summary = {
    totalWorkers: 0,
    totalVehicles: 0,
    totalEquipment: 0,
    byFarm: []
  };
  
  for (const farm of farms) {
    const workers = await getWorkers({ currentFarmId: farm.id });
    const vehicles = await getVehicles({ currentFarmId: farm.id });
    const equipment = await getEquipment({ currentFarmId: farm.id });
    
    summary.totalWorkers += workers.length;
    summary.totalVehicles += vehicles.length;
    summary.totalEquipment += sum(equipment, 'quantityTotal');
    
    summary.byFarm.push({
      farmId: farm.id,
      farmName: farm.name,
      workers: workers.length,
      vehicles: vehicles.length,
      equipment: sum(equipment, 'quantityTotal')
    });
  }
  
  return summary;
}
```

## UI Components

```tsx
interface FarmPortfolioProps {
  farms: Farm[];
  onAddFarm: (farm: FarmInput) => void;
  onEditFarm: (id: string, updates: Partial<Farm>) => void;
}

interface UserManagementProps {
  users: User[];
  farms: Farm[];
  onAddUser: (user: UserInput) => void;
  onUpdatePermissions: (userId: string, permissions: Permission[]) => void;
}

interface SharedResourcesProps {
  summary: ResourceSummary;
  activeTransfers: Transfer[];
  onCreateTransfer: (transfer: TransferInput) => void;
}

interface PortfolioAnalyticsProps {
  analytics: PortfolioAnalytics;
  farms: Farm[];
}
```

## Dependencies
```json
{
  "dependencies": {
    "recharts": "^2.7.2"
  }
}
```
