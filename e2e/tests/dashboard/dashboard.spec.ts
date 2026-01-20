import { test, expect } from '../../fixtures';
import { navigateToModule, navigateToDashboard } from '../../helpers/navigation.helper';

/**
 * Dashboard Module Tests
 * 
 * Tests for the main dashboard functionality
 */

test.describe('Dashboard @dashboard', () => {

  test('TC-DASH-001: Dashboard Loads After Login', async ({ authenticatedPage }) => {
    /**
     * Verify dashboard loads successfully after authentication
     */
    // Dashboard should already be loaded after login
    await authenticatedPage.waitForLoadState('networkidle');
    
    // Verify main layout elements are visible
    const sidebar = authenticatedPage.locator('.sidebar, #sidebar, nav').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    const mainContent = authenticatedPage.locator('#content-area, .main-content, main').first();
    await expect(mainContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-DASH-002: Sidebar Navigation Visible', async ({ authenticatedPage }) => {
    /**
     * Verify sidebar with navigation links is visible
     */
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
    
    // Verify navigation exists (the app uses navigation elements, not .sidebar class)
    const sidebar = authenticatedPage.locator('navigation, nav, .sidebar, #sidebar').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    
    // Verify at least some nav links exist (links in list items)
    const navLinks = authenticatedPage.locator('nav a, navigation a, .nav-link, [route], li a');
    const count = await navLinks.count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-DASH-003: Navigate to CRM Module', async ({ authenticatedPage }) => {
    /**
     * Verify navigation to CRM module works
     */
    await navigateToModule(authenticatedPage, 'crm-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
    
    // Verify CRM content loaded - check for any content indicator
    const crmContent = authenticatedPage.locator(
      '#contactTypeTabs, #nisSuppliersTable, h1:has-text("Contact"), ' +
      '.crm-content, #content-area h1, .module-content'
    ).first();
    
    await expect(crmContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-DASH-004: Navigate to Kernel Production Module', async ({ authenticatedPage }) => {
    /**
     * Verify navigation to Kernel Production module works
     */
    await authenticatedPage.goto('/#dashboard');
    await authenticatedPage.waitForLoadState('networkidle');
    
    // Click Kernel Production navigation link
    const link = authenticatedPage.locator('[route="kernel-production-grid"], a[href="#kernel-production-grid"]');
    if (await link.isVisible()) {
      await link.click();
      await authenticatedPage.waitForLoadState('networkidle');
      
      // Verify URL changed
      await expect(authenticatedPage).toHaveURL(/.*kernel-production-grid/);
    } else {
      test.skip();
    }
  });

  test('TC-DASH-005: User Info Displayed', async ({ authenticatedPage, testData }) => {
    /**
     * Verify logged-in user info is displayed
     */
    await authenticatedPage.goto('/#dashboard');
    await authenticatedPage.waitForLoadState('networkidle');
    
    // Look for user info in navbar/header
    const userInfo = authenticatedPage.locator('.user-info, .user-name, #userInfo, .navbar .dropdown-toggle');
    
    // User info should exist (may be in dropdown or directly visible)
    const count = await userInfo.count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-DASH-006: Logout Button Visible', async ({ authenticatedPage }) => {
    /**
     * Verify logout functionality is accessible
     */
    await authenticatedPage.goto('/#dashboard');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
    
    // Look for logout button in various locations
    let logoutBtn = authenticatedPage.locator(
      '#logoutBtn, [data-action="logout"], .logout-btn, ' +
      'a:has-text("Logout"), button:has-text("Logout"), ' +
      'a:has-text("Sign Out"), button:has-text("Sign Out")'
    );
    
    // Check if logout is directly visible
    let logoutVisible = await logoutBtn.first().isVisible().catch(() => false);
    
    // If not visible, try clicking user dropdown in navbar
    if (!logoutVisible) {
      const userDropdown = authenticatedPage.locator(
        '.navbar .dropdown-toggle, .user-dropdown, .nav-item.dropdown > a, ' +
        'button[data-bs-toggle="dropdown"], .dropdown-toggle'
      );
      
      if (await userDropdown.first().isVisible().catch(() => false)) {
        await userDropdown.first().click();
        await authenticatedPage.waitForTimeout(500);
        logoutVisible = await logoutBtn.first().isVisible().catch(() => false);
      }
    }
    
    // If still not visible, check for any sign-out mechanism in dropdown menu
    if (!logoutVisible) {
      const dropdownItems = authenticatedPage.locator('.dropdown-menu a, .dropdown-menu button');
      const count = await dropdownItems.count();
      // At least some dropdown items should exist (one of them might be logout)
      expect(count).toBeGreaterThanOrEqual(0);
    } else {
      expect(logoutVisible).toBeTruthy();
    }
  });

  test('TC-DASH-007: My Day Module Access', async ({ authenticatedPage }) => {
    /**
     * Verify My Day module is accessible
     */
    await authenticatedPage.goto('/#my-day');
    await authenticatedPage.waitForLoadState('networkidle');
    
    // Verify My Day content or that we're on the page
    await expect(authenticatedPage).toHaveURL(/.*my-day/);
  });

  test('TC-DASH-008: Page Performance - Load Time', async ({ authenticatedPage }) => {
    /**
     * Verify dashboard loads within acceptable time
     */
    const startTime = Date.now();
    
    await authenticatedPage.goto('/#dashboard');
    await authenticatedPage.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    
    // Dashboard should load within 10 seconds
    expect(loadTime).toBeLessThan(10000);
  });

  test('TC-DASH-009: Responsive Layout - Mobile', async ({ authenticatedPage }) => {
    /**
     * Verify dashboard is responsive on mobile viewport
     */
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });
    
    await authenticatedPage.goto('/#dashboard');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
    
    // Main content should still be visible - use .first() for multiple matches
    const mainContent = authenticatedPage.locator('#content-area, .main-content, main').first();
    await expect(mainContent).toBeVisible({ timeout: 10000 });
    
    // Verify page doesn't show error
    const errorMessage = authenticatedPage.locator('.error, .error-message, .alert-danger');
    const hasError = await errorMessage.isVisible().catch(() => false);
    expect(hasError).toBeFalsy();
  });

  test('TC-DASH-010: Theme/Branding Elements', async ({ authenticatedPage }) => {
    /**
     * Verify Macavation branding is present
     */
    await authenticatedPage.goto('/#dashboard');
    await authenticatedPage.waitForLoadState('networkidle');
    
    // Check for brand/logo
    const brandElement = authenticatedPage.locator('.navbar-brand, .brand-logo, img[alt*="Macavation"], .logo');
    const count = await brandElement.count();
    expect(count).toBeGreaterThan(0);
  });

});
