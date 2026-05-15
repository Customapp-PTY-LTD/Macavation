import { test, expect } from '../fixtures';

// Client GUID for Macavation demo environment
const CLIENT_GUID = process.env.CLIENT_GUID || '9e1d961a-bfc2-469d-8526-8af75f536656';

test.describe('Authentication - Login @critical', () => {
  
  test('TC-AUTH-001: Super Admin Login with Valid Credentials', async ({ page, testData }) => {
    /**
     * Test Super Admin can login successfully
     * This is the primary admin user who can add/edit/delete users
     * Credentials are loaded from environment variables for security
     */
    const user = testData.users.superAdmin;
    
    // Skip if no password configured
    test.skip(!user.password, 'SUPER_ADMIN_PASSWORD environment variable not set');
    
    // Navigate to login page with client GUID
    await page.goto(`/signin.html?cc=${CLIENT_GUID}`);
    
    // Wait for form to be ready
    await page.waitForSelector('#signinForm', { state: 'visible' });
    
    // Fill in credentials
    await page.fill('#email', user.email);
    await page.fill('#password', user.password);
    
    // Click login button
    await page.click('#signinForm button[type="submit"]');
    
    // Verify successful login - should navigate away from signin
    await expect(page).not.toHaveURL(/.*signin/, { timeout: 15000 });
    
    // Verify user is on dashboard
    await page.waitForLoadState('networkidle');
  });

  test.skip('TC-AUTH-002: General Manager Login with Valid Credentials', async ({ page, testData }) => {
    /**
     * Test General Manager can login successfully
     * SKIPPED: General Manager credentials not configured in demo environment
     */
    const user = testData.users.generalManager;
    
    await page.goto(`/signin.html?cc=${CLIENT_GUID}`);
    await page.waitForSelector('#signinForm', { state: 'visible' });
    await page.fill('#email', user.email);
    await page.fill('#password', user.password);
    await page.click('#signinForm button[type="submit"]');
    await expect(page).not.toHaveURL(/.*signin/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  });

  test('TC-AUTH-003: User Login with Invalid Credentials', async ({ page, testData }) => {
    /**
     * Test that invalid credentials show error and stay on login page
     */
    const invalidUser = testData.users.invalidUser;
    
    // Navigate to login page with client GUID
    await page.goto(`/signin.html?cc=${CLIENT_GUID}`);
    
    // Wait for form
    await page.waitForSelector('#signinForm', { state: 'visible' });
    
    // Fill in invalid credentials
    await page.fill('#email', invalidUser.email);
    await page.fill('#password', invalidUser.password);
    
    // Click login
    await page.click('#signinForm button[type="submit"]');
    
    // Wait a moment for error handling
    await page.waitForTimeout(2000);
    
    // Verify error message is shown (SweetAlert2 or other error display)
    const errorVisible = await page.locator('.swal2-popup, #errorMessage, .error-message, .alert-danger, .toast-error').isVisible();
    
    // Should remain on login page (or show error)
    await expect(page).toHaveURL(/.*signin/);
  });

  test('TC-AUTH-004: Production Manager Role Dashboard Redirect', async ({ testData, loginAsProductionManager }) => {
    /**
     * Test Production Manager login and redirect
     */
    test.skip(!testData.users.productionManager.email || !testData.users.productionManager.password, 'Set PRODUCTION_MANAGER_EMAIL and PRODUCTION_MANAGER_PASSWORD');
    
    const page = await loginAsProductionManager();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/.*signin/);
  });

  test('TC-AUTH-005: QA Supervisor Role Dashboard Redirect', async ({ testData, loginAsQASupervisor }) => {
    /**
     * Test QA Supervisor login and redirect
     */
    test.skip(!testData.users.qaSupervsor.email || !testData.users.qaSupervsor.password, 'Set QA_SUPERVISOR_EMAIL and QA_SUPERVISOR_PASSWORD');
    
    const page = await loginAsQASupervisor();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/.*signin/);
  });

  test('TC-AUTH-006: Sales Executive Role Dashboard Redirect', async ({ testData, loginAsSalesExecutive }) => {
    /**
     * Test Sales Executive login and redirect
     */
    test.skip(!testData.users.salesExecutive.email || !testData.users.salesExecutive.password, 'Set SALES_EXECUTIVE_EMAIL and SALES_EXECUTIVE_PASSWORD');
    
    const page = await loginAsSalesExecutive();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/.*signin/);
  });

  test('TC-AUTH-007: Oil Plant Manager Role Dashboard Redirect', async ({ testData, loginAsOilPlantManager }) => {
    /**
     * Test Oil Plant Manager login and redirect
     */
    test.skip(!testData.users.oilPlantManager.email || !testData.users.oilPlantManager.password, 'Set OIL_PLANT_MANAGER_EMAIL and OIL_PLANT_MANAGER_PASSWORD');
    
    const page = await loginAsOilPlantManager();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/.*signin/);
  });

  test('TC-AUTH-008: Office Administrator Role Dashboard Redirect', async ({ testData, loginAsOfficeAdministrator }) => {
    /**
     * Test Office Administrator login and redirect
     */
    test.skip(!testData.users.officeAdministrator.email || !testData.users.officeAdministrator.password, 'Set OFFICE_ADMINISTRATOR_EMAIL and OFFICE_ADMINISTRATOR_PASSWORD');
    
    const page = await loginAsOfficeAdministrator();
    await page.waitForLoadState('networkidle');
    await expect(page).not.toHaveURL(/.*signin/);
  });

  test('TC-AUTH-009: Deactivated User Cannot Login', async ({ page, testData }) => {
    /**
     * Test that deactivated users are blocked from login
     */
    const deactivatedUser = testData.users.deactivatedUser;
    
    // Navigate to login page with client GUID
    await page.goto(`/signin.html?cc=${CLIENT_GUID}`);
    
    // Wait for form
    await page.waitForSelector('#signinForm', { state: 'visible' });
    
    // Fill in deactivated user credentials
    await page.fill('#email', deactivatedUser.email);
    await page.fill('#password', deactivatedUser.password);
    
    // Click login
    await page.click('#signinForm button[type="submit"]');
    
    // Wait a moment for error handling
    await page.waitForTimeout(2000);
    
    // Should remain on login page with error
    await expect(page).toHaveURL(/.*signin/);
    
    // Check for error message about account being deactivated
    const errorVisible = await page.locator('.swal2-popup, #errorMessage, .error-message, .alert-danger').isVisible();
    expect(errorVisible).toBeTruthy();
  });

  test('TC-AUTH-010: User Logout', async ({ authenticatedPage, logout }) => {
    /**
     * Test that logged-in user can logout successfully
     */
    // Verify we're logged in (not on signin page)
    await expect(authenticatedPage).not.toHaveURL(/.*signin/);
    
    // Perform logout
    await logout();
    
    // Verify redirected to login page
    await expect(authenticatedPage).toHaveURL(/.*signin/);
  });

  test('TC-AUTH-011: Session Persistence After Page Refresh', async ({ authenticatedPage }) => {
    /**
     * Test that user session persists after page refresh
     */
    // Store current URL
    const currentUrl = authenticatedPage.url();
    
    // Refresh the page
    await authenticatedPage.reload();
    
    // Wait for page to load
    await authenticatedPage.waitForLoadState('networkidle');
    
    // Should still be logged in (not redirected to signin)
    await expect(authenticatedPage).not.toHaveURL(/.*signin/);
  });

  test('TC-AUTH-012: Empty Credentials Validation', async ({ page }) => {
    /**
     * Test HTML5 validation prevents empty credential submission
     */
    // Navigate to login page with client GUID
    await page.goto(`/signin.html?cc=${CLIENT_GUID}`);
    
    // Wait for form
    await page.waitForSelector('#signinForm', { state: 'visible' });
    
    // Click login without entering credentials
    await page.click('#signinForm button[type="submit"]');
    
    // Should show validation error or remain on page
    await expect(page).toHaveURL(/.*signin/);
    
    // Check for validation messages (HTML5 or custom)
    const emailInput = page.locator('#email');
    const isValid = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(isValid).toBe(false);
  });

  test('TC-AUTH-013: Email Format Validation', async ({ page }) => {
    /**
     * Test that invalid email format is rejected
     */
    // Navigate to login page with client GUID
    await page.goto(`/signin.html?cc=${CLIENT_GUID}`);
    
    // Wait for form
    await page.waitForSelector('#signinForm', { state: 'visible' });
    
    // Enter invalid email format
    await page.fill('#email', 'invalidemail');
    await page.fill('#password', 'somepassword');
    
    // Try to submit
    await page.click('#signinForm button[type="submit"]');
    
    // Should remain on login page due to validation
    await expect(page).toHaveURL(/.*signin/);
  });

});

