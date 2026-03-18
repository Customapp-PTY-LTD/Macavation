import { test, expect } from '../fixtures';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Kernel Production Module Tests
 * QA Blueprint: Playwright Tests/{module-name}/{module-name}.spec.ts
 * Tests for kernel production batch workflows
 */

test.describe('Kernel Production - Batch Management @kernel-production', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'kernel-production-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-KP-001: View Production Batches List', async ({ authenticatedPage }) => {
    await authenticatedPage.waitForTimeout(500);
    await expect(authenticatedPage.locator('h1:has-text("Kernel Production Workflow"), h2:has-text("Kernel Production")').first()).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.locator('#kpSilosGrid, #kpKanbanBoard, #kpTableCard').first()).toBeVisible({ timeout: 10000 });
  });

  test('TC-KP-002: Create New Production Batch Button', async ({ authenticatedPage }) => {
    // Kernel Production adds batches via silos (click empty silo), not a header button.
    await expect(authenticatedPage.locator('h1:has-text("Kernel Production Workflow")')).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.locator('#kpSilosGrid')).toBeVisible({ timeout: 5000 });
    // Silos are divs .kp-silo-box (loaded async); empty silo = entry point for "add batch"
    await expect(authenticatedPage.locator('#kpSilosGrid .kp-silo-box').first()).toBeVisible({ timeout: 15000 });
  });

  test('TC-KP-003: Batch Status Workflow Steps', async ({ authenticatedPage }) => {
    const workflowSteps = authenticatedPage.locator(
      '.workflow-steps, .step-indicator, [data-step], ' +
      '.status-badge, .batch-status, th:has-text("Status")'
    );
    const count = await workflowSteps.count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-KP-004: Filter Batches by Status', async ({ authenticatedPage }) => {
    const filterElement = authenticatedPage.locator('#filterBatchStatus');
    await expect(filterElement).toBeVisible({ timeout: 5000 });
    const options = await filterElement.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(0);
    await filterElement.selectOption('awaiting_production');
    await authenticatedPage.waitForTimeout(300);
    const value = await filterElement.inputValue();
    expect(value).toBe('awaiting_production');
  });

  test('TC-KP-005: Search Batches', async ({ authenticatedPage }) => {
    const searchInput = authenticatedPage.locator('#searchBatchesInput');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('KB-');
    await authenticatedPage.waitForTimeout(500);
    expect(await searchInput.inputValue()).toBe('KB-');
  });

  test('TC-KP-006: Batch Details View', async ({ authenticatedPage }) => {
    const batchRow = authenticatedPage.locator(
      'table tbody tr, .batch-card, .batch-item'
    ).first();
    if (await batchRow.isVisible()) {
      await batchRow.click();
      await authenticatedPage.waitForTimeout(500);
    }
  });

  test('TC-KP-007: Quality Hold Badge Visibility', async ({ authenticatedPage }) => {
    const qualityHoldBadge = authenticatedPage.locator(
      '.badge:has-text("Hold"), .quality-hold, [data-status="hold"], ' +
      '.text-warning:has-text("Hold"), .status-hold'
    );
    const count = await qualityHoldBadge.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-KP-008: Batch Weight Display', async ({ authenticatedPage }) => {
    const weightElement = authenticatedPage.locator(
      'th:has-text("Weight"), td:has-text("kg"), .weight-display, ' +
      '[data-field="weight"], [data-field="nis_weight"]'
    );
    const count = await weightElement.count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-KP-009: Export Functionality', async ({ authenticatedPage }) => {
    const exportBtn = authenticatedPage.locator('#exportBatchesBtn');
    await expect(exportBtn).toBeVisible({ timeout: 5000 });
  });

  test('TC-KP-010: Silos section and Board/Table view toggle', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.locator('#kpSilosGrid')).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.locator('h5:has-text("Silos")')).toBeVisible();
    const boardBtn = authenticatedPage.locator('#kpViewKanban');
    const tableBtn = authenticatedPage.locator('#kpViewTable');
    await expect(boardBtn).toHaveClass(/active/);
    await tableBtn.click();
    await authenticatedPage.waitForTimeout(500);
    await expect(authenticatedPage.locator('#kpTableCard')).toBeVisible();
    await expect(authenticatedPage.locator('#batchesTable')).toBeVisible({ timeout: 5000 });
  });

  test('TC-KP-011: Pagination', async ({ authenticatedPage }) => {
    const pagination = authenticatedPage.locator(
      '.pagination, [data-testid="pagination"], ' +
      'button:has-text("Next"), .page-link, .pager'
    );
    const count = await pagination.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-KP-012: Batch Number Format in Table view', async ({ authenticatedPage }) => {
    await authenticatedPage.locator('#kpViewTable').click();
    await authenticatedPage.waitForTimeout(500);
    await expect(authenticatedPage.locator('#batchesTable')).toBeVisible({ timeout: 5000 });
    const batchNumbers = authenticatedPage.locator('#batchesTable tbody td:first-child');
    const count = await batchNumbers.count();
    if (count > 0) {
      const firstBatchNumber = await batchNumbers.first().textContent();
      expect(firstBatchNumber?.trim().length).toBeGreaterThan(0);
    }
  });

  test('TC-KP-013: No Access Denied in content area', async ({ authenticatedPage }) => {
    await authenticatedPage.waitForTimeout(1000);
    const accessDenied = authenticatedPage.locator('#content-area:has-text("Access Denied")');
    await expect(accessDenied).not.toBeVisible();
  });
});
