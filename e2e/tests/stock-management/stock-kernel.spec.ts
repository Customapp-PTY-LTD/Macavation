import { test, expect } from '../../fixtures';
import { navigateToModule } from '../../helpers/navigation.helper';

/**
 * Stock (Kernel) Module Tests
 *
 * Per QA_STRATEGY_BLUEPRINT: Grid View, Kernel batch journey, By style / Weekly / Overview,
 * Send to Dispatch, Refresh. Route: stock-management-kernel.
 */

test.describe('Stock (Kernel) @stock-kernel', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'stock-management-kernel');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-SK-001: Stock (Kernel) title and module load', async ({ authenticatedPage }) => {
    await authenticatedPage.waitForTimeout(500);
    const title = authenticatedPage.locator('#stockManagementTitle:has-text("Stock (Kernel)")');
    await expect(title).toBeVisible({ timeout: 10000 });
    const moduleContent = authenticatedPage.locator('.module-content, #content-area').first();
    await expect(moduleContent).toBeVisible({ timeout: 10000 });
  });

  test('TC-SK-002: Kernel batch journey card visible', async ({ authenticatedPage }) => {
    const journeyCard = authenticatedPage.locator('#kernelBatchJourneyCard');
    await expect(journeyCard).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.locator('#kernelBatchJourneyCard h5:has-text("Kernel batch journey")')).toBeVisible();
  });

  test('TC-SK-003: Kernel Stock by style section present', async ({ authenticatedPage }) => {
    const byStylePanel = authenticatedPage.locator('#ksByStylePanel');
    await expect(byStylePanel).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.locator('h6:has-text("Kernel Stock by style"), .text-muted:has-text("Kernel Stock by style")').first()).toBeVisible({ timeout: 5000 });
  });

  test('TC-SK-004: View toggle By style / Weekly / Overview', async ({ authenticatedPage }) => {
    const byStyleBtn = authenticatedPage.locator('#ksViewByStyle');
    const weeklyBtn = authenticatedPage.locator('#ksViewWeekly');
    const overviewBtn = authenticatedPage.locator('#ksViewOverview');
    await expect(byStyleBtn).toBeVisible();
    await expect(weeklyBtn).toBeVisible();
    await expect(overviewBtn).toBeVisible();
    await expect(byStyleBtn).toHaveClass(/active/);
    await weeklyBtn.click();
    await authenticatedPage.waitForTimeout(300);
    await expect(weeklyBtn).toHaveClass(/active/);
    await overviewBtn.click();
    await authenticatedPage.waitForTimeout(300);
    await expect(overviewBtn).toHaveClass(/active/);
    await byStyleBtn.click();
    await authenticatedPage.waitForTimeout(300);
    await expect(byStyleBtn).toHaveClass(/active/);
  });

  test('TC-SK-005: Send to Dispatch button visible', async ({ authenticatedPage }) => {
    const sendBtn = authenticatedPage.locator('#sendToDispatchBtn');
    await expect(sendBtn).toBeVisible({ timeout: 10000 });
    await expect(sendBtn).toContainText(/Send to Dispatch|Dispatch/);
  });

  test('TC-SK-006: Refresh Kernel Stock button when present', async ({ authenticatedPage }) => {
    const refreshBtn = authenticatedPage.locator('#refreshKernelStockBtn');
    const isVisible = await refreshBtn.isVisible().catch(() => false);
    if (isVisible) {
      await refreshBtn.click();
      await authenticatedPage.waitForLoadState('networkidle');
      await expect(authenticatedPage.locator('#kernelBatchJourneyCard')).toBeVisible({ timeout: 5000 });
    }
  });

  test('TC-SK-007: No Access Denied in content area', async ({ authenticatedPage }) => {
    await authenticatedPage.waitForTimeout(1000);
    const accessDenied = authenticatedPage.locator('#content-area:has-text("Access Denied")');
    await expect(accessDenied).not.toBeVisible();
  });

  test('TC-SK-008: Export button in toolbar', async ({ authenticatedPage }) => {
    const exportBtn = authenticatedPage.locator('#exportStockBtn');
    await expect(exportBtn).toBeVisible({ timeout: 5000 });
  });
});
