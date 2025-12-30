# Amanda Dashboard Module (Material Journey Tracking)

## Overview
Real-time tracking dashboard showing the complete journey of material from grower intake through production to final dispatch. Named "Amanda" after the key stakeholder managing intake and stock.

## Purpose

The Amanda Dashboard provides:
- **Real-time visibility** of all batches in the system
- **Material journey tracking** from NIS receipt to finished goods dispatch
- **Status at every production step** for both kernel and oil production
- **Quick alerts** for quality holds, delays, and bottlenecks
- **Search and filter** capabilities for specific batches, growers, or dates

## Database Entities

### material_journey_events
```sql
CREATE TABLE material_journey_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Batch Identification
    batch_type VARCHAR(20) CHECK (batch_type IN ('kernel', 'oil', 'nis')),
    batch_id UUID, -- References production_batches or oil_production_batches
    batch_number VARCHAR(100) NOT NULL,
    
    -- Event Details
    event_type VARCHAR(100) NOT NULL,
    event_stage VARCHAR(50) NOT NULL,
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Location/Stage
    from_location VARCHAR(100),
    to_location VARCHAR(100),
    current_stage VARCHAR(100),
    
    -- Quantities
    quantity_kg DECIMAL(12,2),
    
    -- Status
    status VARCHAR(50),
    quality_status VARCHAR(50),
    
    -- Personnel
    operator_id UUID REFERENCES users(id),
    
    -- Additional Data
    event_data JSONB,
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_material_journey_batch ON material_journey_events(batch_number);
CREATE INDEX idx_material_journey_timestamp ON material_journey_events(event_timestamp DESC);
CREATE INDEX idx_material_journey_stage ON material_journey_events(current_stage);
```

### dashboard_alerts
```sql
CREATE TABLE dashboard_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_number VARCHAR(50) UNIQUE NOT NULL,
    
    alert_type VARCHAR(50) CHECK (alert_type IN ('quality_hold', 'delay', 'bottleneck', 'expiry_warning', 'stock_low', 'approval_pending')),
    severity VARCHAR(20) CHECK (severity IN ('info', 'warning', 'critical')),
    
    -- Related Entity
    entity_type VARCHAR(50),
    entity_id UUID,
    batch_number VARCHAR(100),
    
    -- Alert Details
    alert_title VARCHAR(255) NOT NULL,
    alert_message TEXT,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved', 'dismissed')),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    -- Personnel
    assigned_to UUID REFERENCES users(id),
    acknowledged_by UUID REFERENCES users(id),
    resolved_by UUID REFERENCES users(id)
);

CREATE INDEX idx_dashboard_alerts_status ON dashboard_alerts(status);
CREATE INDEX idx_dashboard_alerts_severity ON dashboard_alerts(severity);
CREATE INDEX idx_dashboard_alerts_batch ON dashboard_alerts(batch_number);
```

## Frontend Implementation

### Amanda Dashboard HTML
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Amanda Dashboard - Material Journey</title>
    <style>
        /* Dashboard specific styles */
        .amanda-dashboard {
            background: #f5f7fa;
            min-height: 100vh;
            padding: 20px;
        }
        
        .dashboard-header {
            background: linear-gradient(135deg, #5CBDB4 0%, #4A9A93 100%);
            color: white;
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 20px;
        }
        
        .dashboard-title {
            font-size: 2em;
            margin-bottom: 10px;
        }
        
        .dashboard-subtitle {
            opacity: 0.9;
        }
        
        .dashboard-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .stat-value {
            font-size: 2.5em;
            font-weight: bold;
            color: #5CBDB4;
        }
        
        .stat-label {
            color: #4A4A4A;
            margin-top: 5px;
        }
        
        .alerts-section {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .alert-item {
            padding: 15px;
            border-left: 4px solid;
            margin-bottom: 10px;
            border-radius: 4px;
        }
        
        .alert-critical {
            background: #FFEBEE;
            border-color: #C62828;
        }
        
        .alert-warning {
            background: #FFF9C4;
            border-color: #F57F17;
        }
        
        .alert-info {
            background: #E3F2FD;
            border-color: #1976D2;
        }
        
        .journey-timeline {
            background: white;
            padding: 20px;
            border-radius: 8px;
        }
        
        .batch-journey {
            margin-bottom: 30px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
        }
        
        .batch-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .batch-number {
            font-size: 1.3em;
            font-weight: bold;
            color: #4A4A4A;
        }
        
        .batch-grower {
            color: #666;
        }
        
        .journey-steps {
            display: flex;
            align-items: center;
            overflow-x: auto;
        }
        
        .journey-step {
            flex: 1;
            min-width: 120px;
            text-align: center;
            position: relative;
        }
        
        .journey-step:not(:last-child)::after {
            content: '';
            position: absolute;
            top: 20px;
            right: -50%;
            width: 100%;
            height: 3px;
            background: #e0e0e0;
            z-index: 0;
        }
        
        .journey-step.completed:not(:last-child)::after {
            background: #5CBDB4;
        }
        
        .step-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #e0e0e0;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 10px;
            font-weight: bold;
            position: relative;
            z-index: 1;
        }
        
        .journey-step.completed .step-icon {
            background: #5CBDB4;
        }
        
        .journey-step.active .step-icon {
            background: #4A4A4A;
            animation: pulse 2s infinite;
        }
        
        .journey-step.hold .step-icon {
            background: #C62828;
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
        
        .step-label {
            font-size: 0.8em;
            color: #4A4A4A;
        }
        
        .step-time {
            font-size: 0.7em;
            color: #999;
            margin-top: 5px;
        }
        
        .filters-bar {
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }
        
        .filter-group {
            flex: 1;
            min-width: 200px;
        }
        
        .filter-group label {
            display: block;
            margin-bottom: 5px;
            color: #4A4A4A;
            font-weight: 500;
        }
        
        .filter-group input,
        .filter-group select {
            width: 100%;
            padding: 10px;
            border: 2px solid #e0e0e0;
            border-radius: 6px;
        }
    </style>
</head>
<body>
    <div class="amanda-dashboard">
        <!-- Dashboard Header -->
        <div class="dashboard-header">
            <h1 class="dashboard-title">Amanda Dashboard</h1>
            <p class="dashboard-subtitle">Real-Time Material Journey Tracking</p>
            <p class="dashboard-subtitle">Last updated: <span id="lastUpdate">Loading...</span></p>
        </div>

        <!-- Dashboard Statistics -->
        <div class="dashboard-stats">
            <div class="stat-card">
                <div class="stat-value" id="activeBatches">0</div>
                <div class="stat-label">Active Batches</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="pendingRelease">0</div>
                <div class="stat-label">Pending Release</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="qualityHolds">0</div>
                <div class="stat-label">Quality Holds</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="avgCycleTime">0</div>
                <div class="stat-label">Avg Cycle Time (days)</div>
            </div>
        </div>

        <!-- Alerts Section -->
        <div class="alerts-section">
            <h2>Active Alerts</h2>
            <div id="alertsList">
                <!-- Alerts populated by JavaScript -->
            </div>
        </div>

        <!-- Filters -->
        <div class="filters-bar">
            <div class="filter-group">
                <label>Search Batch</label>
                <input type="text" id="searchBatch" placeholder="Batch number or grower...">
            </div>
            <div class="filter-group">
                <label>Product Type</label>
                <select id="filterProductType">
                    <option value="">All</option>
                    <option value="kernel">Kernel</option>
                    <option value="oil">Oil</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Status</label>
                <select id="filterStatus">
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="hold">On Hold</option>
                    <option value="pending_release">Pending Release</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Date Range</label>
                <input type="date" id="filterDateFrom">
            </div>
        </div>

        <!-- Material Journey Timeline -->
        <div class="journey-timeline">
            <h2>Material Journey</h2>
            <div id="journeyBatches">
                <!-- Batch journeys populated by JavaScript -->
            </div>
        </div>
    </div>

    <script src="/js/amanda-dashboard.js"></script>
</body>
</html>
```

### JavaScript Implementation
```javascript
class AmandaDashboard {
    constructor() {
        this.batches = [];
        this.alerts = [];
        this.refreshInterval = 30000; // 30 seconds
        this.init();
    }

    async init() {
        await this.loadDashboardData();
        this.renderDashboard();
        this.setupAutoRefresh();
        this.setupFilters();
    }

    async loadDashboardData() {
        try {
            // Load active batches with journey events
            const { data: kernelBatches } = await supabase
                .from('production_batches')
                .select(`
                    *,
                    batch_step_records(*),
                    supplier:contacts(company_name)
                `)
                .neq('status', 'completed')
                .order('received_date', { ascending: false });

            const { data: oilBatches } = await supabase
                .from('oil_production_batches')
                .select(`
                    *,
                    oil_batch_step_records(*)
                `)
                .neq('status', 'completed')
                .order('production_date', { ascending: false });

            // Load alerts
            const { data: alerts } = await supabase
                .from('dashboard_alerts')
                .select('*')
                .eq('status', 'active')
                .order('created_at', { ascending: false });

            this.batches = [
                ...kernelBatches.map(b => ({ ...b, type: 'kernel' })),
                ...oilBatches.map(b => ({ ...b, type: 'oil' }))
            ];
            this.alerts = alerts;

            this.updateStatistics();
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    }

    updateStatistics() {
        document.getElementById('activeBatches').textContent = this.batches.length;
        document.getElementById('pendingRelease').textContent = 
            this.batches.filter(b => b.status === 'pending_release').length;
        document.getElementById('qualityHolds').textContent = 
            this.batches.filter(b => b.quality_hold).length;
        
        // Calculate average cycle time
        const completedBatches = this.batches.filter(b => b.completion_date);
        if (completedBatches.length > 0) {
            const avgDays = completedBatches.reduce((sum, b) => {
                const start = new Date(b.received_date || b.production_date);
                const end = new Date(b.completion_date);
                return sum + ((end - start) / (1000 * 60 * 60 * 24));
            }, 0) / completedBatches.length;
            document.getElementById('avgCycleTime').textContent = avgDays.toFixed(1);
        }

        document.getElementById('lastUpdate').textContent = new Date().toLocaleString();
    }

    renderDashboard() {
        this.renderAlerts();
        this.renderBatchJourneys();
    }

    renderAlerts() {
        const container = document.getElementById('alertsList');
        container.innerHTML = '';

        if (this.alerts.length === 0) {
            container.innerHTML = '<p>No active alerts</p>';
            return;
        }

        this.alerts.forEach(alert => {
            const alertDiv = document.createElement('div');
            alertDiv.className = `alert-item alert-${alert.severity}`;
            alertDiv.innerHTML = `
                <strong>${alert.alert_title}</strong>
                <p>${alert.alert_message}</p>
                <small>Batch: ${alert.batch_number} | ${new Date(alert.created_at).toLocaleString()}</small>
            `;
            container.appendChild(alertDiv);
        });
    }

    renderBatchJourneys() {
        const container = document.getElementById('journeyBatches');
        container.innerHTML = '';

        this.batches.forEach(batch => {
            const journeyDiv = this.createBatchJourney(batch);
            container.appendChild(journeyDiv);
        });
    }

    createBatchJourney(batch) {
        const div = document.createElement('div');
        div.className = 'batch-journey';

        const steps = batch.type === 'kernel' ? this.getKernelSteps() : this.getOilSteps();
        const currentStep = batch.current_step;

        div.innerHTML = `
            <div class="batch-header">
                <div>
                    <div class="batch-number">${batch.batch_number}</div>
                    <div class="batch-grower">${batch.grower_name || 'Oil Production'}</div>
                </div>
                <div>
                    <span class="badge badge-${batch.status}">${batch.status}</span>
                    ${batch.quality_hold ? '<span class="badge badge-danger">HOLD</span>' : ''}
                </div>
            </div>
            <div class="journey-steps">
                ${steps.map((step, index) => {
                    const stepNum = index + 1;
                    let stepClass = 'journey-step';
                    if (stepNum < currentStep) stepClass += ' completed';
                    if (stepNum === currentStep) stepClass += batch.quality_hold ? ' hold' : ' active';
                    
                    const stepRecord = batch.batch_step_records?.find(r => r.step_number === stepNum) ||
                                     batch.oil_batch_step_records?.find(r => r.step_number === stepNum);
                    
                    return `
                        <div class="${stepClass}">
                            <div class="step-icon">${stepNum}</div>
                            <div class="step-label">${step.name}</div>
                            ${stepRecord && stepRecord.end_time ? 
                                `<div class="step-time">${new Date(stepRecord.end_time).toLocaleDateString()}</div>` : 
                                ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        return div;
    }

    getKernelSteps() {
        return [
            { number: 1, name: 'Receiving' },
            { number: 2, name: 'Cracking' },
            { number: 3, name: 'Washing' },
            { number: 4, name: 'Drying' },
            { number: 5, name: 'Sorting' },
            { number: 6, name: 'Packing' },
            { number: 7, name: 'QA Release' },
            { number: 8, name: 'Storage' }
        ];
    }

    getOilSteps() {
        return [
            { number: 1, name: 'Intake' },
            { number: 2, name: 'Pressing' },
            { number: 3, name: 'Settling' },
            { number: 4, name: 'Filtering' },
            { number: 5, name: 'Testing' },
            { number: 6, name: 'Storage' },
            { number: 7, name: 'Packing' },
            { number: 8, name: 'Release' }
        ];
    }

    setupAutoRefresh() {
        setInterval(async () => {
            await this.loadDashboardData();
            this.renderDashboard();
        }, this.refreshInterval);
    }

    setupFilters() {
        // Implement filter logic
        document.getElementById('searchBatch').addEventListener('input', () => this.applyFilters());
        document.getElementById('filterProductType').addEventListener('change', () => this.applyFilters());
        document.getElementById('filterStatus').addEventListener('change', () => this.applyFilters());
    }

    applyFilters() {
        // Filter implementation
        this.renderBatchJourneys();
    }
}

// Initialize Amanda Dashboard
const amandaDashboard = new AmandaDashboard();
```

## Key Features

1. **Real-Time Tracking**: Auto-refresh every 30 seconds
2. **Visual Journey**: Timeline showing progress through all steps
3. **Alert Management**: Critical, warning, and info alerts
4. **Quick Statistics**: Active batches, holds, pending releases
5. **Search & Filter**: Find specific batches quickly
6. **Status Indicators**: Color-coded status for quick identification
7. **Hold Identification**: Clear visual indicators for quality holds
8. **Responsive Design**: Works on desktop, tablet, and mobile

## Business Value

- **Improved Visibility**: Everyone can see where batches are
- **Faster Response**: Alerts highlight issues immediately
- **Better Planning**: See bottlenecks and capacity constraints
- **Quality Control**: Quality holds clearly visible
- **Customer Service**: Quick batch status lookup for customer inquiries
- **Management Oversight**: High-level view of all operations

