import { test, expect } from '../fixtures';
import { navigateToAdminUsers } from '../helpers/navigation.helper';
import { cleanupE2ePlaywrightFixtureUsers } from '../helpers/database.helper';

/**
 * User Management CRUD Tests
 *
 * Tests for creating, reading, updating, and deleting users.
 * Users are identified by first_name / last_name + email (the username field
 * was removed — see migrations/20260709120000_drop_users_username_column.sql).
 */

// Test user data for different roles
const TEST_USERS = {
  growerIntake: {
    firstName: 'E2E',
    lastName: 'Grower Intake',
    email: `e2e.grower.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Grower Intake',
    password: 'Testing123$',
  },
  production: {
    firstName: 'E2E',
    lastName: 'Production',
    email: `e2e.prod.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Production',
    password: 'Testing123$',
  },
  qualityAssurance: {
    firstName: 'E2E',
    lastName: 'QA',
    email: `e2e.qa.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Quality Assurance',
    password: 'Testing123$',
  },
  sales: {
    firstName: 'E2E',
    lastName: 'Sales',
    email: `e2e.sales.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Sales',
    password: 'Testing123$',
  },
  finance: {
    firstName: 'E2E',
    lastName: 'Finance',
    email: `e2e.finance.${Date.now()}@test.macavation.co.za`,
    role: 'PWA Finance',
    password: 'Testing123$',
  },
};

test.describe('User Management - CRUD Operations @user-management @critical', () => {

  test.afterAll(async () => {
    try {
      await cleanupE2ePlaywrightFixtureUsers();
    } catch (e) {
      console.warn('[user-crud] cleanupE2ePlaywrightFixtureUsers:', e);
    }
  });

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToAdminUsers(authenticatedPage);
  });

  test('TC-UM-001: View Users List', async ({ authenticatedPage }) => {
    /**
     * Verify users list is displayed correctly
     */
    await expect(authenticatedPage.locator('#adminUsersTable, #usersTable').first()).toBeVisible();

    await expect(authenticatedPage.locator('th:has-text("User")')).toBeVisible();
    await expect(authenticatedPage.locator('th:has-text("Email")')).toBeVisible();
    await expect(authenticatedPage.locator('th:has-text("Role")')).toBeVisible();
    await expect(authenticatedPage.locator('th:has-text("Actions")')).toBeVisible();
  });

  test('TC-UM-002: Open Add User Modal', async ({ authenticatedPage }) => {
    /**
     * Verify Add User button opens the modal
     */
    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');

    // Wait for modal to appear
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

    // Verify form fields are present (first/last name replaced the old username field)
    await expect(authenticatedPage.locator('#firstName')).toBeVisible();
    await expect(authenticatedPage.locator('#lastName')).toBeVisible();
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
    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

    // Fill in user details
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

    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

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

    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

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

    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

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

    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

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
    const searchInput = authenticatedPage.locator('#searchInput');
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('e2e');
      await authenticatedPage.waitForTimeout(500);
      expect(await searchInput.inputValue()).toBe('e2e');
      return;
    }
    const roleFilter = authenticatedPage.locator('#userRoleFilter, #filterRole').first();
    await expect(roleFilter).toBeVisible({ timeout: 10000 });
    await roleFilter.locator('option').nth(1).waitFor({ state: 'attached', timeout: 20000 });
    expect((await roleFilter.locator('option').allTextContents()).length).toBeGreaterThan(1);
  });

  test('TC-UM-009: Filter Users by Role', async ({ authenticatedPage }) => {
    const roleFilter = authenticatedPage.locator('#userRoleFilter, #filterRole').first();
    await expect(roleFilter).toBeVisible({ timeout: 10000 });
    await roleFilter.locator('option').nth(1).waitFor({ state: 'attached', timeout: 20000 });
    expect((await roleFilter.locator('option').allTextContents()).length).toBeGreaterThan(1);
  });

  test('TC-UM-010: Edit Existing User', async ({ authenticatedPage }) => {
    /**
     * Test editing an existing user. Row actions live in the MacTableActions
     * ellipsis menu; edit is a [data-admin-edit-user] item.
     */
    const row = authenticatedPage.locator('#usersTableBody tr').first();
    const menuBtn = row.locator('.mac-table-actions [data-bs-toggle="dropdown"]');

    if (await menuBtn.isVisible().catch(() => false)) {
      await menuBtn.click();
      await row.locator('[data-admin-edit-user]').first().click();

      // Wait for modal
      await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

      // Verify form is populated (first name not empty)
      const firstNameValue = await authenticatedPage.locator('#firstName').inputValue();
      expect(firstNameValue.length).toBeGreaterThan(0);

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

  test('TC-UM-EC-001: Required Field Validation - Empty First Name', async ({ authenticatedPage }) => {
    /**
     * Verify first name is required
     */
    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

    // Fill only email, skip first name
    await authenticatedPage.fill('#email', 'test@test.com');

    // Try to save
    await authenticatedPage.click('#saveUserBtn');

    // Check validation
    const firstNameInput = authenticatedPage.locator('#firstName');
    const isValid = await firstNameInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(isValid).toBe(false);

    await authenticatedPage.click('#userModal .btn-close');
  });

  test('TC-UM-EC-002: Required Field Validation - Empty Email', async ({ authenticatedPage }) => {
    /**
     * Verify email is required
     */
    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

    // Fill only first name, skip email
    await authenticatedPage.fill('#firstName', 'Testy');

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
    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

    await authenticatedPage.fill('#firstName', 'Testy');
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
    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

    await authenticatedPage.fill('#firstName', 'Testy');
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
    const existingEmail = await authenticatedPage.locator('#usersTableBody tr:first-child td:nth-child(2), #usersTableBody tr:first-child td:nth-child(3)').first().textContent();

    if (existingEmail && existingEmail.includes('@')) {
      await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
      await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

      await authenticatedPage.fill('#firstName', 'Duplicate');
      await authenticatedPage.fill('#lastName', `Test${Date.now()}`);
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
    await authenticatedPage.click('#adminBtnAddUser, #adminBtnAddUserTab, #addUserBtn');
    await authenticatedPage.waitForSelector('#userModal.show', { state: 'visible' });

    await authenticatedPage.fill('#firstName', 'Testy');
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
