import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { navigateToAdminRoles } from '../helpers/navigation.helper';

/**
 * Admin Customize must not cross-edit role_features between roles.
 * Regression for: disabling admin-grid on Production Manager must not remove it from super_user.
 */

async function openCustomizeForRole(page: Page, roleLabel: string): Promise<void> {
  const row = page.locator('tr.js-admin-role-row').filter({ hasText: roleLabel }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.locator('[data-admin-customize-role]').click();
  await page.waitForSelector('#adminRoleCustomizeModal.show', { state: 'visible', timeout: 15000 });
  await page.locator('#adminFeaturesTableBody').filter({ hasText: 'Loading' }).waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
}

async function getAdminGridCheckbox(page: Page) {
  const row = page.locator('#adminFeaturesTableBody tr.feature-row').filter({
    has: page.locator('code', { hasText: 'admin-grid' }),
  }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  return row.locator('.admin-feature-checkbox');
}

async function closeCustomizeModal(page: Page): Promise<void> {
  await page.locator('#adminRoleCustomizeModal .btn-secondary').click();
  await page.waitForSelector('#adminRoleCustomizeModal.show', { state: 'hidden', timeout: 10000 }).catch(() => {});
}

test.describe('Admin Customize role isolation @roles-management @critical', () => {

  test('TC-ACRI-001: Production Manager customize does not remove super_user admin-grid', async ({ loginAsSuperAdmin }) => {
    const page = await loginAsSuperAdmin();
    await page.waitForLoadState('networkidle');
    await navigateToAdminRoles(page);

    // Baseline: super_user has User & access (admin-grid)
    await openCustomizeForRole(page, 'Super User');
    const superCheckbox = await getAdminGridCheckbox(page);
    const superHadAdminGrid = await superCheckbox.isChecked();
    expect(superHadAdminGrid).toBeTruthy();
    await closeCustomizeModal(page);

    // Act: toggle admin-grid for Production Manager only
    await openCustomizeForRole(page, 'Production Manager');
    const prodCheckbox = await getAdminGridCheckbox(page);
    const prodInitially = await prodCheckbox.isChecked();
    await prodCheckbox.setChecked(!prodInitially);
    await page.waitForTimeout(1500);
    await closeCustomizeModal(page);

    // Assert: super_user still has admin-grid
    await openCustomizeForRole(page, 'Super User');
    const superCheckboxAfter = await getAdminGridCheckbox(page);
    await expect(superCheckboxAfter).toBeChecked();
    await closeCustomizeModal(page);

    // Restore Production Manager prior state
    await openCustomizeForRole(page, 'Production Manager');
    const prodRestore = await getAdminGridCheckbox(page);
    if (await prodRestore.isChecked() !== prodInitially) {
      await prodRestore.setChecked(prodInitially);
      await page.waitForTimeout(1500);
    }
    await closeCustomizeModal(page);
  });

  test('TC-ACRI-002: Rapid role switch in Customize does not apply stale toggle', async ({ loginAsSuperAdmin }) => {
    const page = await loginAsSuperAdmin();
    await page.waitForLoadState('networkidle');
    await navigateToAdminRoles(page);

    await openCustomizeForRole(page, 'Super User');
    const superCheckbox = await getAdminGridCheckbox(page);
    await expect(superCheckbox).toBeChecked();

    // Open another role while modal stays open (same session)
    await openCustomizeForRole(page, 'Production Manager');
    await page.locator('#adminFeaturesTableBody').filter({ hasText: 'Loading' }).waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    const prodCheckbox = await getAdminGridCheckbox(page);
    const prodBefore = await prodCheckbox.isChecked();
    await prodCheckbox.click();
    await page.waitForTimeout(2000);

    // Switch back quickly to super_user
    await openCustomizeForRole(page, 'Super User');
    const superAfter = await getAdminGridCheckbox(page);
    await expect(superAfter).toBeChecked();

    await closeCustomizeModal(page);

    // Restore production manager if changed
    await openCustomizeForRole(page, 'Production Manager');
    const prodAfter = await getAdminGridCheckbox(page);
    if (await prodAfter.isChecked() !== prodBefore) {
      await prodAfter.setChecked(prodBefore);
      await page.waitForTimeout(1500);
    }
    await closeCustomizeModal(page);
  });

});
