import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { navigateToAdminRoles, navigateToModule } from '../helpers/navigation.helper';

/**
 * Roles Management CRUD Tests (User & access hub — Roles tab)
 */

async function openAddRoleModal(page: Page) {
  const adminAdd = page.locator('button[data-bs-target="#addRoleModal"]').first();
  if (await adminAdd.isVisible().catch(() => false)) {
    await adminAdd.click();
    await page.waitForSelector('#addRoleModal.show', { state: 'visible', timeout: 15000 });
    return;
  }
  await page.locator('#addRoleBtn').click();
  await page.waitForSelector('#roleModal.show', { state: 'visible', timeout: 15000 });
}

async function openEditRoleModal(page: Page) {
  const adminEdit = page.locator('[data-admin-edit-role]').first();
  if (await adminEdit.isVisible().catch(() => false)) {
    await adminEdit.click();
    await page.waitForSelector('#roleModal.show', { state: 'visible', timeout: 15000 });
    return;
  }
  const legacyEdit = page.locator('#rolesTableBody tr.js-role-row, #rolesTableBody tr:first-child').first();
  await legacyEdit.click();
  await page.waitForSelector('#roleModal.show', { state: 'visible', timeout: 15000 });
}

test.describe('Roles Management - CRUD Operations @roles-management', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToAdminRoles(authenticatedPage);
  });

  test('TC-RM-001: View Roles List', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.locator('#adminRolesTable, #rolesTable').first()).toBeVisible({ timeout: 15000 });
    await expect(authenticatedPage.locator('#rolesTableBody:has-text("Loading")')).not.toBeVisible({ timeout: 20000 });
    await expect(authenticatedPage.locator('th:has-text("Role name"), th:has-text("Role Name")').first()).toBeVisible();
    await expect(authenticatedPage.locator('th:has-text("Description")').first()).toBeVisible();
  });

  test('TC-RM-002: Open Add Role Modal', async ({ authenticatedPage }) => {
    await openAddRoleModal(authenticatedPage);
    const adminForm = authenticatedPage.locator('#addRoleForm input[name="role_name"]');
    const legacyForm = authenticatedPage.locator('#roleName');
    const hasAdmin = await adminForm.isVisible().catch(() => false);
    if (hasAdmin) {
      await expect(adminForm).toBeVisible();
      await authenticatedPage.click('#addRoleModal .btn-close');
    } else {
      await expect(legacyForm).toBeVisible();
      await authenticatedPage.click('#roleModal .btn-close');
    }
  });

  test('TC-RM-003: Create New Role', async ({ authenticatedPage }) => {
    const roleName = `E2E Test Role ${Date.now()}`;
    await openAddRoleModal(authenticatedPage);
    const adminForm = authenticatedPage.locator('#addRoleForm input[name="role_name"]');
    if (await adminForm.isVisible().catch(() => false)) {
      await authenticatedPage.fill('#addRoleForm input[name="role_name"]', roleName);
      await authenticatedPage.fill('#addRoleForm textarea[name="description"]', 'Role created by E2E test');
      await authenticatedPage.click('#addRoleSubmitBtn');
    } else {
      await authenticatedPage.fill('#roleName', roleName);
      await authenticatedPage.fill('#roleDescription', 'Role created by E2E test');
      await authenticatedPage.selectOption('#cboPermissionLevel', '2');
      await authenticatedPage.click('#saveRoleBtn');
    }
    await authenticatedPage.waitForTimeout(2000);
    const modalClosed =
      !(await authenticatedPage.locator('#addRoleModal.show, #roleModal.show').first().isVisible().catch(() => true));
    expect(modalClosed).toBeTruthy();
  });

  test('TC-RM-004: Role Permission Levels', async ({ authenticatedPage }) => {
    await openEditRoleModal(authenticatedPage);
    const options = await authenticatedPage.locator('#cboPermissionLevel option').allTextContents();
    expect(options.length).toBeGreaterThan(3);
    expect(options.some((o) => o.includes('Basic'))).toBeTruthy();
    expect(options.some((o) => o.includes('Admin'))).toBeTruthy();
    await authenticatedPage.click('#roleModal .btn-close');
  });

  test('TC-RM-005: Search Roles', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'roles-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    const searchInput = authenticatedPage.locator('#rolesSearchInput');
    test.skip(!(await searchInput.isVisible().catch(() => false)), 'Legacy roles grid search not available');
    await searchInput.fill('admin');
    await authenticatedPage.waitForTimeout(500);
    expect(await searchInput.inputValue()).toBe('admin');
  });

  test('TC-RM-006: Filter Roles by Status', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'roles-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    const statusFilter = authenticatedPage.locator('#rolesFilterStatus');
    test.skip(!(await statusFilter.isVisible().catch(() => false)), 'Legacy roles status filter not available');
    const options = await statusFilter.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await statusFilter.selectOption('true');
    await expect(statusFilter).toHaveValue('true');
  });

  test('TC-RM-007: Clear role filters', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'roles-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    const searchInput = authenticatedPage.locator('#rolesSearchInput');
    const clearBtn = authenticatedPage.locator('#rolesClearFiltersBtn');
    test.skip(
      !(await searchInput.isVisible().catch(() => false)) || !(await clearBtn.isVisible().catch(() => false)),
      'Legacy roles clear-filters not available'
    );
    await searchInput.fill('test');
    await authenticatedPage.locator('#rolesFilterStatus').selectOption('true');
    await clearBtn.click();
    await expect(searchInput).toHaveValue('');
  });

  test('TC-RM-008: Edit Existing Role', async ({ authenticatedPage }) => {
    await openEditRoleModal(authenticatedPage);
    const roleNameValue = await authenticatedPage.locator('#roleName').inputValue();
    expect(roleNameValue.length).toBeGreaterThan(0);
    await authenticatedPage.click('#roleModal .btn-close');
  });

  test('TC-RM-009: Delete Role Confirmation', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'roles-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    const deleteBtn = authenticatedPage.locator('#rolesTableBody tr:first-child button:has-text("Delete"), #rolesTableBody tr:first-child .delete-btn').first();
    test.skip(!(await deleteBtn.isVisible().catch(() => false)), 'Delete role only on legacy roles grid');
    await deleteBtn.click();
    await authenticatedPage.waitForSelector('#deleteModal.show', { state: 'visible' });
    await expect(authenticatedPage.locator('#deleteModal .alert-warning')).toBeVisible();
    await authenticatedPage.click('#deleteModal .btn-secondary');
  });

  test('TC-RM-010: Users Count Display', async ({ authenticatedPage }) => {
    const usersCountHeader = authenticatedPage.locator('th:has-text("Users Count"), th:has-text("Users")');
    await expect(usersCountHeader.first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-RM-EC-001: Required Role Name Validation', async ({ authenticatedPage }) => {
    await openAddRoleModal(authenticatedPage);
    if (await authenticatedPage.locator('#addRoleForm input[name="role_name"]').isVisible().catch(() => false)) {
      await authenticatedPage.fill('#addRoleForm textarea[name="description"]', 'Test description');
      await authenticatedPage.click('#addRoleSubmitBtn');
      const roleNameInput = authenticatedPage.locator('#addRoleForm input[name="role_name"]');
      const isValid = await roleNameInput.evaluate((el: HTMLInputElement) => el.validity.valid);
      expect(isValid).toBe(false);
      await authenticatedPage.click('#addRoleModal .btn-close');
    } else {
      await authenticatedPage.fill('#roleDescription', 'Test description');
      await authenticatedPage.click('#saveRoleBtn');
      const roleNameInput = authenticatedPage.locator('#roleName');
      const isValid = await roleNameInput.evaluate((el: HTMLInputElement) => el.validity.valid);
      expect(isValid).toBe(false);
      await authenticatedPage.click('#roleModal .btn-close');
    }
  });

  test('TC-RM-EC-002: Required Permission Level Validation', async ({ authenticatedPage }) => {
    await openEditRoleModal(authenticatedPage);
    await authenticatedPage.selectOption('#cboPermissionLevel', '');
    await authenticatedPage.click('#saveRoleBtn');
    const permissionSelect = authenticatedPage.locator('#cboPermissionLevel');
    const isValid = await permissionSelect.evaluate((el: HTMLSelectElement) => el.validity.valid);
    expect(isValid).toBe(false);
    await authenticatedPage.click('#roleModal .btn-close');
  });

  test('TC-RM-EC-003: Duplicate Role Name Prevention', async ({ authenticatedPage }) => {
    const existingRoleName = await authenticatedPage.locator('#rolesTableBody tr:first-child td:first-child').textContent();
    test.skip(!existingRoleName?.trim(), 'No roles in list');
    await openAddRoleModal(authenticatedPage);
    if (await authenticatedPage.locator('#addRoleForm input[name="role_name"]').isVisible().catch(() => false)) {
      await authenticatedPage.fill('#addRoleForm input[name="role_name"]', existingRoleName!.trim());
      await authenticatedPage.click('#addRoleSubmitBtn');
    } else {
      await authenticatedPage.fill('#roleName', existingRoleName!.trim());
      await authenticatedPage.selectOption('#cboPermissionLevel', '1');
      await authenticatedPage.click('#saveRoleBtn');
    }
    await authenticatedPage.waitForTimeout(2000);
    const errorVisible = await authenticatedPage.locator('.swal2-popup, .alert-danger, .toast-error').isVisible().catch(() => false);
    expect(errorVisible).toBeTruthy();
  });

  test('TC-RM-EC-004: Cannot Delete Role With Active Users', async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'roles-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    const deleteBtn = authenticatedPage.locator('#rolesTableBody tr:first-child button:has-text("Delete")').first();
    test.skip(!(await deleteBtn.isVisible().catch(() => false)), 'Delete role only on legacy roles grid');
    await deleteBtn.click();
    await authenticatedPage.waitForSelector('#deleteModal.show', { state: 'visible' });
    const warningText = await authenticatedPage.locator('#deleteModal .alert-warning').textContent();
    expect(warningText).toContain('users');
    await authenticatedPage.click('#deleteModal .btn-secondary');
  });

  test('TC-RM-EC-005: Long Role Name Handling', async ({ authenticatedPage }) => {
    await openAddRoleModal(authenticatedPage);
    if (await authenticatedPage.locator('#addRoleForm input[name="role_name"]').isVisible().catch(() => false)) {
      await authenticatedPage.fill('#addRoleForm input[name="role_name"]', 'A'.repeat(200));
      await authenticatedPage.click('#addRoleSubmitBtn');
    } else {
      await authenticatedPage.fill('#roleName', 'A'.repeat(200));
      await authenticatedPage.selectOption('#cboPermissionLevel', '1');
      await authenticatedPage.click('#saveRoleBtn');
    }
    await authenticatedPage.waitForTimeout(2000);
    await expect(authenticatedPage.locator('body')).toBeVisible();
  });

  test('TC-RM-EC-006: Special Characters in Role Name', async ({ authenticatedPage }) => {
    await openAddRoleModal(authenticatedPage);
    const weird = `Test <script>alert(1)</script> Role ${Date.now()}`;
    if (await authenticatedPage.locator('#addRoleForm input[name="role_name"]').isVisible().catch(() => false)) {
      await authenticatedPage.fill('#addRoleForm input[name="role_name"]', weird);
      await authenticatedPage.click('#addRoleSubmitBtn');
    } else {
      await authenticatedPage.fill('#roleName', weird);
      await authenticatedPage.selectOption('#cboPermissionLevel', '1');
      await authenticatedPage.click('#saveRoleBtn');
    }
    await authenticatedPage.waitForTimeout(2000);
    await expect(authenticatedPage.locator('body')).toBeVisible();
  });

  test('TC-RM-EC-007: Role Status Toggle', async ({ authenticatedPage }) => {
    await openAddRoleModal(authenticatedPage);
    const adminStatus = authenticatedPage.locator('#addRoleForm select[name="is_active"]');
    if (await adminStatus.isVisible().catch(() => false)) {
      await adminStatus.selectOption('false');
      await expect(adminStatus).toHaveValue('false');
      await authenticatedPage.click('#addRoleModal .btn-close');
    } else {
      const statusCheckbox = authenticatedPage.locator('#isActive');
      const isCheckedInitially = await statusCheckbox.isChecked();
      await statusCheckbox.click();
      expect(await statusCheckbox.isChecked()).not.toBe(isCheckedInitially);
      await authenticatedPage.click('#roleModal .btn-close');
    }
  });

});
