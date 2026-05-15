# Test Strategy & Scenarios Documentation

## Overview

This document provides a comprehensive testing strategy for the Macavation farm management system. It includes database schema for test management, all test scenarios, and instructions for implementing Playwright E2E tests.

**This document is stored in Supabase** in the `project_documentation` table for version control and easy access across environments.

---

## Table of Contents

1. [Test Management Architecture](#test-management-architecture)
2. [Database Schema](#database-schema)
3. [Test Data Management](#test-data-management)
4. [Test Users & Roles](#test-users--roles)
5. [Test Scenarios by Module](#test-scenarios-by-module)
6. [Playwright Implementation Guide](#playwright-implementation-guide)
7. [Test Results Storage](#test-results-storage)
8. [RBAC Testing Integration](#rbac-testing-integration)
9. [Applying to Other Projects](#applying-to-other-projects)

---

## Test Management Architecture

### Six-Table Design

```
┌─────────────────────┐
│   test_scenarios    │  ← Test case definitions (what to test)
│  (167 scenarios)    │
└──────────┬──────────┘
           │ scenario_id
           ▼
┌─────────────────────┐
│   test_instances    │  ← Individual test runs (execution records)
│  (run history)      │  ← Stored via Supabase Reporter
└──────────┬──────────┘
           │ run_batch_id
           ▼
┌─────────────────────┐
│  test_run_batches   │  ← Grouped test suite executions
│  (deployment gates) │  ← Stored via Supabase Reporter
└─────────────────────┘

┌─────────────────────┐    ┌─────────────────────────┐
│  e2e_test_data_sets │───▶│  e2e_test_data_records  │
│  (data categories)  │    │  (individual test data) │
└─────────────────────┘    └─────────────────────────┘

┌─────────────────────────┐
│  project_documentation  │  ← Stores this MD file
│  (QA strategies, docs)  │
└─────────────────────────┘
```

### Severity Levels & Deployment Impact

| Severity | Description | Deployment Impact |
|----------|-------------|-------------------|
| `critical` | Core functionality broken | **BLOCK** - Cannot deploy |
| `high` | Major feature affected | **HOLD** - Decision required |
| `medium` | Feature degraded | **PROCEED** with documented issue |
| `low` | Minor issue | **PROCEED** - Fix in next sprint |
| `info` | Informational only | **PROCEED** - No action needed |

---

## Database Schema

### 1. test_scenarios Table

Stores test case definitions:

```sql
CREATE TABLE test_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identification
    scenario_code VARCHAR UNIQUE NOT NULL,  -- e.g., TC-AUTH-001
    scenario_name VARCHAR NOT NULL,
    description TEXT,
    
    -- Categorization
    module_name VARCHAR NOT NULL,           -- e.g., 'authentication', 'crm'
    feature_name VARCHAR,                   -- e.g., 'Login', 'Contact Creation'
    test_type VARCHAR DEFAULT 'functional', -- functional, security, e2e, integration, performance, usability
    
    -- Role/Feature Association
    role_id UUID REFERENCES roles(id),      -- Which role can execute this
    feature_id BIGINT REFERENCES "Features"(id),
    
    -- Test Definition
    preconditions TEXT,                     -- What must be true before running
    test_steps JSONB DEFAULT '[]'::jsonb,   -- [{step: 1, action: "...", expected: "..."}]
    expected_result TEXT NOT NULL,
    test_data JSONB DEFAULT '{}'::jsonb,    -- Sample data for test
    test_data_description TEXT,
    
    -- Severity Classification
    severity_level VARCHAR DEFAULT 'medium' 
        CHECK (severity_level IN ('critical', 'high', 'medium', 'low', 'info')),
    severity_description TEXT,
    
    -- Organization
    tags JSONB DEFAULT '[]'::jsonb,
    depends_on UUID[],                      -- Other scenarios this depends on
    
    -- Automation
    is_automated BOOLEAN DEFAULT false,
    automation_script_path TEXT,            -- e.g., 'e2e/auth/login.spec.ts'
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_deprecated BOOLEAN DEFAULT false,
    deprecated_reason TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID REFERENCES "Users"(id),
    updated_by UUID REFERENCES "Users"(id)
);

-- Comment
COMMENT ON TABLE test_scenarios IS 'Test scenarios for system testing with role/feature associations and severity classifications';
```

### 2. test_instances Table

Records individual test executions:

```sql
CREATE TABLE test_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID NOT NULL REFERENCES test_scenarios(id),
    
    -- Run Information
    run_number INTEGER DEFAULT nextval('test_instances_run_number_seq'),
    run_batch_id UUID REFERENCES test_run_batches(id),
    environment VARCHAR DEFAULT 'development'
        CHECK (environment IN ('development', 'staging', 'production', 'local', 'ci_cd')),
    
    -- Execution Details
    executed_by UUID REFERENCES "Users"(id),
    executed_by_name VARCHAR,
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    
    -- Results
    status VARCHAR DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'passed', 'failed', 'skipped', 'blocked', 'error')),
    actual_result TEXT,
    error_message TEXT,
    error_stack TEXT,
    
    -- Evidence
    screenshots JSONB DEFAULT '[]'::jsonb,
    logs JSONB DEFAULT '[]'::jsonb,
    attachments JSONB DEFAULT '[]'::jsonb,
    step_results JSONB DEFAULT '[]'::jsonb,  -- [{step: 1, status: "passed", notes: "..."}]
    tester_notes TEXT,
    
    -- Defect Tracking
    defect_id VARCHAR,
    defect_url TEXT,
    
    -- Deployment Impact
    severity_level_at_run VARCHAR,          -- Copied from scenario at execution time
    deployment_impact VARCHAR
        CHECK (deployment_impact IN ('blocked', 'decision_required', 'warning', 'proceed', 'informational')),
    
    -- Retry Information
    retry_of UUID REFERENCES test_instances(id),
    retry_count INTEGER DEFAULT 0,
    
    -- Environment Info
    browser_info JSONB,
    device_info JSONB,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE test_instances IS 'Records of individual test executions with results and evidence';
```

### 3. test_run_batches Table

Groups test runs for deployment decisions:

```sql
CREATE TABLE test_run_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Batch Information
    batch_name VARCHAR NOT NULL,
    description TEXT,
    environment VARCHAR DEFAULT 'development',
    version_tested VARCHAR,
    build_number VARCHAR,
    
    -- Timing
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    
    -- Statistics
    total_tests INTEGER DEFAULT 0,
    passed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    blocked_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    
    -- Status & Recommendation
    overall_status VARCHAR DEFAULT 'running'
        CHECK (overall_status IN ('running', 'completed', 'aborted', 'passed', 'failed')),
    deployment_recommendation VARCHAR
        CHECK (deployment_recommendation IN ('block', 'hold', 'proceed_with_caution', 'proceed', 'review_required')),
    recommendation_notes TEXT,
    
    -- Execution
    executed_by UUID REFERENCES "Users"(id),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE test_run_batches IS 'Groups multiple test instances into a single test suite execution for deployment decisions';
```

### 4. e2e_test_data_sets Table

Categorizes and organizes test data by module:

```sql
CREATE TABLE e2e_test_data_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_name VARCHAR UNIQUE NOT NULL,     -- e.g., 'auth_test_data', 'crm_test_data'
    module VARCHAR NOT NULL,               -- Module the data belongs to
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE e2e_test_data_sets IS 'Categories for organizing E2E test data by module';
```

### 5. e2e_test_data_records Table

Stores individual test data records:

```sql
CREATE TABLE e2e_test_data_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id UUID NOT NULL REFERENCES e2e_test_data_sets(id) ON DELETE CASCADE,
    data_key VARCHAR NOT NULL,            -- Key identifier like 'valid_general_manager'
    entity_type VARCHAR NOT NULL,         -- 'user', 'contact', 'batch', etc.
    entity_id UUID,                       -- Optional link to actual entity
    data_json JSONB NOT NULL,             -- The test data itself
    purpose TEXT,                         -- What this data is used for
    cleanup_required BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_set_key UNIQUE(set_id, data_key)
);

COMMENT ON TABLE e2e_test_data_records IS 'Individual test data records for E2E tests';
```

### 6. project_documentation Table

Stores project documentation including this QA strategy:

```sql
CREATE TABLE project_documentation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name VARCHAR(100) NOT NULL,
    document_type VARCHAR(50) NOT NULL,   -- 'test_strategy', 'readme', 'guide'
    document_title VARCHAR(255) NOT NULL,
    document_slug VARCHAR(100) NOT NULL,  -- URL-friendly identifier
    content TEXT NOT NULL,                -- The document content (MD, etc.)
    version VARCHAR(20) DEFAULT '1.0.0',
    is_active BOOLEAN DEFAULT true,
    tags JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_project_document UNIQUE(project_name, document_slug)
);

COMMENT ON TABLE project_documentation IS 'Stores project documentation files';
```

### RBAC Permissions for Test Tables

```sql
-- Add permissions for super_user and admin roles
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT 
    r.id,
    'function',
    fn.name,
    'EXECUTE',
    true
FROM roles r
CROSS JOIN (
    VALUES 
        ('get_test_scenarios'),
        ('get_test_scenario_by_id'),
        ('create_test_scenario'),
        ('update_test_scenario'),
        ('get_test_instances'),
        ('create_test_instance'),
        ('update_test_instance'),
        ('get_test_run_batches'),
        ('create_test_run_batch'),
        ('update_test_run_batch')
) AS fn(name)
WHERE r.role_name IN ('super_user', 'admin');
```

---

## Test Data Management

### Test Data Sets

Test data is organized by module and stored in the database:

| Set Name | Module | Description |
|----------|--------|-------------|
| `auth_test_data` | authentication | User credentials for all roles |
| `crm_test_data` | crm | Contacts, customers, growers |
| `grower_intake_test_data` | grower-intake | Sample submissions |
| `kernel_production_test_data` | kernel-production | Production batches |
| `oil_production_test_data` | oil-production | Oil batches |
| `quality_test_data` | quality-assurance | Quality tests, thresholds |
| `stock_test_data` | stock-management | Stock items, locations |
| `financial_test_data` | financial-management | Payment calculations |

### Loading Test Data in Playwright

```typescript
// e2e/fixtures/test-data.fixture.ts
export const test = base.extend<TestDataFixtures>({
  testData: async ({}, use) => {
    // Loads from database if SUPABASE_URL is configured
    // Falls back to default hardcoded data otherwise
    const data = await loadTestDataFromDatabase();
    await use(data);
  },
});
```

### Adding New Test Data

```sql
-- 1. Create a test data set (if new module)
INSERT INTO e2e_test_data_sets (set_name, module, description)
VALUES ('new_module_test_data', 'new-module', 'Test data for new module');

-- 2. Add test data records
INSERT INTO e2e_test_data_records (set_id, data_key, entity_type, data_json, purpose)
VALUES (
    (SELECT id FROM e2e_test_data_sets WHERE set_name = 'new_module_test_data'),
    'valid_item',
    'item',
    '{"name": "Test Item", "status": "active"}'::jsonb,
    'Valid item for happy path tests'
);
```

---

## Test Users & Roles

### Macavation Role Hierarchy

| Role | Level | Description | Can Manage Users |
|------|-------|-------------|------------------|
| Super Admin | 100 | Full system access, user management | ✅ Add, Edit, Delete |
| General Manager | 100 | Full operations access | ❌ |
| Production Manager | 80 | Production and maintenance | ❌ |
| QA Supervisor | 75 | Quality assurance and food safety | ❌ |
| Oil Plant Manager | 70 | Oil production management | ❌ |
| Sales Executive | 70 | Sales, CRM, forecasting | ❌ |
| Office Administrator | 60 | Intake, invoicing, stock | ❌ |
| Production Staff | 30 | Limited production workflow | ❌ |
| Read Only | 10 | View-only access | ❌ |

### Test User Credentials

| Key | Email | Password | Role |
|-----|-------|----------|------|
| `superAdmin` | kishan@customapp.co.za | P@ssword1 | Super Admin |
| `generalManager` | jon.walters@macavation.co.za | Password123! | General Manager |
| `productionManager` | mark.payne@macavation.co.za | Password123! | Production Manager |
| `qaSupervsor` | simone.naidu@macavation.co.za | Password123! | QA Supervisor |
| `salesExecutive` | peter.symons@macavation.co.za | Password123! | Sales Executive |
| `oilPlantManager` | brandon.morrison@macavation.co.za | Password123! | Oil Plant Manager |
| `officeAdministrator` | josslyn.pillay@macavation.co.za | Password123! | Office Administrator |
| `deactivatedUser` | deactivated@macavation.co.za | Password123! | User (Inactive) |
| `invalidUser` | invalid@macavation.co.za | wrongpassword | (Invalid) |

### Creating Test Users in New Projects

```sql
-- Create user with bcrypt-hashed password
INSERT INTO public."Users" (
    email, full_name, first_name, last_name,
    password_hash, provider, role_id, is_active,
    "ClientUniqueGUID"
) VALUES (
    'admin@project.com',
    'Admin User',
    'Admin',
    'User',
    crypt('SecureP@ssword1', gen_salt('bf')),  -- Bcrypt hash
    'email',
    (SELECT id FROM "UserRoles" WHERE role_name = 'Super Admin'),
    true,
    'your-client-guid-here'
);
```

### Role Assignment Requirements

For email/password authentication to work:
1. User must have `password_hash` set (bcrypt)
2. User must have `provider` = 'email'
3. User must have `is_active` = true
4. User must have `ClientUniqueGUID` matching the application

---

## Test Scenarios by Module

### Module Summary

| Module | Total | Critical | High | Medium | Low/Info |
|--------|-------|----------|------|--------|----------|
| Authentication | 14 | 5 | 4 | 3 | 2 |
| CRM | 12 | 2 | 4 | 5 | 1 |
| Grower Intake | 12 | 4 | 5 | 2 | 1 |
| Kernel Production | 14 | 5 | 7 | 1 | 1 |
| Oil Production | 15 | 5 | 8 | 1 | 1 |
| Quality Assurance | 11 | 4 | 5 | 1 | 1 |
| Stock Management | 14 | 5 | 6 | 2 | 1 |
| Financial Management | 15 | 5 | 6 | 3 | 1 |
| Document Management | 12 | 2 | 6 | 3 | 1 |
| Executive Dashboard | 9 | 0 | 3 | 4 | 2 |
| Palladium Integration | 14 | 4 | 7 | 2 | 1 |
| Other (RBAC, UI, etc.) | 5 | 1 | 0 | 2 | 2 |

---

### Authentication Module (14 scenarios)

#### TC-AUTH-001: User Login with Valid Credentials
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify users can successfully authenticate with valid email/password or Google OAuth
- **Preconditions**: User account exists and is active
- **Expected Result**: User is authenticated and directed to appropriate module based on role

#### TC-AUTH-002: Role-Based Access Control Enforcement
- **Type**: Security | **Severity**: Critical
- **Description**: Verify users can only access modules/functions permitted by their role
- **Preconditions**: Users with different roles exist
- **Expected Result**: RBAC enforced correctly across all modules

#### TC-AUTH-003: JWT Token Validation
- **Type**: Security | **Severity**: Critical
- **Description**: Verify API calls with invalid or expired tokens are rejected
- **Preconditions**: Lambda proxy is operational
- **Expected Result**: All invalid token scenarios return appropriate error responses

#### TC-AUTH-004: Account Lockout After Failed Attempts
- **Type**: Security | **Severity**: Critical
- **Description**: Verify account locks after 5 failed login attempts for 30 minutes
- **Preconditions**: Active user account exists with known credentials
- **Expected Result**: Account lockout mechanism protects against brute force attacks

#### TC-AUTH-005: Password Reset Link Expiration
- **Type**: Security | **Severity**: High
- **Description**: Verify password reset links expire after 1 hour per business rule
- **Preconditions**: User account exists
- **Expected Result**: Password reset links expire after 1 hour for security

#### TC-AUTH-006: Session Timeout After 8 Hours Inactivity
- **Type**: Security | **Severity**: High
- **Description**: Verify user session expires after 8 hours of inactivity per business rule
- **Preconditions**: User is logged in with active session
- **Expected Result**: Session expires correctly after 8 hours inactivity

#### TC-AUTH-007: Password History - No Reuse of Last 5 Passwords
- **Type**: Security | **Severity**: Medium
- **Description**: Verify users cannot reuse last 5 passwords per business rule
- **Preconditions**: User has changed password at least 5 times in history
- **Expected Result**: Password history prevents reuse of recent passwords

#### TC-AUTH-008: Concurrent Session Limit - Max 3 Sessions
- **Type**: Security | **Severity**: Medium
- **Description**: Verify users can only have 3 active sessions simultaneously per business rule
- **Preconditions**: User account exists
- **Expected Result**: Maximum 3 concurrent sessions enforced

#### TC-AUTH-009: Password Change Required Every 90 Days
- **Type**: Security | **Severity**: High
- **Description**: Verify system enforces password change every 90 days
- **Preconditions**: User account with password older than 90 days
- **Expected Result**: Password expiry enforced at 90 days

#### TC-AUTH-010: Deactivated User Cannot Login
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify deactivated user accounts cannot authenticate
- **Preconditions**: User account exists and has been deactivated
- **Expected Result**: Deactivated users completely blocked from system access

#### TC-AUTH-EC-001: Login at Exact Session Timeout Boundary (8 hours)
- **Type**: Security | **Severity**: High
- **Description**: Verify system behavior when user attempts action at exactly 8-hour session timeout boundary
- **Preconditions**: User session started exactly 8 hours ago
- **Expected Result**: Session should expire at or after 8-hour mark

#### TC-AUTH-EC-002: Login After 4 Failed Attempts (Just Below Lockout)
- **Type**: Security | **Severity**: Critical
- **Description**: Verify account is not locked after 4 failed attempts and successful 5th attempt
- **Preconditions**: Fresh user account with no failed attempts
- **Expected Result**: Account should NOT be locked after 4 failures; 5th correct attempt should succeed

#### TC-AUTH-EC-003: Password Reset Link Used Twice
- **Type**: Security | **Severity**: Critical
- **Description**: Verify password reset link cannot be reused after first use
- **Preconditions**: Valid password reset link generated
- **Expected Result**: Second use of reset link should fail with "link expired or already used" message

#### TC-AUTH-EC-004: Login with Password Expiring Today
- **Type**: Security | **Severity**: High
- **Description**: Verify behavior when password expires on current date
- **Preconditions**: User password set to expire today
- **Expected Result**: User should be prompted to change password but allowed to complete current session

---

### CRM Module (12 scenarios)

#### TC-CRM-001: Create Supplier/Grower Contact
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify new supplier/grower contacts can be created
- **Preconditions**: User has CRM access
- **Expected Result**: Contact created and available for selection in intake and purchasing

#### TC-CRM-002: Create Customer Contact
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify customer contacts can be created with shipping details
- **Preconditions**: User has CRM access
- **Expected Result**: Customer contact created with full details for sales and shipping

#### TC-CRM-003: Contact Status Workflow Transition
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify contact status follows workflow: Prospect → Active → Inactive → Suspended
- **Preconditions**: Contact exists in Prospect status
- **Expected Result**: Contact status workflow enforced correctly

#### TC-CRM-004: Key Account Requires Account Manager
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify key accounts must have an assigned account manager
- **Preconditions**: Contact form is accessible
- **Expected Result**: Key accounts require assigned account manager

#### TC-CRM-005: Quote Expiration After Valid Until Date
- **Type**: Functional | **Severity**: High
- **Description**: Verify quotes automatically expire after valid_until date passes
- **Preconditions**: Quote exists with valid_until date in the past
- **Expected Result**: Quote expiration enforced correctly

#### TC-CRM-006: Quote to Sales Order Conversion
- **Type**: Functional | **Severity**: High
- **Description**: Verify accepted quote can be converted to sales order with all details
- **Preconditions**: Quote exists in Accepted status
- **Expected Result**: Quote conversion transfers all data to sales order correctly

#### TC-CRM-007: Supplier Rating Below 3.0 Triggers Review
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify suppliers rated below 3.0 trigger review meeting requirement
- **Preconditions**: Supplier contact exists with rating capability
- **Expected Result**: Low supplier ratings trigger appropriate alerts and actions

#### TC-CRM-008: Credit Limit Enforcement on Orders
- **Type**: Functional | **Severity**: High
- **Description**: Verify orders blocked when customer exceeds credit limit
- **Preconditions**: Customer with credit limit of R50,000 and outstanding balance of R48,000
- **Expected Result**: Credit limits enforced correctly on order creation

#### TC-CRM-009: Communication Follow-up Escalation
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify overdue follow-ups are escalated to account manager
- **Preconditions**: Communication logged with follow-up required
- **Expected Result**: Follow-up management and escalation works correctly

#### TC-CRM-EC-001: Order at Exact Credit Limit
- **Type**: Functional | **Severity**: High
- **Description**: Verify order accepted at exact credit limit
- **Preconditions**: Customer with R100,000 credit limit; order for exactly R100,000
- **Expected Result**: Order at exact credit limit should be accepted

#### TC-CRM-EC-002: Order Exceeding Credit Limit by R0.01
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify order blocked when exceeding credit limit minimally
- **Preconditions**: Customer with R100,000 limit; order for R100,000.01
- **Expected Result**: Order should be placed on credit hold for approval

#### TC-CRM-EC-003: Quote Expiry at Exactly Midnight
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify quote valid until end of expiry date
- **Preconditions**: Quote valid until today
- **Expected Result**: Quote should be valid until 23:59:59 on expiry date

#### TC-CRM-EC-004: Contact with Duplicate Email Address
- **Type**: Functional | **Severity**: High
- **Description**: Verify system prevents duplicate email addresses
- **Preconditions**: Existing contact with email@test.com
- **Expected Result**: System should warn about duplicate email

---

### Grower Intake Module (12 scenarios)

#### TC-GI-001: Create Sample Submission
- **Type**: Functional | **Severity**: High
- **Description**: Verify sample submissions can be created for growers
- **Preconditions**: Grower contact exists
- **Expected Result**: Sample submission created with quality test data

#### TC-GI-002: Calculate Crack-Out Percentages
- **Type**: Functional | **Severity**: High
- **Description**: Verify crack-out percentage calculations are accurate
- **Preconditions**: Sample with weight data exists
- **Expected Result**: Crack-out percentages calculated correctly

#### TC-GI-003: Approve Sample and Generate Main Run Document
- **Type**: Functional | **Severity**: High
- **Description**: Verify approved samples generate Main Run Documents
- **Preconditions**: Sample exists with passing quality
- **Expected Result**: MRD generated with correct data from sample

#### TC-GI-004: Reject Sample with Reason
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify samples can be rejected with documented reason
- **Preconditions**: Sample exists pending approval
- **Expected Result**: Sample rejected with reason recorded

#### TC-GI-005: Sample Collection 15-Day Acceptance Window
- **Type**: Functional | **Severity**: High
- **Description**: Verify 15-day acceptance window for sample collection
- **Preconditions**: Sample approved
- **Expected Result**: Acceptance window enforced correctly

#### TC-GI-006: Quality Acceptance Thresholds
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify quality thresholds (crack-out ≥25%, moisture ≤2.5%)
- **Preconditions**: Sample with quality data
- **Expected Result**: Quality thresholds enforced correctly

#### TC-GI-007: Main Run Document Auto-Generation
- **Type**: Functional | **Severity**: High
- **Description**: Verify MRD auto-generates with correct grower and sample data
- **Preconditions**: Sample approved
- **Expected Result**: MRD generated with all required fields

#### TC-GI-008: Incoming Receiving Checklist Completion
- **Type**: Functional | **Severity**: High
- **Description**: Verify receiving checklist must be completed on delivery
- **Preconditions**: MRD exists, delivery arriving
- **Expected Result**: Checklist required before batch creation

#### TC-GI-EC-001: Sample Acceptance on Exact Day 15 Deadline
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify sample can be accepted on exactly day 15
- **Preconditions**: Sample approved 15 days ago
- **Expected Result**: Sample acceptance valid on day 15

#### TC-GI-EC-002: Crack-Out at Exact 25% Threshold
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify sample with exactly 25% crack-out passes
- **Preconditions**: Sample with 25.00% crack-out
- **Expected Result**: Sample should pass at exactly 25%

#### TC-GI-EC-003: Crack-Out at 24.99% (Just Below Threshold)
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify sample with 24.99% crack-out fails
- **Preconditions**: Sample with 24.99% crack-out
- **Expected Result**: Sample should fail at 24.99%

#### TC-GI-EC-004: Zero Weight Sample Submission
- **Type**: Functional | **Severity**: High
- **Description**: Verify system rejects zero weight samples
- **Preconditions**: Attempt to create sample with 0kg weight
- **Expected Result**: Validation error for zero weight

#### TC-GI-EC-005: Sample from Suspended Grower
- **Type**: Functional | **Severity**: High
- **Description**: Verify samples blocked from suspended growers
- **Preconditions**: Grower in suspended status
- **Expected Result**: Sample creation blocked with appropriate message

#### TC-GI-EC-006: Moisture at Exact 2.5% Maximum
- **Type**: Functional | **Severity**: High
- **Description**: Verify sample with exactly 2.5% moisture passes
- **Preconditions**: Sample with 2.50% moisture
- **Expected Result**: Sample should pass at exactly 2.5%

---

### Kernel Production Module (14 scenarios)

#### TC-KP-001: Create Production Batch from Main Run Document
- **Type**: Functional | **Severity**: High
- **Description**: Verify production batches can be created from MRDs
- **Preconditions**: MRD exists with delivery received
- **Expected Result**: Production batch created with MRD data linked

#### TC-KP-002: Complete Cracking Step with Minute Tests
- **Type**: Functional | **Severity**: High
- **Description**: Verify cracking step requires minute tests
- **Preconditions**: Batch in cracking step
- **Expected Result**: Minute test data recorded correctly

#### TC-KP-003: Complete Washing Step with Peracetic Acid Tests
- **Type**: Functional | **Severity**: High
- **Description**: Verify washing step requires PAA concentration tests
- **Preconditions**: Batch in washing step
- **Expected Result**: PAA test data recorded (100-200ppm required)

#### TC-KP-004: Record Daily Moisture Readings
- **Type**: Functional | **Severity**: High
- **Description**: Verify daily moisture readings during drying
- **Preconditions**: Batch in drying step
- **Expected Result**: Moisture readings tracked until target reached

#### TC-KP-005: Complete Sorting by Style
- **Type**: Functional | **Severity**: High
- **Description**: Verify kernel sorting by style classification
- **Preconditions**: Batch in sorting step
- **Expected Result**: Kernels sorted into SP, 0, 1, 1S, 4L, 5, 6, 7/8, Butter

#### TC-KP-006: Positive Release Approval
- **Type**: Functional | **Severity**: High
- **Description**: Verify QA positive release required before stock
- **Preconditions**: Batch completed all production steps
- **Expected Result**: Positive release recorded by QA supervisor

#### TC-KP-007: Place Batch on Quality Hold
- **Type**: Functional | **Severity**: High
- **Description**: Verify batches can be placed on quality hold
- **Preconditions**: Batch in any production step
- **Expected Result**: Quality hold applied with reason documented

#### TC-KP-008: 17-Step Workflow Sequence Enforcement
- **Type**: E2E | **Severity**: Critical
- **Description**: Verify all 17 production steps must be completed in sequence
- **Preconditions**: New production batch created
- **Expected Result**: Steps cannot be skipped; sequence enforced

#### TC-KP-009: Batch Size Limits - 5 Tons Maximum
- **Type**: Functional | **Severity**: High
- **Description**: Verify batch size cannot exceed 5000kg
- **Preconditions**: Batch creation form
- **Expected Result**: Maximum 5000kg per batch enforced

#### TC-KP-010: Drying Time Limits Enforcement
- **Type**: Functional | **Severity**: High
- **Description**: Verify drying time limits (max 72 hours)
- **Preconditions**: Batch in drying step
- **Expected Result**: Alert if drying exceeds 72 hours

#### TC-KP-011: Sorting Style Classification
- **Type**: Functional | **Severity**: High
- **Description**: Verify kernel styles classified correctly
- **Preconditions**: Kernels ready for sorting
- **Expected Result**: All 9 style grades available for classification

#### TC-KP-012: Minute Test Requirements During Cracking
- **Type**: Functional | **Severity**: High
- **Description**: Verify minute tests recorded every 15 minutes
- **Preconditions**: Cracking in progress
- **Expected Result**: Minute test frequency enforced

#### TC-KP-013: Peracetic Acid Test Compliance
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify PAA concentration within 100-200ppm range
- **Preconditions**: Washing step active
- **Expected Result**: PAA out of range triggers alert

#### TC-KP-EC-001: Batch at Exactly 5000kg (Maximum Limit)
- **Type**: Functional | **Severity**: High
- **Description**: Verify batch at exactly 5000kg is accepted
- **Preconditions**: Create batch with 5000kg
- **Expected Result**: Batch created successfully at limit

#### TC-KP-EC-002: Batch at 5001kg (Just Over Maximum)
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify batch over 5000kg is rejected
- **Preconditions**: Attempt to create batch with 5001kg
- **Expected Result**: Validation error for exceeding limit

#### TC-KP-EC-003: Step Transition at Midnight
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify step transitions handle date boundary
- **Preconditions**: Step transition at 23:59:59
- **Expected Result**: Correct date/time recorded

#### TC-KP-EC-004: Batch with 0% Kernel Recovery (Total Loss)
- **Type**: Functional | **Severity**: High
- **Description**: Verify handling of complete batch loss
- **Preconditions**: Batch with zero output
- **Expected Result**: Batch flagged for investigation

#### TC-KP-EC-005: Drying Duration at Exact 72-Hour Maximum
- **Type**: Functional | **Severity**: High
- **Description**: Verify batch at exactly 72 hours drying
- **Preconditions**: Drying started 72 hours ago
- **Expected Result**: Alert triggered at 72-hour mark

#### TC-KP-EC-006: PAA Concentration at Exactly 100ppm (Minimum)
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify PAA at exactly 100ppm passes
- **Preconditions**: PAA test reading of 100ppm
- **Expected Result**: Test passes at minimum threshold

#### TC-KP-EC-007: Skip Step Attempt in Sequential Workflow
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify steps cannot be skipped
- **Preconditions**: Batch in step 3
- **Expected Result**: Cannot transition to step 5 without completing step 4

---

### Oil Production Module (15 scenarios)

#### TC-OP-001: Create Oil Production Batch
- **Type**: Functional | **Severity**: High
- **Description**: Verify oil production batches can be created
- **Preconditions**: Released kernel stock available
- **Expected Result**: Oil batch created with kernel input recorded

#### TC-OP-002: Record Oil Pressing Results
- **Type**: Functional | **Severity**: High
- **Description**: Verify oil pressing data recorded correctly
- **Preconditions**: Oil batch in pressing step
- **Expected Result**: Pressing data (temp, pressure, yield) recorded

#### TC-OP-003: Oil Production Complete 11-Step Workflow
- **Type**: E2E | **Severity**: Critical
- **Description**: Verify all 11 oil production steps complete in sequence
- **Preconditions**: New oil batch created
- **Expected Result**: Full workflow completed with all data captured

#### TC-OP-004: Oil Cold Press Temperature Limit
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify cold press temperature ≤42°C
- **Preconditions**: Pressing step active
- **Expected Result**: Temperature exceeding 42°C triggers alert

#### TC-OP-005: Oil Quality Standards Enforcement
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify oil quality standards (FFA ≤0.1%, moisture ≤0.1%)
- **Preconditions**: Oil testing step
- **Expected Result**: Quality standards enforced with alerts

#### TC-OP-006: Oil Settling Minimum Time
- **Type**: Functional | **Severity**: High
- **Description**: Verify minimum 24-hour settling time
- **Preconditions**: Oil in settling tank
- **Expected Result**: Cannot proceed before 24 hours settling

#### TC-OP-007: Oil Dual Filtration Recording
- **Type**: Functional | **Severity**: High
- **Description**: Verify dual filtration process recorded
- **Preconditions**: Settling complete
- **Expected Result**: Both filtration passes recorded

#### TC-OP-008: Oil Nitrogen Flush for Extended Shelf Life
- **Type**: Functional | **Severity**: High
- **Description**: Verify nitrogen flush option for extended shelf life
- **Preconditions**: Oil ready for packing
- **Expected Result**: Nitrogen flush recorded with extended best-before date

#### TC-OP-009: Oil Tank Storage Limits
- **Type**: Functional | **Severity**: High
- **Description**: Verify tank storage capacity limits
- **Preconditions**: Oil ready for storage
- **Expected Result**: Tank capacity tracked and limits enforced

#### TC-OP-010: Oil Yield Calculation and Variance
- **Type**: Functional | **Severity**: High
- **Description**: Verify oil yield calculation (output/input × 100)
- **Preconditions**: Pressing complete
- **Expected Result**: Yield calculated and variance from target flagged

#### TC-OP-011: Oil GMP Checklist Completion
- **Type**: Functional | **Severity**: High
- **Description**: Verify daily GMP checklist for oil production
- **Preconditions**: Oil production active
- **Expected Result**: GMP checklist required and recorded

#### TC-OP-012: Oil Batch Traceability - Kernel to Oil
- **Type**: E2E | **Severity**: Critical
- **Description**: Verify complete traceability from kernel batch to oil
- **Preconditions**: Oil batch with kernel source
- **Expected Result**: Full traceability chain maintained

#### TC-OP-EC-001: Cold Press Temperature at Exactly 42°C Maximum
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify pressing at exactly 42°C is accepted
- **Preconditions**: Temperature reading of 42.0°C
- **Expected Result**: Reading accepted at maximum threshold

#### TC-OP-EC-002: Cold Press Temperature at 42.1°C (Just Over Maximum)
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify pressing at 42.1°C triggers alert
- **Preconditions**: Temperature reading of 42.1°C
- **Expected Result**: Quality alert triggered

#### TC-OP-EC-003: FFA at Exact 0.1% Threshold
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify oil with exactly 0.1% FFA passes
- **Preconditions**: FFA test result of 0.10%
- **Expected Result**: Oil passes at threshold

#### TC-OP-EC-004: Oil Yield at 0% (Complete Extraction Failure)
- **Type**: Functional | **Severity**: High
- **Description**: Verify handling of zero oil yield
- **Preconditions**: Pressing with no output
- **Expected Result**: Batch flagged for investigation

#### TC-OP-EC-005: Settling Time at Exactly 24 Hours Minimum
- **Type**: Functional | **Severity**: High
- **Description**: Verify transition possible at exactly 24 hours
- **Preconditions**: Settling started 24 hours ago
- **Expected Result**: Transition allowed at 24-hour mark

#### TC-OP-EC-006: Double Nitrogen Flush Attempt
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify nitrogen flush cannot be applied twice
- **Preconditions**: Nitrogen flush already applied
- **Expected Result**: Second flush blocked or warning displayed

#### TC-OP-EC-007: Best Before Date in Past at Creation
- **Type**: Functional | **Severity**: High
- **Description**: Verify best before date cannot be in past
- **Preconditions**: Attempt to set past date
- **Expected Result**: Validation error for past date

---

### Quality Assurance Module (11 scenarios)

#### TC-QA-001: Record Quality Test Results
- **Type**: Functional | **Severity**: High
- **Description**: Verify quality test results can be recorded
- **Preconditions**: Batch or sample requiring testing
- **Expected Result**: Test results recorded with tester info

#### TC-QA-002: Generate Certificate of Analysis
- **Type**: Functional | **Severity**: High
- **Description**: Verify COA generation for shipments
- **Preconditions**: Released batch for customer
- **Expected Result**: COA generated with all test data

#### TC-QA-003: Complete GMP Daily Checklist
- **Type**: Functional | **Severity**: High
- **Description**: Verify daily GMP checklist completion
- **Preconditions**: Production active
- **Expected Result**: GMP checklist completed and signed

#### TC-QA-004: COA Revision Tracking
- **Type**: Functional | **Severity**: High
- **Description**: Verify COA revision history maintained
- **Preconditions**: COA exists
- **Expected Result**: Revisions tracked with version numbers

#### TC-QA-005: Quality Hold Release Approval
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify QA supervisor approval for hold release
- **Preconditions**: Batch on quality hold
- **Expected Result**: Only QA supervisor can release hold

#### TC-QA-006: Audit Schedule Management
- **Type**: Functional | **Severity**: High
- **Description**: Verify audit scheduling and tracking
- **Preconditions**: Audit schedule exists
- **Expected Result**: Audit notifications and tracking work

#### TC-QA-007: Food Safety Incident Reporting
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify incident reporting workflow
- **Preconditions**: Incident occurs
- **Expected Result**: Incident recorded with investigation workflow

#### TC-QA-008: Testing Frequency Compliance
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify testing frequency requirements met
- **Preconditions**: Production active
- **Expected Result**: Testing frequency tracked and alerts sent

#### TC-QA-EC-001: COA Revision of Already-Shipped Batch
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify COA revision handling for shipped batches
- **Preconditions**: COA for shipped batch
- **Expected Result**: Customer notification required for revision

#### TC-QA-EC-002: Quality Hold on Partially Dispatched Stock
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify quality hold on partially shipped stock
- **Preconditions**: Stock with partial dispatch
- **Expected Result**: Recall alert generated; remaining stock held

#### TC-QA-EC-003: Moisture Test at Exact 1.5% Target
- **Type**: Functional | **Severity**: Low
- **Description**: Verify moisture at target passes
- **Preconditions**: Moisture reading of 1.5%
- **Expected Result**: Test passes at target

#### TC-QA-EC-004: Multiple Concurrent Quality Tests on Same Batch
- **Type**: Functional | **Severity**: High
- **Description**: Verify multiple simultaneous tests on one batch
- **Preconditions**: Batch requiring multiple test types
- **Expected Result**: All tests recorded correctly without conflicts

---

### Stock Management Module (14 scenarios)

#### TC-SM-001: View Stock Levels by Style
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify stock levels viewable by kernel style
- **Preconditions**: Stock exists
- **Expected Result**: Stock levels displayed by style/grade

#### TC-SM-002: Stock Movement Recording
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify stock movements recorded with audit trail
- **Preconditions**: Stock exists
- **Expected Result**: Movement recorded with full details

#### TC-SM-003: FIFO Stock Allocation
- **Type**: Functional | **Severity**: High
- **Description**: Verify FIFO allocation for orders
- **Preconditions**: Multiple batches of same product
- **Expected Result**: Oldest stock allocated first

#### TC-SM-004: Stock Take Variance Investigation
- **Type**: Functional | **Severity**: High
- **Description**: Verify variance investigation workflow
- **Preconditions**: Stock take with variance
- **Expected Result**: Variance flagged and investigation required

#### TC-SM-005: Quality Hold Blocks Dispatch
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify quality hold prevents dispatch
- **Preconditions**: Stock on quality hold
- **Expected Result**: Dispatch blocked with appropriate message

#### TC-SM-006: Minimum Stock Level Alert
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify alerts when stock below minimum
- **Preconditions**: Minimum stock level set
- **Expected Result**: Alert generated when below minimum

#### TC-SM-007: Stock Movement Audit Trail
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify complete audit trail for movements
- **Preconditions**: Stock movements occur
- **Expected Result**: Full audit trail with user, time, reason

#### TC-SM-008: Stock Valuation by Product Type
- **Type**: Functional | **Severity**: High
- **Description**: Verify stock valuation calculations
- **Preconditions**: Stock with cost data
- **Expected Result**: Valuation calculated correctly by type

#### TC-SM-009: Best Before Date Tracking
- **Type**: Functional | **Severity**: High
- **Description**: Verify best before date tracking and alerts
- **Preconditions**: Stock with best before dates
- **Expected Result**: Alerts for approaching expiry

#### TC-SM-EC-001: Stock Quantity at Exactly Zero
- **Type**: Functional | **Severity**: High
- **Description**: Verify handling of zero stock
- **Preconditions**: Stock depleted to zero
- **Expected Result**: Zero stock handled correctly

#### TC-SM-EC-002: Reserve More Than Available Stock
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify cannot reserve more than available
- **Preconditions**: 100kg available; reserve 101kg
- **Expected Result**: Reservation blocked with message

#### TC-SM-EC-003: FIFO Conflict with Quality Hold Item
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify FIFO skips quality hold items
- **Preconditions**: Oldest batch on hold
- **Expected Result**: FIFO allocates next oldest available

#### TC-SM-EC-004: Stock Movement of Negative Quantity
- **Type**: Functional | **Severity**: High
- **Description**: Verify negative quantity blocked
- **Preconditions**: Attempt negative movement
- **Expected Result**: Validation error

#### TC-SM-EC-005: Stock Take with 100% Variance
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify handling of complete variance
- **Preconditions**: Stock take shows zero when expected 1000kg
- **Expected Result**: Requires manager approval and investigation

#### TC-SM-EC-006: Dispatch From Quality Hold Stock
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify dispatch blocked for held stock
- **Preconditions**: Attempt to dispatch held stock
- **Expected Result**: Dispatch blocked with error message

#### TC-SM-EC-007: Stock Transfer Between Same Location
- **Type**: Functional | **Severity**: Low
- **Description**: Verify same-location transfer handling
- **Preconditions**: Transfer with from=to location
- **Expected Result**: Warning or block for same-location transfer

---

### Financial Management Module (15 scenarios)

#### TC-FM-001: Calculate Grower Payment
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify grower payment calculations
- **Preconditions**: Completed production batch
- **Expected Result**: Payment calculated based on net kernel and price tier

#### TC-FM-002: Purchase Order Approval Limits
- **Type**: Functional | **Severity**: High
- **Description**: Verify PO approval hierarchy (<R10K, R10K-R50K, >R50K)
- **Preconditions**: PO draft exists
- **Expected Result**: Approval routed to correct level

#### TC-FM-003: Three-Way Matching - PO vs GRN vs Invoice
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify three-way matching for invoice processing
- **Preconditions**: PO, goods received, invoice received
- **Expected Result**: Matching prevents payment errors

#### TC-FM-004: Grower Payment Calculation Formula
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify payment formula: (Net Kernel × Price) - Deductions
- **Preconditions**: Batch with kernel output
- **Expected Result**: Payment calculated correctly

#### TC-FM-005: Payment Approval Limits
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify payment approval hierarchy
- **Preconditions**: Payment pending approval
- **Expected Result**: Routed to correct approver

#### TC-FM-006: Weekly Grower Payment Run - Friday
- **Type**: Functional | **Severity**: High
- **Description**: Verify weekly payment batch on Friday
- **Preconditions**: Approved payments pending
- **Expected Result**: Payment batch generated on Friday

#### TC-FM-007: Budget Variance Alert > 10%
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify alert when budget variance exceeds 10%
- **Preconditions**: Budget defined
- **Expected Result**: Alert triggered at 10% variance

#### TC-FM-008: Expense Claim Approval Workflow
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify expense claim approval process
- **Preconditions**: Expense claim submitted
- **Expected Result**: Claim routed for approval

#### TC-FM-009: Account Reconciliation
- **Type**: Functional | **Severity**: High
- **Description**: Verify account reconciliation workflow
- **Preconditions**: Transactions exist
- **Expected Result**: Reconciliation completed with variance handling

#### TC-FM-010: Early Payment Discount Application
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify 2% discount for payment within 7 days
- **Preconditions**: Invoice with early payment terms
- **Expected Result**: Discount applied correctly

#### TC-FM-EC-001: Payment at Exact Approval Limit (R50,000)
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify payment at exactly R50,000 approval limit
- **Preconditions**: Payment of exactly R50,000
- **Expected Result**: Routed to correct approval level

#### TC-FM-EC-002: Payment at R50,000.01 (Just Over Limit)
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify payment over limit goes to higher approval
- **Preconditions**: Payment of R50,000.01
- **Expected Result**: Escalated to next approval level

#### TC-FM-EC-003: Grower Payment with Deductions Exceeding Gross
- **Type**: Functional | **Severity**: High
- **Description**: Verify handling when deductions exceed gross payment
- **Preconditions**: Gross R10,000; deductions R15,000
- **Expected Result**: Flagged for review; no negative payment

#### TC-FM-EC-004: Three-Way Match with R0.01 Variance
- **Type**: Functional | **Severity**: High
- **Description**: Verify minimal variance handling
- **Preconditions**: R0.01 difference in matching
- **Expected Result**: Within tolerance; auto-approved

#### TC-FM-EC-005: Purchase Order with R0.00 Amount
- **Type**: Functional | **Severity**: Medium
- **Description**: Verify zero-value PO handling
- **Preconditions**: Attempt to create R0 PO
- **Expected Result**: Validation error or special handling

#### TC-FM-EC-006: Early Payment Discount at Exact Cutoff Date
- **Type**: Functional | **Severity**: High
- **Description**: Verify discount on exactly day 7
- **Preconditions**: Payment on day 7 exactly
- **Expected Result**: Discount applied on day 7

#### TC-FM-EC-007: Duplicate Payment Prevention
- **Type**: Functional | **Severity**: Critical
- **Description**: Verify duplicate payment blocked
- **Preconditions**: Payment already processed
- **Expected Result**: Duplicate blocked with warning

---

### Document Management Module (12 scenarios)

*(Similar detail for TC-DM-001 through TC-DM-EC-004)*

### Executive Dashboard Module (9 scenarios)

*(Similar detail for TC-RP-001 through TC-RP-008)*

### Palladium Integration Module (14 scenarios)

*(Similar detail for TC-PI-001 through TC-PI-EC-004)*

---

## Playwright Implementation Guide

### Project Structure

```
e2e/
├── playwright.config.ts          # Playwright configuration
├── package.json                  # Test dependencies
├── fixtures/
│   ├── auth.fixture.ts           # Authentication fixtures
│   ├── database.fixture.ts       # Database helpers
│   └── test-data.fixture.ts      # Test data generators
├── helpers/
│   ├── api.helper.ts             # API call utilities
│   ├── auth.helper.ts            # Authentication utilities
│   ├── database.helper.ts        # Direct database access
│   └── wait.helper.ts            # Wait utilities
├── pages/                        # Page Object Models
│   ├── login.page.ts
│   ├── dashboard.page.ts
│   ├── crm/
│   │   ├── contacts.page.ts
│   │   └── quotes.page.ts
│   ├── grower-intake/
│   │   └── samples.page.ts
│   └── ...
├── tests/
│   ├── auth/
│   │   ├── login.spec.ts
│   │   ├── rbac.spec.ts
│   │   └── session.spec.ts
│   ├── crm/
│   │   ├── contacts.spec.ts
│   │   └── quotes.spec.ts
│   ├── grower-intake/
│   │   ├── samples.spec.ts
│   │   └── mrd.spec.ts
│   ├── kernel-production/
│   │   ├── batches.spec.ts
│   │   └── workflow.spec.ts
│   └── ...
├── reporters/
│   └── supabase.reporter.ts      # Custom reporter for DB storage
└── global-setup.ts               # Global test setup
```

---

## Test Results Storage

### Supabase Reporter

A custom Playwright reporter automatically stores all test results in Supabase.

**Location:** `e2e/reporters/supabase.reporter.ts`

### Enabling Test Storage

1. Create `.env.e2e` file:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
TEST_ENVIRONMENT=local
APP_VERSION=1.0.0
```

2. Run tests - results are stored automatically:
```bash
cd "Playwright Tests"
npm test
```

### What Gets Stored

**test_run_batches** (one per test run):
- Batch name and timestamp
- Pass/fail/skip counts
- Overall status
- Deployment recommendation

**test_instances** (one per test):
- Linked to scenario via `scenario_code`
- Status (passed/failed/skipped/timedOut)
- Duration in milliseconds
- Error message and stack trace
- Step-by-step results
- Browser info

### Reporter Output

```
[SupabaseReporter] Starting test run with 13 tests
[SupabaseReporter] Creating test run batch...
[SupabaseReporter] Created batch: abc123-def456-...
[SupabaseReporter] Successfully stored 13 test results

[SupabaseReporter] ═══════════════════════════════════════
  Batch ID: abc123-def456-...
  Total: 13 | Passed: 4 | Failed: 9 | Skipped: 0
  Duration: 175.23s
═══════════════════════════════════════
```

### Querying Test Results

```sql
-- View recent test runs
SELECT 
    batch_name,
    started_at,
    total_tests,
    passed_count,
    failed_count,
    deployment_recommendation
FROM test_run_batches 
ORDER BY started_at DESC 
LIMIT 10;

-- View failed tests from latest run
SELECT 
    ti.scenario_code,
    ti.status,
    ti.duration_ms,
    ti.error_message,
    ts.severity_level
FROM test_instances ti
LEFT JOIN test_scenarios ts ON ts.scenario_code = ti.scenario_code
WHERE ti.run_batch_id = (
    SELECT id FROM test_run_batches 
    ORDER BY started_at DESC LIMIT 1
)
AND ti.status IN ('failed', 'timedOut')
ORDER BY ts.severity_level;

-- Deployment readiness check
SELECT 
    trb.deployment_recommendation,
    COUNT(*) FILTER (WHERE ti.status = 'passed') as passed,
    COUNT(*) FILTER (WHERE ti.status = 'failed') as failed,
    COUNT(*) FILTER (WHERE ts.severity_level = 'critical' AND ti.status = 'failed') as critical_failures
FROM test_run_batches trb
JOIN test_instances ti ON ti.run_batch_id = trb.id
LEFT JOIN test_scenarios ts ON ts.scenario_code = ti.scenario_code
WHERE trb.id = 'your-batch-id'
GROUP BY trb.deployment_recommendation;
```

### Test History Dashboard Query

```sql
-- Test pass rate trend (last 10 runs)
SELECT 
    DATE(started_at) as run_date,
    batch_name,
    ROUND(passed_count::numeric / NULLIF(total_tests, 0) * 100, 1) as pass_rate,
    deployment_recommendation
FROM test_run_batches
ORDER BY started_at DESC
LIMIT 10;
```

---

### Test Naming Convention

Match test names to scenario codes:

```typescript
// e2e/tests/auth/login.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication Module', () => {
  test('TC-AUTH-001: User Login with Valid Credentials', async ({ page }) => {
    // Test implementation
  });

  test('TC-AUTH-002: Role-Based Access Control Enforcement', async ({ page }) => {
    // Test implementation
  });
});
```

### Reporting Test Results to Database

```typescript
// e2e/helpers/test-reporter.ts
import { createClient } from '@supabase/supabase-js';

export async function reportTestResult(
  scenarioCode: string,
  status: 'passed' | 'failed' | 'skipped',
  result: {
    duration?: number;
    error?: string;
    screenshots?: string[];
  }
) {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  // Find scenario
  const { data: scenario } = await supabase
    .from('test_scenarios')
    .select('id, severity_level')
    .eq('scenario_code', scenarioCode)
    .single();

  if (!scenario) return;

  // Create test instance
  await supabase.from('test_instances').insert({
    scenario_id: scenario.id,
    run_batch_id: process.env.TEST_BATCH_ID,
    environment: process.env.TEST_ENV || 'local',
    status,
    duration_ms: result.duration,
    error_message: result.error,
    screenshots: result.screenshots || [],
    severity_level_at_run: scenario.severity_level,
    deployment_impact: calculateDeploymentImpact(status, scenario.severity_level)
  });
}
```

---

## RBAC Testing Integration

### Testing Different Roles

```typescript
// e2e/fixtures/auth.fixture.ts
import { test as base } from '@playwright/test';

type AuthFixtures = {
  superUserPage: Page;
  adminPage: Page;
  productionManagerPage: Page;
  qaPage: Page;
};

export const test = base.extend<AuthFixtures>({
  superUserPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, 'super_user');
    await use(page);
    await context.close();
  },
  
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, 'admin');
    await use(page);
    await context.close();
  },
  // ... more roles
});
```

### Role-Based Test Matrix

```typescript
// e2e/tests/rbac/access-control.spec.ts
import { test, expect } from '../../fixtures/auth.fixture';

const roleAccessMatrix = {
  'super_user': ['crm', 'production', 'quality', 'finance', 'admin'],
  'admin': ['crm', 'production', 'quality', 'admin'],
  'production_manager': ['production', 'quality'],
  'qa_supervisor': ['quality'],
  'office_admin': ['crm', 'intake'],
};

for (const [role, allowedModules] of Object.entries(roleAccessMatrix)) {
  test.describe(`RBAC for ${role}`, () => {
    for (const module of allowedModules) {
      test(`can access ${module}`, async ({ page }) => {
        await loginAs(page, role);
        await page.goto(`/#${module}-grid`);
        await expect(page.locator('.module-content')).toBeVisible();
      });
    }
  });
}
```

---

## Applying to Other Projects

This section provides a complete guide to implement this testing strategy in any new project.

### Step 1: Create Database Tables

Run these SQL migrations in order:

```sql
-- 1. Test Scenarios Table
CREATE TABLE test_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_code VARCHAR UNIQUE NOT NULL,
    scenario_name VARCHAR NOT NULL,
    description TEXT,
    module_name VARCHAR NOT NULL,
    feature_name VARCHAR,
    test_type VARCHAR DEFAULT 'functional',
    preconditions TEXT,
    test_steps JSONB DEFAULT '[]'::jsonb,
    expected_result TEXT NOT NULL,
    test_data JSONB DEFAULT '{}'::jsonb,
    severity_level VARCHAR DEFAULT 'medium',
    tags JSONB DEFAULT '[]'::jsonb,
    is_automated BOOLEAN DEFAULT false,
    automation_script_path TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Test Run Batches Table
CREATE TABLE test_run_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_name VARCHAR NOT NULL,
    description TEXT,
    environment VARCHAR DEFAULT 'development',
    version_tested VARCHAR,
    build_number VARCHAR,
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    total_tests INTEGER DEFAULT 0,
    passed_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    overall_status VARCHAR DEFAULT 'running',
    deployment_recommendation VARCHAR,
    recommendation_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Test Instances Table
CREATE TABLE test_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID REFERENCES test_scenarios(id),
    scenario_code VARCHAR(50),
    run_batch_id UUID REFERENCES test_run_batches(id),
    run_number INTEGER DEFAULT 1,
    environment VARCHAR NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    status VARCHAR NOT NULL,
    error_message TEXT,
    error_stack TEXT,
    step_results JSONB,
    browser_info JSONB,
    tester_notes TEXT,
    severity_level_at_run VARCHAR DEFAULT 'medium',
    executed_by_name VARCHAR,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Test Data Sets Table
CREATE TABLE e2e_test_data_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_name VARCHAR UNIQUE NOT NULL,
    module VARCHAR NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Test Data Records Table
CREATE TABLE e2e_test_data_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id UUID REFERENCES e2e_test_data_sets(id) ON DELETE CASCADE,
    data_key VARCHAR NOT NULL,
    entity_type VARCHAR NOT NULL,
    data_json JSONB NOT NULL,
    purpose TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(set_id, data_key)
);

-- 6. Project Documentation Table
CREATE TABLE project_documentation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name VARCHAR(100) NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    document_title VARCHAR(255) NOT NULL,
    document_slug VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    version VARCHAR(20) DEFAULT '1.0.0',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(project_name, document_slug)
);
```

### Step 2: Create Test Users

```sql
-- Create admin user with password
INSERT INTO public."Users" (
    email, full_name, password_hash, provider, 
    role_id, is_active, "ClientUniqueGUID"
) VALUES (
    'admin@yourproject.com',
    'Admin User',
    crypt('SecurePassword123!', gen_salt('bf')),
    'email',
    (SELECT id FROM "UserRoles" WHERE role_name = 'Super Admin'),
    true,
    'your-client-guid'
);
```

### Step 3: Add RBAC Permissions

```sql
-- Add test management permissions
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_test_scenarios', 'EXECUTE', true
FROM roles r WHERE r.role_name IN ('super_user', 'admin', 'qa_supervisor');
```

### Step 4: Populate Test Scenarios

Use this template for each scenario:

```sql
INSERT INTO test_scenarios (
    scenario_code,
    scenario_name,
    description,
    module_name,
    feature_name,
    test_type,
    severity_level,
    preconditions,
    expected_result,
    test_steps
) VALUES (
    'TC-MODULE-001',
    'Scenario Name Here',
    'Detailed description of what is being tested',
    'module-name',
    'Feature Name',
    'functional', -- functional, security, e2e, integration, performance, usability
    'high',       -- critical, high, medium, low, info
    'What must be true before test runs',
    'What should happen when test passes',
    '[
        {"step": 1, "action": "Navigate to page", "expected": "Page loads"},
        {"step": 2, "action": "Enter data", "expected": "Form accepts input"},
        {"step": 3, "action": "Submit form", "expected": "Success message shown"}
    ]'::jsonb
);
```

### Step 5: Set Up Playwright E2E Folder

1. Create folder structure:
```
e2e/
├── fixtures/
│   ├── index.ts
│   ├── auth.fixture.ts
│   └── test-data.fixture.ts
├── helpers/
│   └── database.helper.ts
├── pages/
│   ├── login.page.ts
│   └── dashboard.page.ts
├── reporters/
│   └── supabase.reporter.ts    # Critical for storing results
├── tests/
│   └── auth/
│       ├── login.spec.ts
│       └── rbac.spec.ts
├── playwright.config.ts
├── package.json
└── .env.e2e
```

2. Install dependencies:
```bash
cd "Playwright Tests"
npm init -y
npm install -D @playwright/test @supabase/supabase-js dotenv
npx playwright install
```

3. Configure `playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.e2e' });

export default defineConfig({
  testDir: './tests',
  reporter: [
    ['html'],
    ['list'],
    ['./reporters/supabase.reporter.ts'],  // Store results in DB
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5500',
  },
});
```

4. Create `.env.e2e`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
BASE_URL=http://localhost:5500
TEST_ENVIRONMENT=local
```

### Step 6: Copy Supabase Reporter

Copy `e2e/reporters/supabase.reporter.ts` from this project. It automatically:
- Creates `test_run_batches` record for each run
- Creates `test_instances` for each test
- Links to `test_scenarios` via scenario_code
- Calculates deployment recommendations

### Step 7: Store This Documentation

```sql
-- Store QA strategy in database
INSERT INTO project_documentation (
    project_name, document_type, document_title, 
    document_slug, content, version
) VALUES (
    'YourProjectName',
    'test_strategy',
    'Test Strategy & Scenarios Documentation',
    'test-strategy',
    'full_markdown_content_here',
    '1.0.0'
);
```

### Step 8: Integrate with CI/CD

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm test
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

---

## Test Scenario Code Naming Convention

Format: `TC-{MODULE}-{TYPE?}-{NUMBER}`

| Prefix | Module |
|--------|--------|
| TC-AUTH | Authentication |
| TC-CRM | CRM |
| TC-GI | Grower Intake |
| TC-KP | Kernel Production |
| TC-OP | Oil Production |
| TC-QA | Quality Assurance |
| TC-SM | Stock Management |
| TC-FM | Financial Management |
| TC-DM | Document Management |
| TC-RP | Reporting/Dashboard |
| TC-PI | Palladium Integration |
| TC-SF | Sales Forecasting |

Type suffixes:
- `-EC-` = Edge Case scenarios
- No suffix = Standard functional scenarios

Example: `TC-AUTH-EC-001` = Authentication Edge Case #001

---

## Maintenance

### Adding New Scenarios

1. Insert into `test_scenarios` table
2. Create corresponding Playwright test file
3. Update `automation_script_path` in scenario record
4. Run test and verify

### Updating Scenarios

1. Update database record
2. Update Playwright test
3. Mark old scenario as deprecated if needed

### Reviewing Results

Query deployment readiness:

```sql
SELECT 
    trb.batch_name,
    trb.deployment_recommendation,
    trb.passed_count,
    trb.failed_count,
    ti.scenario_id,
    ts.scenario_code,
    ts.severity_level,
    ti.status
FROM test_run_batches trb
JOIN test_instances ti ON ti.run_batch_id = trb.id
JOIN test_scenarios ts ON ts.id = ti.scenario_id
WHERE trb.id = 'latest-batch-id'
AND ti.status = 'failed'
ORDER BY 
    CASE ts.severity_level 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
    END;
```

---

## Complete Table Reference

| Table | Purpose | Auto-Populated By |
|-------|---------|-------------------|
| `test_scenarios` | Test case definitions | Manual / Import |
| `test_instances` | Individual test results | Supabase Reporter |
| `test_run_batches` | Grouped test runs | Supabase Reporter |
| `e2e_test_data_sets` | Test data categories | Manual |
| `e2e_test_data_records` | Individual test data | Manual |
| `project_documentation` | QA docs like this file | Manual |
| `UserRoles` | Role definitions | Project setup |
| `Users` | Test user accounts | Project setup |
| `role_permissions` | RBAC permissions | Project setup |

---

## Quick Start Checklist

- [ ] Create database tables (6 tables)
- [ ] Create test users with passwords
- [ ] Set up RBAC permissions
- [ ] Create Playwright E2E folder structure
- [ ] Copy Supabase reporter
- [ ] Create `.env.e2e` with credentials
- [ ] Populate test scenarios
- [ ] Populate test data sets
- [ ] Store this documentation in database
- [ ] Run tests and verify results are stored
- [ ] Set up CI/CD integration

---

*Last Updated: January 2026*
*Total Scenarios: 167*
*Modules Covered: 14*
*Supabase Project: iwxmuemrfopajwvqdiae*
