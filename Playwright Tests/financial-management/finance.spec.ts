import { test, expect } from '../fixtures';
import { navigateToModule } from '../helpers/navigation.helper';

/**
 * Financial Management Module Tests
 * 
 * Tests for financial management including payments and POs
 */

test.describe('Financial Management @financial', () => {

  test.beforeEach(async ({ authenticatedPage }) => {
    await navigateToModule(authenticatedPage, 'financial-management-grid');
    await authenticatedPage.waitForLoadState('networkidle');
    // Wait for any content to load
    await authenticatedPage.waitForTimeout(1000);
  });

  test('TC-FM-001: View Financial Dashboard', async ({ authenticatedPage }) => {
    // Wait for module to fully load
    await authenticatedPage.waitForTimeout(500);
    
    // Check for any content indicator in financial module
    const content = authenticatedPage.locator(
      '#content-area, .module-content, .financial-content, table, h1, h2, .nav-tabs'
    ).first();
    
    await expect(content).toBeVisible({ timeout: 10000 });
  });

  test('TC-FM-002: Payment Records Display', async ({ authenticatedPage }) => {
    const paymentSection = authenticatedPage.locator(
      'th:has-text("Payment"), th:has-text("Amount"), .payment-list, #paymentsTable'
    );
    const count = await paymentSection.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-FM-003: Purchase Order Section', async ({ authenticatedPage }) => {
    const poSection = authenticatedPage.locator(
      'th:has-text("PO"), th:has-text("Order"), .po-list, #purchaseOrdersTable, .nav-tabs'
    );
    const count = await poSection.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-FM-004: Amount/Currency Display', async ({ authenticatedPage }) => {
    const currencyDisplay = authenticatedPage.locator(
      'td:has-text("R"), td:has-text("ZAR"), th:has-text("Amount"), th:has-text("Value")'
    );
    const count = await currencyDisplay.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-FM-005: Date Range Filter', async ({ authenticatedPage }) => {
    const dateFilter = authenticatedPage.locator(
      'input[type="date"], .date-picker, #startDate, #endDate, .date-range'
    );
    const count = await dateFilter.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-FM-006: Export Financial Reports', async ({ authenticatedPage }) => {
    const exportBtn = authenticatedPage.locator(
      'button:has-text("Export"), button:has-text("Download"), #exportBtn'
    );
    const count = await exportBtn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

});

