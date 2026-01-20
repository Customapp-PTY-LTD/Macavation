import { test, expect } from '../../fixtures';
import { navigateToModule } from '../../helpers/navigation.helper';

/**
 * Role-Based Access Control (RBAC) Tests
 * 
 * Tests for verifying role-based permissions and module access
 */

// Client GUID for demo environment
const CLIENT_GUID = process.env.CLIENT_GUID || '9e1d961a-bfc2-469d-8526-8af75f536656';

test.describe('RBAC - Role-Based Access Control @rbac @critical', () => {

  test('TC-RBAC-001: Super Admin Full Access', async ({ loginAsSuperAdmin }) => {
    /**
     * Super Admin should have access to all modules including user management
     */
    const page = await loginAsSuperAdmin();
    await page.waitForLoadState('networkidle');
    
    // Verify login succeeded
    await expect(page).not.toHaveURL(/.*signin/);
    
    // Navigate to user management (admin-only feature)
    await navigateToModule(page, 'users-grid');
    
    // Should be able to access users grid
    const usersContent = page.locator('.module-content, #usersTable, [data-module="users"]');
    const accessDenied = page.locator('.access-denied, .unauthorized, .error-403');
    
    // Either content is visible OR we're still on the page (not redirected)
    const hasAccess = await usersContent.isVisible().catch(() => false);
    const isDenied = await accessDenied.isVisible().catch(() => false);
    
    // Super admin should have access
    expect(isDenied).toBeFalsy();
  });

  test('TC-RBAC-002: Super Admin Can Access Roles Management', async ({ loginAsSuperAdmin }) => {
    /**
     * Super Admin should access roles management
     */
    const page = await loginAsSuperAdmin();
    await page.waitForLoadState('networkidle');
    
    // Navigate to roles management
    await navigateToModule(page, 'roles-grid');
    
    // Verify not denied
    const accessDenied = page.locator('.access-denied, .unauthorized, .error-403');
    const isDenied = await accessDenied.isVisible().catch(() => false);
    expect(isDenied).toBeFalsy();
  });

  test('TC-RBAC-003: Production Manager Access to Kernel Production', async ({ testData, loginAsProductionManager }) => {
    /**
     * Production Manager should have access to kernel production module
     * Skipped if credentials not available
     */
    test.skip(!testData.users.productionManager.password, 'Production Manager credentials not configured');
    
    const page = await loginAsProductionManager();
    await page.waitForLoadState('networkidle');
    await page.goto('/#kernel-production-grid');
    await page.waitForLoadState('networkidle');
    
    const moduleContent = page.locator('.module-content, [data-module="kernel-production"]');
    await expect(moduleContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-RBAC-004: QA Supervisor Access to Quality Assurance', async ({ testData, loginAsQASupervisor }) => {
    /**
     * QA Supervisor should have access to quality assurance module
     * Skipped if credentials not available
     */
    test.skip(!testData.users.qaSupervsor.password, 'QA Supervisor credentials not configured');
    
    const page = await loginAsQASupervisor();
    await page.waitForLoadState('networkidle');
    await page.goto('/#quality-assurance-grid');
    await page.waitForLoadState('networkidle');
    
    const moduleContent = page.locator('.module-content, [data-module="quality-assurance"]');
    await expect(moduleContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-RBAC-005: Sales Executive Access to Sales Forecasting', async ({ testData, loginAsSalesExecutive }) => {
    /**
     * Sales Executive should have access to sales forecasting module
     * Skipped if credentials not available
     */
    test.skip(!testData.users.salesExecutive.password, 'Sales Executive credentials not configured');
    
    const page = await loginAsSalesExecutive();
    await page.waitForLoadState('networkidle');
    await page.goto('/#sales-forecasting-grid');
    await page.waitForLoadState('networkidle');
    
    const moduleContent = page.locator('.module-content, [data-module="sales-forecasting"]');
    await expect(moduleContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-RBAC-006: Oil Plant Manager Access to Oil Production', async ({ testData, loginAsOilPlantManager }) => {
    /**
     * Oil Plant Manager should have access to oil production module
     * Skipped if credentials not available
     */
    test.skip(!testData.users.oilPlantManager.password, 'Oil Plant Manager credentials not configured');
    
    const page = await loginAsOilPlantManager();
    await page.waitForLoadState('networkidle');
    await page.goto('/#oil-production-grid');
    await page.waitForLoadState('networkidle');
    
    const moduleContent = page.locator('.module-content, [data-module="oil-production"]');
    await expect(moduleContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-RBAC-007: Office Administrator Access to Grower Intake', async ({ testData, loginAsOfficeAdministrator }) => {
    /**
     * Office Administrator should have access to grower intake module
     * Skipped if credentials not available
     */
    test.skip(!testData.users.officeAdministrator.password, 'Office Administrator credentials not configured');
    
    const page = await loginAsOfficeAdministrator();
    await page.waitForLoadState('networkidle');
    await page.goto('/#grower-intake-grid');
    await page.waitForLoadState('networkidle');
    
    const moduleContent = page.locator('.module-content, [data-module="grower-intake"]');
    await expect(moduleContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-RBAC-008: Non-Admin Cannot Access User Management', async ({ testData, loginAsProductionManager }) => {
    /**
     * Non-admin users should not have access to user management
     * Skipped if credentials not available
     */
    test.skip(!testData.users.productionManager.password, 'Production Manager credentials not configured');
    
    const page = await loginAsProductionManager();
    await page.waitForLoadState('networkidle');
    await page.goto('/#users-grid');
    await page.waitForLoadState('networkidle');
    
    const url = page.url();
    const accessDenied = page.locator('.access-denied, .unauthorized, .error-403');
    const isDenied = await accessDenied.isVisible().catch(() => false);
    const wasRedirected = !url.includes('users-grid');
    expect(isDenied || wasRedirected).toBeTruthy();
  });

  test('TC-RBAC-009: Sidebar Shows Only Permitted Modules', async ({ testData, loginAsQASupervisor }) => {
    /**
     * Sidebar should only show modules user has permission to access
     * Skipped if credentials not available
     */
    test.skip(!testData.users.qaSupervsor.password, 'QA Supervisor credentials not configured');
    
    const page = await loginAsQASupervisor();
    await page.waitForLoadState('networkidle');
    
    const sidebar = page.locator('.sidebar, #sidebar, .nav-sidebar');
    await expect(sidebar).toBeVisible();
    
    const usersLink = page.locator('[route="users-grid"], a[href="#users-grid"]');
    const usersLinkVisible = await usersLink.isVisible().catch(() => false);
    expect(usersLinkVisible).toBeFalsy();
  });

  test('TC-RBAC-010: Super Admin Can Access All Core Modules', async ({ authenticatedPage }) => {
    /**
     * Verify Super Admin has access to all core modules by navigating to each
     */
    const coreModules = [
      { route: 'crm-grid', name: 'CRM' },
      { route: 'grower-intake-grid', name: 'Grower Intake' },
      { route: 'kernel-production-grid', name: 'Kernel Production' },
      { route: 'quality-assurance-grid', name: 'Quality Assurance' },
      { route: 'stock-management-grid', name: 'Stock Management' },
      { route: 'financial-management-grid', name: 'Financial Management' },
    ];
    
    for (const module of coreModules) {
      await authenticatedPage.goto(`/#${module.route}`);
      await authenticatedPage.waitForLoadState('networkidle');
      
      // Should have access (no access denied)
      const accessDenied = await authenticatedPage.locator('.access-denied, .unauthorized').isVisible().catch(() => false);
      expect(accessDenied).toBeFalsy();
      
      // Module content should be visible
      const hasContent = await authenticatedPage.locator('.module-content, #content-area').isVisible().catch(() => false);
      expect(hasContent).toBeTruthy();
    }
  });

});
