# FruitLive - Module 2: Labour Management

## Overview
The Labour Management module handles workforce allocation, attendance tracking, task management, cross-farm transfers, and cost allocation. It eliminates manual timesheets and provides real-time visibility into labour deployment.

## Purpose
- Digital daily labour allocation by block, task, and variety
- Track attendance and productivity
- Manage cross-farm labour transfers
- Calculate labour costs per block/task
- Employee records and contract management
- Performance analytics and reporting

## Key Features
1. Daily digital allocation (block, variety, task)
2. Attendance tracking (clock in/out)
3. Cross-farm labour transfers
4. Task and bonus monitoring
5. Cost tracking per block/task/variety
6. Employee database (ID, bank details, contracts)
7. Disciplinary issue logging
8. Productivity analytics
9. Induna (supervisor) mobile interface
10. Bulk allocation tools

## Database Schema

### Tables Required

```sql
-- Workers
CREATE TABLE workers (
    id UUID PRIMARY KEY,
    employee_number VARCHAR(50) UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    id_number VARCHAR(20) UNIQUE,
    phone VARCHAR(20),
    email VARCHAR(100),
    home_farm_id UUID REFERENCES farms(id),
    current_farm_id UUID REFERENCES farms(id),
    employment_type VARCHAR(20), -- 'permanent', 'seasonal', 'casual'
    hire_date DATE,
    termination_date DATE,
    bank_name VARCHAR(100),
    bank_account_number VARCHAR(50),
    bank_branch_code VARCHAR(20),
    position VARCHAR(100),
    hourly_rate DECIMAL(10,2),
    status VARCHAR(20), -- 'active', 'inactive', 'transferred'
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Worker Allocations
CREATE TABLE worker_allocations (
    id UUID PRIMARY KEY,
    worker_id UUID REFERENCES workers(id),
    farm_id UUID REFERENCES farms(id),
    allocation_date DATE,
    block_id UUID REFERENCES blocks(id),
    variety_id UUID REFERENCES varieties(id),
    task_type VARCHAR(50), -- 'pruning', 'harvesting', 'mowing', 'weeding', 'spraying'
    induna_id UUID REFERENCES workers(id), -- Supervisor
    start_time TIME,
    end_time TIME,
    hours_worked DECIMAL(4,2),
    quantity_completed DECIMAL(10,2), -- e.g., kg picked, trees pruned
    unit VARCHAR(20), -- 'kg', 'trees', 'rows', 'hectares'
    bonus_amount DECIMAL(10,2),
    notes TEXT,
    status VARCHAR(20), -- 'planned', 'in_progress', 'completed', 'absent'
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Attendance Records
CREATE TABLE attendance (
    id UUID PRIMARY KEY,
    worker_id UUID REFERENCES workers(id),
    farm_id UUID REFERENCES farms(id),
    date DATE,
    clock_in TIME,
    clock_out TIME,
    hours_worked DECIMAL(4,2),
    status VARCHAR(20), -- 'present', 'absent', 'late', 'half_day', 'sick'
    notes TEXT,
    verified_by UUID REFERENCES users(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE(worker_id, date)
);

-- Labour Transfers (Cross-Farm)
CREATE TABLE labour_transfers (
    id UUID PRIMARY KEY,
    transfer_number VARCHAR(50) UNIQUE,
    origin_farm_id UUID REFERENCES farms(id),
    destination_farm_id UUID REFERENCES farms(id),
    start_date DATE,
    end_date DATE,
    status VARCHAR(20), -- 'pending', 'active', 'completed', 'cancelled'
    requested_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Labour Transfer Workers
CREATE TABLE labour_transfer_workers (
    id UUID PRIMARY KEY,
    transfer_id UUID REFERENCES labour_transfers(id),
    worker_id UUID REFERENCES workers(id),
    created_at TIMESTAMP
);

-- Tasks (Predefined task types)
CREATE TABLE task_types (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    name VARCHAR(100),
    category VARCHAR(50), -- 'orchard', 'vineyard', 'general'
    unit VARCHAR(20), -- 'trees', 'rows', 'hectares', 'kg'
    base_rate DECIMAL(10,2),
    bonus_structure JSONB,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Disciplinary Records
CREATE TABLE disciplinary_records (
    id UUID PRIMARY KEY,
    worker_id UUID REFERENCES workers(id),
    incident_date DATE,
    incident_type VARCHAR(50), -- 'warning', 'suspension', 'performance'
    description TEXT,
    action_taken TEXT,
    reported_by UUID REFERENCES users(id),
    follow_up_date DATE,
    resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Worker Contracts
CREATE TABLE worker_contracts (
    id UUID PRIMARY KEY,
    worker_id UUID REFERENCES workers(id),
    contract_type VARCHAR(50), -- 'permanent', 'fixed_term', 'seasonal'
    start_date DATE,
    end_date DATE,
    terms TEXT,
    document_url VARCHAR(255),
    signed_date DATE,
    signed_by_worker BOOLEAN,
    signed_by_employer BOOLEAN,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Team Groups (for bulk allocation)
CREATE TABLE teams (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    name VARCHAR(100),
    induna_id UUID REFERENCES workers(id),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Team Members
CREATE TABLE team_members (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id),
    worker_id UUID REFERENCES workers(id),
    created_at TIMESTAMP,
    UNIQUE(team_id, worker_id)
);
```

## API Endpoints

### Workers

#### GET /api/labour/workers
Get all workers with filters

**Query Parameters:**
- `farmId` - Filter by farm
- `status` - 'active', 'inactive', 'transferred'
- `employmentType` - 'permanent', 'seasonal', 'casual'
- `search` - Search by name or employee number

**Response:**
```json
{
  "workers": [
    {
      "id": "uuid",
      "employeeNumber": "EMP-001",
      "firstName": "Johannes",
      "lastName": "Botha",
      "homeFarm": "Kinmount Estate",
      "currentFarm": "Quinn Farms",
      "position": "Induna",
      "employmentType": "permanent",
      "status": "transferred"
    }
  ],
  "total": 147,
  "summary": {
    "permanent": 120,
    "seasonal": 23,
    "shared": 12
  }
}
```

#### POST /api/labour/workers
Create new worker

**Request:**
```json
{
  "employeeNumber": "EMP-150",
  "firstName": "John",
  "lastName": "Smith",
  "idNumber": "8001011234567",
  "phone": "0821234567",
  "homeFarmId": "uuid",
  "employmentType": "permanent",
  "position": "Pruner",
  "hourlyRate": 45.50,
  "bankName": "FNB",
  "bankAccountNumber": "62123456789",
  "bankBranchCode": "250655"
}
```

#### PUT /api/labour/workers/:id
Update worker details

#### DELETE /api/labour/workers/:id
Deactivate worker (soft delete)

### Allocations

#### GET /api/labour/allocations
Get allocations with filters

**Query Parameters:**
- `farmId` - Required
- `date` - Specific date (default: today)
- `blockId` - Filter by block
- `taskType` - Filter by task
- `indunaId` - Filter by supervisor

**Response:**
```json
{
  "date": "2025-12-13",
  "farm": "Quinn Farms",
  "allocations": [
    {
      "id": "uuid",
      "block": "Block A3",
      "variety": "Granny Smith",
      "taskType": "pruning",
      "workers": [
        {
          "id": "uuid",
          "name": "Johannes Botha",
          "startTime": "07:00",
          "endTime": "16:00",
          "hoursWorked": 8,
          "status": "completed"
        }
      ],
      "induna": "Rich van der Merwe",
      "totalWorkers": 45,
      "totalHours": 360,
      "totalCost": 16380
    }
  ],
  "summary": {
    "totalWorkers": 147,
    "totalHours": 1176,
    "totalCost": 52920
  }
}
```

#### POST /api/labour/allocations/bulk
Bulk create allocations

**Request:**
```json
{
  "farmId": "uuid",
  "date": "2025-12-13",
  "allocations": [
    {
      "blockId": "uuid",
      "varietyId": "uuid",
      "taskType": "pruning",
      "indunaId": "uuid",
      "workerIds": ["uuid1", "uuid2", "uuid3"],
      "startTime": "07:00",
      "endTime": "16:00"
    }
  ]
}
```

#### POST /api/labour/allocations/copy
Copy previous day's allocations

**Request:**
```json
{
  "farmId": "uuid",
  "sourceDate": "2025-12-12",
  "targetDate": "2025-12-13",
  "adjustments": {
    "blockChanges": {},
    "workerChanges": {}
  }
}
```

#### PUT /api/labour/allocations/:id
Update allocation (for indunas to adjust in field)

#### POST /api/labour/allocations/:id/complete
Mark allocation as completed with actual hours/quantity

**Request:**
```json
{
  "actualHours": 8,
  "quantityCompleted": 125,
  "unit": "trees",
  "bonusAmount": 50,
  "notes": "Excellent work quality"
}
```

### Attendance

#### GET /api/labour/attendance
Get attendance records

**Query Parameters:**
- `farmId` - Required
- `date` - Specific date or range
- `workerId` - Filter by worker

#### POST /api/labour/attendance/clock-in
Clock in worker

**Request:**
```json
{
  "workerId": "uuid",
  "farmId": "uuid",
  "time": "07:15"
}
```

#### POST /api/labour/attendance/clock-out
Clock out worker

#### POST /api/labour/attendance/bulk
Bulk attendance marking (for indunas)

**Request:**
```json
{
  "farmId": "uuid",
  "date": "2025-12-13",
  "attendance": [
    {
      "workerId": "uuid",
      "status": "present",
      "clockIn": "07:00",
      "clockOut": "16:00"
    }
  ]
}
```

### Transfers

#### GET /api/labour/transfers
Get all labour transfers

**Query Parameters:**
- `status` - 'pending', 'active', 'completed'
- `farmId` - Filter by origin or destination farm

**Response:**
```json
{
  "transfers": [
    {
      "id": "uuid",
      "transferNumber": "TRF-001245",
      "originFarm": "Kinmount Estate",
      "destinationFarm": "Quinn Farms",
      "startDate": "2025-12-09",
      "endDate": "2025-12-23",
      "workerCount": 12,
      "status": "active",
      "workers": [...]
    }
  ]
}
```

#### POST /api/labour/transfers
Create labour transfer

**Request:**
```json
{
  "originFarmId": "uuid",
  "destinationFarmId": "uuid",
  "startDate": "2025-12-09",
  "endDate": "2025-12-23",
  "workerIds": ["uuid1", "uuid2"],
  "notes": "Pruning season support"
}
```

#### PUT /api/labour/transfers/:id/approve
Approve pending transfer

#### PUT /api/labour/transfers/:id/complete
Complete transfer (return workers to home farm)

### Analytics

#### GET /api/labour/analytics/costs
Get labour cost analytics

**Query Parameters:**
- `farmId`
- `startDate`
- `endDate`
- `groupBy` - 'block', 'variety', 'task', 'week', 'month'

**Response:**
```json
{
  "period": "2025-12-01 to 2025-12-13",
  "totalCost": 87450,
  "breakdown": [
    {
      "category": "Block A3",
      "cost": 24500,
      "hours": 544,
      "workers": 68,
      "percentage": 28
    }
  ]
}
```

#### GET /api/labour/analytics/productivity
Get productivity metrics

**Response:**
```json
{
  "averageTreesPerHour": 15.6,
  "averageKgPerWorker": 245,
  "topPerformers": [...],
  "efficiency": {
    "target": 100,
    "actual": 112,
    "variance": 12
  }
}
```

## UI Components

### 1. Worker List Component
```tsx
interface WorkerListProps {
  farmId: string;
  filters: WorkerFilters;
  onWorkerSelect: (worker: Worker) => void;
}
```

### 2. Daily Allocation Board
```tsx
interface AllocationBoardProps {
  farmId: string;
  date: Date;
  allocations: Allocation[];
  onAllocate: (allocation: AllocationInput) => void;
  onCopyPrevious: () => void;
}
```

### 3. Bulk Allocation Modal
```tsx
interface BulkAllocationModalProps {
  farmId: string;
  date: Date;
  availableWorkers: Worker[];
  teams: Team[];
  blocks: Block[];
  onSubmit: (allocations: AllocationInput[]) => void;
}
```

### 4. Attendance Tracker
```tsx
interface AttendanceTrackerProps {
  farmId: string;
  date: Date;
  workers: Worker[];
  attendance: AttendanceRecord[];
  onMarkAttendance: (records: AttendanceInput[]) => void;
}
```

### 5. Labour Transfer Manager
```tsx
interface TransferManagerProps {
  availableFarms: Farm[];
  activeTransfers: Transfer[];
  onCreateTransfer: (transfer: TransferInput) => void;
}
```

### 6. Cost Analytics Dashboard
```tsx
interface CostAnalyticsProps {
  farmId: string;
  dateRange: DateRange;
  groupBy: 'block' | 'variety' | 'task';
  data: CostBreakdown[];
}
```

### 7. Worker Profile Card
```tsx
interface WorkerProfileProps {
  worker: Worker;
  allocations: Allocation[];
  attendance: AttendanceRecord[];
  disciplinary: DisciplinaryRecord[];
  onEdit: (worker: Worker) => void;
}
```

### 8. Induna Mobile Interface
```tsx
interface IndunaMobileProps {
  indunaId: string;
  team: Team;
  todaysAllocations: Allocation[];
  onUpdateAllocation: (id: string, updates: Partial<Allocation>) => void;
  onMarkAttendance: (attendance: AttendanceInput[]) => void;
}
```

## Business Logic

### Allocation Algorithm
```typescript
async function createDailyAllocations(input: AllocationInput) {
  // 1. Validate workers are available (not allocated elsewhere)
  const conflicts = await checkWorkerConflicts(input.workerIds, input.date);
  if (conflicts.length > 0) {
    throw new Error(`Workers already allocated: ${conflicts.join(', ')}`);
  }
  
  // 2. Validate block capacity
  const blockCapacity = await getBlockCapacity(input.blockId);
  if (input.workerIds.length > blockCapacity.maxWorkers) {
    throw new Warning(`Exceeds recommended capacity of ${blockCapacity.maxWorkers}`);
  }
  
  // 3. Create allocation records
  const allocations = await Promise.all(
    input.workerIds.map(workerId => 
      createAllocation({
        workerId,
        farmId: input.farmId,
        date: input.date,
        blockId: input.blockId,
        varietyId: input.varietyId,
        taskType: input.taskType,
        indunaId: input.indunaId,
        startTime: input.startTime,
        endTime: input.endTime,
        status: 'planned'
      })
    )
  );
  
  // 4. Log activity
  await logActivity({
    module: 'labour',
    action: 'allocations_created',
    farmId: input.farmId,
    metadata: { count: allocations.length, date: input.date }
  });
  
  return allocations;
}
```

### Cost Calculation
```typescript
async function calculateLabourCost(allocation: Allocation) {
  const worker = await getWorker(allocation.workerId);
  const hours = allocation.hoursWorked || 
    calculateHours(allocation.startTime, allocation.endTime);
  
  const baseCost = worker.hourlyRate * hours;
  const bonusCost = allocation.bonusAmount || 0;
  
  // Apply shared worker markup if transferred
  let markup = 0;
  if (worker.homeFarmId !== allocation.farmId) {
    markup = baseCost * 0.10; // 10% markup for shared workers
  }
  
  return {
    baseCost,
    bonusCost,
    markup,
    totalCost: baseCost + bonusCost + markup
  };
}
```

### Transfer Workflow
```typescript
async function executeLabourTransfer(transferId: string) {
  const transfer = await getTransfer(transferId);
  
  // 1. Update worker current_farm_id
  await db.workers.updateMany(
    { id: { in: transfer.workerIds } },
    { currentFarmId: transfer.destinationFarmId, status: 'transferred' }
  );
  
  // 2. Notify farm managers
  await notifyFarmManagers(transfer);
  
  // 3. Update transfer status
  await updateTransfer(transferId, { status: 'active' });
  
  // 4. Create dashboard alert for destination farm
  await createAlert({
    farmId: transfer.destinationFarmId,
    type: 'info',
    title: 'Workers Received',
    message: `${transfer.workerIds.length} workers from ${transfer.originFarm.name}`
  });
}
```

### Productivity Analytics
```typescript
async function calculateProductivity(farmId: string, dateRange: DateRange) {
  const allocations = await getAllocations({
    farmId,
    dateRange,
    status: 'completed'
  });
  
  // Group by task type
  const byTask = groupBy(allocations, 'taskType');
  
  const metrics = Object.entries(byTask).map(([taskType, records]) => {
    const totalQuantity = sum(records, 'quantityCompleted');
    const totalHours = sum(records, 'hoursWorked');
    const avgPerHour = totalQuantity / totalHours;
    
    return {
      taskType,
      totalQuantity,
      totalHours,
      avgPerHour,
      efficiency: (avgPerHour / TASK_BENCHMARKS[taskType]) * 100
    };
  });
  
  return metrics;
}
```

## Integration Points

### With Other Modules
1. **Dashboard** → Active worker count, weekly cost
2. **Admin** → Cross-farm transfers, shared resource pool
3. **Compliance** → Worker training certificates, contracts
4. **Crops** → Block allocation data
5. **Assets** → Induna equipment allocation

### Event Emissions
```typescript
// Emit events for other modules
events.emit('labour.allocation_created', { farmId, date, workerCount });
events.emit('labour.cost_calculated', { farmId, block, cost });
events.emit('labour.transfer_active', { originFarm, destinationFarm, workerCount });
```

## State Management

### Redux Slices
```typescript
interface LabourState {
  workers: Worker[];
  allocations: Allocation[];
  attendance: AttendanceRecord[];
  transfers: Transfer[];
  teams: Team[];
  selectedDate: Date;
  selectedFarm: string;
  filters: LabourFilters;
  loading: boolean;
}

const labourSlice = createSlice({
  name: 'labour',
  initialState,
  reducers: {
    setWorkers,
    addWorker,
    updateWorker,
    setAllocations,
    createAllocations,
    updateAllocation,
    setAttendance,
    markAttendance,
    setTransfers,
    createTransfer,
    setSelectedDate,
    setFilters
  }
});
```

## UI Screens

### Main Labour Management Screen
**Route:** `/labour`

**Layout:**
```
┌─────────────────────────────────────────┐
│ Navbar (Farm Selector)                  │
├─────────────────────────────────────────┤
│ Labour Allocation - Quinn Farms         │
│ Date: [< Dec 13, 2025 >] | Copy Prev Day│
├─────────────────────────────────────────┤
│ Shared Workers Alert (12 from Kinmount) │
├─────────────────────────────────────────┤
│ Summary: 147 workers | 23 seasonal      │
├─────────────────────────────────────────┤
│ [Bulk Allocate] [Teams] [Shared Workers]│
├─────────────────────────────────────────┤
│ Allocation Grid:                        │
│ ┌────────────────────────────────────┐  │
│ │ Block A3 - Granny Smith | Pruning  │  │
│ │ Induna: Rich van der Merwe         │  │
│ │ Workers: [45 assigned]             │  │
│ │ Time: 07:00 - 16:00 | Cost: R20,250│  │
│ └────────────────────────────────────┘  │
├─────────────────────────────────────────┤
│ Worker Directory | Attendance | Reports │
└─────────────────────────────────────────┘
```

### Induna Mobile Interface
**Route:** `/labour/induna`

**Features:**
- Simplified tablet/mobile view
- Team roster
- Quick attendance marking
- Allocation adjustments
- Photo upload for evidence

## Permissions & Access Control

### Role-Based Features
- **Super Admin:** All features, all farms
- **Farm Admin:** View all, manage allocations, approve transfers
- **Farm Manager:** Daily allocations, attendance, reports
- **Induna:** Mobile interface, team management, attendance marking
- **Field User:** View only

## Performance Considerations

### Optimization
- Index on (worker_id, allocation_date) for fast lookups
- Cache team compositions
- Batch allocation creation
- Lazy load worker history
- Debounce search inputs

### Scaling
- Partition allocations table by date (monthly)
- Archive old allocations after 2 years
- Use read replicas for reports
- Cache worker lists per farm

## Testing Requirements

### Unit Tests
- Allocation conflict detection
- Cost calculation with transfers
- Productivity metrics calculation
- Attendance validation

### Integration Tests
- Bulk allocation creation
- Transfer workflow end-to-end
- Cross-farm cost allocation
- API endpoint responses

### E2E Tests
- Farm manager creates allocations
- Induna marks attendance on mobile
- Transfer request and approval flow
- Cost report generation

## Mobile Considerations

### Induna Tablet Interface
- Offline support for attendance
- Sync when connection available
- Camera access for photo evidence
- Simplified navigation
- Large touch targets

## Implementation Notes

### Technology Stack
- **Frontend:** React + TypeScript
- **Mobile:** React Native / PWA
- **State:** Redux Toolkit
- **Forms:** React Hook Form + Zod validation
- **Tables:** TanStack Table
- **Date:** date-fns

### File Structure
```
src/
├── features/
│   └── labour/
│       ├── components/
│       │   ├── WorkerList.tsx
│       │   ├── AllocationBoard.tsx
│       │   ├── BulkAllocationModal.tsx
│       │   ├── AttendanceTracker.tsx
│       │   ├── TransferManager.tsx
│       │   └── CostAnalytics.tsx
│       ├── mobile/
│       │   └── IndunaInterface.tsx
│       ├── hooks/
│       │   ├── useAllocations.ts
│       │   ├── useWorkers.ts
│       │   └── useTransfers.ts
│       ├── services/
│       │   └── labourApi.ts
│       ├── slices/
│       │   └── labourSlice.ts
│       └── pages/
│           ├── LabourManagementPage.tsx
│           ├── WorkerDirectoryPage.tsx
│           └── IndunaDashboard.tsx
```

## Dependencies
```json
{
  "dependencies": {
    "date-fns": "^2.30.0",
    "@tanstack/react-table": "^8.9.3",
    "react-hook-form": "^7.45.0",
    "zod": "^3.21.4",
    "recharts": "^2.7.2"
  }
}
```
