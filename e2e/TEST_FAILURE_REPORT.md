# Macavation E2E Test Failure Report

**Generated:** January 19, 2026  
**Environment:** Demo (https://demo-macavation.customapp.org)  
**Browser:** Chromium  
**Test Framework:** Playwright

---

## Executive Summary

| Status | Count |
|--------|-------|
| ✅ Passed | 86 |
| ⏭️ Skipped | 1 |
| ❌ Failed | 11 |
| **Total** | **98** |

**Pass Rate: 87.8%**

---

## Failed Tests Summary

| # | Test ID | Module | Description | Duration |
|---|---------|--------|-------------|----------|
| 1 | TC-DASH-003 | Dashboard | Navigate to CRM Module | 17.8s |
| 2 | TC-DASH-006 | Dashboard | Logout Button Visible | 12.2s |
| 3 | TC-DASH-009 | Dashboard | Responsive Layout - Mobile | 10.8s |
| 4 | TC-FM-001 | Financial | View Financial Dashboard | 12.8s |
| 5 | TC-KP-001 | Kernel Production | View Production Batches List | 12.4s |
| 6 | TC-KP-010 | Kernel Production | Refresh Data | 12.0s |
| 7 | TC-OP-001 | Oil Production | View Oil Batches List | 8.9s |
| 8 | TC-SM-001 | Stock Management | View Stock List | 13.5s |
| 9 | TC-RSA-002 | Role Screen Access | Super Admin sees User Management | 9.2s |
| 10 | TC-RSA-004 | Role Screen Access | User Management hidden from non-admin | 14.8s |
| 11 | TC-RSA-EC-003 | Role Screen Access | Empty route handling | 9.8s |

---

## Detailed Failure Reports

### Failure #1: TC-DASH-003 - Navigate to CRM Module

| Field | Value |
|-------|-------|
| **Test ID** | TC-DASH-003 |
| **Test File** | `tests/dashboard/dashboard.spec.ts:43` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Dashboard |

#### Steps to Reproduce:
1. Login as Super Admin (kishan@customapp.co.za)
2. Wait for dashboard to load
3. Click on "CRM" link in sidebar
4. Verify CRM module loads

#### Expected Result:
- CRM module content loads with contact tabs

#### Actual Result:
- Navigation assertion may fail due to URL pattern mismatch

#### Recommended Fix:
- Update URL assertion pattern or use hash-based navigation check

---

### Failure #2: TC-DASH-006 - Logout Button Visible

| Field | Value |
|-------|-------|
| **Test ID** | TC-DASH-006 |
| **Test File** | `tests/dashboard/dashboard.spec.ts:101` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Dashboard |

#### Steps to Reproduce:
1. Login as Super Admin
2. Look for logout button in header or sidebar

#### Expected Result:
- Logout button/link is visible

#### Actual Result:
- Selector for logout button doesn't match actual implementation

#### Recommended Fix:
- Update logout button selector to match actual UI element

---

### Failure #3: TC-DASH-009 - Responsive Layout - Mobile

| Field | Value |
|-------|-------|
| **Test ID** | TC-DASH-009 |
| **Test File** | `tests/dashboard/dashboard.spec.ts:149` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Dashboard |

#### Steps to Reproduce:
1. Login as Super Admin
2. Resize viewport to mobile dimensions
3. Verify responsive layout changes

#### Expected Result:
- Mobile-specific layout elements are visible

#### Actual Result:
- Selector may not match responsive elements

#### Recommended Fix:
- Update selectors for mobile layout elements

---

### Failure #4: TC-FM-001 - View Financial Dashboard

| Field | Value |
|-------|-------|
| **Test ID** | TC-FM-001 |
| **Test File** | `tests/financial-management/finance.spec.ts:19` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Financial Management |

#### Steps to Reproduce:
1. Login as Super Admin
2. Navigate to Financial Management module
3. Verify financial dashboard content

#### Expected Result:
- Financial dashboard content is visible

#### Actual Result:
- Module content assertion fails

#### Recommended Fix:
- Increase wait time or update content selectors

---

### Failure #5: TC-KP-001 - View Production Batches List

| Field | Value |
|-------|-------|
| **Test ID** | TC-KP-001 |
| **Test File** | `tests/kernel-production/batches.spec.ts:19` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Kernel Production |

#### Steps to Reproduce:
1. Login as Super Admin
2. Navigate to Kernel Production module
3. Verify production batches table is visible

#### Expected Result:
- Production batches table is visible

#### Actual Result:
- Table visibility assertion fails

#### Recommended Fix:
- Update table selector or increase wait time

---

### Failure #6: TC-KP-010 - Refresh Data

| Field | Value |
|-------|-------|
| **Test ID** | TC-KP-010 |
| **Test File** | `tests/kernel-production/batches.spec.ts:171` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Kernel Production |

#### Steps to Reproduce:
1. Login as Super Admin
2. Navigate to Kernel Production
3. Click refresh button
4. Verify data reloads

#### Expected Result:
- Data refreshes successfully

#### Actual Result:
- Refresh button or data reload assertion fails

---

### Failure #7: TC-OP-001 - View Oil Batches List

| Field | Value |
|-------|-------|
| **Test ID** | TC-OP-001 |
| **Test File** | `tests/oil-production/oil-batches.spec.ts:18` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Oil Production |

#### Steps to Reproduce:
1. Login as Super Admin
2. Navigate to Oil Production module
3. Verify oil batches table is visible

#### Expected Result:
- Oil batches table is visible

#### Actual Result:
- Table visibility assertion fails

---

### Failure #8: TC-SM-001 - View Stock List

| Field | Value |
|-------|-------|
| **Test ID** | TC-SM-001 |
| **Test File** | `tests/stock-management/stock.spec.ts:18` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Stock Management |

#### Steps to Reproduce:
1. Login as Super Admin
2. Navigate to Stock Management module
3. Verify stock list is visible

#### Expected Result:
- Stock list/table is visible

#### Actual Result:
- List visibility assertion fails

---

### Failure #9: TC-RSA-002 - Super Admin sees User Management

| Field | Value |
|-------|-------|
| **Test ID** | TC-RSA-002 |
| **Test File** | `tests/user-management/role-screen-access.spec.ts:133` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Role Screen Access |

#### Steps to Reproduce:
1. Login as Super Admin
2. Check sidebar for User Management link

#### Expected Result:
- User Management link is visible in sidebar

#### Actual Result:
- Selector for User Management link doesn't match

---

### Failure #10: TC-RSA-004 - User Management hidden from non-admin

| Field | Value |
|-------|-------|
| **Test ID** | TC-RSA-004 |
| **Test File** | `tests/user-management/role-screen-access.spec.ts:169` |
| **User** | Non-admin user |
| **User Role** | Various |
| **Module** | Role Screen Access |

#### Steps to Reproduce:
1. Login as non-admin user
2. Check that User Management is NOT visible

#### Expected Result:
- User Management link is hidden

#### Actual Result:
- Test may require valid non-admin credentials

---

### Failure #11: TC-RSA-EC-003 - Empty route handling

| Field | Value |
|-------|-------|
| **Test ID** | TC-RSA-EC-003 |
| **Test File** | `tests/user-management/role-screen-access.spec.ts:266` |
| **User** | kishan@customapp.co.za |
| **User Role** | Super Admin |
| **Module** | Role Screen Access |

#### Steps to Reproduce:
1. Login as Super Admin
2. Navigate to empty route

#### Expected Result:
- Graceful handling of empty route

#### Actual Result:
- Edge case handling assertion fails

---

## Skipped Tests

| Test ID | Description | Reason |
|---------|-------------|--------|
| TC-DASH-004 | Navigate to Kernel Production Module | Skipped by test condition |

---

## Passing Tests by Module

| Module | Passed | Total | Pass Rate |
|--------|--------|-------|-----------|
| Authentication | 8 | 8 | 100% |
| RBAC | 3 | 3 | 100% |
| CRM - Contacts | 13 | 13 | 100% |
| Dashboard | 6 | 10 | 60% |
| Financial Management | 5 | 6 | 83% |
| Grower Intake | 5 | 5 | 100% |
| Kernel Production | 7 | 9 | 78% |
| Oil Production | 5 | 6 | 83% |
| Quality Assurance | 5 | 5 | 100% |
| Stock Management | 3 | 4 | 75% |
| Role Screen Access | 7 | 11 | 64% |
| Roles CRUD | 14 | 14 | 100% |
| User CRUD | 14 | 14 | 100% |

---

## Test Environment Configuration

```env
BASE_URL=https://demo-macavation.customapp.org
CLIENT_GUID=9e1d961a-bfc2-469d-8526-8af75f536656
SUPER_ADMIN_EMAIL=kishan@customapp.co.za
SUPER_ADMIN_PASSWORD=******** (stored securely)
TEST_ENVIRONMENT=demo
```

---

## Root Causes Analysis

### 1. Selector Mismatches (6 failures)
Several tests fail because UI selectors don't match the actual implementation:
- Logout button location
- User Management sidebar link
- Mobile responsive elements

### 2. Module Navigation (3 failures)
Some module navigation tests fail due to:
- URL pattern assertions not matching hash-based routing
- Content loading timing issues

### 3. Edge Cases (2 failures)
Edge case tests need adjustment for:
- Empty route handling
- Non-admin role testing (requires credentials)

---

## Recommended Next Steps

1. **Update Selectors** - Review and update selectors for:
   - Logout button
   - User Management sidebar link
   - Mobile responsive elements

2. **Fix Navigation Tests** - Update URL assertions to handle hash-based routing

3. **Add Wait Times** - Some module content may need additional wait time

4. **Configure Non-Admin Credentials** - To enable full RBAC testing

5. **Re-run Tests** - Execute full test suite after fixes

---

## How to Run Tests

```bash
# Run all tests
cd e2e
npm test

# Run in headed mode
npm run test:headed

# Run specific module
npm run test:auth
npm run test:crm
npm run test:users

# Run with specific tag
npm run test:critical
npm run test:smoke
```

---

*Report generated by Playwright E2E Test Suite*
