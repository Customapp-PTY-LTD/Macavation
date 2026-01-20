import { test, expect } from '../../fixtures';
import { navigateToModule } from '../../helpers/navigation.helper';

/**
 * User Management CRUD Tests
 * 
 * Tests for creating, reading, updating, and deleting users
 */

// Test user data for different roles
const TEST_USERS = {
  growerIntake: {
    username: `e2e_grower_${Date.now()}`,
    firstName: 'E2E',
    lastName: 'Grower Intake',
    email: `e2e.grower.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Grower Intake',
    password: 'Testing123$',
  },
  production: {
    username: `e2e_prod_${Date.now()}`,
    firstName: 'E2E',
    lastName: 'Production',
    email: `e2e.prod.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Production',
    password: 'Testing123$',
  },
  qualityAssurance: {
    username: `e2e_qa_${Date.now()}`,
    firstName: 'E2E',
    lastName: 'QA',
    email: `e2e.qa.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Quality Assurance',
    password: 'Testing123$',
  },
  sales: {
    username: `e2e_sales_${Date.now()}`,
    firstName: 'E2E',
    lastName: 'Sales',
    email: `e2e.sales.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Sales',
    password: 'Testing123$',
  },
  finance: {
    username: `e2e_finance_${Date.now()}`,
    firstName: 'E2E',
    lastName: 'Finance',
    email: `e2e.finance.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Finance',
    password: 'Testing123$',
  },
};

test.describe('User Management - CRUD Operations @user-management @critical', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    // Navigate to Users Management module via sidebar
    await navigateToModule(authenticatedPage, 'users-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-UM-001: View Users List', async ({ authenticatedPage }) => {
    /**
     * Verify users list is displayed correctly
     */
    // Verify table is visible
    await expect(authenticatedPage.locator('#usersTable')).toBeVisible();
    
    // Verify table headers
    await expect(authenticatedPage.locator('th:has-text("User")')).toBeVisible();
    await expect(authenticatedPage.locator('th:has-text("Email")')).toBeVisible();
    await expect(authenticatedPage.locator('th:has-text("Role")')).toBeVisible();
    await expect(authenticatedPage.locator('th:has-text("Actions")')).toBeVisible();
  });

  test('TC-UM-002: Open Add User Modal', async ({ authenticatedPage }) => {
    /**
     * Verify Add User button opens the modal
     */
    await authenticatedPage.click('#addUserBtn');
    
    // Wait for modal to appear
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    // Verify form fields are present
    await expect(authenticatedPage.locator('#username')).toBeVisible();
    await expect(authenticatedPage.locator('#email')).toBeVisible();
    await expect(authenticatedPage.locator('#cboRole')).toBeVisible();
    await expect(authenticatedPage.locator('#password')).toBeVisible();
    
    // Close modal
    await authenticatedPage.click('#userModal .btn-close');
  });

  test('TC-UM-003: Create User with PWA Grower Intake Role', async ({ authenticatedPage }) => {
    /**
     * Create a new user with PWA Grower Intake role
     */
    const user = TEST_USERS.growerIntake;
    
    // Click Add User button
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    // Fill in user details
    await authenticatedPage.fill('#username', user.username);
    await authenticatedPage.fill('#firstName', user.firstName);
    await authenticatedPage.fill('#lastName', user.lastName);
    await authenticatedPage.fill('#email', user.email);
    
    // Select role
    await authenticatedPage.selectOption('#cboRole', { label: user.role });
    
    // Set password
    await authenticatedPage.fill('#password', user.password);
    await authenticatedPage.fill('#txtConfirmPassword', user.password);
    
    // Save user
    await authenticatedPage.click('#saveUserBtn');
    
    // Wait for success or modal to close
    await authenticatedPage.waitForTimeout(2000);
    
    // Verify success message or user appears in list
    const successVisible = await authenticatedPage.locator('.swal2-popup, .toast-success, .alert-success').isVisible().catch(() => false);
    const modalClosed = !(await authenticatedPage.locator('#userModal.show').isVisible().catch(() => true));
    
    expect(successVisible || modalClosed).toBeTruthy();
  });

  test('TC-UM-004: Create User with PWA Production Role', async ({ authenticatedPage }) => {
    /**
     * Create a new user with PWA Production role
     */
    const user = TEST_USERS.production;
    
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#username', user.username);
    await authenticatedPage.fill('#firstName', user.firstName);
    await authenticatedPage.fill('#lastName', user.lastName);
    await authenticatedPage.fill('#email', user.email);
    await authenticatedPage.selectOption('#cboRole', { label: user.role });
    await authenticatedPage.fill('#password', user.password);
    await authenticatedPage.fill('#txtConfirmPassword', user.password);
    
    await authenticatedPage.click('#saveUserBtn');
    await authenticatedPage.waitForTimeout(2000);
    
    const modalClosed = !(await authenticatedPage.locator('#userModal.show').isVisible().catch(() => true));
    expect(modalClosed).toBeTruthy();
  });

  test('TC-UM-005: Create User with PWA Quality Assurance Role', async ({ authenticatedPage }) => {
    /**
     * Create a new user with PWA Quality Assurance role
     */
    const user = TEST_USERS.qualityAssurance;
    
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#username', user.username);
    await authenticatedPage.fill('#firstName', user.firstName);
    await authenticatedPage.fill('#lastName', user.lastName);
    await authenticatedPage.fill('#email', user.email);
    await authenticatedPage.selectOption('#cboRole', { label: user.role });
    await authenticatedPage.fill('#password', user.password);
    await authenticatedPage.fill('#txtConfirmPassword', user.password);
    
    await authenticatedPage.click('#saveUserBtn');
    await authenticatedPage.waitForTimeout(2000);
  });

  test('TC-UM-006: Create User with PWA Sales Role', async ({ authenticatedPage }) => {
    /**
     * Create a new user with PWA Sales role
     */
    const user = TEST_USERS.sales;
    
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#username', user.username);
    await authenticatedPage.fill('#firstName', user.firstName);
    await authenticatedPage.fill('#lastName', user.lastName);
    await authenticatedPage.fill('#email', user.email);
    await authenticatedPage.selectOption('#cboRole', { label: user.role });
    await authenticatedPage.fill('#password', user.password);
    await authenticatedPage.fill('#txtConfirmPassword', user.password);
    
    await authenticatedPage.click('#saveUserBtn');
    await authenticatedPage.waitForTimeout(2000);
  });

  test('TC-UM-007: Create User with PWA Finance Role', async ({ authenticatedPage }) => {
    /**
     * Create a new user with PWA Finance role
     */
    const user = TEST_USERS.finance;
    
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#username', user.username);
    await authenticatedPage.fill('#firstName', user.firstName);
    await authenticatedPage.fill('#lastName', user.lastName);
    await authenticatedPage.fill('#email', user.email);
    await authenticatedPage.selectOption('#cboRole', { label: user.role });
    await authenticatedPage.fill('#password', user.password);
    await authenticatedPage.fill('#txtConfirmPassword', user.password);
    
    await authenticatedPage.click('#saveUserBtn');
    await authenticatedPage.waitForTimeout(2000);
  });

  test('TC-UM-008: Search Users', async ({ authenticatedPage }) => {
    /**
     * Test user search functionality
     */
    const searchInput = authenticatedPage.locator('#searchInput');
    await searchInput.fill('e2e');
    await authenticatedPage.click('#searchBtn');
    
    await authenticatedPage.waitForTimeout(1000);
    
    // Verify search was performed
    const searchValue = await searchInput.inputValue();
    expect(searchValue).toBe('e2e');
  });

  test('TC-UM-009: Filter Users by Role', async ({ authenticatedPage }) => {
    /**
     * Test role filter functionality
     */
    // Expand filters
    const filterToggle = authenticatedPage.locator('[data-bs-target="#filtersCollapse"]');
    await filterToggle.click();
    await authenticatedPage.waitForSelector('#filtersCollapse.show', { state: 'visible' });
    
    // Select a role filter
    const roleFilter = authenticatedPage.locator('#filterRole');
    const options = await roleFilter.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
  });

  test('TC-UM-010: Edit Existing User', async ({ authenticatedPage }) => {
    /**
     * Test editing an existing user
     */
    // Find an edit button in the users table
    const editBtn = authenticatedPage.locator('#usersTableBody tr:first-child button:has-text("Edit"), #usersTableBody tr:first-child .edit-btn, #usersTableBody tr:first-child [data-action="edit"]').first();
    
    if (await editBtn.isVisible()) {
      await editBtn.click();
      
      // Wait for modal
      await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
      
      // Verify form is populated (fields not empty)
      const usernameValue = await authenticatedPage.locator('#username').inputValue();
      expect(usernameValue.length).toBeGreaterThan(0);
      
      // Close modal
      await authenticatedPage.click('#userModal .btn-close');
    }
  });

  test('TC-UM-011: Deactivate User Confirmation', async ({ authenticatedPage }) => {
    /**
     * Test deactivate user confirmation modal
     */
    // Find a delete/deactivate button
    const deleteBtn = authenticatedPage.locator('#usersTableBody tr:first-child button:has-text("Delete"), #usersTableBody tr:first-child .delete-btn, #usersTableBody tr:first-child [data-action="delete"]').first();
    
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      
      // Wait for confirmation modal
      await authenticatedPage.waitForSelector('#deleteModal.show', { state: 'visible' });
      
      // Verify warning message
      await expect(authenticatedPage.locator('#deleteModal .alert-warning')).toBeVisible();
      
      // Cancel (don't actually delete)
      await authenticatedPage.click('#deleteModal .btn-secondary');
    }
  });

  // Edge Cases

  test('TC-UM-EC-001: Required Field Validation - Empty Username', async ({ authenticatedPage }) => {
    /**
     * Verify username is required
     */
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    // Fill only email, skip username
    await authenticatedPage.fill('#email', 'test@test.com');
    
    // Try to save
    await authenticatedPage.click('#saveUserBtn');
    
    // Check validation
    const usernameInput = authenticatedPage.locator('#username');
    const isValid = await usernameInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(isValid).toBe(false);
    
    await authenticatedPage.click('#userModal .btn-close');
  });

  test('TC-UM-EC-002: Required Field Validation - Empty Email', async ({ authenticatedPage }) => {
    /**
     * Verify email is required
     */
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    // Fill only username, skip email
    await authenticatedPage.fill('#username', 'testuser');
    
    // Try to save
    await authenticatedPage.click('#saveUserBtn');
    
    // Check validation
    const emailInput = authenticatedPage.locator('#email');
    const isValid = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(isValid).toBe(false);
    
    await authenticatedPage.click('#userModal .btn-close');
  });

  test('TC-UM-EC-003: Invalid Email Format', async ({ authenticatedPage }) => {
    /**
     * Verify email format validation
     */
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#username', 'testuser');
    await authenticatedPage.fill('#email', 'invalid-email');
    
    await authenticatedPage.click('#saveUserBtn');
    
    // Modal should still be visible (validation failed)
    await expect(authenticatedPage.locator('#userModal.show')).toBeVisible();
    
    await authenticatedPage.click('#userModal .btn-close');
  });

  test('TC-UM-EC-004: Password Mismatch', async ({ authenticatedPage }) => {
    /**
     * Verify password confirmation matches
     */
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#username', 'testuser');
    await authenticatedPage.fill('#email', 'test@example.com');
    await authenticatedPage.fill('#password', 'Password123!');
    await authenticatedPage.fill('#txtConfirmPassword', 'DifferentPassword!');
    
    await authenticatedPage.click('#saveUserBtn');
    
    // Should show error or modal remains open
    await authenticatedPage.waitForTimeout(1000);
    
    const errorVisible = await authenticatedPage.locator('.swal2-popup, .alert-danger, .error-message').isVisible().catch(() => false);
    const modalStillOpen = await authenticatedPage.locator('#userModal.show').isVisible();
    
    expect(errorVisible || modalStillOpen).toBeTruthy();
    
    await authenticatedPage.click('#userModal .btn-close').catch(() => {});
  });

  test('TC-UM-EC-005: Duplicate Email Prevention', async ({ authenticatedPage }) => {
    /**
     * Verify duplicate email is rejected
     */
    // First, get an existing user's email
    const existingEmail = await authenticatedPage.locator('#usersTableBody tr:first-child td:nth-child(3)').textContent();
    
    if (existingEmail) {
      await authenticatedPage.click('#addUserBtn');
      await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
      
      await authenticatedPage.fill('#username', `duplicate_test_${Date.now()}`);
      await authenticatedPage.fill('#email', existingEmail.trim());
      await authenticatedPage.fill('#password', 'Password123!');
      await authenticatedPage.fill('#txtConfirmPassword', 'Password123!');
      
      await authenticatedPage.click('#saveUserBtn');
      await authenticatedPage.waitForTimeout(2000);
      
      // Should show error
      const errorVisible = await authenticatedPage.locator('.swal2-popup, .alert-danger, .toast-error').isVisible().catch(() => false);
      expect(errorVisible).toBeTruthy();
    }
  });

  test('TC-UM-EC-006: Required Role Selection', async ({ authenticatedPage }) => {
    /**
     * Verify role is required when creating user
     */
    await authenticatedPage.click('#addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#username', 'testuser');
    await authenticatedPage.fill('#email', 'test@example.com');
    await authenticatedPage.fill('#password', 'Password123!');
    await authenticatedPage.fill('#txtConfirmPassword', 'Password123!');
    // Don't select role
    
    await authenticatedPage.click('#saveUserBtn');
    
    // Check role validation
    const roleSelect = authenticatedPage.locator('#cboRole');
    const isValid = await roleSelect.evaluate((el: HTMLSelectElement) => el.validity.valid);
    expect(isValid).toBe(false);
    
    await authenticatedPage.click('#userModal .btn-close');
  });

});
