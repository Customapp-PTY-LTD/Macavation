import { test, expect } from '../fixtures';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Kernel Dispatch Module Tests
 * QA Blueprint: Playwright Tests/{module-name}/{module-name}.spec.ts
 * Grid View, View Toggle, Refresh. Kernel Dispatch lists orders (baskets) from Stock (Kernel).
 */

test.describe('Kernel Dispatch @kernel-dispatch', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'kernel-dispatch-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-KD-001: View Kernel Dispatch module', async ({ authenticatedPage }) => {
    await authenticatedPage.waitForTimeout(500);
    const moduleContent = authenticatedPage.locator('.module-content, #content-area').first();
    await expect(moduleContent).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.locator('h1:has-text("Kernel Dispatch"), h2:has-text("Kernel Dispatch")')).toBeVisible({ timeout: 5000 });
  });

  test('TC-KD-002: Kernel outbound card visible', async ({ authenticatedPage }) => {
    const card = authenticatedPage.locator('.card-title:has-text("Kernel outbound"), .card-text:has-text("INV")').first();
    await expect(card).toBeVisible({ timeout: 10000 });
  });

  test('TC-KD-003: Board view is default', async ({ authenticatedPage }) => {
    const board = authenticatedPage.locator('#kdKanbanBoard');
    await expect(board).toBeVisible({ timeout: 10000 });
    const boardViewBtn = authenticatedPage.locator('#kdViewKanban');
    await expect(boardViewBtn).toHaveClass(/active/);
  });

  test('TC-KD-004: Switch to Table view', async ({ authenticatedPage }) => {
    const tableViewBtn = authenticatedPage.locator('#kdViewTable');
    await tableViewBtn.click();
    await authenticatedPage.waitForTimeout(500);
    const tableCard = authenticatedPage.locator('#kdTableCards');
    await expect(tableCard).toBeVisible({ timeout: 5000 });
    const table = authenticatedPage.locator('#kernelDispatchTable');
    await expect(table).toBeVisible({ timeout: 5000 });
  });

  test('TC-KD-005: Table view shows dispatch orders columns', async ({ authenticatedPage }) => {
    await authenticatedPage.locator('#kdViewTable').click();
    await authenticatedPage.waitForTimeout(800);
    const table = authenticatedPage.locator('#kernelDispatchTable');
    await expect(table).toBeVisible({ timeout: 8000 });
    const header = authenticatedPage.locator('#kernelDispatchTable thead th');
    await expect(header.first()).toBeVisible({ timeout: 5000 });
    const hasBuyer = await authenticatedPage.locator('th:has-text("Buyer")').isVisible().catch(() => false);
    const hasDelivery = await authenticatedPage.locator('th:has-text("Delivery"), th:has-text("Created")').first().isVisible().catch(() => false);
    expect(hasBuyer || hasDelivery || (await header.count()) >= 2).toBeTruthy();
  });

  test('TC-KD-006: Refresh button visible and clickable', async ({ authenticatedPage }) => {
    const refreshBtn = authenticatedPage.locator('#kernelDispatchRefreshBtn');
    await expect(refreshBtn).toBeVisible({ timeout: 10000 });
    await refreshBtn.click();
    await authenticatedPage.waitForLoadState('networkidle');
    await expect(authenticatedPage.locator('#kdKanbanBoard, #kdTableCards, #kernelDispatchTable').first()).toBeVisible({ timeout: 8000 });
  });

  test('TC-KD-007: Dispatched table section present in Table view', async ({ authenticatedPage }) => {
    await authenticatedPage.locator('#kdViewTable').click();
    await authenticatedPage.waitForTimeout(500);
    const dispatchedSection = authenticatedPage.locator('h5:has-text("Baskets marked as dispatched")');
    await expect(dispatchedSection).toBeVisible({ timeout: 5000 });
    await expect(authenticatedPage.locator('#kernelDispatchedTable')).toBeVisible();
  });

  test('TC-KD-008: No Access Denied in content area', async ({ authenticatedPage }) => {
    await authenticatedPage.waitForTimeout(1000);
    const accessDenied = authenticatedPage.locator('#content-area:has-text("Access Denied")');
    await expect(accessDenied).not.toBeVisible();
  });
});
