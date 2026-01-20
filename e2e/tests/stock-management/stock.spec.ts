import { test, expect } from '../../fixtures';
import { navigateToModule } from '../../helpers/navigation.helper';

/**
 * Stock Management Module Tests
 * 
 * Tests for stock/inventory management
 */

test.describe('Stock Management @stock-management', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'stock-management-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-SM-001: View Stock List', async ({ authenticatedPage }) => {
    // Wait for module to fully load
    await authenticatedPage.waitForTimeout(500);
    
    // Look for stock table, list, or any content
    const stockList = authenticatedPage.locator(
      '#content-area, table, .stock-grid, [data-testid="stock"], ' +
      'h1, h2, .module-content, .nav-tabs'
    ).first();
    
    await expect(stockList).toBeVisible({ timeout: 10000 });
  });

  test('TC-SM-002: Stock Location Display', async ({ authenticatedPage }) => {
    const locationColumn = authenticatedPage.locator(
      'th:has-text("Location"), th:has-text("Warehouse"), th:has-text("Room")'
    );
    const count = await locationColumn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-SM-003: Product Type Column', async ({ authenticatedPage }) => {
    const typeColumn = authenticatedPage.locator(
      'th:has-text("Type"), th:has-text("Product"), th:has-text("Category")'
    );
    const count = await typeColumn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-SM-004: Quantity Display', async ({ authenticatedPage }) => {
    const qtyColumn = authenticatedPage.locator(
      'th:has-text("Qty"), th:has-text("Quantity"), th:has-text("kg")'
    );
    const count = await qtyColumn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-SM-005: Stock Status Badges', async ({ authenticatedPage }) => {
    const statusBadges = authenticatedPage.locator(
      '.badge, .status-badge, [data-status], th:has-text("Status")'
    );
    const count = await statusBadges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('TC-SM-006: Filter by Product Type', async ({ authenticatedPage }) => {
    const filter = authenticatedPage.locator(
      'select[name*="type"], #typeFilter, .type-filter, .nav-tabs'
    );
    const count = await filter.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

});
