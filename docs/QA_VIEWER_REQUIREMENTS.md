# QA Generic Viewer - Full Requirements Specification

**Project:** Macavation Farm Management System
**Document Version:** 1.0
**Date:** January 2026
**Author:** QA Engineering Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Solution Overview](#2-solution-overview)
3. [Database Schema](#3-database-schema)
4. [QA Viewer Features](#4-qa-viewer-features)
5. [E2E Test Integration](#5-e2e-test-integration)
6. [Technical Architecture](#6-technical-architecture)
7. [Setup Instructions](#7-setup-instructions)
8. [User Roles & Permissions](#8-user-roles--permissions)
9. [API Endpoints](#9-api-endpoints)
10. [Future Enhancements](#10-future-enhancements)

---

## 1. Executive Summary

The QA Generic Viewer is a standalone web application that provides comprehensive visibility into test scenarios, test execution results, and quality metrics for the Macavation farm management system. It integrates with Playwright E2E tests and stores results in Supabase for real-time tracking and historical analysis.

### Key Objectives

- Centralized view of all test scenarios across 14+ modules
- Real-time test execution tracking and history
- Comprehensive audit trail for test results
- Role-based testing matrix visibility
- Export capabilities for reporting

---

## 2. Solution Overview

### 2.1 Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| QA Viewer | HTML/JS/Bootstrap 5 | Standalone web interface |
| Database | Supabase (PostgreSQL) | Test data storage |
| E2E Tests | Playwright | Automated test execution |
| Reporter | Custom Supabase Reporter | Store test results |

### 2.2 File Structure

```
Macavation/
├── test-scenarios-viewer.html    # QA Generic Viewer (main UI)
├── qa-data-seeder.html           # Database seeding tool
├── e2e/
│   ├── package.json              # E2E test dependencies
│   ├── playwright.config.ts      # Playwright configuration
│   ├── .env.e2e                  # Environment variables
│   ├── reporters/
│   │   └── supabase.reporter.ts  # Custom result reporter
│   ├── database/
│   │   └── create_qa_tables.sql  # Database schema
│   └── tests/
│       ├── auth/                 # Authentication tests
│       ├── crm/                  # CRM module tests
│       ├── dashboard/            # Dashboard tests
│       ├── financial-management/ # Finance tests
│       ├── grower-intake/        # Grower intake tests
│       ├── kernel-production/    # Kernel production tests
│       ├── oil-production/       # Oil production tests
│       ├── quality-assurance/    # QA module tests
│       ├── stock-management/     # Stock tests
│       └── user-management/      # User/Role tests
└── docs/
    └── QA_VIEWER_REQUIREMENTS.md # This document
```

---

## 3. Database Schema

### 3.1 Entity Relationship Diagram

```
┌─────────────────────┐     ┌─────────────────────┐
│   test_scenarios    │     │   test_run_batches  │
├─────────────────────┤     ├─────────────────────┤
│ id (PK)             │     │ id (PK)             │
│ scenario_code       │     │ batch_name          │
│ scenario_name       │     │ environment         │
│ module_name         │     │ started_at          │
│ test_type           │     │ completed_at        │
│ severity_level      │     │ total_tests         │
│ test_steps (JSONB)  │     │ passed_count        │
│ expected_result     │     │ failed_count        │
│ test_data (JSONB)   │     │ overall_status      │
│ is_automated        │     │ deployment_rec      │
└─────────┬───────────┘     └──────────┬──────────┘
          │                            │
          │    ┌───────────────────────┤
          │    │                       │
          ▼    ▼                       ▼
┌─────────────────────┐     ┌─────────────────────┐
│   test_instances    │     │     test_audit      │
├─────────────────────┤     ├─────────────────────┤
│ id (PK)             │     │ id (PK)             │
│ scenario_id (FK)    │     │ scenario_id (FK)    │
│ run_batch_id (FK)   │     │ instance_id (FK)    │
│ status              │     │ batch_id (FK)       │
│ duration_ms         │     │ status              │
│ error_message       │     │ step_results (JSONB)│
│ step_results (JSONB)│     │ test_data_used      │
│ executed_by_name    │     │ expected_result     │
└─────────────────────┘     │ actual_result       │
                            │ defects (JSONB)     │
                            │ notes               │
                            └─────────────────────┘
```

### 3.2 Table Specifications

#### 3.2.1 test_scenarios (Existing - Updated)

Stores test scenario definitions.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| scenario_code | VARCHAR(50) | Yes | Unique code (e.g., TC-AUTH-001) |
| scenario_name | VARCHAR(255) | Yes | Human-readable name |
| description | TEXT | No | Detailed description |
| module_name | VARCHAR(100) | No | Module category |
| feature_name | VARCHAR(100) | No | Feature within module |
| test_type | VARCHAR(50) | No | functional/security/e2e/integration |
| severity_level | VARCHAR(20) | No | critical/high/medium/low |
| preconditions | TEXT | No | Setup requirements |
| **test_steps** | JSONB | No | **NEW** - Array of step objects |
| expected_result | JSONB/TEXT | No | Expected outcome |
| test_data | JSONB | No | Test data payload |
| tags | JSONB | No | Array of tags |
| is_automated | BOOLEAN | No | Has E2E automation |
| **automation_script_path** | VARCHAR(500) | No | **NEW** - Path to test file |
| is_active | BOOLEAN | No | Active/archived |

**test_steps JSONB Format:**
```json
[
  {
    "step": 1,
    "action": "Navigate to login page",
    "expected": "Login form is displayed"
  },
  {
    "step": 2,
    "action": "Enter valid credentials",
    "expected": "Credentials accepted"
  },
  {
    "step": 3,
    "action": "Click submit button",
    "expected": "User redirected to dashboard"
  }
]
```

#### 3.2.2 test_run_batches (New)

Stores test execution batch summaries.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| batch_name | VARCHAR(255) | Yes | Run identifier |
| description | TEXT | No | Run description |
| environment | VARCHAR(50) | No | local/development/staging/production |
| version_tested | VARCHAR(50) | No | Application version |
| build_number | VARCHAR(100) | No | CI/CD build number |
| started_at | TIMESTAMPTZ | No | Run start time |
| completed_at | TIMESTAMPTZ | No | Run end time |
| total_tests | INTEGER | No | Total test count |
| passed_count | INTEGER | No | Passed tests |
| failed_count | INTEGER | No | Failed tests |
| skipped_count | INTEGER | No | Skipped tests |
| blocked_count | INTEGER | No | Blocked tests |
| overall_status | VARCHAR(20) | No | passed/failed/running |
| deployment_recommendation | VARCHAR(50) | No | approve/review/block |
| recommendation_notes | TEXT | No | Deployment notes |

#### 3.2.3 test_instances (New)

Stores individual test execution results.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| scenario_id | UUID | No | FK to test_scenarios |
| scenario_code | VARCHAR(50) | No | Denormalized code |
| run_batch_id | UUID | No | FK to test_run_batches |
| run_number | INTEGER | No | Execution attempt |
| environment | VARCHAR(50) | No | Execution environment |
| started_at | TIMESTAMPTZ | No | Test start time |
| completed_at | TIMESTAMPTZ | No | Test end time |
| duration_ms | INTEGER | No | Execution duration |
| status | VARCHAR(20) | No | passed/failed/skipped/timedOut |
| actual_result | TEXT | No | Actual outcome |
| error_message | TEXT | No | Error details |
| error_stack | TEXT | No | Stack trace |
| step_results | JSONB | No | Per-step results |
| browser_info | JSONB | No | Browser metadata |
| tester_notes | TEXT | No | Execution notes |
| executed_by_name | VARCHAR(255) | No | Tester/automation name |

#### 3.2.4 test_audit (New)

Comprehensive audit log for test executions.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| scenario_id | UUID | No | FK to test_scenarios |
| scenario_code | VARCHAR(50) | No | Denormalized code |
| scenario_name | VARCHAR(255) | No | Denormalized name |
| module_name | VARCHAR(100) | No | Module category |
| test_type | VARCHAR(50) | No | Test type |
| instance_id | UUID | No | FK to test_instances |
| batch_id | UUID | No | FK to test_run_batches |
| status | VARCHAR(20) | Yes | passed/failed/blocked/skipped |
| tester_name | VARCHAR(255) | No | Tester name |
| executed_at | TIMESTAMPTZ | No | Execution timestamp |
| duration_ms | INTEGER | No | Duration |
| step_results | JSONB | No | Detailed step results |
| test_data_used | JSONB | No | Data used in test |
| expected_result | TEXT | No | Expected outcome |
| actual_result | TEXT | No | Actual outcome |
| defects | JSONB | No | Linked defects |
| notes | TEXT | No | Tester notes |
| evidence | JSONB | No | Screenshots/attachments |

**step_results JSONB Format:**
```json
[
  {
    "step": 1,
    "action": "Navigate to login page",
    "expected": "Login form displayed",
    "actual": "Login form displayed correctly",
    "status": "passed"
  },
  {
    "step": 2,
    "action": "Enter invalid credentials",
    "expected": "Error message shown",
    "actual": "Error: Invalid email or password",
    "status": "passed"
  }
]
```

#### 3.2.5 e2e_test_data_sets (New)

Stores test data set definitions.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| set_name | VARCHAR(100) | Yes | Data set name |
| module | VARCHAR(100) | No | Related module |
| description | TEXT | No | Set description |
| is_active | BOOLEAN | No | Active flag |

#### 3.2.6 e2e_test_data_records (New)

Stores individual test data records.

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| set_id | UUID | No | FK to e2e_test_data_sets |
| data_key | VARCHAR(100) | Yes | Unique key identifier |
| entity_type | VARCHAR(50) | No | user/contact/batch/etc. |
| data_json | JSONB | Yes | Test data payload |
| purpose | VARCHAR(255) | No | Usage description |

---

## 4. QA Viewer Features

### 4.1 Navigation Tabs

| Tab | Description |
|-----|-------------|
| **Test Scenarios** | View all test scenarios with filtering |
| **Test Data Sets** | Browse test data sets and records |
| **Test Types** | Distribution chart and type statistics |
| **User Roles** | Role permissions matrix |
| **Test Instances** | Individual test execution records |
| **Run History** | Test batch history and summaries |
| **Test Audit** | Comprehensive audit log |

### 4.2 Test Scenarios Tab

**Features:**
- Search by code, name, description
- Filter by module, severity, type, automation status
- Pagination (20 items per page)
- Click to view scenario details

**Detail Modal Shows:**
- Scenario code and name
- Description and preconditions
- Module and test type badges
- Severity level indicator
- Test steps table (Step, Action, Expected)
- Test data JSON viewer
- Automation status and script path
- Tags

### 4.3 Test Types Tab

**Features:**
- Visual distribution chart (progress bars)
- Type statistics table
- Click to filter scenarios by type

**Test Types Tracked:**
| Type | Description | Color |
|------|-------------|-------|
| Functional | Core feature tests | Blue |
| Security | Auth/authorization tests | Red |
| E2E | Full user journey tests | Green |
| Integration | API/service tests | Purple |
| Smoke | Quick sanity checks | Orange |
| Regression | Post-change validation | Teal |
| Performance | Load/response tests | Cyan |
| Accessibility | WCAG compliance | Gray |

### 4.4 User Roles Tab

**Features:**
- List of 5 user roles with descriptions
- Click to view role details
- Role-based permissions matrix
- Related test scenarios per role

**User Roles:**
| Role | Access Level |
|------|--------------|
| Administrator | Full system access |
| Farm Manager | Operations management |
| Worker | Day-to-day tasks |
| Investor | Financial reports (read-only) |
| Guest | Limited public access |

### 4.5 Test Instances Tab

**Features:**
- Filter by batch, status, date
- Pagination
- View instance details modal
- Shows: scenario, batch, status, duration, executed at

**Status Badges:**
- Passed (green)
- Failed (red)
- Skipped (yellow)
- Pending (gray)
- Running (blue spinner)

### 4.6 Run History Tab

**Features:**
- Filter by environment, status, date range
- Shows: batch name, dates, environment, counts
- Pass/fail/skip statistics
- Deployment recommendation
- Click to view batch instances

### 4.7 Test Audit Tab

**Features:**
- Filter by scenario, status, tester, date range
- Summary statistics cards (total, passed, failed, blocked, skipped, pass rate)
- Export to CSV
- Detailed audit modal

**Audit Detail Modal Shows:**
- Audit ID and scenario info
- Status and tester
- Execution timestamp and duration
- Test steps with Expected vs Actual results
- Test data used (JSON)
- Defects/issues linked
- Notes/comments
- Evidence/screenshots
- Print functionality

---

## 5. E2E Test Integration

### 5.1 Playwright Configuration

**File:** `e2e/playwright.config.ts`

```typescript
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['./reporters/supabase.reporter.ts'],  // Custom reporter
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://demo-macavation.customapp.org',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  timeout: 60000,
});
```

### 5.2 Supabase Reporter

**File:** `e2e/reporters/supabase.reporter.ts`

**Functionality:**
1. Initializes Supabase client on test start
2. Tracks test results as they complete
3. On test end:
   - Creates `test_run_batches` record
   - Looks up `scenario_id` from `test_scenarios`
   - Inserts `test_instances` records
   - Logs summary to console

**Required Environment Variables:**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
TEST_ENVIRONMENT=local
```

### 5.3 Test Naming Convention

Tests must follow this naming pattern for proper tracking:

```
TC-{MODULE}-{NUMBER}: {Description}
```

**Examples:**
- `TC-AUTH-001: Super Admin Login with Valid Credentials`
- `TC-CRM-005: Create New NIS Supplier`
- `TC-UM-EC-001: Required Field Validation - Empty Username`

### 5.4 Test Modules Coverage

| Module | Test File | Test Count |
|--------|-----------|------------|
| Authentication | auth/login.spec.ts | 13 |
| RBAC | auth/rbac.spec.ts | 10 |
| CRM | crm/contacts.spec.ts | 13 |
| Dashboard | dashboard/dashboard.spec.ts | 10 |
| Financial | financial-management/finance.spec.ts | 6 |
| Grower Intake | grower-intake/samples.spec.ts | 5 |
| Kernel Production | kernel-production/batches.spec.ts | 12 |
| Oil Production | oil-production/oil-batches.spec.ts | 6 |
| Quality Assurance | quality-assurance/quality.spec.ts | 5 |
| Stock Management | stock-management/stock.spec.ts | 6 |
| Role Screen Access | user-management/role-screen-access.spec.ts | 17 |
| Roles CRUD | user-management/roles-crud.spec.ts | 17 |
| Users CRUD | user-management/user-crud.spec.ts | 17 |
| **Total** | | **137** |

---

## 6. Technical Architecture

### 6.1 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     QA Generic Viewer                        │
│                 (test-scenarios-viewer.html)                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │Scenarios│ │TestData │ │ Types   │ │ Roles   │ │ Audit  │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ │
└───────┼──────────┼──────────┼──────────┼───────────┼────────┘
        │          │          │          │           │
        └──────────┴──────────┴──────────┴───────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Supabase Client  │
                    │   (JavaScript)    │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │     Supabase      │
                    │   PostgreSQL DB   │
                    │  ┌─────────────┐  │
                    │  │test_scenarios│  │
                    │  │test_instances│  │
                    │  │test_batches  │  │
                    │  │test_audit    │  │
                    │  └─────────────┘  │
                    └─────────▲─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────┴───────┐    ┌───────┴───────┐    ┌───────┴───────┐
│   Playwright  │    │  QA Data      │    │   Manual      │
│   E2E Tests   │    │  Seeder       │    │   Entry       │
│   (137 tests) │    │  (HTML Tool)  │    │   (Future)    │
└───────────────┘    └───────────────┘    └───────────────┘
```

### 6.2 Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend | HTML5, CSS3, JavaScript (ES6+) | - |
| UI Framework | Bootstrap 5 | 5.3.0 |
| Icons | Font Awesome | 6.4.0 |
| Fonts | Nunito Sans (Google Fonts) | - |
| Database | Supabase (PostgreSQL) | Latest |
| E2E Testing | Playwright | 1.40.0+ |
| Package Manager | npm | - |

### 6.3 Security

**Row Level Security (RLS):**
- All tables have RLS enabled
- `anon` role: SELECT only (read access)
- `authenticated` role: ALL operations

**API Keys:**
- `anon` key: Used by QA Viewer for reading
- `service_role` key: Used by Playwright reporter for writing

---

## 7. Setup Instructions

### 7.1 Prerequisites

- Node.js 18+
- npm 9+
- Supabase account with project
- Modern web browser (Chrome recommended)

### 7.2 Database Setup

1. Open Supabase SQL Editor
2. Run `e2e/database/create_qa_tables.sql`
3. Verify tables created:
   - test_scenarios (updated with new columns)
   - test_run_batches
   - test_instances
   - test_audit
   - e2e_test_data_sets
   - e2e_test_data_records

### 7.3 E2E Test Setup

1. Navigate to e2e directory:
   ```bash
   cd e2e
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment (`.env.e2e`):
   ```env
   BASE_URL=https://demo-macavation.customapp.org
   TEST_ENVIRONMENT=local
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   ```

4. Install Playwright browsers:
   ```bash
   npx playwright install
   ```

### 7.4 Running Tests

**Full test suite:**
```bash
npm test
```

**Specific module:**
```bash
npm run test:auth
npm run test:crm
npm run test:users
```

**By tag:**
```bash
npm run test:critical
npm run test:smoke
npm run test:security
```

### 7.5 Viewing Results

1. Start local server:
   ```bash
   npx serve -l 5500
   ```

2. Open QA Viewer:
   ```
   http://localhost:5500/test-scenarios-viewer.html
   ```

---

## 8. User Roles & Permissions

### 8.1 Application Roles (Tested)

| Role | Dashboard | Users | Grower | Kernel | Oil | QA | Stock | Sales | Finance |
|------|-----------|-------|--------|--------|-----|-----|-------|-------|---------|
| Super Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PWA Grower Intake | ✓ | - | ✓ | - | - | - | - | - | - |
| PWA Production | ✓ | - | ✓ | ✓ | ✓ | - | - | - | - |
| PWA Quality Assurance | ✓ | - | ✓ | - | - | ✓ | ✓ | - | - |
| PWA Stock Management | ✓ | - | - | - | - | ✓ | ✓ | - | - |
| PWA Sales | ✓ | - | - | - | - | - | - | ✓ | - |
| PWA Finance | ✓ | - | - | - | - | - | - | - | ✓ |
| PWA Document Mgmt | ✓ | - | - | - | - | - | - | - | - |
| PWA Field Operations | ✓ | - | ✓ | ✓ | - | ✓ | - | - | - |

### 8.2 QA Viewer Access

The QA Viewer is a standalone tool accessible without authentication (read-only mode). It uses the Supabase `anon` key which only permits SELECT operations.

---

## 9. API Endpoints

### 9.1 Supabase REST API

All data access goes through Supabase's auto-generated REST API:

**Base URL:** `https://{project}.supabase.co/rest/v1`

| Endpoint | Method | Description |
|----------|--------|-------------|
| /test_scenarios | GET | List all scenarios |
| /test_scenarios?id=eq.{id} | GET | Get scenario by ID |
| /test_run_batches | GET | List all batches |
| /test_instances | GET | List all instances |
| /test_instances?run_batch_id=eq.{id} | GET | Instances by batch |
| /test_audit | GET | List audit records |
| /e2e_test_data_sets | GET | List data sets |
| /e2e_test_data_records?set_id=eq.{id} | GET | Records by set |

### 9.2 Headers Required

```http
apikey: {SUPABASE_ANON_KEY}
Content-Type: application/json
```

---

## 10. Future Enhancements

### 10.1 Planned Features

| Feature | Priority | Description |
|---------|----------|-------------|
| Real-time updates | High | WebSocket for live test status |
| Manual test entry | High | Form for manual test results |
| Defect integration | Medium | Link to Jira/GitHub Issues |
| Test scheduling | Medium | Automated test triggers |
| Email notifications | Medium | Test failure alerts |
| Dashboard widgets | Low | Executive summary dashboard |
| PDF reports | Low | Generate PDF test reports |
| Trend analysis | Low | Historical pass rate charts |

### 10.2 Technical Debt

- [ ] Add authentication to QA Viewer
- [ ] Implement caching for large datasets
- [ ] Add unit tests for viewer JavaScript
- [ ] Create Docker deployment option
- [ ] Add CI/CD pipeline integration

---

## Appendix A: SQL Migration Script

See `e2e/database/create_qa_tables.sql` for the complete database schema creation script.

## Appendix B: Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| BASE_URL | Yes | Application URL for testing |
| SUPABASE_URL | Yes | Supabase project URL |
| SUPABASE_SERVICE_KEY | Yes | Service role key (for writing) |
| SUPABASE_ANON_KEY | No | Anon key (for reading) |
| TEST_ENVIRONMENT | No | Environment name (default: local) |
| APP_VERSION | No | Version being tested |
| BUILD_NUMBER | No | CI/CD build number |

---

*End of Requirements Document*
