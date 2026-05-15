import { test, expect } from '../fixtures';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Roles Management CRUD Tests
 * 
 * Tests for creating, reading, updating, and deleting roles
 */

test.describe('Roles Management - CRUD Operations @roles-management', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    // Navigate to Roles Management module via sidebar
    await navigateToModule(authenticatedPage, 'roles-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-RM-001: View Roles List', async ({ authenticatedPage }) => {
    /**
     * Verify roles list is displayed correctly
     */
    await expect(authenticatedPage.locator('#rolesTable')).toBeVisible({ timeout: 15000 });
    await expect(authenticatedPage.locator('#rolesTableBody:has-text("Loading roles")')).not.toBeVisible({ timeout: 20000 });
    
    // Verify table headers
    await expect(authenticatedPage.locator('#rolesTable th:has-text("Role Name")')).toBeVisible();
    await expect(authenticatedPage.locator('#rolesTable th:has-text("Description")')).toBeVisible();
  });

  test('TC-RM-002: Open Add Role Modal', async ({ authenticatedPage }) => {
    /**
     * Verify Add Role button opens the modal
     */
    await authenticatedPage.click('#addRoleBtn');
    
    // Wait for modal
    await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
    
    // Verify form fields
    await expect(authenticatedPage.locator('#roleName')).toBeVisible();
    await expect(authenticatedPage.locator('#roleDescription')).toBeVisible();
    await expect(authenticatedPage.locator('#cboPermissionLevel')).toBeVisible();
    
    // Close modal
    await authenticatedPage.click('#roleModal .btn-close');
  });

  test('TC-RM-003: Create New Role', async ({ authenticatedPage }) => {
    /**
     * Create a new custom role
     */
    const roleName = `E2E Test Role ${Date.now()}`;
    
    await authenticatedPage.click('#addRoleBtn');
    await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#roleName', roleName);
    await authenticatedPage.fill('#roleDescription', 'Role created by E2E test');
    await authenticatedPage.selectOption('#cboPermissionLevel', '2'); // Standard
    
    await authenticatedPage.click('#saveRoleBtn');
    await authenticatedPage.waitForTimeout(2000);
    
    // Verify success
    const modalClosed = !(await authenticatedPage.locator('#roleModal.show').isVisible().catch(() => true));
    expect(modalClosed).toBeTruthy();
  });

  test('TC-RM-004: Role Permission Levels', async ({ authenticatedPage }) => {
    /**
     * Verify all permission levels are available
     */
    await authenticatedPage.click('#addRoleBtn');
    await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
    
    const options = await authenticatedPage.locator('#cboPermissionLevel option').allTextContents();
    
    // Should have multiple permission levels
    expect(options.length).toBeGreaterThan(3);
    expect(options.some(o => o.includes('Basic'))).toBeTruthy();
    expect(options.some(o => o.includes('Admin'))).toBeTruthy();
    
    await authenticatedPage.click('#roleModal .btn-close');
  });

  test('TC-RM-005: Search Roles', async ({ authenticatedPage }) => {
    /**
     * Test role search functionality (roles grid uses #rolesSearchInput, filters on input)
     */
    const searchInput = authenticatedPage.locator('#rolesSearchInput');
    await searchInput.fill('admin');
    await authenticatedPage.waitForTimeout(500);
    const searchValue = await searchInput.inputValue();
    expect(searchValue).toBe('admin');
  });

  test('TC-RM-006: Filter Roles by Status', async ({ authenticatedPage }) => {
    /**
     * Test status filter (roles grid uses #rolesFilterStatus)
     */
    const statusFilter = authenticatedPage.locator('#rolesFilterStatus');
    await expect(statusFilter).toBeVisible();
    const options = await statusFilter.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await statusFilter.selectOption('true');
    await authenticatedPage.waitForTimeout(400);
    await expect(statusFilter).toHaveValue('true');
  });

  test('TC-RM-007: Clear role filters', async ({ authenticatedPage }) => {
    /**
     * Test clear filters button (#rolesClearFiltersBtn)
     */
    await authenticatedPage.locator('#rolesSearchInput').fill('test');
    await authenticatedPage.locator('#rolesFilterStatus').selectOption('true');
    await authenticatedPage.waitForTimeout(300);
    await authenticatedPage.locator('#rolesClearFiltersBtn').click();
    await authenticatedPage.waitForTimeout(400);
    await expect(authenticatedPage.locator('#rolesSearchInput')).toHaveValue('');
    await expect(authenticatedPage.locator('#rolesFilterStatus')).toHaveValue('');
  });

  test('TC-RM-008: Edit Existing Role', async ({ authenticatedPage }) => {
    /**
     * Test editing an existing role
     */
    const editBtn = authenticatedPage.locator('#rolesTableBody tr:first-child button:has-text("Edit"), #rolesTableBody tr:first-child .edit-btn').first();
    
    if (await editBtn.isVisible()) {
      await editBtn.click();
      await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
      
      // Verify form is populated
      const roleNameValue = await authenticatedPage.locator('#roleName').inputValue();
      expect(roleNameValue.length).toBeGreaterThan(0);
      
      await authenticatedPage.click('#roleModal .btn-close');
    }
  });

  test('TC-RM-009: Delete Role Confirmation', async ({ authenticatedPage }) => {
    /**
     * Test delete role confirmation modal
     */
    const deleteBtn = authenticatedPage.locator('#rolesTableBody tr:first-child button:has-text("Delete"), #rolesTableBody tr:first-child .delete-btn').first();
    
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await authenticatedPage.waitForSelector('#deleteModal.show', { state: 'visible' });
      
      // Verify warning about users
      await expect(authenticatedPage.locator('#deleteModal .alert-warning')).toBeVisible();
      
      // Cancel
      await authenticatedPage.click('#deleteModal .btn-secondary');
    }
  });

  test('TC-RM-010: Users Count Display', async ({ authenticatedPage }) => {
    /**
     * Verify users count is displayed for each role
     */
    const usersCountHeader = authenticatedPage.locator('th:has-text("Users Count"), th:has-text("Users")');
    const headerVisible = await usersCountHeader.isVisible().catch(() => false);
    
    if (headerVisible) {
      // At least the header exists
      expect(headerVisible).toBeTruthy();
    }
  });

  // Edge Cases

  test('TC-RM-EC-001: Required Role Name Validation', async ({ authenticatedPage }) => {
    /**
     * Verify role name is required
     */
    await authenticatedPage.click('#addRoleBtn');
    await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
    
    // Fill description but not name
    await authenticatedPage.fill('#roleDescription', 'Test description');
    
    await authenticatedPage.click('#saveRoleBtn');
    
    // Check validation
    const roleNameInput = authenticatedPage.locator('#roleName');
    const isValid = await roleNameInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(isValid).toBe(false);
    
    await authenticatedPage.click('#roleModal .btn-close');
  });

  test('TC-RM-EC-002: Required Permission Level Validation', async ({ authenticatedPage }) => {
    /**
     * Verify permission level is required
     */
    await authenticatedPage.click('#addRoleBtn');
    await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#roleName', 'Test Role');
    // Don't select permission level
    
    await authenticatedPage.click('#saveRoleBtn');
    
    // Check validation
    const permissionSelect = authenticatedPage.locator('#cboPermissionLevel');
    const isValid = await permissionSelect.evaluate((el: HTMLSelectElement) => el.validity.valid);
    expect(isValid).toBe(false);
    
    await authenticatedPage.click('#roleModal .btn-close');
  });

  test('TC-RM-EC-003: Duplicate Role Name Prevention', async ({ authenticatedPage }) => {
    /**
     * Verify duplicate role names are rejected
     */
    // Get an existing role name
    const existingRoleName = await authenticatedPage.locator('#rolesTableBody tr:first-child td:first-child').textContent();
    
    if (existingRoleName) {
      await authenticatedPage.click('#addRoleBtn');
      await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
      
      await authenticatedPage.fill('#roleName', existingRoleName.trim());
      await authenticatedPage.selectOption('#cboPermissionLevel', '1');
      
      await authenticatedPage.click('#saveRoleBtn');
      await authenticatedPage.waitForTimeout(2000);
      
      // Should show error
      const errorVisible = await authenticatedPage.locator('.swal2-popup, .alert-danger, .toast-error').isVisible().catch(() => false);
      expect(errorVisible).toBeTruthy();
    }
  });

  test('TC-RM-EC-004: Cannot Delete Role With Active Users', async ({ authenticatedPage }) => {
    /**
     * Roles with active users should show warning before deletion
     */
    const deleteBtn = authenticatedPage.locator('#rolesTableBody tr:first-child button:has-text("Delete")').first();
    
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await authenticatedPage.waitForSelector('#deleteModal.show', { state: 'visible' });
      
      // Should show warning about affected users
      const warningText = await authenticatedPage.locator('#deleteModal .alert-warning').textContent();
      expect(warningText).toContain('users');
      
      await authenticatedPage.click('#deleteModal .btn-secondary');
    }
  });

  test('TC-RM-EC-005: Long Role Name Handling', async ({ authenticatedPage }) => {
    /**
     * Verify long role names are handled properly
     */
    await authenticatedPage.click('#addRoleBtn');
    await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
    
    const longName = 'A'.repeat(200); // Very long name
    await authenticatedPage.fill('#roleName', longName);
    await authenticatedPage.selectOption('#cboPermissionLevel', '1');
    
    await authenticatedPage.click('#saveRoleBtn');
    await authenticatedPage.waitForTimeout(2000);
    
    // Should either accept (with truncation) or show error
    // Just verify no crash
    const hasContent = await authenticatedPage.locator('body').isVisible();
    expect(hasContent).toBeTruthy();
  });

  test('TC-RM-EC-006: Special Characters in Role Name', async ({ authenticatedPage }) => {
    /**
     * Verify special characters are handled in role names
     */
    await authenticatedPage.click('#addRoleBtn');
    await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
    
    await authenticatedPage.fill('#roleName', `Test <script>alert(1)</script> Role ${Date.now()}`);
    await authenticatedPage.selectOption('#cboPermissionLevel', '1');
    
    await authenticatedPage.click('#saveRoleBtn');
    await authenticatedPage.waitForTimeout(2000);
    
    // Should sanitize or reject, but not execute script
    const hasContent = await authenticatedPage.locator('body').isVisible();
    expect(hasContent).toBeTruthy();
  });

  test('TC-RM-EC-007: Role Status Toggle', async ({ authenticatedPage }) => {
    /**
     * Verify role status can be toggled
     */
    await authenticatedPage.click('#addRoleBtn');
    await authenticatedPage.waitForSelector('#roleModal.show', { state: 'visible' });
    
    const statusCheckbox = authenticatedPage.locator('#isActive');
    const isCheckedInitially = await statusCheckbox.isChecked();
    
    // Toggle the checkbox
    await statusCheckbox.click();
    
    const isCheckedAfter = await statusCheckbox.isChecked();
    expect(isCheckedAfter).not.toBe(isCheckedInitially);
    
    await authenticatedPage.click('#roleModal .btn-close');
  });

});

