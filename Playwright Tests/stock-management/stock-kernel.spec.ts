import { test, expect } from '../fixtures';
import { navigateToStockKernel } from '../helpers/navigation.helper';

/**
 * Stock (Kernel) Module Tests
 * QA Blueprint: Playwright Tests/{module-name}/ — Stock (Kernel) variant.
 * Grid View, Kernel batch journey, By style / Weekly / Overview, Send to Dispatch, Refresh.
 */

test.describe('Stock (Kernel) @stock-kernel', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToStockKernel(authenticatedPage);
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
    await expect(byStyleBtn).toBeVisible();
    await expect(byStyleBtn).toHaveClass(/active/);

    const moreViewsBtn = authenticatedPage.locator('#ksMoreViewsBtn');
    if (await moreViewsBtn.isVisible().catch(() => false)) {
      await moreViewsBtn.click();
      await authenticatedPage.locator('.js-ks-more-view[data-view="weekly"]').click();
      await authenticatedPage.waitForTimeout(300);
      await authenticatedPage.locator('#ksWeeklyPanel, #ksOverviewPanel').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await moreViewsBtn.click();
      await authenticatedPage.locator('.js-ks-more-view[data-view="overview"]').click();
      await authenticatedPage.waitForTimeout(300);
    }

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

/**
 * Kernel – Form Operations: Send to Dispatch (QA Blueprint: select dropdown, required fields, save).
 * Select buyer, set delivery date, Next → step 2; optionally add to basket and send.
 */
test.describe('Kernel - Form Operations: Send to Dispatch @kernel', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToStockKernel(authenticatedPage);
  });

  test('TC-SD-001: Send to Dispatch modal opens with buyer and date', async ({ authenticatedPage }) => {
    await authenticatedPage.locator('#sendToDispatchBtn').click();
    await expect(authenticatedPage.locator('#sendToDispatchModal')).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.locator('#dispatchBuyer')).toBeVisible();
    await expect(authenticatedPage.locator('#dispatchBuyerContact')).toBeVisible();
    await expect(authenticatedPage.locator('#dispatchDeliveryDate')).toBeVisible();
    await expect(authenticatedPage.locator('#dispatchModalSelectBoxesBtn')).toBeVisible();
  });

  test('TC-SD-002: Buyer dropdown is populated (kernel customers)', async ({ authenticatedPage }) => {
    await authenticatedPage.locator('#sendToDispatchBtn').click();
    await expect(authenticatedPage.locator('#sendToDispatchModal')).toBeVisible({ timeout: 10000 });
    // Wait for get_contacts to load: dropdown has placeholder + at least one kernel customer from DB
    await expect(authenticatedPage.locator('#dispatchBuyerContact option').nth(1)).toBeAttached({ timeout: 10000 });
    const count = await authenticatedPage.locator('#dispatchBuyerContact option').count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('TC-SD-003: Select buyer and date then Next shows step 2', async ({ authenticatedPage }) => {
    await authenticatedPage.locator('#sendToDispatchBtn').click();
    await expect(authenticatedPage.locator('#sendToDispatchModal')).toBeVisible({ timeout: 10000 });
    // Wait for kernel customers to load from DB (placeholder + at least one option)
    await expect(authenticatedPage.locator('#dispatchBuyerContact option').nth(1)).toBeAttached({ timeout: 10000 });
    const optionCount = await authenticatedPage.locator('#dispatchBuyerContact option').count();
    if (optionCount > 1) {
      await authenticatedPage.locator('#dispatchBuyerContact').selectOption({ index: 1 });
      await authenticatedPage.waitForTimeout(300);
      const selectedText = await authenticatedPage.locator('#dispatchBuyerContact option:checked').textContent();
      await authenticatedPage.locator('#dispatchBuyer').fill(selectedText?.trim() || 'Test buyer');
    } else {
      await authenticatedPage.locator('#dispatchBuyer').fill('E2E Test Buyer');
    }
    // #dispatchDeliveryDate is readonly (Flatpickr); app defaults it to today — do not use fill()
    await expect(authenticatedPage.locator('#dispatchDeliveryDate')).toHaveValue(/.+/, { timeout: 5000 });
    await authenticatedPage.locator('#dispatchModalSelectBoxesBtn').click();
    await authenticatedPage.waitForTimeout(1000);
    await expect(authenticatedPage.locator('#sendToDispatchStep2')).toBeVisible();
    await expect(authenticatedPage.locator('#dispatchModalBackBtn')).toBeVisible();
  });

  test('TC-SD-004: Back from step 2 returns to step 1', async ({ authenticatedPage }) => {
    await authenticatedPage.locator('#sendToDispatchBtn').click();
    await expect(authenticatedPage.locator('#sendToDispatchModal')).toBeVisible({ timeout: 10000 });
    await authenticatedPage.waitForTimeout(500);
    await authenticatedPage.locator('#dispatchBuyer').fill('Test');
    // #dispatchDeliveryDate is readonly (Flatpickr); app defaults to today
    await expect(authenticatedPage.locator('#dispatchDeliveryDate')).toHaveValue(/.+/, { timeout: 5000 });
    await authenticatedPage.locator('#dispatchModalSelectBoxesBtn').click();
    await authenticatedPage.waitForTimeout(500);
    await authenticatedPage.locator('#dispatchModalBackBtn').click();
    await authenticatedPage.waitForTimeout(300);
    await expect(authenticatedPage.locator('#sendToDispatchStep1')).toBeVisible();
  });

  test('TC-SD-005: Cancel closes modal', async ({ authenticatedPage }) => {
    await authenticatedPage.locator('#sendToDispatchBtn').click();
    await expect(authenticatedPage.locator('#sendToDispatchModal')).toBeVisible({ timeout: 10000 });
    await authenticatedPage.locator('#sendToDispatchModal .btn-close, #sendToDispatchModal [data-bs-dismiss="modal"]').first().click();
    await authenticatedPage.waitForTimeout(500);
    await expect(authenticatedPage.locator('#sendToDispatchModal.show')).not.toBeVisible();
  });
});
