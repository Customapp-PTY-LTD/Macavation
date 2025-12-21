# FruitLive - Module 1: Dashboard

## Overview
The Dashboard is the central command center providing real-time visibility across all farms, critical alerts, KPIs, and quick access to all system modules.

## Purpose
- Provide at-a-glance operational status across multi-farm portfolio
- Display critical alerts and upcoming tasks
- Enable rapid farm switching
- Show shared resource status
- Provide KPI widgets for key metrics

## Key Features
1. Multi-farm selector (dropdown in navbar)
2. Farm-specific context display
3. Critical alerts and notifications
4. Key performance indicators (Labour, Compliance, Crops, Water)
5. Shared resources notification panel
6. Recent activity feed
7. Upcoming tasks calendar
8. Quick access cards to all 9 modules
9. Real-time data updates

## Database Schema

### Tables Required

```sql
-- Dashboard Widgets
CREATE TABLE dashboard_widgets (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    widget_type VARCHAR(50), -- 'kpi', 'alert', 'activity', 'task'
    position INT,
    config JSONB,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Alerts
CREATE TABLE alerts (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    alert_type VARCHAR(50), -- 'critical', 'warning', 'info'
    category VARCHAR(50), -- 'compliance', 'labour', 'asset', etc.
    title VARCHAR(255),
    message TEXT,
    action_url VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP,
    expires_at TIMESTAMP
);

-- Activity Log
CREATE TABLE activity_log (
    id UUID PRIMARY KEY,
    farm_id UUID REFERENCES farms(id),
    user_id UUID REFERENCES users(id),
    module VARCHAR(50),
    action VARCHAR(100),
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMP
);

-- User Preferences
CREATE TABLE user_dashboard_preferences (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    default_farm_id UUID REFERENCES farms(id),
    widget_layout JSONB,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

## API Endpoints

### GET /api/dashboard/:farmId
Get dashboard data for specific farm

**Response:**
```json
{
  "farm": {
    "id": "uuid",
    "name": "Quinn Farms",
    "location": "Paarl, Western Cape",
    "hectares": 125,
    "cropType": "Apples"
  },
  "kpis": {
    "activeLabour": 147,
    "labourCostWeek": 87450,
    "complianceScore": 94,
    "sprayScheduleDue": 3,
    "waterUsageMonth": 18450
  },
  "alerts": [
    {
      "id": "uuid",
      "type": "critical",
      "title": "Certificate Expiry",
      "message": "3 staff training certificates expire within 7 days",
      "actionUrl": "/compliance#certificates"
    }
  ],
  "sharedResources": {
    "workersReceived": 12,
    "workersSent": 0,
    "assetsReceived": 0,
    "assetsSent": 1
  },
  "recentActivity": [...],
  "upcomingTasks": [...]
}
```

### GET /api/dashboard/alerts
Get all alerts for current user's accessible farms

### POST /api/dashboard/alerts/:id/read
Mark alert as read

### GET /api/dashboard/activity
Get recent activity across farms

**Query Parameters:**
- `farmId` (optional) - Filter by farm
- `limit` (default: 10)
- `module` (optional) - Filter by module

### GET /api/dashboard/kpis/:farmId
Get real-time KPI data for farm

## UI Components

### 1. Navbar Component
```tsx
interface NavbarProps {
  currentUser: User;
  currentFarm: Farm;
  accessibleFarms: Farm[];
  onFarmChange: (farmId: string) => void;
}
```

**Features:**
- Farm selector dropdown
- User profile dropdown
- Admin link (role-based)
- Logout functionality

### 2. Farm Context Header
```tsx
interface FarmHeaderProps {
  farm: Farm;
  date: Date;
}
```

**Display:**
- Farm name and location
- Current date
- Farm metadata (hectares, crop type)

### 3. Shared Resources Alert
```tsx
interface SharedResourcesAlertProps {
  workersReceived: number;
  workersSent: number;
  assets: Asset[];
}
```

**Display:**
- Worker transfers (in/out)
- Asset transfers
- Link to Admin → Resources

### 4. KPI Widget
```tsx
interface KPIWidgetProps {
  title: string;
  value: number | string;
  subtitle: string;
  icon: string;
  color: string;
}
```

**Variants:**
- Labour count
- Labour cost
- Compliance score
- Spray schedule
- Water usage

### 5. Alert Card
```tsx
interface AlertCardProps {
  type: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
}
```

### 6. Module Quick Access Card
```tsx
interface ModuleCardProps {
  icon: string;
  title: string;
  description: string;
  url: string;
  isHighlighted?: boolean; // For Admin module
}
```

### 7. Recent Activity Feed
```tsx
interface ActivityItemProps {
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  timestamp: Date;
  user: string;
}
```

### 8. Upcoming Tasks
```tsx
interface TaskItemProps {
  priority: 'high' | 'medium' | 'low';
  title: string;
  dueDate: Date;
}
```

## Business Logic

### Dashboard Data Aggregation
```typescript
async function getDashboardData(farmId: string, userId: string) {
  // 1. Verify user has access to farm
  const hasAccess = await checkFarmAccess(userId, farmId);
  if (!hasAccess) throw new UnauthorizedError();
  
  // 2. Fetch KPIs in parallel
  const [labour, compliance, chemicals, water] = await Promise.all([
    getLabourKPIs(farmId),
    getComplianceKPIs(farmId),
    getChemicalKPIs(farmId),
    getWaterKPIs(farmId)
  ]);
  
  // 3. Get active alerts
  const alerts = await getActiveAlerts(farmId);
  
  // 4. Get shared resources status
  const sharedResources = await getSharedResourcesStatus(farmId);
  
  // 5. Get recent activity
  const activity = await getRecentActivity(farmId, 10);
  
  // 6. Get upcoming tasks
  const tasks = await getUpcomingTasks(farmId, 5);
  
  return {
    farm: await getFarm(farmId),
    kpis: { labour, compliance, chemicals, water },
    alerts,
    sharedResources,
    activity,
    tasks
  };
}
```

### Alert Generation
```typescript
// Auto-generate alerts based on system events
async function generateAlerts() {
  // Certificate expiry alerts
  const expiringCerts = await findExpiringCertificates(7); // 7 days
  for (const cert of expiringCerts) {
    await createAlert({
      farmId: cert.farmId,
      type: 'critical',
      category: 'compliance',
      title: 'Certificate Expiry',
      message: `${cert.name} expires in ${cert.daysUntilExpiry} days`,
      actionUrl: '/compliance#certificates'
    });
  }
  
  // Service due alerts
  const serviceDue = await findVehiclesServiceDue();
  // ... etc
}
```

### Real-time Updates
```typescript
// WebSocket connection for real-time dashboard updates
io.on('connection', (socket) => {
  socket.on('subscribe:farm', async (farmId) => {
    socket.join(`farm:${farmId}`);
    
    // Send initial data
    const data = await getDashboardData(farmId, socket.userId);
    socket.emit('dashboard:update', data);
  });
  
  // Broadcast updates when KPIs change
  socket.on('kpi:updated', (data) => {
    io.to(`farm:${data.farmId}`).emit('kpi:update', data);
  });
});
```

## Integration Points

### With Other Modules
1. **Labour Module** → Active worker count, weekly cost
2. **Compliance Module** → Score, expiring certificates
3. **Chemical Module** → Spray applications due
4. **Water Module** → Monthly usage
5. **Admin Module** → Shared resource notifications

### Data Flow
```
Dashboard subscribes to:
- labour.worker_allocation_updated
- compliance.certificate_expiring
- compliance.audit_scheduled
- assets.service_due
- water.license_threshold_warning
- admin.resource_transfer_created
```

## UI Screens

### Main Dashboard View
**Route:** `/dashboard`

**Layout:**
```
┌─────────────────────────────────────────┐
│ Navbar (Farm Selector | Admin | User)  │
├─────────────────────────────────────────┤
│ Farm Context Header                     │
├─────────────────────────────────────────┤
│ Shared Resources Alert (if applicable)  │
├─────────────────────────────────────────┤
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐        │
│ │ KPI │ │ KPI │ │ KPI │ │ KPI │        │
│ └─────┘ └─────┘ └─────┘ └─────┘        │
├─────────────────────────────────────────┤
│ Critical Alerts                         │
├─────────────────────────────────────────┤
│ Quick Access Modules (3x3 grid)        │
├───────────────────┬─────────────────────┤
│ Recent Activity   │ Upcoming Tasks      │
│ (8 cols)          │ (4 cols)            │
└───────────────────┴─────────────────────┘
```

## State Management

### Redux Slices
```typescript
// dashboardSlice.ts
interface DashboardState {
  currentFarm: Farm | null;
  kpis: KPIData | null;
  alerts: Alert[];
  activity: ActivityItem[];
  tasks: Task[];
  loading: boolean;
  error: string | null;
}

const dashboardSlice = createSlice({
  name: 'dashboard',
  initialState,
  reducers: {
    setCurrentFarm,
    updateKPIs,
    addAlert,
    markAlertRead,
    addActivity,
    // ...
  }
});
```

## Permissions & Access Control

### Role-Based Visibility
- **Super Admin:** All farms, all modules
- **Farm Admin:** Assigned farms, all modules
- **Farm Manager:** Single farm, operational modules
- **Field User:** Limited view, no dashboard access

### Feature Flags
```typescript
const canAccessModule = (user: User, module: string) => {
  const rolePermissions = {
    'super_admin': ['*'],
    'farm_admin': ['dashboard', 'labour', 'compliance', 'reports'],
    'farm_manager': ['dashboard', 'labour', 'chemicals', 'crops', 'water'],
    'field_user': ['labour:capture']
  };
  
  return rolePermissions[user.role].includes(module) || 
         rolePermissions[user.role].includes('*');
};
```

## Performance Considerations

### Caching Strategy
- KPI data: Cache for 5 minutes
- Alert data: Cache for 1 minute
- Activity feed: Cache for 30 seconds
- Farm list: Cache for 1 hour

### Optimization
- Lazy load module cards
- Virtualize long activity feeds
- Debounce real-time updates (max 1/second)
- Use React.memo for static components

## Testing Requirements

### Unit Tests
- KPI calculation functions
- Alert generation logic
- Permission checking
- Data aggregation

### Integration Tests
- API endpoint responses
- WebSocket connections
- Multi-farm switching
- Alert creation workflows

### E2E Tests
- User logs in → sees correct farms
- Farm switching updates all widgets
- Alert clicking navigates correctly
- Module cards link to correct pages

## Accessibility

- ARIA labels on all interactive elements
- Keyboard navigation support
- Screen reader announcements for alerts
- Color contrast compliance (WCAG 2.1 AA)

## Mobile Responsiveness

### Breakpoints
- Desktop: 1200px+
- Tablet: 768px - 1199px
- Mobile: < 768px

### Mobile Adaptations
- Stack KPI widgets vertically
- Collapse farm selector to dropdown
- Hide activity feed on small screens
- Show only top 3 module cards, "View All" button

## Implementation Notes

### Technology Stack
- **Frontend:** React 18+ with TypeScript
- **State:** Redux Toolkit + RTK Query
- **Styling:** Tailwind CSS / Bootstrap 5
- **Charts:** Recharts / Chart.js
- **Real-time:** Socket.io
- **Routing:** React Router v6

### File Structure
```
src/
├── features/
│   └── dashboard/
│       ├── components/
│       │   ├── Navbar.tsx
│       │   ├── FarmHeader.tsx
│       │   ├── SharedResourcesAlert.tsx
│       │   ├── KPIWidget.tsx
│       │   ├── AlertCard.tsx
│       │   ├── ModuleCard.tsx
│       │   ├── ActivityFeed.tsx
│       │   └── UpcomingTasks.tsx
│       ├── hooks/
│       │   ├── useDashboardData.ts
│       │   ├── useFarmSwitch.ts
│       │   └── useRealTimeUpdates.ts
│       ├── services/
│       │   └── dashboardApi.ts
│       ├── slices/
│       │   └── dashboardSlice.ts
│       └── pages/
│           └── DashboardPage.tsx
```

## Environment Variables
```env
REACT_APP_API_URL=http://localhost:3000/api
REACT_APP_WS_URL=ws://localhost:3000
REACT_APP_REFRESH_INTERVAL=300000 # 5 minutes
```

## Dependencies
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-redux": "^8.1.0",
    "@reduxjs/toolkit": "^1.9.5",
    "react-router-dom": "^6.14.0",
    "socket.io-client": "^4.5.1",
    "date-fns": "^2.30.0",
    "recharts": "^2.7.2"
  }
}
```
