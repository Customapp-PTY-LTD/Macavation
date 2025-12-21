# FruitLive Implementation Guide
## Bootstrap 5 + Vanilla JavaScript + Supabase + AWS Lambda Stack

---

## 📚 How to Use the Module Specifications

The 9 module specifications were originally written for a React + Redux stack, but they can be **easily adapted** to your Bootstrap 5 + Vanilla JS + Supabase + AWS Lambda stack. Here's how:

---

## 🔄 Conversion Matrix

| Spec Component | Original Tech | Your Tech | Conversion Method |
|----------------|---------------|-----------|-------------------|
| **Database Schema** | PostgreSQL | Supabase (PostgreSQL) | ✅ Use as-is, apply directly |
| **API Endpoints** | Express REST | AWS Lambda | 🔄 Convert to Lambda handlers |
| **React Components** | React + JSX | Vanilla JS + HTML | 🔄 Convert to classes/templates |
| **Redux State** | Redux Toolkit | AppState class | 🔄 Use state management pattern |
| **Styling** | Tailwind/Bootstrap | Bootstrap 5 | ✅ Use as-is |
| **Forms** | React Hook Form | HTML5 + Bootstrap | 🔄 Use native validation |
| **Charts** | Recharts | Chart.js | 🔄 Similar API, easy conversion |

---

## 🗄️ Step 1: Database Setup (No Conversion Needed!)

### The SQL schemas in all 9 specs work perfectly with Supabase!

**Example from Labour Management spec:**

```sql
-- From 02-labour-management-spec.md
-- Copy this SQL exactly into Supabase SQL Editor

CREATE TABLE workers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_number VARCHAR(50) UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    id_number VARCHAR(20) UNIQUE,
    phone VARCHAR(20),
    email VARCHAR(100),
    home_farm_id UUID REFERENCES farms(id),
    current_farm_id UUID REFERENCES farms(id),
    employment_type VARCHAR(20),
    hire_date DATE,
    bank_name VARCHAR(100),
    bank_account_number VARCHAR(50),
    hourly_rate DECIMAL(10,2),
    status VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Enable RLS for multi-farm security
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;

-- Only see workers from your accessible farms
CREATE POLICY "users_own_farm_workers" ON workers
  FOR SELECT USING (
    current_farm_id IN (
      SELECT farm_id FROM user_farm_access
      WHERE user_id = auth.uid()
    )
  );
```

### Migration Process

```bash
# 1. Install Supabase CLI
npm install -g supabase

# 2. Login to your project
supabase login

# 3. Link to your project
supabase link --project-ref your-project-ref

# 4. Create migration files for each module
supabase migration new 01_dashboard_tables
supabase migration new 02_labour_tables
# ... etc

# 5. Copy SQL from specs into migration files

# 6. Apply migrations
supabase db push

# 7. Verify in Supabase Dashboard
```

---

## ⚡ Step 2: Convert API Endpoints to Lambda

### From Spec to Lambda Function

**Example from Labour Management spec:**

**Spec says:**
```javascript
GET /api/labour/workers?farmId=&status=&search=

Response:
{
  "workers": [...],
  "total": 147
}
```

**Your Lambda implementation:**

```javascript
// lambda-functions/labour/getWorkers.js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  try {
    // 1. Extract query parameters (from spec)
    const { farmId, status, search } = event.queryStringParameters || {};

    // 2. Validate required params
    if (!farmId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'farmId is required' })
      };
    }

    // 3. Build query using Supabase client
    let query = supabase
      .from('workers')
      .select('*')
      .eq('current_farm_id', farmId);

    // 4. Apply filters from spec
    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    }

    // 5. Execute query
    const { data: workers, error } = await query;

    if (error) throw error;

    // 6. Return response matching spec format
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        workers,
        total: workers.length
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

### Lambda Function Template

For any endpoint in any spec, use this template:

```javascript
// lambda-functions/[module]/[functionName].js

const { createClient } = require('@supabase/supabase-js');
const { validateSession } = require('../shared/auth');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  try {
    // 1. Validate session (for protected endpoints)
    const session = await validateSession(event.headers);
    if (!session.valid) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // 2. Extract parameters from spec
    const params = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};

    // 3. Implement business logic from spec
    // ... your code here ...

    // 4. Return response matching spec format
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ /* data from spec */ })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

---

## 🎨 Step 3: Convert React Components to Vanilla JS

### Conversion Strategy

**From spec (React interface):**
```typescript
interface WorkerListProps {
  farmId: string;
  workers: Worker[];
  onWorkerSelect: (worker: Worker) => void;
}
```

**To Vanilla JS class:**

```javascript
// js/modules/labour/WorkerList.js

class WorkerList {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.farmId = options.farmId;
    this.workers = options.workers || [];
    this.onWorkerSelect = options.onWorkerSelect || (() => {});
    
    this.init();
  }

  init() {
    this.render();
    this.attachEventListeners();
  }

  render() {
    if (this.workers.length === 0) {
      this.container.innerHTML = `
        <div class="text-center text-muted py-5">
          <i class="bi bi-people fs-1"></i>
          <p>No workers found</p>
        </div>
      `;
      return;
    }

    this.container.innerHTML = `
      <div class="list-group">
        ${this.workers.map(worker => `
          <div class="list-group-item list-group-item-action worker-item" 
               data-worker-id="${worker.id}">
            <div class="d-flex w-100 justify-content-between">
              <h6 class="mb-1">${worker.firstName} ${worker.lastName}</h6>
              <small class="text-muted">${worker.employeeNumber}</small>
            </div>
            <p class="mb-1">${worker.position}</p>
            <small class="text-muted">
              <i class="bi bi-house"></i> ${worker.currentFarm || worker.homeFarm}
            </small>
          </div>
        `).join('')}
      </div>
    `;
  }

  attachEventListeners() {
    this.container.querySelectorAll('.worker-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const workerId = e.currentTarget.dataset.workerId;
        const worker = this.workers.find(w => w.id === workerId);
        if (worker) {
          this.onWorkerSelect(worker);
        }
      });
    });
  }

  update(workers) {
    this.workers = workers;
    this.render();
  }

  destroy() {
    this.container.innerHTML = '';
  }
}
```

### HTML Template for Component

```html
<!-- labour.html -->

<div class="card">
  <div class="card-header">
    <h5>Workers</h5>
  </div>
  <div class="card-body">
    <!-- Component renders here -->
    <div id="workerListContainer"></div>
  </div>
</div>

<script>
  // Usage
  const workerList = new WorkerList('workerListContainer', {
    farmId: currentFarmId,
    workers: [],
    onWorkerSelect: (worker) => {
      console.log('Selected worker:', worker);
      showWorkerDetails(worker);
    }
  });

  // Load workers from API
  async function loadWorkers() {
    const data = await api.get('/labour/workers', { farmId: currentFarmId });
    workerList.update(data.workers);
  }
</script>
```

---

## 📊 Step 4: Convert Charts

**From spec (Recharts):**
```tsx
import { LineChart, Line, XAxis, YAxis } from 'recharts';

<LineChart data={data}>
  <Line dataKey="cost" stroke="#5CBDB4" />
  <XAxis dataKey="date" />
  <YAxis />
</LineChart>
```

**To Chart.js:**

```javascript
// js/charts/labourCostChart.js

function renderLabourCostChart(containerId, data) {
  const ctx = document.getElementById(containerId).getContext('2d');
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.date),
      datasets: [{
        label: 'Labour Cost',
        data: data.map(d => d.cost),
        borderColor: '#5CBDB4',
        backgroundColor: 'rgba(92, 189, 180, 0.1)',
        borderWidth: 2,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: (context) => 'R' + context.parsed.y.toLocaleString()
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => 'R' + value.toLocaleString()
          }
        }
      }
    }
  });
}
```

```html
<!-- In your HTML -->
<div class="card">
  <div class="card-header">Labour Cost Trend</div>
  <div class="card-body">
    <canvas id="labourCostChart" height="300"></canvas>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
  // Load data and render
  async function loadCostData() {
    const data = await api.get('/labour/analytics/costs', {
      farmId: currentFarmId,
      startDate: '2025-12-01',
      endDate: '2025-12-13'
    });
    
    renderLabourCostChart('labourCostChart', data.breakdown);
  }
</script>
```

---

## 🔧 Step 5: Implement Business Logic

**From spec (TypeScript):**
```typescript
async function calculateLabourCost(allocation: Allocation) {
  const worker = await getWorker(allocation.workerId);
  const hours = allocation.hoursWorked;
  
  const baseCost = worker.hourlyRate * hours;
  const bonusCost = allocation.bonusAmount || 0;
  
  // Apply markup for transferred workers
  let markup = 0;
  if (worker.homeFarmId !== allocation.farmId) {
    markup = baseCost * 0.10;
  }
  
  return {
    baseCost,
    bonusCost,
    markup,
    totalCost: baseCost + bonusCost + markup
  };
}
```

**To Lambda function:**

```javascript
// lambda-functions/labour/calculateCost.js

async function calculateLabourCost(supabase, allocation) {
  // 1. Get worker data
  const { data: worker } = await supabase
    .from('workers')
    .select('*')
    .eq('id', allocation.workerId)
    .single();

  // 2. Calculate base cost
  const hours = allocation.hoursWorked || 
    calculateHours(allocation.startTime, allocation.endTime);
  const baseCost = worker.hourlyRate * hours;
  const bonusCost = allocation.bonusAmount || 0;

  // 3. Apply transfer markup
  let markup = 0;
  if (worker.homeFarmId !== allocation.farmId) {
    markup = baseCost * 0.10; // 10% markup for shared workers
  }

  const totalCost = baseCost + bonusCost + markup;

  // 4. Update allocation with cost
  await supabase
    .from('worker_allocations')
    .update({ 
      cost: totalCost,
      base_cost: baseCost,
      bonus_cost: bonusCost,
      transfer_markup: markup
    })
    .eq('id', allocation.id);

  return { baseCost, bonusCost, markup, totalCost };
}

function calculateHours(startTime, endTime) {
  const start = new Date(`2000-01-01 ${startTime}`);
  const end = new Date(`2000-01-01 ${endTime}`);
  return (end - start) / (1000 * 60 * 60); // Convert to hours
}

module.exports = { calculateLabourCost };
```

---

## 📋 Module-by-Module Implementation Guide

### Module 1: Dashboard

**What to convert:**
- ✅ Database schema → Apply to Supabase as-is
- 🔄 API endpoints → 3-4 Lambda functions (getDashboard, getAlerts, getActivity)
- 🔄 React components → Vanilla JS classes (KPIWidget, AlertCard, ActivityFeed)
- 🔄 WebSocket updates → Use Supabase Realtime instead

**Implementation time:** 2-3 days

### Module 2: Labour Management

**What to convert:**
- ✅ Database schema → Apply to Supabase as-is (7 tables)
- 🔄 API endpoints → 10-12 Lambda functions
- 🔄 React components → 8 Vanilla JS classes
- 🔄 Mobile interface → Responsive Bootstrap with simplified UI

**Implementation time:** 1-2 weeks

### Module 3: Compliance

**What to convert:**
- ✅ Database schema → Apply to Supabase as-is (9 tables)
- 🔄 File uploads → Use Supabase Storage
- 🔄 PDF generation → Use jsPDF in Lambda
- 🔄 React components → 6 Vanilla JS classes

**Implementation time:** 1 week

### Modules 4-9: Similar Pattern

Each follows the same conversion approach. See `TECHNICAL-ARCHITECTURE-SUPABASE.md` for detailed patterns.

---

## 🚀 Quick Start Workflow

### Day 1: Setup Infrastructure

```bash
# 1. Create Supabase project
# Go to supabase.com, create project

# 2. Apply database schemas
# Copy SQL from 09-administration-spec.md (farms, users tables)
# Run in Supabase SQL Editor

# 3. Set up AWS Lambda
npm install -g serverless
serverless create --template aws-nodejs --path fruitlive-api
cd fruitlive-api
npm install @supabase/supabase-js jsonwebtoken

# 4. Create first Lambda function
# Use template from TECHNICAL-ARCHITECTURE-SUPABASE.md
```

### Day 2-3: Build Authentication

```bash
# 1. Apply user tables from Administration spec
# 2. Create login Lambda function
# 3. Build login.html page
# 4. Test auth flow
```

### Week 1: Dashboard + Administration

```bash
# 1. Apply remaining database schemas
# 2. Build dashboard.html
# 3. Create dashboard Lambda functions
# 4. Add farm selector
# 5. Test multi-farm switching
```

### Week 2-3: First Operational Module (Labour)

```bash
# 1. Build labour.html
# 2. Create labour Lambda functions
# 3. Test allocation workflow
# 4. Add mobile interface for indunas
```

### Week 4-8: Remaining Modules

Build one module per week following same pattern.

---

## 💡 Pro Tips for Conversion

### 1. Start Simple
Don't try to convert everything at once. Build incrementally:
- Login page first
- Then dashboard
- Then one module at a time

### 2. Reuse Patterns
Once you've converted one component, you have a template for all others:
- Same Lambda structure
- Same Vanilla JS class pattern
- Same HTML template approach

### 3. Leverage Supabase Features
- Use Supabase Realtime instead of building WebSocket infrastructure
- Use Supabase Storage instead of S3 for simplicity
- Use Supabase Auth instead of building custom auth

### 4. Use Bootstrap Components
Bootstrap 5 has built-in components that replace many React libraries:
- Modals → `bootstrap.Modal`
- Toasts → `bootstrap.Toast`
- Dropdowns → `bootstrap.Dropdown`
- Tooltips → `bootstrap.Tooltip`

### 5. Test As You Go
Don't build all Lambda functions before testing. Test each one as you build it:
```bash
# Test Lambda locally
serverless invoke local --function getWorkers --path test-event.json
```

---

## 📦 Project Structure

```
fruitlive/
├── frontend/
│   ├── index.html              # Login page
│   ├── dashboard.html
│   ├── labour.html
│   ├── compliance.html
│   ├── chemicals.html
│   ├── crops.html
│   ├── assets.html
│   ├── post-harvest.html
│   ├── water.html
│   ├── admin.html
│   ├── css/
│   │   ├── bootstrap.min.css
│   │   └── custom.css          # CustomApp theme
│   ├── js/
│   │   ├── shared/
│   │   │   ├── api.js
│   │   │   ├── auth.js
│   │   │   ├── state.js
│   │   │   └── utils.js
│   │   └── modules/
│   │       ├── dashboard.js
│   │       ├── labour.js
│   │       └── ... (one per module)
│   └── vendor/
│       ├── bootstrap.bundle.min.js
│       ├── chart.min.js
│       └── dayjs.min.js
│
├── lambda-functions/
│   ├── auth/
│   ├── dashboard/
│   ├── labour/
│   ├── compliance/
│   ├── chemicals/
│   ├── crops/
│   ├── assets/
│   ├── postHarvest/
│   ├── water/
│   ├── admin/
│   └── shared/
│       ├── db.js
│       ├── auth.js
│       └── validation.js
│
├── supabase/
│   └── migrations/
│       ├── 001_admin_tables.sql
│       ├── 002_labour_tables.sql
│       └── ... (one per module)
│
├── serverless.yml              # AWS Lambda config
├── package.json
└── README.md
```

---

## 🔍 Where to Find What in Specs

### Database Schemas
Look for the "Database Schema" section in each spec. Copy the SQL exactly into Supabase.

### API Endpoints
Look for the "API Endpoints" section. Each endpoint becomes a Lambda function.

### Business Logic
Look for the "Business Logic" section. Copy the logic into Lambda functions.

### UI Components
Look for the "UI Components" section. Convert to Vanilla JS classes using the patterns shown above.

### Integration Points
Look for "Integration Points" section to understand how modules connect.

---

## ✅ Checklist for Each Module

- [ ] Copy database schema to Supabase migration
- [ ] Run migration, verify tables created
- [ ] Enable RLS policies for farm isolation
- [ ] Create Lambda functions for each API endpoint
- [ ] Test Lambda functions with sample data
- [ ] Create HTML page for module
- [ ] Build Vanilla JS classes for UI components
- [ ] Connect frontend to Lambda APIs
- [ ] Test complete workflow
- [ ] Add to navigation menu
- [ ] Document any customizations

---

## 🎯 Success Metrics

Your implementation is on track when:
- ✅ Each Lambda function returns data in the format specified in the spec
- ✅ Frontend displays data correctly with Bootstrap styling
- ✅ Forms submit successfully and validate inputs
- ✅ Multi-farm switching works across all modules
- ✅ Session management keeps users logged in
- ✅ RLS policies prevent cross-farm data access
- ✅ Charts render with correct data
- ✅ Mobile responsive design works on tablets

---

**You now have everything you need to build FruitLive with your preferred tech stack!** 🚀

The module specs provide the **blueprint** (what to build), and this guide provides the **methodology** (how to build it with your stack).
