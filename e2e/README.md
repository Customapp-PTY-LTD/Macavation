# Macavation E2E Tests

End-to-end tests for the Macavation farm management system using Playwright.

## Overview

This test suite provides comprehensive E2E testing for all Macavation modules, with test data stored both in the Supabase database and as TypeScript fixtures for offline/fallback usage.

## Quick Start

```bash
# Navigate to e2e directory
cd e2e

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install

# Create environment file
cp .env.example .env.e2e

# Run tests
npm test
```

## Environment Setup

Create a `.env.e2e` file in the `e2e` directory:

```env
# Application URL (demo environment)
BASE_URL=https://demo-macavation.customapp.org

# Client GUID for Macavation
CLIENT_GUID=9e1d961a-bfc2-469d-8526-8af75f536656

# Super Admin Credentials (REQUIRED for auth tests)
SUPER_ADMIN_EMAIL=kishan@customapp.co.za
SUPER_ADMIN_PASSWORD=<your_password_here>

# Supabase Configuration (for test result storage)
SUPABASE_URL=https://iwxmuemrfopajwvqdiae.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here

# Test Environment identifier
TEST_ENVIRONMENT=demo
```

> ⚠️ **Security Notes**:
> - The `.env.e2e` file contains sensitive credentials - **never commit it to version control**
> - The `SUPABASE_SERVICE_KEY` bypasses RLS - keep it secure
> - Request test credentials from your team lead

## Test Data Architecture

### Database-Stored Test Data

Test data is stored in two tables:

1. **`e2e_test_data_sets`** - Defines test data sets by module
2. **`e2e_test_data_records`** - Individual test data records

This allows:
- Centralized test data management
- Easy updates without code changes
- Sharing data between test suites
- Traceability of test coverage

### Test Data Sets Available

| Set Name | Module | Description |
|----------|--------|-------------|
| `auth_test_data` | authentication | User credentials and role data |
| `crm_test_data` | crm | Contacts, customers, growers |
| `grower_intake_test_data` | grower-intake | Sample submissions |
| `kernel_production_test_data` | kernel-production | Production batches |
| `oil_production_test_data` | oil-production | Oil production batches |
| `quality_test_data` | quality-assurance | Quality tests, thresholds |
| `stock_test_data` | stock-management | Stock items, locations |
| `financial_test_data` | financial-management | Payment calculations |

### Fixture Files (Fallback)

The `fixtures/test-data.fixture.ts` contains default test data that:
- Mirrors the database test data
- Provides offline testing capability
- Serves as fallback if database is unavailable

## Test Results Storage

Test results are automatically stored in Supabase when the `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` environment variables are set.

### Database Tables Used

| Table | Purpose |
|-------|---------|
| `test_run_batches` | Groups test runs, tracks pass/fail counts, deployment recommendations |
| `test_instances` | Individual test results with error details, duration, screenshots |
| `test_scenarios` | Test scenario definitions (linked to instances via scenario_code) |

### Enabling Test Storage

1. Create `.env.e2e` file with Supabase credentials
2. Run tests normally - results are stored automatically

```bash
# Results will be stored in Supabase
npm test
```

### Viewing Test Results

Query the database to view historical test results:

```sql
-- View recent test runs
SELECT * FROM test_run_batches ORDER BY started_at DESC LIMIT 10;

-- View failed tests from last run
SELECT ti.scenario_code, ti.status, ti.error_message
FROM test_instances ti
JOIN test_run_batches trb ON ti.run_batch_id = trb.id
WHERE trb.id = (SELECT id FROM test_run_batches ORDER BY started_at DESC LIMIT 1)
AND ti.status = 'failed';
```

## Project Structure

```
e2e/
├── fixtures/
│   ├── index.ts              # Main export for all fixtures
│   ├── auth.fixture.ts       # Authentication fixtures
│   └── test-data.fixture.ts  # Test data fixtures & types
├── reporters/
│   └── supabase.reporter.ts  # Custom reporter for database storage
├── helpers/
│   ├── database.helper.ts    # Supabase database helpers
│   ├── api.helper.ts         # API request helpers
│   └── wait.helper.ts        # Wait/timing utilities
├── pages/
│   ├── login.page.ts         # Login page object
│   └── dashboard.page.ts     # Dashboard page object
├── tests/
│   ├── auth/
│   │   ├── login.spec.ts     # Login tests
│   │   └── rbac.spec.ts      # RBAC tests
│   ├── crm/
│   │   └── contacts.spec.ts  # CRM contact tests
│   ├── grower-intake/
│   │   └── samples.spec.ts   # Sample submission tests
│   ├── kernel-production/
│   │   └── batches.spec.ts   # Production batch tests
│   ├── oil-production/
│   │   └── oil-batches.spec.ts
│   ├── quality-assurance/
│   │   └── quality.spec.ts
│   ├── stock-management/
│   │   └── stock.spec.ts
│   ├── financial-management/
│   │   └── finance.spec.ts
│   └── dashboard/
│       └── dashboard.spec.ts
├── playwright.config.ts      # Playwright configuration
├── global-setup.ts           # Global test setup
├── package.json
└── README.md
```

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from '../fixtures';

test.describe('Feature Name', () => {
  test('TC-XXX-001: Test scenario name', async ({ authenticatedPage, testData }) => {
    // Use testData for pre-defined test data
    const grower = testData.contacts.growerActive;
    
    // Navigate and interact
    await authenticatedPage.goto('/module/page.html');
    await authenticatedPage.fill('#input', grower.company_name);
    
    // Assert
    await expect(authenticatedPage.locator('.result')).toBeVisible();
  });
});
```

### Using Role-Based Authentication

```typescript
import { test, expect } from '../fixtures';

test('Production Manager can view batches', async ({ loginAsProductionManager, testData }) => {
  const page = await loginAsProductionManager();
  
  await page.goto('/kernel-production/batches.html');
  await expect(page.locator('h1')).toContainText('Production');
});

test('Sales can view forecasting', async ({ loginAsSalesExecutive }) => {
  const page = await loginAsSalesExecutive();
  
  await page.goto('/sales-forecasting/index.html');
  await expect(page).toHaveURL(/sales-forecasting/);
});
```

### Creating Test Data

```typescript
import { test, expect, createTestContact, createTestBatch } from '../fixtures';

test('Create and cleanup test data', async ({ authenticatedPage, cleanup }) => {
  // Create test data
  const contact = await createTestContact({
    company_name: 'E2E Test Grower ' + Date.now(),
    contact_type: 'grower',
  });
  
  // Track for cleanup
  cleanup.track('contacts', contact.id);
  
  // Use in test...
  
  // Cleanup happens automatically after test via fixture
});
```

### Using Generators for Unique Data

```typescript
import { test, expect } from '../fixtures';

test('Create contact with unique data', async ({ 
  authenticatedPage, 
  generateContact, 
  uniqueCode 
}) => {
  const contactData = generateContact({
    contact_type: 'customer',
    status: 'active',
  });
  
  const code = uniqueCode('CUS');
  
  await authenticatedPage.fill('#companyName', contactData.company_name);
  await authenticatedPage.fill('#contactCode', code);
});
```

## Available Test Data

### Users

| Key | Email | Role | Status |
|-----|-------|------|--------|
| `superAdmin` | kishan@customapp.co.za | Super Admin | ✅ Configured |
| `generalManager` | jon.walters@macavation.co.za | General Manager | ⏭️ Skipped |
| `productionManager` | mark.payne@macavation.co.za | Production Manager | ⏭️ Skipped |
| `qaSupervsor` | simone.naidu@macavation.co.za | QA Supervisor | ⏭️ Skipped |
| `salesExecutive` | peter.symons@macavation.co.za | Sales Executive | ⏭️ Skipped |
| `oilPlantManager` | brandon.morrison@macavation.co.za | Oil Plant Manager | ⏭️ Skipped |
| `officeAdministrator` | josslyn.pillay@macavation.co.za | Office Administrator | ⏭️ Skipped |
| `invalidUser` | invalid@macavation.co.za | (Invalid credentials) | ✅ Test only |

> 🔒 **Note**: Only the Super Admin account is configured. Tests requiring other roles are automatically skipped.

### Contacts

| Key | Company | Type | Status |
|-----|---------|------|--------|
| `growerActive` | Van der Merwe Macadamias | grower | active |
| `growerKhoza` | Khoza Farming Trust | grower | active |
| `growerSuspended` | Riverside Plantations | grower | suspended |
| `customerOriental` | Oriental Foods Trading Co. | customer | active |
| `customerSuspended` | Durban Snack Foods | customer | suspended |

### Production Batches

| Key | Batch Number | Status | Notes |
|-----|--------------|--------|-------|
| `completed` | KB-2026-001 | completed | Released, has outputs |
| `inCracking` | KB-EC-001 | cracking | In production |
| `onHold` | KB-EC-003 | hold | Quality hold |
| `inDrying` | KB-EC-004 | drying | In drying step |

### Oil Batches

| Key | Batch Number | Status | Notes |
|-----|--------------|--------|-------|
| `completed` | OB-2026-002 | completed | Full outputs |
| `pressing` | OB-EC-001 | pressing | In progress |
| `onHold` | OB-EC-002 | hold | Temperature exceeded |
| `inStorage` | OB-EC-007 | storage | Tank storage |

## Running Tests

```bash
# Run all tests
npm test

# Run with UI
npm run test:ui

# Run specific test file
npx playwright test tests/auth/login.spec.ts

# Run tests by tag/grep
npx playwright test --grep "TC-AUTH"

# Run in headed mode
npm run test:headed

# Run with debug
npm run test:debug

# Generate and view report
npm run test:report
```

## Test Naming Convention

Tests should follow the scenario code pattern:

- `TC-AUTH-001` - Authentication module
- `TC-CRM-001` - CRM module
- `TC-GI-001` - Grower Intake
- `TC-KP-001` - Kernel Production
- `TC-OP-001` - Oil Production
- `TC-QA-001` - Quality Assurance
- `TC-SM-001` - Stock Management
- `TC-FM-001` - Financial Management
- `TC-RP-001` - Reporting/Dashboard

## CI/CD Integration

The tests are configured to run in CI with:
- Parallel execution disabled
- 2 retries on failure
- HTML report generation
- Screenshot on failure
- Video on first retry

Add to your CI pipeline:

```yaml
- name: Run E2E Tests
  run: |
    cd e2e
    npm ci
    npx playwright install --with-deps
    npm test
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

## Troubleshooting

### Tests fail with authentication errors

Ensure the test users exist in the database and have correct passwords set.

### Database connection fails

Check that `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correctly set in `.env.e2e`.

### Tests timeout

Increase timeout in `playwright.config.ts` or use `test.slow()` for slow tests.

### Element not found

Use `await page.waitForSelector()` or Playwright's auto-waiting with locators.
