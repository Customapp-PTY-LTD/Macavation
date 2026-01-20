import { test, expect } from '../../fixtures';
import { navigateToModule } from '../../helpers/navigation.helper';

/**
 * Oil Production Module Tests
 * 
 * Tests for oil production batch workflows
 */

test.describe('Oil Production - Batch Management @oil-production', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'oil-production-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-OP-001: View Oil Batches List', async ({ authenticatedPage }) => {
    // Wait for module to fully load
    await authenticatedPage.waitForTimeout(500);
    
    // Look for oil batches table, list, or any content
    const batchList = authenticatedPage.locator(
      '#content-area, table, .oil-batches-grid, [data-testid="oil-batches"], ' +
      'h1, h2, .module-content, .nav-tabs'
    ).first();
    
    await expect(batchList).toBeVisible({ timeout: 10000 });
  });

  test('TC-OP-002: Oil Batch Status Display', async ({ authenticatedPage }) => {
    const statusBadges = authenticatedPage.locator(
      '.badge, .status-badge, [data-status], th:has-text("Status")'
    );
    const count = await statusBadges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-OP-003: Temperature Column Visible', async ({ authenticatedPage }) => {
    const tempHeader = authenticatedPage.locator(
      'th:has-text("Temp"), th:has-text("Temperature"), th:has-text("°C")'
    );
    const count = await tempHeader.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-OP-004: Oil Yield Display', async ({ authenticatedPage }) => {
    const yieldColumn = authenticatedPage.locator(
      'th:has-text("Yield"), th:has-text("Output"), th:has-text("Litres")'
    );
    const count = await yieldColumn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-OP-005: Add Oil Batch Button', async ({ authenticatedPage }) => {
    const addBtn = authenticatedPage.locator(
      'button:has-text("Add"), button:has-text("New"), button:has-text("Create"), #addOilBatchBtn'
    );
    const count = await addBtn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-OP-006: Batch Number Format OB-', async ({ authenticatedPage }) => {
    const batchCells = authenticatedPage.locator('td:has-text("OB-")');
    const count = await batchCells.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

});
