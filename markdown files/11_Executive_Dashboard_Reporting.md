# Executive Dashboard & Advanced Reporting Module

## Overview
Provides executive-level KPIs, advanced analytics, and comprehensive reporting across all business operations.

## Database Entities

### dashboard_kpis
```sql
CREATE TABLE dashboard_kpis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kpi_name VARCHAR(100) NOT NULL,
    kpi_category VARCHAR(50),
    
    kpi_value DECIMAL(15,2),
    target_value DECIMAL(15,2),
    variance DECIMAL(15,2),
    variance_percentage DECIMAL(5,2),
    
    period_type VARCHAR(20), -- daily, weekly, monthly, quarterly, annual
    period_date DATE,
    
    trend VARCHAR(20), -- up, down, stable
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### report_templates
```sql
CREATE TABLE report_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_name VARCHAR(255) NOT NULL,
    report_category VARCHAR(100),
    
    sql_query TEXT,
    parameters JSONB,
    
    chart_type VARCHAR(50),
    chart_config JSONB,
    
    created_by UUID REFERENCES users(id),
    is_system_template BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### scheduled_reports
```sql
CREATE TABLE scheduled_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_template_id UUID REFERENCES report_templates(id),
    
    schedule_frequency VARCHAR(20), -- daily, weekly, monthly
    schedule_time TIME,
    schedule_day INTEGER,
    
    recipients TEXT[],
    format VARCHAR(20), -- pdf, excel, csv
    
    last_run_date TIMESTAMP WITH TIME ZONE,
    next_run_date TIMESTAMP WITH TIME ZONE,
    
    is_active BOOLEAN DEFAULT true,
    
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Executive Dashboard Features

### Key Performance Indicators (KPIs)

**Production KPIs**
- Total production volume (kernels & oil)
- Average cycle time
- Production efficiency (%)
- Quality pass rate (%)
- Waste percentage
- Equipment utilization

**Financial KPIs**
- Revenue (monthly, YTD)
- Gross margin (%)
- Operating expenses
- Accounts receivable aging
- Accounts payable aging
- Cash flow

**Quality KPIs**
- Quality test pass rate
- Quality holds count
- Customer complaints
- Audit compliance score
- COA issuance time

**Customer KPIs**
- Order fulfillment rate
- On-time delivery (%)
- Customer satisfaction score
- Quote conversion rate
- Average order value
- Customer retention rate

**Supplier KPIs**
- Supplier quality rating
- On-time delivery from suppliers
- Grower payment timeliness
- Supplier defect rate

**Stock KPIs**
- Stock turnover rate
- Days of stock on hand
- Stock accuracy (%)
- Slow-moving stock value
- Stock value by product type

### Standard Reports

**Production Reports**
1. Daily Production Summary
2. Weekly Production Analysis
3. Batch Completion Report
4. Yield Analysis Report
5. Waste Analysis Report
6. Mass Balance Report
7. Equipment Utilization Report

**Quality Reports**
1. Quality Test Summary
2. Quality Hold Report
3. Non-Conformance Report
4. Audit Findings Report
5. COA Issuance Report
6. Customer Complaint Report

**Financial Reports**
1. Sales Analysis Report
2. Purchase Analysis Report
3. Grower Payment Report
4. Cash Flow Report
5. Budget vs Actual Report
6. Profitability Analysis Report

**Customer Reports**
1. Sales by Customer Report
2. Customer Order History
3. Customer Payment Report
4. Quote Analysis Report
5. Customer Satisfaction Report

**Stock Reports**
1. Stock on Hand Report
2. Stock Movement Report
3. Stock Aging Report
4. Stock Valuation Report
5. Slow-Moving Stock Report

**Supplier Reports**
1. Supplier Performance Report
2. Purchase Order Report
3. Grower Batch Report
4. Supplier Quality Report
5. Payment to Suppliers Report

### Report Filters

- Date ranges (today, yesterday, this week, last week, this month, last month, this quarter, this year, custom)
- Product types (kernel, oil)
- Customers
- Suppliers
- Batch numbers
- Status
- Department
- User

### Report Export Formats

- PDF (formatted for printing)
- Excel (with pivot tables)
- CSV (for further analysis)
- Email delivery

### Dashboards

**Executive Dashboard**
- High-level KPIs
- Revenue trends
- Production volume trends
- Quality metrics
- Financial summary
- Alerts and notifications

**Production Dashboard**
- Active batches pipeline
- Production efficiency
- Quality metrics
- Equipment status
- Staff productivity

**Sales Dashboard**
- Sales trends
- Order pipeline
- Customer activity
- Quote conversion
- Revenue forecasts

**Quality Dashboard**
- Quality test results
- Hold status
- Audit compliance
- Testing backlog
- COA issuance status

**Finance Dashboard**
- Cash flow
- AP/AR aging
- Budget variance
- Payment schedules
- Profitability

## Business Rules

### Dashboard Access
- Executive Dashboard: General Manager, Directors
- Production Dashboard: Production Manager, QA Supervisor
- Sales Dashboard: Sales Executive, General Manager
- Quality Dashboard: QA Supervisor, General Manager
- Finance Dashboard: Office Administrator, General Manager

### Report Scheduling
- Daily reports: Generated at 6 AM
- Weekly reports: Generated Monday 6 AM
- Monthly reports: Generated 1st day of month 6 AM
- Ad-hoc reports: On demand

### Data Refresh
- Real-time dashboards: 30-second refresh
- KPIs: 5-minute refresh
- Historical reports: No auto-refresh

## Key Features

- Interactive dashboards with drill-down
- Customizable KPI targets
- Trend analysis and forecasting
- Automated report generation
- Email report distribution
- Mobile-responsive design
- Export to multiple formats
- Scheduled report delivery
